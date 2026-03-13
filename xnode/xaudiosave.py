"""
音频保存节点模块 (V3 API)
========================

这个模块包含音频保存相关的节点。
"""

import json
import os
import re
import shutil
import tempfile
import time
from pathlib import Path

import comfy.utils
import ffmpeg
import numpy as np
import torch
from comfy_api.latest import io
from scipy.io import wavfile
from torchaudio.transforms import Resample

try:
    from ..xz3r0_utils import (
        ensure_unique_filename,
        replace_datetime_tokens,
        resolve_output_subpath,
        sanitize_path_component,
    )
except ImportError:
    # 兼容直接执行测试脚本时从仓库根目录导入 xnode 的场景。
    from xz3r0_utils import (
        ensure_unique_filename,
        replace_datetime_tokens,
        resolve_output_subpath,
        sanitize_path_component,
    )

try:
    import folder_paths

    COMFYUI_AVAILABLE = True
except ImportError:
    COMFYUI_AVAILABLE = False

NULL_DEVICE = "NUL" if os.name == "nt" else "/dev/null"


class XAudioSave(io.ComfyNode):
    """
    XAudioSave 音频保存节点 (V3)

    提供音频保存功能，支持WAV/FLAC无损导出，自定义文件名、
    子文件夹、日期时间标识符、音量标准化和峰值限制。

    功能:
        - 保存音频到ComfyUI默认输出目录
        - 默认使用WAV无损格式(PCM 32-bit float)
        - 支持FLAC无损压缩导出(最终阶段量化到s32)
        - WAV 在当前 FFmpeg 路径下不稳定保留自定义 metadata
        - FLAC 支持嵌入 prompt/workflow 等工作流 metadata
        - 支持多种采样率(44.1kHz, 48kHz, 96kHz, 192kHz)
        - LUFS音量标准化(默认-14.1 LUFS)
        - 传统压缩器支持(acompressor, 三种预设: 快速/平衡/缓慢)
        - 支持自定义压缩比(1.0-20.0)
        - 多声道统一处理(link=average, 保持立体声平衡)
        - 峰值限制(支持两种模式: Disabled, True Peak)
        - 支持自定义文件名和子文件夹
        - 支持日期时间标识符(%Y%, %m%, %d%, %H%, %M%, %S%)
        - 自动添加序列号防止覆盖(从00001开始)
        - 仅支持单级子文件夹创建
        - 安全防护(防止路径遍历攻击)
        - 输出相对路径(不泄露绝对路径)

    处理流程:
        1. 应用传统压缩器(如果启用):
           - 选择预设模式(快速/平衡/缓慢)
           - 可选使用自定义压缩比覆盖预设值
           - 使用 acompressor 滤镜进行动态范围压缩
        2. 使用 loudnorm 双阶段处理进行 LUFS 标准化:
           - 步骤 2a: 粗略标准化 (dual_mono=true) - 快速达到接近目标的 LUFS
           - 步骤 2b: 测量粗略标准化后的音频信息
           - 步骤 2c: 精确调整 (linear=true) - 基于粗略测量值进行精确线性归一化
        3. 最终测量音频信息验证结果

    压缩预设参数说明:
        - 阈值自适应计算: threshold = actual_lufs + (
            actual_lufs - target_lufs) * 0.3 + base_offset
        - 快速: 适合语音/播客, base_offset=6dB, ratio=3:1,
            attack=10ms, release=50ms
        - 平衡: 通用/音乐, base_offset=4dB, ratio=2:1,
            attack=20ms, release=250ms
        - 缓慢: 适合母带/广播, base_offset=2dB, ratio=1.5:1,
            attack=50ms, release=500ms

    峰值限制说明:
        - True Peak: 广播标准True Peak限制(8x过采样，精度高)

    输入:
        audio: 音频对象 (AUDIO)
        filename_prefix: 文件名前缀 (STRING)
        subfolder: 子文件夹名称 (STRING)
        sample_rate: 采样率 (COMBO)
        target_lufs: 目标LUFS值 (FLOAT)
        enable_peak_limiter: 是否启用峰值限制 (BOOLEAN)
        peak_limit: 峰值限制值 (FLOAT)
        enable_compression: 是否启用压缩 (BOOLEAN)
        compression_mode: 压缩预设模式 (COMBO)
        use_custom_ratio: 是否使用自定义压缩比 (BOOLEAN)
        custom_ratio: 自定义压缩比 (FLOAT)

    输出:
        processed_audio: 处理后的音频(重采样、压缩、LUFS标准化、峰值限制)
        save_path: 保存的相对路径 (STRING)

    使用示例:
        filename_prefix="MyAudio_%Y%m%d", subfolder="Audio",
        sample_rate="48000", target_lufs=-14.0,
        enable_peak_limiter=True, peak_limit=-1.0,
        enable_compression=True, compression_mode="平衡"
        输出: processed_audio(重采样/压缩/标准化/峰值限制),
        save_path="output/Audio/MyAudio_20260114.wav"
    """

    SAMPLE_RATES = {
        "44100": 44100,
        "48000": 48000,
        "96000": 96000,
        "192000": 192000,
    }
    OUTPUT_DIRECTORY_ERROR = "Unable to create output directory"
    INVALID_SAVE_PATH_ERROR = "Invalid save path"
    RELATIVE_PATH_ERROR = "Unable to build relative save path"
    AUDIO_TENSOR_PREPARE_ERROR = "Unable to prepare audio tensor for saving"
    AUDIO_NORMALIZE_ERROR = "Audio normalization failed"
    AUDIO_SAVE_ERROR = "Audio file saving failed"
    FILE_SAVE_VALIDATION_ERROR = "Saved audio file validation failed"
    INVALID_FORMAT_ERROR = "format must be either WAV or FLAC"

    @classmethod
    def define_schema(cls):
        """定义节点的输入输出模式"""
        return io.Schema(
            node_id="XAudioSave",
            display_name="XAudioSave",
            description="Save audio with LUFS normalization, compression, "
            "peak limiting, and WAV/FLAC lossless output",
            category="♾️ Xz3r0/File-Processing",
            is_output_node=True,
            inputs=[
                io.Audio.Input(
                    "audio",
                    tooltip="Input audio tensor",
                ),
                io.String.Input(
                    "filename_prefix",
                    default="ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%",
                    tooltip="Filename prefix, supports datetime "
                    "placeholders: %Y%, %m%, %d%, %H%, %M%, %S%",
                ),
                io.String.Input(
                    "subfolder",
                    default="Audio",
                    tooltip="Subfolder name (no path separators "
                    "allowed), supports datetime "
                    "placeholders: %Y%, %m%, %d%, %H%, %M%, %S%",
                ),
                io.Combo.Input(
                    "format",
                    options=["WAV", "FLAC"],
                    default="FLAC",
                    tooltip="Output file format. WAV keeps float32 "
                    "master output but does not reliably preserve "
                    "custom workflow metadata. FLAC uses lossless "
                    "compression and supports metadata embedding.",
                ),
                io.Combo.Input(
                    "sample_rate",
                    options=list(cls.SAMPLE_RATES.keys()),
                    default="48000",
                    tooltip="Target sample rate for the output audio file",
                ),
                io.Float.Input(
                    "target_lufs",
                    default=-14.1,
                    min=-70.0,
                    max=0.0,
                    step=0.1,
                    tooltip="Target LUFS value for loudness normalization. "
                    "Lower values make audio quieter. "
                    "Default -14.1, Set to -70 to disable.",
                ),
                io.Boolean.Input(
                    "enable_peak_limiter",
                    default=True,
                    tooltip="Enable True Peak limiting "
                    "(Broadcast standard, 8x oversampling). "
                    "When disabled, skips peak limiting.",
                ),
                io.Float.Input(
                    "peak_limit",
                    default=-1.1,
                    min=-6.0,
                    max=0.0,
                    step=0.1,
                    tooltip="Peak limiting value in dB. "
                    "Only used when enable_peak_limiter is enabled. "
                    "Default -1.1, Values below 0 dB prevent clipping.",
                ),
                io.Boolean.Input(
                    "enable_compression",
                    default=False,
                    tooltip="Enable dynamic range compression using "
                    "acompressor filter. "
                    "When disabled, skips compression and "
                    "proceeds directly to LUFS normalization.",
                ),
                io.Combo.Input(
                    "compression_mode",
                    options=["Fast", "Balanced", "Slow"],
                    default="Balanced",
                    tooltip="Compression preset mode. "
                    "Threshold is automatically calculated based "
                    "on audio LUFS and target LUFS. "
                    "Fast: Fast response for voice/podcasts, "
                    "ratio=3:1. "
                    "Balanced: Balanced for general use, "
                    "ratio=2:1. "
                    "Slow: Smooth for mastering/broadcast, "
                    "ratio=1.5:1.",
                ),
                io.Boolean.Input(
                    "use_custom_ratio",
                    default=False,
                    tooltip="Enable custom compression ratio to "
                    "override preset value. "
                    "When disabled, uses the preset's "
                    "default ratio.",
                ),
                io.Float.Input(
                    "custom_ratio",
                    default=2.0,
                    min=1.0,
                    max=20.0,
                    step=0.1,
                    tooltip="Custom compression ratio (1.0 to 20.0). "
                    "Only used when use_custom_ratio is enabled. "
                    "Lower values = lighter compression, higher "
                    "values = stronger compression. "
                    "Set ratio to 1.0 to disable compression "
                    "(pass-through mode).",
                ),
            ],
            outputs=[
                io.Audio.Output(
                    "processed_audio",
                    tooltip="Audio after resampling, loudness "
                    "normalization, and peak limiting "
                    "(32-bit float format)",
                ),
                io.String.Output(
                    "save_path",
                    tooltip="Saved file path relative to ComfyUI "
                    "output directory",
                ),
            ],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(
        cls,
        audio: dict,
        filename_prefix: str,
        subfolder: str,
        format: str,
        sample_rate: str,
        target_lufs: float,
        enable_peak_limiter: bool,
        peak_limit: float,
        enable_compression: bool,
        compression_mode: str,
        use_custom_ratio: bool,
        custom_ratio: float,
    ) -> io.NodeOutput:
        """
        保存音频到ComfyUI输出目录

        Args:
            audio: 音频字典，包含"waveform"和"sample_rate"
            filename_prefix: 文件名前缀(支持日期时间标识符)
            subfolder: 子文件夹名称(单级)
            format: 输出格式 (WAV/FLAC)
            sample_rate: 采样率选项
            target_lufs: 目标LUFS值
            enable_peak_limiter: 是否启用峰值限制
            peak_limit: 峰值限制值
            enable_compression: 是否启用压缩
            compression_mode: 压缩预设模式
            use_custom_ratio: 是否使用自定义压缩比
            custom_ratio: 自定义压缩比

        Returns:
            NodeOutput: 包含处理后的音频和保存的相对路径
            - processed_audio: 32-bit float 格式的音频
            - save_path: 保存的音频文件相对路径(.wav或.flac)
        """
        # 获取ComfyUI默认输出目录
        output_dir = cls._get_output_directory()
        output_format = cls._normalize_output_format(format)
        # 处理日期时间标识符和安全过滤
        safe_filename_prefix = sanitize_path_component(filename_prefix)
        safe_filename_prefix = replace_datetime_tokens(
            safe_filename_prefix
        )

        safe_subfolder = sanitize_path_component(subfolder)
        safe_subfolder = replace_datetime_tokens(safe_subfolder)

        try:
            save_dir = resolve_output_subpath(output_dir, safe_subfolder)
        except ValueError as exc:
            raise RuntimeError(cls.INVALID_SAVE_PATH_ERROR) from exc

        # 创建目录(仅支持单级目录)
        try:
            save_dir.mkdir(exist_ok=True)
        except OSError as exc:
            raise RuntimeError(cls.OUTPUT_DIRECTORY_ERROR) from exc

        # 获取音频数据
        waveform = audio["waveform"]
        original_sr = audio["sample_rate"]

        # 确保波形数据格式正确
        if waveform.dim() == 3:
            waveform = waveform.squeeze(0)
        if waveform.dim() == 1:
            waveform = waveform.unsqueeze(0)

        # 获取目标采样率
        target_sr = cls.SAMPLE_RATES[sample_rate]

        # 定义处理步骤数
        # 步骤1: 重采样, 步骤2: 文件名生成, 步骤3-10: 音频处理各阶段
        total_steps = 10
        progress_bar = comfy.utils.ProgressBar(total_steps)

        # 重采样音频(如果需要)
        if original_sr != target_sr:
            waveform = cls._resample_audio(waveform, original_sr, target_sr)
        progress_bar.update_absolute(1)

        # 生成文件名(添加序列号)
        base_filename = safe_filename_prefix
        extension = ".wav" if output_format == "WAV" else ".flac"
        final_filename = ensure_unique_filename(
            save_dir, base_filename, extension
        )
        progress_bar.update_absolute(2)

        try:
            save_path = resolve_output_subpath(
                output_dir,
                Path(safe_subfolder) / final_filename,
            )
        except ValueError as exc:
            raise RuntimeError(cls.INVALID_SAVE_PATH_ERROR) from exc

        # 处理LUFS标准化和峰值限制
        # WAV 容器在当前 FFmpeg 路径下无法稳定保留自定义工作流元数据，
        # 因此 WAV 路径不做 metadata 注入。FLAC 路径会注入 metadata。
        final_lufs = target_lufs if target_lufs > -70 else None
        if final_lufs is not None:
            if output_format == "WAV":
                waveform = cls._normalize_audio(
                    waveform,
                    target_sr,
                    final_lufs,
                    enable_peak_limiter,
                    peak_limit,
                    enable_compression,
                    compression_mode,
                    use_custom_ratio,
                    custom_ratio,
                    save_path,
                    progress_bar,
                    current_step=2,
                )
            else:
                with tempfile.NamedTemporaryFile(
                    suffix=".wav", delete=False
                ) as temp_output:
                    temp_output_path = temp_output.name

                try:
                    waveform = cls._normalize_audio(
                        waveform,
                        target_sr,
                        final_lufs,
                        enable_peak_limiter,
                        peak_limit,
                        enable_compression,
                        compression_mode,
                        use_custom_ratio,
                        custom_ratio,
                        Path(temp_output_path),
                        progress_bar,
                        current_step=2,
                    )
                    metadata = cls._generate_metadata(
                        cls.hidden.prompt,
                        cls.hidden.extra_pnginfo,
                    )
                    cls._save_flac_from_source(
                        source_path=temp_output_path,
                        target_path=save_path,
                        metadata=metadata,
                    )
                finally:
                    if os.path.exists(temp_output_path):
                        try:
                            os.remove(temp_output_path)
                        except OSError:
                            pass
        else:
            # 没有LUFS标准化时按目标格式直接保存。
            if output_format == "WAV":
                cls._save_wav_32bit_float(
                    waveform,
                    save_path,
                    target_sr,
                )
            else:
                metadata = cls._generate_metadata(
                    cls.hidden.prompt,
                    cls.hidden.extra_pnginfo,
                )
                cls._save_flac_from_waveform(
                    waveform=waveform,
                    path=save_path,
                    sample_rate=target_sr,
                    metadata=metadata,
                )
            progress_bar.update_absolute(total_steps)

        cls._validate_saved_file(save_path)

        # 记录相对路径
        relative_path = cls._build_relative_save_path(save_path, output_dir)

        # 构建 ComfyUI 音频字典格式 (需要 batch 维度)
        processed_audio = {
            "waveform": waveform.unsqueeze(0),
            "sample_rate": target_sr,
        }

        return io.NodeOutput(processed_audio, relative_path)

    @classmethod
    def _resample_audio(
        cls, waveform: torch.Tensor, original_sr: int, target_sr: int
    ) -> torch.Tensor:
        """
        重采样音频

        Args:
            waveform: 音频波形张量 (channels, samples)
            original_sr: 原始采样率
            target_sr: 目标采样率

        Returns:
            重采样后的音频波形
        """
        resampler = Resample(orig_freq=original_sr, new_freq=target_sr)
        return resampler(waveform)

    @classmethod
    def _normalize_output_format(cls, output_format: str) -> str:
        """
        规范化输出格式并校验合法值。
        """
        normalized = str(output_format).upper()
        if normalized not in ("WAV", "FLAC"):
            raise ValueError(cls.INVALID_FORMAT_ERROR)
        return normalized

    @classmethod
    def _normalize_audio(
        cls,
        waveform: torch.Tensor,
        sample_rate: int,
        target_lufs: float,
        enable_peak_limiter: bool,
        peak_limit: float,
        enable_compression: bool,
        compression_mode: str,
        use_custom_ratio: bool,
        custom_ratio: float,
        final_save_path: Path,
        progress_bar=None,
        current_step: int = 0,
    ) -> torch.Tensor:
        """
        标准化音频（压缩 + LUFS线性标准化 + 峰值限制）

        Args:
            waveform: 音频波形张量 (channels, samples)
            sample_rate: 采样率
            target_lufs: 目标 LUFS 值
            enable_peak_limiter: 是否启用峰值限制
            peak_limit: 峰值限制值
            enable_compression: 是否启用压缩
            compression_mode: 压缩预设模式
            use_custom_ratio: 是否使用自定义压缩比
            custom_ratio: 自定义压缩比
            final_save_path: 最终保存路径
            progress_bar: 进度条对象(可选)
            current_step: 当前进度步数

        Returns:
            标准化后的音频波形
        """
        files_to_cleanup = []
        audio_np = cls._prepare_waveform_for_io(waveform)

        try:
            print("[XAudioSave] ===== ♾️Starting audio processing♾️ =====")

            ffmpeg_path = shutil.which("ffmpeg")
            if not ffmpeg_path:
                raise RuntimeError(
                    "FFmpeg executable not found. "
                    "Please install FFmpeg and add it to your system PATH."
                )

            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False
            ) as input_file:
                input_path = input_file.name
                files_to_cleanup.append(input_path)

            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False
            ) as temp_file:
                temp_path = temp_file.name

            try:
                audio_data = np.transpose(audio_np, (1, 0))
                audio_data = audio_data.astype(np.float32)
                wavfile.write(temp_path, sample_rate, audio_data)

                time.sleep(0.01)

                (
                    ffmpeg.input(temp_path)
                    .output(
                        input_path,
                        acodec="pcm_f32le",
                        **{"loglevel": "error"},
                    )
                    .overwrite_output()
                    .run(capture_stdout=True, capture_stderr=True)
                )
            finally:
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except OSError:
                        pass

            # 步骤3: 准备完成
            if progress_bar:
                progress_bar.update_absolute(current_step + 1)

            current_input_path = input_path

            peak_limit_db = peak_limit if peak_limit < 0 else -1.0
            tp_value = peak_limit_db if enable_peak_limiter else 0

            peak_limiter_str = "enabled" if enable_peak_limiter else "disabled"
            print(
                f"[XAudioSave] Peak limiter {peak_limiter_str} "
                f"(target: {tp_value} dB)"
            )

            stdout, stderr = (
                ffmpeg.input(current_input_path)
                .filter(
                    "loudnorm", I=target_lufs, TP=tp_value, print_format="json"
                )
                .output(NULL_DEVICE, format="null")
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
            stderr_str = stderr.decode("utf-8")

            stats_json = None
            json_match = re.search(r'\{[^{}]*"input_i"[^{}]*\}', stderr_str)
            if json_match:
                try:
                    stats_json = json.loads(json_match.group(0))
                except json.JSONDecodeError:
                    raise RuntimeError(cls.AUDIO_NORMALIZE_ERROR) from None

            if stats_json is None:
                raise RuntimeError(cls.AUDIO_NORMALIZE_ERROR)

            # 步骤4: 初始测量完成
            if progress_bar:
                progress_bar.update_absolute(current_step + 2)

            acompressor_filter = None

            actual_lufs = float(stats_json["input_i"])

            print(
                f"[XAudioSave] Audio LUFS: {actual_lufs:.2f} dB, "
                f"Target LUFS: {target_lufs:.2f} dB"
            )

            if enable_compression:
                preset_configs = {
                    "Fast": {
                        "base_offset": 6.0,
                        "ratio": 3.0,
                        "attack": 10,
                        "release": 50,
                        "knee": 2,
                        "makeup": 2,
                    },
                    "Balanced": {
                        "base_offset": 4.0,
                        "ratio": 2.0,
                        "attack": 20,
                        "release": 250,
                        "knee": 2.8,
                        "makeup": 0,
                    },
                    "Slow": {
                        "base_offset": 2.0,
                        "ratio": 1.5,
                        "attack": 50,
                        "release": 500,
                        "knee": 4,
                        "makeup": 3,
                    },
                }

                config = preset_configs.get(
                    compression_mode, preset_configs["Balanced"]
                )
                ratio_value = (
                    custom_ratio if use_custom_ratio else config["ratio"]
                )

                dynamic_offset = (actual_lufs - target_lufs) * 0.3 + config[
                    "base_offset"
                ]
                adaptive_threshold = actual_lufs + dynamic_offset

                print(
                    f"[XAudioSave] Dynamic offset: {dynamic_offset:.2f} dB, "
                    f"Adaptive threshold: {adaptive_threshold:.2f} dB"
                )

                acompressor_filter = (
                    f"acompressor=threshold={adaptive_threshold:.2f}dB:"
                    f"ratio={ratio_value}:"
                    f"attack={config['attack'] / 1000}:"
                    f"release={config['release'] / 1000}:"
                    f"knee={config['knee']}dB:makeup={config['makeup']}dB:"
                    f"link=average:detection=peak"
                )

                preset_name = compression_mode
                ratio_info = (
                    f"(ratio={ratio_value})"
                    if use_custom_ratio
                    else f"(ratio={config['ratio']})"
                )
                print(
                    f"[XAudioSave] Selected: {preset_name} "
                    f"compression preset {ratio_info}"
                )

            if acompressor_filter:
                with tempfile.NamedTemporaryFile(
                    suffix=".wav", delete=False
                ) as compressed_file:
                    compressed_path = compressed_file.name
                    files_to_cleanup.append(compressed_path)

                stdout_comp, stderr_comp = (
                    ffmpeg.input(current_input_path)
                    .output(
                        compressed_path,
                        acodec="pcm_f32le",
                        af=acompressor_filter,
                        **{"loglevel": "error"},
                    )
                    .overwrite_output()
                    .run(capture_stdout=True, capture_stderr=True)
                )

                current_input_path = compressed_path
                print("[XAudioSave] Compression completed")
            else:
                print("[XAudioSave] Compression disabled")

            # 步骤5: 压缩处理完成
            if progress_bar:
                progress_bar.update_absolute(current_step + 3)

            loudnorm_tp = tp_value if enable_peak_limiter else 0

            rough_lufs_filter = (
                f"loudnorm=I={target_lufs}:TP={loudnorm_tp}:dual_mono=true"
            )

            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False
            ) as rough_file:
                rough_path = rough_file.name
                files_to_cleanup.append(rough_path)

            stdout_rough, stderr_rough = (
                ffmpeg.input(current_input_path)
                .output(
                    rough_path,
                    acodec="pcm_f32le",
                    af=rough_lufs_filter,
                    ar=sample_rate,
                    **{"loglevel": "error"},
                )
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )

            _, stderr_rough_measure = (
                ffmpeg.input(str(rough_path))
                .filter(
                    "loudnorm",
                    I=target_lufs,
                    TP=loudnorm_tp,
                    print_format="json",
                )
                .output(NULL_DEVICE, format="null")
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
            stderr_rough_measure_str = stderr_rough_measure.decode("utf-8")

            stats_rough = None
            json_match_rough = re.search(
                r'\{[^{}]*"input_i"[^{}]*\}', stderr_rough_measure_str
            )
            if json_match_rough:
                try:
                    stats_rough = json.loads(json_match_rough.group(0))
                except json.JSONDecodeError:
                    raise RuntimeError(cls.AUDIO_NORMALIZE_ERROR) from None

            if stats_rough is None:
                raise RuntimeError(cls.AUDIO_NORMALIZE_ERROR)

            # 步骤6: 粗略标准化完成
            if progress_bar:
                progress_bar.update_absolute(current_step + 4)

            rough_i = str(stats_rough["input_i"])
            rough_lra = str(stats_rough["input_lra"])
            rough_tp = str(stats_rough["input_tp"])
            rough_thresh = str(stats_rough["input_thresh"])

            loudnorm_filter = (
                f"loudnorm=I={target_lufs}:TP={loudnorm_tp}:linear=true:"
                f"measured_I={rough_i}:measured_LRA={rough_lra}:"
                f"measured_TP={rough_tp}:measured_thresh={rough_thresh}"
            )

            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False
            ) as lufs_file:
                lufs_path = lufs_file.name
                files_to_cleanup.append(lufs_path)

            stdout_lufs, stderr_lufs = (
                ffmpeg.input(rough_path)
                .output(
                    lufs_path,
                    acodec="pcm_f32le",
                    af=loudnorm_filter,
                    ar=sample_rate,
                    **{"loglevel": "error"},
                )
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )

            _, stderr_after = (
                ffmpeg.input(str(lufs_path))
                .filter(
                    "loudnorm", I=target_lufs, TP=tp_value, print_format="json"
                )
                .output(NULL_DEVICE, format="null")
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
            stderr_after_str = stderr_after.decode("utf-8")

            stats_after = None
            json_match_after = re.search(
                r'\{[^{}]*"input_i"[^{}]*\}', stderr_after_str
            )
            if json_match_after:
                try:
                    stats_after = json.loads(json_match_after.group(0))
                except json.JSONDecodeError:
                    raise RuntimeError(cls.AUDIO_NORMALIZE_ERROR) from None

            if stats_after is None:
                raise RuntimeError(cls.AUDIO_NORMALIZE_ERROR)

            after_i = str(stats_after["input_i"])
            after_lra = str(stats_after["input_lra"])
            after_tp = str(stats_after["input_tp"])
            after_thresh = str(stats_after["input_thresh"])
            print(
                f"[XAudioSave] Finished LUFS - I: {after_i}, "
                f"LRA: {after_lra}, TP: {after_tp}, "
                f"Thresh: {after_thresh}"
            )

            # 步骤7: 精确标准化完成
            if progress_bar:
                progress_bar.update_absolute(current_step + 5)

            _, verify_stderr = (
                ffmpeg.input(str(lufs_path))
                .filter("ebur128", peak="true")
                .output(
                    NULL_DEVICE,
                    format="null",
                    **{"loglevel": "error"},
                )
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )

            verify_output = verify_stderr.decode("utf-8")
            for line in reversed(verify_output.split("\n")):
                if "I:" in line or "TP:" in line or "LRA:" in line:
                    print(f"[XAudioSave] Final: {line.strip()}")

            # 步骤8: 最终验证完成
            if progress_bar:
                progress_bar.update_absolute(current_step + 6)

            shutil.copy2(lufs_path, final_save_path)

            sample_rate_out, audio_data_out = wavfile.read(
                lufs_path, mmap=True
            )

            if audio_data_out.ndim == 1:
                audio_data_out = audio_data_out.reshape(-1, 1)

            waveform_processed = torch.from_numpy(
                np.transpose(audio_data_out, (1, 0))
            ).float()
            waveform_processed = torch.clamp(waveform_processed, -1.0, 1.0)

            try:
                waveform_processed = waveform_processed.to(
                    waveform.device, non_blocking=True
                )
            except RuntimeError:
                print(
                    "[XAudioSave] Warning: Could not transfer audio "
                    f"to device {waveform.device}. Using CPU."
                )
                waveform_processed = waveform_processed.to("cpu")

            # 步骤9: 文件保存完成
            if progress_bar:
                progress_bar.update_absolute(current_step + 7)

            print("[XAudioSave] ===== ♾️Audio processing completed♾️ =====")
            return waveform_processed
        except (ffmpeg.Error, OSError, ValueError, RuntimeError) as exc:
            raise RuntimeError(cls.AUDIO_NORMALIZE_ERROR) from exc
        finally:
            for path in files_to_cleanup:
                if os.path.exists(path):
                    try:
                        os.remove(path)
                    except OSError:
                        pass

    @classmethod
    def _save_wav_32bit_float(
        cls,
        waveform: torch.Tensor,
        path: Path,
        sample_rate: int,
    ):
        """
        保存为32-bit float WAV文件（使用FFmpeg）
        仅负责音频数据保存，不包含工作流 metadata。

        Args:
            waveform: 音频波形张量 (channels, samples)
            path: 保存路径
            sample_rate: 采样率
        """
        audio_np = cls._prepare_waveform_for_io(waveform)

        ffmpeg_path = shutil.which("ffmpeg")
        if not ffmpeg_path:
            raise RuntimeError(
                "FFmpeg executable not found. "
                "Please install FFmpeg and add it to your system PATH."
            )

        with tempfile.NamedTemporaryFile(
            suffix=".wav", delete=False
        ) as temp_file:
            temp_path = temp_file.name

        try:
            audio_data = np.transpose(audio_np, (1, 0))
            wavfile.write(temp_path, sample_rate, audio_data)

            with open(temp_path, "ab") as f:
                os.fsync(f.fileno())

            (
                ffmpeg.input(temp_path)
                .output(
                    str(path),
                    acodec="pcm_f32le",
                    **{"loglevel": "error"},
                )
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
        except (ffmpeg.Error, OSError, ValueError) as exc:
            raise RuntimeError(cls.AUDIO_SAVE_ERROR) from exc
        finally:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass

    @classmethod
    def _save_flac_from_waveform(
        cls,
        waveform: torch.Tensor,
        path: Path,
        sample_rate: int,
        metadata: dict | None = None,
    ) -> None:
        """
        将 float 波形写临时 WAV，再以 FLAC(s32) 无损压缩导出。
        """
        audio_np = cls._prepare_waveform_for_io(waveform)
        with tempfile.NamedTemporaryFile(
            suffix=".wav", delete=False
        ) as temp_file:
            temp_path = temp_file.name

        try:
            audio_data = np.transpose(audio_np, (1, 0))
            wavfile.write(temp_path, sample_rate, audio_data)
            cls._save_flac_from_source(
                source_path=temp_path,
                target_path=path,
                metadata=metadata,
            )
        finally:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass

    @classmethod
    def _save_flac_from_source(
        cls,
        source_path: str | Path,
        target_path: Path,
        metadata: dict | None = None,
    ) -> None:
        """
        将源音频编码为 FLAC，并写入工作流元数据。
        """
        output_kwargs = {
            "acodec": "flac",
            "sample_fmt": "s32",
            **{"loglevel": "error"},
        }
        output_kwargs.update(
            cls._build_ffmpeg_metadata_options(metadata)
        )
        try:
            (
                ffmpeg.input(str(source_path))
                .output(str(target_path), **output_kwargs)
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
        except (ffmpeg.Error, OSError, ValueError) as exc:
            raise RuntimeError(cls.AUDIO_SAVE_ERROR) from exc

    @classmethod
    def _generate_metadata(cls, prompt, extra_pnginfo):
        """
        生成音频文件元数据（用于 FLAC）。
        """
        if prompt is None and extra_pnginfo is None:
            return None

        metadata = {}
        if prompt is not None:
            metadata["prompt"] = json.dumps(prompt)
        if extra_pnginfo is not None:
            for key, value in extra_pnginfo.items():
                metadata[key] = json.dumps(value)
        return metadata

    @classmethod
    def _build_ffmpeg_metadata_options(
        cls, metadata: dict | None
    ) -> dict[str, str]:
        """
        将元数据转为 FFmpeg metadata 参数。
        """
        if not metadata:
            return {}

        options = {}
        for index, (key, value) in enumerate(metadata.items()):
            options[f"metadata:g:{index}"] = f"{key}={value}"
        return options

    @classmethod
    def _prepare_waveform_for_io(cls, waveform: torch.Tensor) -> np.ndarray:
        """
        将音频张量转换为适合磁盘读写的 NumPy 格式。
        """
        try:
            prepared = waveform.detach()
            prepared = prepared.to(device="cpu", dtype=torch.float32)
            prepared = prepared.contiguous()
            return prepared.numpy()
        except (RuntimeError, TypeError, ValueError) as exc:
            raise RuntimeError(cls.AUDIO_TENSOR_PREPARE_ERROR) from exc

    @classmethod
    def _validate_saved_file(cls, save_path: Path) -> None:
        """
        验证保存结果，确保文件已落盘且不是空文件。
        """
        try:
            if not save_path.exists():
                raise RuntimeError(cls.FILE_SAVE_VALIDATION_ERROR)

            if save_path.stat().st_size <= 0:
                raise RuntimeError(cls.FILE_SAVE_VALIDATION_ERROR)
        except OSError as exc:
            raise RuntimeError(cls.FILE_SAVE_VALIDATION_ERROR) from exc

    @classmethod
    def _get_output_directory(cls) -> Path:
        """
        获取ComfyUI默认输出目录

        Returns:
            输出目录路径
        """
        if COMFYUI_AVAILABLE:
            return Path(folder_paths.get_output_directory())

        return Path("test_output")

    @classmethod
    def _build_relative_save_path(
        cls,
        save_path: Path,
        output_dir: Path,
    ) -> str:
        """
        基于当前实例输出目录构建相对保存路径。
        """
        try:
            return str(Path(save_path).relative_to(output_dir))
        except ValueError as exc:
            raise RuntimeError(cls.RELATIVE_PATH_ERROR) from exc
