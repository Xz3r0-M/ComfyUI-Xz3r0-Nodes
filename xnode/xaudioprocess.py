"""
音频处理节点模块 (V3 API)
========================

独立的音频处理节点，使用 DynamicCombo 下拉菜单在四种处理模式间
切换。每个节点实例只执行一种处理环节，串联多个实例完成完整处理链。

处理模式：
    - Resample:   改变采样率（44.1k / 48k / 96k / 192k Hz）
    - Compress:   动态范围压缩（三种预设 + 可选自定义压缩比）
    - Normalize:  响度标准化（LUFS 两阶段 loudnorm）
    - Limit:      峰值限制（防止削波）
"""

import json
import os
import re
import shutil
import tempfile

import ffmpeg
import numpy as np
import torch
from torchaudio.transforms import Resample

try:
    from ..xz3r0_utils import get_logger
except ImportError:
    from xz3r0_utils import get_logger

from comfy_api.latest import io

LOGGER = get_logger(__name__)
NULL_DEVICE = "NUL" if os.name == "nt" else "/dev/null"


class XAudioProcess(io.ComfyNode):
    """
    XAudioProcess 音频处理节点 (V3)

    一次只做一个音频处理环节——改采样率、压缩动态范围、
    统一响度或限制峰值。把多个节点串起来就能搭出完整的
    母带处理链。

    处理模式：
        Resample  — 改变采样率（44.1k / 48k / 96k / 192k Hz）
        Compress  — 动态范围压缩，自适应阈值，三种预设可选
        Normalize — 响度标准化，两阶段 LUFS 精确处理
        Limit     — 峰值限制，把音频峰值压在你设定的上限以下

    输入：
        audio: 音频对象 (AUDIO)
        mode: 处理模式选择 (DynamicCombo)，每个选项显示对应的子参数

    输出：
        processed_audio: 处理后的音频 (AUDIO, 32-bit float)
    """

    SAMPLE_RATES = {
        "44100": 44100,
        "48000": 48000,
        "96000": 96000,
        "192000": 192000,
    }
    AUDIO_PROCESS_ERROR = "Audio processing failed"

    @classmethod
    def define_schema(cls):
        """定义节点的输入输出模式"""
        return io.Schema(
            node_id="XAudioProcess",
            display_name="XAudioProcess",
            description=(
                "Apply one audio effect at a time — or chain "
                "them all at once. Change sample rate, "
                "compress dynamics, normalize loudness, or "
                "limit peaks. Use 'Chain' mode to combine "
                "multiple steps in one node."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            is_output_node=False,
            inputs=[
                io.Audio.Input(
                    "audio",
                    tooltip="Input audio to process",
                ),
                io.DynamicCombo.Input(
                    "mode",
                    options=[
                        io.DynamicCombo.Option(
                            "Resample",
                            [
                                io.Combo.Input(
                                    "sample_rate",
                                    options=list(cls.SAMPLE_RATES.keys()),
                                    default="48000",
                                    tooltip=(
                                        "Target sample rate in Hz. "
                                        "Common choices: 44100 "
                                        "(CD quality), 48000 "
                                        "(video standard), 96000 "
                                        "or 192000 (high-res)."
                                    ),
                                ),
                            ],
                        ),
                        io.DynamicCombo.Option(
                            "Compress",
                            [
                                io.Combo.Input(
                                    "compression_mode",
                                    options=["Fast", "Balanced", "Slow"],
                                    default="Balanced",
                                    tooltip=(
                                        "Compression preset. "
                                        "Fast: quick response, "
                                        "good for voice. "
                                        "Balanced: all-purpose, "
                                        "works for most music. "
                                        "Slow: smooth and gentle, "
                                        "for mastering."
                                    ),
                                ),
                                io.Boolean.Input(
                                    "use_custom_ratio",
                                    default=False,
                                    label_on="Enabled",
                                    label_off="Disabled",
                                    tooltip=(
                                        "When Enabled, use your "
                                        "own compression ratio "
                                        "instead of the preset's "
                                        "default."
                                    ),
                                ),
                                io.Float.Input(
                                    "custom_ratio",
                                    default=2.0,
                                    min=1.0,
                                    max=20.0,
                                    step=0.1,
                                    tooltip=(
                                        "Your custom compression "
                                        "ratio (1.0 to 20.0). "
                                        "Only used when custom "
                                        "ratio is Enabled. "
                                        "Higher = stronger "
                                        "compression. Set to 1.0 "
                                        "for no compression."
                                    ),
                                ),
                            ],
                        ),
                        io.DynamicCombo.Option(
                            "Normalize",
                            [
                                io.Float.Input(
                                    "target_lufs",
                                    default=-14.1,
                                    min=-70.0,
                                    max=0.0,
                                    step=0.1,
                                    tooltip=(
                                        "Target loudness in LUFS. "
                                        "-14 LUFS is the common "
                                        "streaming standard. "
                                        "Lower = quieter. "
                                        "Set to -70 to skip."
                                    ),
                                ),
                            ],
                        ),
                        io.DynamicCombo.Option(
                            "Limit",
                            [
                                io.Float.Input(
                                    "peak_limit",
                                    default=-1.1,
                                    min=-6.0,
                                    max=0.0,
                                    step=0.1,
                                    tooltip=(
                                        "Maximum peak level in dB. "
                                        "The limiter stops any "
                                        "audio from going above "
                                        "this level. -1.0 dB is a "
                                        "safe default to prevent "
                                        "clipping."
                                    ),
                                ),
                            ],
                        ),
                        io.DynamicCombo.Option(
                            "Chain",
                            [
                                io.Boolean.Input(
                                    "chain_resample",
                                    default=False,
                                    label_on="Enabled",
                                    label_off="Disabled",
                                    tooltip=(
                                        "When Enabled, change "
                                        "the sample rate before "
                                        "other processing steps."
                                    ),
                                ),
                                io.Combo.Input(
                                    "sample_rate",
                                    options=list(cls.SAMPLE_RATES.keys()),
                                    default="48000",
                                    tooltip=(
                                        "Target sample rate in Hz. "
                                        "Only used when Resample "
                                        "is Enabled."
                                    ),
                                ),
                                io.Boolean.Input(
                                    "chain_compress",
                                    default=False,
                                    label_on="Enabled",
                                    label_off="Disabled",
                                    tooltip=(
                                        "When Enabled, apply "
                                        "dynamic range compression "
                                        "to even out loudness."
                                    ),
                                ),
                                io.Combo.Input(
                                    "compression_mode",
                                    options=["Fast", "Balanced", "Slow"],
                                    default="Balanced",
                                    tooltip=(
                                        "Compression preset. "
                                        "Fast: quick response, "
                                        "good for voice. "
                                        "Balanced: all-purpose. "
                                        "Slow: smooth, for "
                                        "mastering."
                                    ),
                                ),
                                io.Boolean.Input(
                                    "use_custom_ratio",
                                    default=False,
                                    label_on="Enabled",
                                    label_off="Disabled",
                                    tooltip=(
                                        "When Enabled, use your "
                                        "own ratio instead of "
                                        "the preset's default."
                                    ),
                                ),
                                io.Float.Input(
                                    "custom_ratio",
                                    default=2.0,
                                    min=1.0,
                                    max=20.0,
                                    step=0.1,
                                    tooltip=(
                                        "Your custom compression "
                                        "ratio (1.0–20.0). "
                                        "Only used when custom "
                                        "ratio is Enabled."
                                    ),
                                ),
                                io.Boolean.Input(
                                    "chain_normalize",
                                    default=True,
                                    label_on="Enabled",
                                    label_off="Disabled",
                                    tooltip=(
                                        "When Enabled, adjust "
                                        "overall loudness to the "
                                        "target LUFS level."
                                    ),
                                ),
                                io.Float.Input(
                                    "target_lufs",
                                    default=-14.1,
                                    min=-70.0,
                                    max=0.0,
                                    step=0.1,
                                    tooltip=(
                                        "Target loudness in LUFS. "
                                        "-14 is the streaming "
                                        "standard. Lower = "
                                        "quieter. Set to -70 to "
                                        "skip."
                                    ),
                                ),
                                io.Boolean.Input(
                                    "chain_limit",
                                    default=True,
                                    label_on="Enabled",
                                    label_off="Disabled",
                                    tooltip=(
                                        "When Enabled, cap audio "
                                        "peaks to prevent "
                                        "clipping."
                                    ),
                                ),
                                io.Float.Input(
                                    "peak_limit",
                                    default=-1.1,
                                    min=-6.0,
                                    max=0.0,
                                    step=0.1,
                                    tooltip=(
                                        "Maximum peak level in dB. "
                                        "Only used when Peak "
                                        "Limiting is Enabled."
                                    ),
                                ),
                            ],
                        ),
                    ],
                ),
            ],
            outputs=[
                io.Audio.Output(
                    "processed_audio",
                    tooltip=(
                        "Audio after the selected processing "
                        "(32-bit float, same format as input)"
                    ),
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        audio: dict,
        mode: io.DynamicCombo.Type,
    ) -> io.NodeOutput:
        """
        根据选择的模式执行对应的音频处理。

        Args:
            audio: 音频字典，包含 "waveform" 和 "sample_rate"
            mode: DynamicCombo 字典，键 "mode" 为选中的模式名

        Returns:
            NodeOutput: 包含处理后的音频 (AUDIO dict)
        """
        waveform = audio["waveform"]
        original_sr = audio["sample_rate"]

        # 确保波形数据格式正确: (channels, samples)
        if waveform.dim() == 3:
            waveform = waveform.squeeze(0)
        if waveform.dim() == 1:
            waveform = waveform.unsqueeze(0)

        selected_mode = mode["mode"]

        if selected_mode == "Resample":
            target_sr = cls.SAMPLE_RATES[mode["sample_rate"]]
            waveform = cls._process_resample(waveform, original_sr, target_sr)
            output_sr = target_sr
        elif selected_mode == "Compress":
            waveform = cls._process_compress(
                waveform,
                original_sr,
                mode["compression_mode"],
                mode["use_custom_ratio"],
                mode["custom_ratio"],
            )
            output_sr = original_sr
        elif selected_mode == "Normalize":
            waveform = cls._process_normalize(
                waveform, original_sr, mode["target_lufs"]
            )
            output_sr = original_sr
        elif selected_mode == "Limit":
            waveform = cls._process_limit(
                waveform, original_sr, mode["peak_limit"]
            )
            output_sr = original_sr
        elif selected_mode == "Chain":
            waveform, output_sr = cls._process_chain(
                waveform, original_sr, mode
            )
        else:
            raise ValueError(f"Unknown processing mode: {selected_mode}")

        # 构建 ComfyUI 音频字典格式 (需要 batch 维度)
        processed_audio = {
            "waveform": waveform.unsqueeze(0),
            "sample_rate": output_sr,
        }

        return io.NodeOutput(processed_audio)

    # ================================================================
    # 处理模式实现
    # ================================================================

    @classmethod
    def _process_resample(
        cls,
        waveform: torch.Tensor,
        original_sr: int,
        target_sr: int,
    ) -> torch.Tensor:
        """
        重采样音频到目标采样率。

        使用 torchaudio 的 Resample，纯张量操作，无需 FFmpeg。
        """
        if original_sr == target_sr:
            LOGGER.info(
                "[XAudioProcess] Resample: %d Hz → %d Hz (no change)",
                original_sr,
                target_sr,
            )
            return waveform

        LOGGER.info(
            "[XAudioProcess] Resample: %d Hz → %d Hz",
            original_sr,
            target_sr,
        )
        resampler = Resample(orig_freq=original_sr, new_freq=target_sr)
        return resampler(waveform)

    @classmethod
    def _process_chain(
        cls,
        waveform: torch.Tensor,
        original_sr: int,
        chain_opts: dict,
    ) -> tuple[torch.Tensor, int]:
        """
        按顺序串联多个处理环节。

        处理顺序（与 XAudioSave 一致）：
        1. 重采样
        2. 动态压缩
        3. 响度标准化
        4. 峰值限制

        Args:
            waveform: 音频波形 (channels, samples)
            original_sr: 原始采样率
            chain_opts: Chain 模式的参数字典

        Returns:
            (waveform, output_sr)
        """
        output_sr = original_sr

        # 1. 重采样
        if chain_opts.get("chain_resample", False):
            target_sr = cls.SAMPLE_RATES[chain_opts["sample_rate"]]
            LOGGER.info(
                "[XAudioProcess] Chain: Resample %d → %d Hz",
                output_sr,
                target_sr,
            )
            waveform = cls._process_resample(waveform, output_sr, target_sr)
            output_sr = target_sr

        # 2. 动态压缩
        if chain_opts.get("chain_compress", False):
            LOGGER.info("[XAudioProcess] Chain: Compress")
            waveform = cls._process_compress(
                waveform,
                output_sr,
                chain_opts["compression_mode"],
                chain_opts["use_custom_ratio"],
                chain_opts["custom_ratio"],
            )

        # 3. 响度标准化
        if chain_opts.get("chain_normalize", False):
            LOGGER.info("[XAudioProcess] Chain: Normalize")
            waveform = cls._process_normalize(
                waveform, output_sr, chain_opts["target_lufs"]
            )

        # 4. 峰值限制
        if chain_opts.get("chain_limit", False):
            LOGGER.info("[XAudioProcess] Chain: Limit")
            waveform = cls._process_limit(
                waveform, output_sr, chain_opts["peak_limit"]
            )

        return waveform, output_sr

    @classmethod
    def _process_compress(
        cls,
        waveform: torch.Tensor,
        sample_rate: int,
        compression_mode: str,
        use_custom_ratio: bool,
        custom_ratio: float,
    ) -> torch.Tensor:
        """
        使用 acompressor 滤镜进行动态范围压缩。

        阈值根据音频实际 LUFS 和目标 LUFS (-14) 自动计算，
        与 XAudioSave 的自适应阈值算法保持一致。
        """
        ffmpeg_path = shutil.which("ffmpeg")
        if not ffmpeg_path:
            raise RuntimeError(
                "FFmpeg executable not found. "
                "Please install FFmpeg and add it to PATH."
            )

        # 预设配置（与 XAudioSave 一致）
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
        ratio_value = custom_ratio if use_custom_ratio else config["ratio"]

        files_to_cleanup = []
        audio_np = cls._prepare_waveform_for_io(waveform)

        try:
            # 步骤 1: 写入临时 WAV
            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False
            ) as tmp:
                input_path = tmp.name
                files_to_cleanup.append(input_path)

            audio_data = np.transpose(audio_np, (1, 0)).astype(np.float32)
            from scipy.io import wavfile

            wavfile.write(input_path, sample_rate, audio_data)

            # 步骤 2: 测量 LUFS（用于自适应阈值）
            target_lufs = -14.1  # 参照值
            stderr_str = (
                ffmpeg.input(input_path)
                .filter(
                    "loudnorm",
                    I=target_lufs,
                    TP=0,
                    print_format="json",
                )
                .output(NULL_DEVICE, format="null")
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)[1]
                .decode("utf-8")
            )

            stats_json = None
            json_match = re.search(r'\{[^{}]*"input_i"[^{}]*\}', stderr_str)
            if json_match:
                try:
                    stats_json = json.loads(json_match.group(0))
                except json.JSONDecodeError:
                    raise RuntimeError(cls.AUDIO_PROCESS_ERROR) from None

            if stats_json is None:
                raise RuntimeError(cls.AUDIO_PROCESS_ERROR)

            actual_lufs = float(stats_json["input_i"])

            # 步骤 3: 计算自适应阈值
            dynamic_offset = (actual_lufs - target_lufs) * 0.3 + config[
                "base_offset"
            ]
            adaptive_threshold = actual_lufs + dynamic_offset

            LOGGER.info(
                "[XAudioProcess] Compress: LUFS=%.1f, "
                "threshold=%.1f dB, ratio=%.1f, "
                "mode=%s",
                actual_lufs,
                adaptive_threshold,
                ratio_value,
                compression_mode,
            )

            # 步骤 4: 构建 acompressor 滤镜串
            acompressor_filter = (
                f"acompressor="
                f"threshold={adaptive_threshold:.2f}dB:"
                f"ratio={ratio_value}:"
                f"attack={config['attack'] / 1000}:"
                f"release={config['release'] / 1000}:"
                f"knee={config['knee']}dB:"
                f"makeup={config['makeup']}dB:"
                f"link=average:detection=peak"
            )

            # 步骤 5: 应用压缩
            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False
            ) as tmp:
                output_path = tmp.name
                files_to_cleanup.append(output_path)

            ffmpeg.input(input_path).output(
                output_path,
                acodec="pcm_f32le",
                af=acompressor_filter,
                **{"loglevel": "error"},
            ).overwrite_output().run(capture_stdout=True, capture_stderr=True)

            # 步骤 6: 读回结果
            sample_rate_out, audio_data_out = wavfile.read(
                output_path, mmap=True
            )

            if audio_data_out.ndim == 1:
                audio_data_out = audio_data_out.reshape(-1, 1)

            waveform_out = torch.from_numpy(
                np.transpose(audio_data_out, (1, 0))
            ).float()
            waveform_out = torch.clamp(waveform_out, -1.0, 1.0)

            return waveform_out.to(waveform.device)

        except (ffmpeg.Error, OSError, ValueError, RuntimeError) as exc:
            raise RuntimeError(cls.AUDIO_PROCESS_ERROR) from exc
        finally:
            for path in files_to_cleanup:
                if os.path.exists(path):
                    try:
                        os.remove(path)
                    except OSError:
                        pass

    @classmethod
    def _process_normalize(
        cls,
        waveform: torch.Tensor,
        sample_rate: int,
        target_lufs: float,
    ) -> torch.Tensor:
        """
        使用 loudnorm 两阶段处理进行 LUFS 响度标准化。

        第一遍粗略标准化 + 测量，第二遍精确线性调整。
        与 XAudioSave 的 loudnorm 处理逻辑一致。
        """
        if target_lufs <= -70:
            LOGGER.info(
                "[XAudioProcess] Normalize: target_lufs <= -70, skipping"
            )
            return waveform

        ffmpeg_path = shutil.which("ffmpeg")
        if not ffmpeg_path:
            raise RuntimeError(
                "FFmpeg executable not found. "
                "Please install FFmpeg and add it to PATH."
            )

        files_to_cleanup = []
        audio_np = cls._prepare_waveform_for_io(waveform)

        try:
            # 步骤 1: 写入临时 WAV
            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False
            ) as tmp:
                input_path = tmp.name
                files_to_cleanup.append(input_path)

            audio_data = np.transpose(audio_np, (1, 0)).astype(np.float32)
            from scipy.io import wavfile

            wavfile.write(input_path, sample_rate, audio_data)

            # 步骤 2: 第一遍 — 粗略标准化
            rough_filter = f"loudnorm=I={target_lufs}:TP=0:dual_mono=true"
            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False
            ) as tmp:
                rough_path = tmp.name
                files_to_cleanup.append(rough_path)

            ffmpeg.input(input_path).output(
                rough_path,
                acodec="pcm_f32le",
                af=rough_filter,
                ar=sample_rate,
                **{"loglevel": "error"},
            ).overwrite_output().run(capture_stdout=True, capture_stderr=True)

            # 步骤 3: 测量粗略结果
            stderr_str = (
                ffmpeg.input(str(rough_path))
                .filter(
                    "loudnorm",
                    I=target_lufs,
                    TP=0,
                    print_format="json",
                )
                .output(NULL_DEVICE, format="null")
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)[1]
                .decode("utf-8")
            )

            stats_rough = None
            json_match = re.search(r'\{[^{}]*"input_i"[^{}]*\}', stderr_str)
            if json_match:
                try:
                    stats_rough = json.loads(json_match.group(0))
                except json.JSONDecodeError:
                    raise RuntimeError(cls.AUDIO_PROCESS_ERROR) from None

            if stats_rough is None:
                raise RuntimeError(cls.AUDIO_PROCESS_ERROR)

            # 步骤 4: 第二遍 — 精确线性调整
            loudnorm_filter = (
                f"loudnorm="
                f"I={target_lufs}:TP=0:linear=true:"
                f"measured_I={stats_rough['input_i']}:"
                f"measured_LRA={stats_rough['input_lra']}:"
                f"measured_TP={stats_rough['input_tp']}:"
                f"measured_thresh={stats_rough['input_thresh']}"
            )

            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False
            ) as tmp:
                output_path = tmp.name
                files_to_cleanup.append(output_path)

            ffmpeg.input(rough_path).output(
                output_path,
                acodec="pcm_f32le",
                af=loudnorm_filter,
                ar=sample_rate,
                **{"loglevel": "error"},
            ).overwrite_output().run(capture_stdout=True, capture_stderr=True)

            LOGGER.info(
                "[XAudioProcess] Normalize: target=%.1f LUFS, input_i=%s",
                target_lufs,
                stats_rough["input_i"],
            )

            # 步骤 5: 读回结果
            sample_rate_out, audio_data_out = wavfile.read(
                output_path, mmap=True
            )

            if audio_data_out.ndim == 1:
                audio_data_out = audio_data_out.reshape(-1, 1)

            waveform_out = torch.from_numpy(
                np.transpose(audio_data_out, (1, 0))
            ).float()
            waveform_out = torch.clamp(waveform_out, -1.0, 1.0)

            return waveform_out.to(waveform.device)

        except (ffmpeg.Error, OSError, ValueError, RuntimeError) as exc:
            raise RuntimeError(cls.AUDIO_PROCESS_ERROR) from exc
        finally:
            for path in files_to_cleanup:
                if os.path.exists(path):
                    try:
                        os.remove(path)
                    except OSError:
                        pass

    @classmethod
    def _process_limit(
        cls,
        waveform: torch.Tensor,
        sample_rate: int,
        peak_limit: float,
    ) -> torch.Tensor:
        """
        使用 alimiter 滤镜进行峰值限制。

        把音频峰值压在你设定的上限以下，防止下游处理或
        导出时削波。
        """
        ffmpeg_path = shutil.which("ffmpeg")
        if not ffmpeg_path:
            raise RuntimeError(
                "FFmpeg executable not found. "
                "Please install FFmpeg and add it to PATH."
            )

        files_to_cleanup = []
        audio_np = cls._prepare_waveform_for_io(waveform)

        try:
            # 步骤 1: 写入临时 WAV
            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False
            ) as tmp:
                input_path = tmp.name
                files_to_cleanup.append(input_path)

            audio_data = np.transpose(audio_np, (1, 0)).astype(np.float32)
            from scipy.io import wavfile

            wavfile.write(input_path, sample_rate, audio_data)

            # 步骤 2: 构建 alimiter 滤镜
            # limit 需要线性幅度比（非 dB），公式: 10^(dB/20)
            # attack/release 单位为 ms
            limit_amplitude = 10 ** (peak_limit / 20)
            alimiter_filter = (
                f"alimiter=limit={limit_amplitude:.4f}:attack=5:release=50"
            )

            LOGGER.info(
                "[XAudioProcess] Limit: peak=%.1f dB",
                peak_limit,
            )

            # 步骤 3: 应用限制
            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False
            ) as tmp:
                output_path = tmp.name
                files_to_cleanup.append(output_path)

            ffmpeg.input(input_path).output(
                output_path,
                acodec="pcm_f32le",
                af=alimiter_filter,
                **{"loglevel": "error"},
            ).overwrite_output().run(capture_stdout=True, capture_stderr=True)

            # 步骤 4: 读回结果
            sample_rate_out, audio_data_out = wavfile.read(
                output_path, mmap=True
            )

            if audio_data_out.ndim == 1:
                audio_data_out = audio_data_out.reshape(-1, 1)

            waveform_out = torch.from_numpy(
                np.transpose(audio_data_out, (1, 0))
            ).float()
            waveform_out = torch.clamp(waveform_out, -1.0, 1.0)

            return waveform_out.to(waveform.device)

        except (ffmpeg.Error, OSError, ValueError, RuntimeError) as exc:
            raise RuntimeError(cls.AUDIO_PROCESS_ERROR) from exc
        finally:
            for path in files_to_cleanup:
                if os.path.exists(path):
                    try:
                        os.remove(path)
                    except OSError:
                        pass

    # ================================================================
    # 工具方法
    # ================================================================

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
            raise RuntimeError(cls.AUDIO_PROCESS_ERROR) from exc
