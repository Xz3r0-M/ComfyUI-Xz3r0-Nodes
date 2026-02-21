"""
音频保存节点模块
================

这个模块包含音频保存相关的节点。
"""

import json
import os
import re
import shutil
import tempfile
import time
import traceback
from datetime import datetime
from pathlib import Path

import comfy.utils
import ffmpeg
import folder_paths
import numpy as np
import torch
from scipy.io import wavfile
from torchaudio.transforms import Resample

NULL_DEVICE = "NUL" if os.name == "nt" else "/dev/null"


class XAudioSave:
    """
    XAudioSave 音频保存节点

    提供音频保存功能，使用WAV无损格式，支持自定义文件名、子文件夹、日期时间标识符、音量标准化和峰值限制。

    功能:
        - 保存音频到ComfyUI默认输出目录
        - 统一使用WAV无损格式(PCM 32-bit float)
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

    OUTPUT_NODE = True

    SAMPLE_RATES = {
        "44100": 44100,
        "48000": 48000,
        "96000": 96000,
        "192000": 192000,
    }

    @classmethod
    def INPUT_TYPES(cls) -> dict:
        """定义节点的输入类型和约束"""
        return {
            "required": {
                "audio": ("AUDIO", {"tooltip": "Input audio tensor"}),
                "filename_prefix": (
                    "STRING",
                    {
                        "default": "ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%",
                        "tooltip": (
                            "Filename prefix, supports datetime placeholders: "
                            "%Y%, %m%, %d%, %H%, %M%, %S%"
                        ),
                    },
                ),
                "subfolder": (
                    "STRING",
                    {
                        "default": "Audio",
                        "tooltip": (
                            "Subfolder name (no path separators allowed), "
                            "supports datetime placeholders: "
                            "%Y%, %m%, %d%, %H%, %M%, %S%"
                        ),
                    },
                ),
                "sample_rate": (
                    list(cls.SAMPLE_RATES.keys()),
                    {
                        "default": "48000",
                        "tooltip": (
                            "Target sample rate for the output audio file"
                        ),
                    },
                ),
                "target_lufs": (
                    "FLOAT",
                    {
                        "default": -14.1,
                        "min": -70.0,
                        "max": 0.0,
                        "step": 0.1,
                        "tooltip": (
                            "Target LUFS value for loudness normalization. "
                            "Lower values make audio quieter. "
                            "Default -14.1, Set to -70 to disable."
                        ),
                    },
                ),
                "enable_peak_limiter": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "Enable True Peak limiting "
                            "(Broadcast standard, 8x oversampling). "
                            "When disabled, skips peak limiting."
                        ),
                    },
                ),
                "peak_limit": (
                    "FLOAT",
                    {
                        "default": -1.1,
                        "min": -6.0,
                        "max": 0.0,
                        "step": 0.1,
                        "tooltip": (
                            "Peak limiting value in dB. "
                            "Only used when enable_peak_limiter is enabled. "
                            "Default -1.1, Values below 0 dB prevent clipping."
                        ),
                    },
                ),
                "enable_compression": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "Enable dynamic range compression using "
                            "acompressor filter. "
                            "When disabled, skips compression and "
                            "proceeds directly to LUFS normalization."
                        ),
                    },
                ),
                "compression_mode": (
                    ["Fast", "Balanced", "Slow"],
                    {
                        "default": "Balanced",
                        "tooltip": (
                            "Compression preset mode. "
                            "Threshold is automatically calculated based "
                            "on audio LUFS and target LUFS. "
                            "Fast: Fast response for voice/podcasts, "
                            "ratio=3:1. "
                            "Balanced: Balanced for general use, "
                            "ratio=2:1. "
                            "Slow: Smooth for mastering/broadcast, "
                            "ratio=1.5:1."
                        ),
                    },
                ),
                "use_custom_ratio": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "Enable custom compression ratio to "
                            "override preset value. "
                            "When disabled, uses the preset's "
                            "default ratio."
                        ),
                    },
                ),
                "custom_ratio": (
                    "FLOAT",
                    {
                        "default": 2.0,
                        "min": 1.0,
                        "max": 20.0,
                        "step": 0.1,
                        "tooltip": (
                            "Custom compression ratio (1.0 to 20.0). "
                            "Only used when use_custom_ratio is enabled. "
                            "Lower values = lighter compression, higher "
                            "values = stronger compression. "
                            "Set ratio to 1.0 to disable compression "
                            "(pass-through mode)."
                        ),
                    },
                ),
            }
        }

    RETURN_TYPES = ("AUDIO", "STRING")
    RETURN_NAMES = ("processed_audio", "save_path")
    OUTPUT_TOOLTIPS = (
        "Audio after resampling, loudness normalization, and peak limiting "
        "(32-bit float format)",
        "Saved file path relative to ComfyUI output directory",
    )
    FUNCTION = "save"
    CATEGORY = "♾️ Xz3r0/File-Processing"

    def save(
        self,
        audio: dict,
        filename_prefix: str,
        subfolder: str,
        sample_rate: str,
        target_lufs: float,
        enable_peak_limiter: bool,
        peak_limit: float,
        enable_compression: bool,
        compression_mode: str,
        use_custom_ratio: bool,
        custom_ratio: float,
    ) -> tuple[dict, str]:
        """
        保存音频到ComfyUI输出目录

        Args:
            audio: 音频字典，包含"waveform"和"sample_rate"
            filename_prefix: 文件名前缀(支持日期时间标识符)
            subfolder: 子文件夹名称(单级)
            sample_rate: 采样率选项
            target_lufs: 目标LUFS值
            enable_peak_limiter: 是否启用峰值限制
            peak_limit: 峰值限制值
            enable_compression: 是否启用压缩
            compression_mode: 压缩预设模式
            use_custom_ratio: 是否使用自定义压缩比
            custom_ratio: 自定义压缩比

        Returns:
            (processed_audio, save_path): 处理后的音频和保存的相对路径
            - processed_audio: 32-bit float 格式的音频
            - save_path: 保存的 WAV 文件相对路径 (32-bit float)
        """
        # 获取ComfyUI默认输出目录
        output_dir = self._get_output_directory()

        # 处理日期时间标识符和安全过滤
        safe_filename_prefix = self._sanitize_path(filename_prefix)
        safe_filename_prefix = self._replace_datetime_placeholders(
            safe_filename_prefix
        )

        safe_subfolder = self._sanitize_path(subfolder)
        safe_subfolder = self._replace_datetime_placeholders(safe_subfolder)

        # 创建完整保存路径
        save_dir = output_dir
        if safe_subfolder:
            save_dir = save_dir / safe_subfolder

        # 创建目录(仅支持单级目录)
        save_dir.mkdir(exist_ok=True)

        # 获取音频数据
        waveform = audio["waveform"]
        original_sr = audio["sample_rate"]

        # 确保波形数据格式正确
        if waveform.dim() == 3:
            waveform = waveform.squeeze(0)
        if waveform.dim() == 1:
            waveform = waveform.unsqueeze(0)

        # 获取目标采样率
        target_sr = self.SAMPLE_RATES[sample_rate]

        # 定义处理步骤数
        # 步骤1: 重采样, 步骤2: 文件名生成, 步骤3-10: 音频处理各阶段
        total_steps = 10
        progress_bar = comfy.utils.ProgressBar(total_steps)

        # 重采样音频(如果需要)
        if original_sr != target_sr:
            waveform = self._resample_audio(waveform, original_sr, target_sr)
        progress_bar.update_absolute(1)

        # 生成文件名(添加序列号)
        base_filename = safe_filename_prefix
        final_filename = self._get_unique_filename(
            save_dir, base_filename, ".wav"
        )
        progress_bar.update_absolute(2)

        # 保存路径
        save_path = save_dir / final_filename

        # 处理LUFS标准化和峰值限制
        final_lufs = target_lufs if target_lufs > -70 else None
        if final_lufs is not None:
            waveform = self._normalize_audio(
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
            # 没有LUFS标准化时，保存为32-bit float WAV格式
            self._save_wav_32bit_float(waveform, save_path, target_sr)
            progress_bar.update_absolute(total_steps)

        # 记录相对路径
        relative_path = str(save_path.relative_to(output_dir))

        # 构建 ComfyUI 音频字典格式 (需要 batch 维度)
        processed_audio = {
            "waveform": waveform.unsqueeze(0),
            "sample_rate": target_sr,
        }

        return (processed_audio, relative_path)

    def _resample_audio(
        self, waveform: torch.Tensor, original_sr: int, target_sr: int
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

    def _normalize_audio(
        self,
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
        audio_np = waveform.numpy()

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

            # print("[XAudioSave] Measuring initial audio statistics")

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
                    pass

            if stats_json is None:
                print("[XAudioSave] Warning: Could not parse loudnorm stats")
                return waveform

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

            # print(
            #     "[XAudioSave] ===== Applying LUFS normalization "
            #     "(Two-pass mode) ====="
            # )

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
                    pass

            if stats_rough is None:
                print(
                    "[XAudioSave] Warning: Could not parse "
                    "loudnorm stats after rough normalization"
                )
                stats_rough = stats_json

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

            # print(
            #     "[XAudioSave] ===== Measuring audio "
            #     "after LUFS normalization ====="
            # )

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
                    pass

            if stats_after:
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

            # print("[XAudioSave] ===== Final audio verification =====")

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
            # final_size = os.path.getsize(final_save_path)
            # print(
            #     f"[XAudioSave] Copied to: {final_save_path} "
            #     f"({final_size} bytes)"
            # )

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
        except ffmpeg.Error as e:
            print("[XAudioSave] ERROR: FFmpeg processing failed")
            print(f"[XAudioSave] Error details: {e}")
            if e.stderr:
                print(
                    f"[XAudioSave] FFmpeg stderr: {e.stderr.decode('utf-8')}"
                )
            if e.stdout:
                print(
                    f"[XAudioSave] FFmpeg stdout: {e.stdout.decode('utf-8')}"
                )
            print("[XAudioSave] Using original audio without processing.")
            return waveform
        except Exception as e:
            print(
                "[XAudioSave] ERROR: Unexpected error during audio processing"
            )
            print(f"[XAudioSave] Exception type: {type(e).__name__}")
            print(f"[XAudioSave] Exception message: {e}")
            print("[XAudioSave] Traceback:")
            print(traceback.format_exc())
            print(
                "[XAudioSave] ===== ♾️Warning: Using original audio "
                "without processing♾️ ====="
            )
            return waveform
        finally:
            for path in files_to_cleanup:
                if os.path.exists(path):
                    try:
                        os.remove(path)
                    except OSError:
                        pass

    def _save_wav_32bit_float(
        self, waveform: torch.Tensor, path: Path, sample_rate: int
    ):
        """
        保存为32-bit float WAV文件（使用FFmpeg）

        Args:
            waveform: 音频波形张量 (channels, samples)
            path: 保存路径
            sample_rate: 采样率
        """
        ffmpeg_path = shutil.which("ffmpeg")
        if not ffmpeg_path:
            raise RuntimeError(
                "FFmpeg executable not found. "
                "Please install FFmpeg and add it to your system PATH."
            )

        audio_np = waveform.numpy()

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
        finally:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass

    def _get_output_directory(self) -> Path:
        """
        获取ComfyUI默认输出目录

        Returns:
            输出目录路径
        """
        return Path(folder_paths.get_output_directory())

    def _sanitize_path(self, path: str) -> str:
        """
        清理路径，防止遍历攻击并禁用多级目录

        将所有危险字符和路径分隔符替换为下划线，确保只允许单级文件夹名称

        Args:
            path: 原始路径或文件夹名称

        Returns:
            安全的文件夹名称
        """
        if not path:
            return ""

        # 危险字符列表
        dangerous_chars = [
            "\\",
            "/",
            "..",
            ".",
            "|",
            ":",
            "*",
            "?",
            '"',
            "<",
            ">",
            "\n",
            "\r",
            "\t",
            "\x00",
            "\x0b",
            "\x0c",
        ]

        # 路径遍历模式
        path_traversal_patterns = [
            r"\.\./+",
            r"\.\.\\+",
            r"~",
            r"^\.",
            r"\.$",
            r"^/",
            r"^\\",
        ]

        # 替换危险字符
        safe_path = path
        for char in dangerous_chars:
            safe_path = safe_path.replace(char, "_")

        # 替换路径遍历模式
        for pattern in path_traversal_patterns:
            safe_path = re.sub(pattern, "_", safe_path)

        # 清理连续的下划线
        safe_path = re.sub(r"_+", "_", safe_path)

        # 移除首尾下划线
        safe_path = safe_path.strip("_")

        return safe_path

    def _replace_datetime_placeholders(self, text: str) -> str:
        """
        替换日期时间标识符

        支持的标识符:
        - %Y%: 年份(4位)
        - %m%: 月份(01-12)
        - %d%: 日期(01-31)
        - %H%: 小时(00-23)
        - %M%: 分钟(00-59)
        - %S%: 秒(00-59)

        Args:
            text: 包含日期时间标识符的文本

        Returns:
            替换后的文本
        """
        if not text:
            return ""

        now = datetime.now()

        replacements = {
            "%Y%": now.strftime("%Y"),
            "%m%": now.strftime("%m"),
            "%d%": now.strftime("%d"),
            "%H%": now.strftime("%H"),
            "%M%": now.strftime("%M"),
            "%S%": now.strftime("%S"),
        }

        result = text
        for placeholder, value in replacements.items():
            result = result.replace(placeholder, value)

        return result

    def _get_unique_filename(
        self,
        directory: Path,
        filename: str,
        extension: str,
        max_attempts: int = 100000,
    ) -> str:
        """
        获取唯一的文件名，避免覆盖

        如果文件名不存在则直接使用，存在则添加序列号

        Args:
            directory: 目录路径
            filename: 基础文件名
            extension: 文件扩展名
            max_attempts: 最大尝试次数，防止无限循环

        Returns:
            唯一的文件名

        Raises:
            FileExistsError: 无法生成唯一文件名时抛出
        """
        base_name = filename

        for counter in range(max_attempts):
            if counter == 0:
                candidate = f"{base_name}{extension}"
            else:
                candidate = f"{base_name}_{counter:05d}{extension}"

            candidate_path = directory / candidate

            if not candidate_path.exists():
                return candidate

        raise FileExistsError("Unable to generate unique filename")


NODE_CLASS_MAPPINGS = {
    "XAudioSave": XAudioSave,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "XAudioSave": "XAudioSave",
}
