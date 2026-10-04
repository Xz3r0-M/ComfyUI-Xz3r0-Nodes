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
    from ..xz3r0_utils import (
        clamp_compressor_threshold_db,
        get_logger,
        is_measurable_lufs,
        is_silent,
        peak_amplitude,
        sanitize_waveform,
    )
except ImportError:
    from xz3r0_utils import (
        clamp_compressor_threshold_db,
        get_logger,
        is_measurable_lufs,
        is_silent,
        peak_amplitude,
        sanitize_waveform,
    )

import comfy.utils
from comfy_api.latest import io

LOGGER = get_logger(__name__)
NULL_DEVICE = "NUL" if os.name == "nt" else "/dev/null"


class XAudioProcess(io.ComfyNode):
    """
    XAudioProcess 音频处理节点 (V3)

    一次只做一个音频处理环节——改采样率、压缩动态范围、
    统一响度或限制峰值。把多个节点串起来就能搭出完整的
    母带处理链。

    输入一批多条音频时，每条分别处理，最后一起输出。

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
                "multiple steps in one node. When the input "
                "holds several audios, each one is processed "
                "on its own and they all come out together."
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
                                    default=True,
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
        selected_mode = mode["mode"]

        # 统一整理成 (batch, channels, samples)。
        # 批次里的每一条都当成一段独立音频，逐条处理后再拼回去
        if waveform.dim() == 3:
            batch = waveform
        elif waveform.dim() == 2:
            batch = waveform.unsqueeze(0)  # (channels, samples)
        elif waveform.dim() == 1:
            batch = waveform.unsqueeze(0).unsqueeze(0)
        else:
            raise ValueError(
                f"Unsupported waveform shape: {list(waveform.shape)}. "
                "Expected (samples,), (channels, samples) or "
                "(batch, channels, samples)."
            )

        if batch.shape[-1] == 0:
            raise ValueError(
                "XAudioProcess: input audio is empty (0 samples), "
                "nothing to process."
            )

        batch_size = batch.shape[0]
        single = batch_size == 1
        output_sr = original_sr
        processed_items = []

        # 进度条：总步数 = 每条音频要跑的步数 × 批次数
        steps_per_item = cls._count_steps(mode)
        progress_bar = comfy.utils.ProgressBar(steps_per_item * batch_size)

        for index in range(batch_size):
            item = batch[index]
            label = "" if single else f"Batch item {index + 1}/{batch_size}: "
            base_step = index * steps_per_item

            # NaN / Inf 会一路污染到 FFmpeg 的滤镜参数，先清成 0
            item, replaced = sanitize_waveform(item)
            if replaced:
                LOGGER.warning(
                    "[XAudioProcess] %sReplaced %d non-finite sample(s) "
                    "(NaN/Inf) with 0. The upstream audio is likely "
                    "broken (check the VAE decode precision)",
                    label,
                    replaced,
                )

            # 没有声音的音频无论如何处理都还是没声音，而且 FFmpeg
            # 也量不出它的响度。直接原样返回，只保留重采样。
            silent = is_silent(item)
            if silent and selected_mode != "Resample":
                LOGGER.warning(
                    "[XAudioProcess] %sInput audio is silent "
                    "(peak=%.2e); skipping %s processing and "
                    "returning it unchanged",
                    label,
                    peak_amplitude(item),
                    selected_mode,
                )

            if selected_mode == "Resample":
                target_sr = cls.SAMPLE_RATES[mode["sample_rate"]]
                item = cls._process_resample(item, original_sr, target_sr)
                output_sr = target_sr
            elif selected_mode == "Compress":
                if not silent:
                    item = cls._process_compress(
                        item,
                        original_sr,
                        mode["compression_mode"],
                        mode["use_custom_ratio"],
                        mode["custom_ratio"],
                    )
            elif selected_mode == "Normalize":
                if not silent:
                    item = cls._process_normalize(
                        item, original_sr, mode["target_lufs"]
                    )
            elif selected_mode == "Limit":
                if not silent:
                    item = cls._process_limit(
                        item, original_sr, mode["peak_limit"]
                    )
            elif selected_mode == "Chain":
                item, output_sr = cls._process_chain(
                    item,
                    original_sr,
                    mode,
                    skip_ffmpeg=silent,
                    progress_bar=progress_bar,
                    base_step=base_step,
                )
            else:
                raise ValueError(f"Unknown processing mode: {selected_mode}")

            # 这一条处理完了（静音跳过的也算完成）
            cls._tick(progress_bar, base_step + steps_per_item)

            processed_items.append(item)

        # 构建 ComfyUI 音频字典格式 (需要 batch 维度)
        if single:
            waveform_out = processed_items[0].unsqueeze(0)
        else:
            try:
                waveform_out = torch.stack(processed_items, dim=0)
            except RuntimeError as exc:
                lengths = [int(item.shape[-1]) for item in processed_items]
                raise RuntimeError(
                    "XAudioProcess: batch items ended up with different "
                    f"lengths {lengths}; process them one at a time."
                ) from exc

        processed_audio = {
            "waveform": waveform_out,
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
        if waveform.dim() != 2:
            raise ValueError(
                f"Resample expects a 2D waveform (channels, samples), "
                f"got shape {list(waveform.shape)}"
            )

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
        # torchaudio 的 Resample 只吃 float32（fp16/bf16/float64
        # 在 CPU 上会直接报类型错误）
        return resampler(waveform.to(torch.float32))

    @classmethod
    def _process_chain(
        cls,
        waveform: torch.Tensor,
        original_sr: int,
        chain_opts: dict,
        skip_ffmpeg: bool = False,
        progress_bar=None,
        base_step: int = 0,
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
            skip_ffmpeg: 为 True 时跳过需要 FFmpeg 的三个环节
                （音频没有声音时用，避免无意义的处理与报错）
            progress_bar: 可选进度条，每个打开的环节推进一步
            base_step: 本条音频在进度条里的起始步数

        Returns:
            (waveform, output_sr)
        """
        output_sr = original_sr
        step = base_step

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
            step += 1
            cls._tick(progress_bar, step)

        # 2. 动态压缩
        if chain_opts.get("chain_compress", False):
            if not skip_ffmpeg:
                LOGGER.info("[XAudioProcess] Chain: Compress")
                waveform = cls._process_compress(
                    waveform,
                    output_sr,
                    chain_opts["compression_mode"],
                    chain_opts["use_custom_ratio"],
                    chain_opts["custom_ratio"],
                )
            step += 1
            cls._tick(progress_bar, step)

        # 3. 响度标准化
        if chain_opts.get("chain_normalize", False):
            if not skip_ffmpeg:
                LOGGER.info("[XAudioProcess] Chain: Normalize")
                waveform = cls._process_normalize(
                    waveform, output_sr, chain_opts["target_lufs"]
                )
            step += 1
            cls._tick(progress_bar, step)

        # 4. 峰值限制
        if chain_opts.get("chain_limit", False):
            if not skip_ffmpeg:
                LOGGER.info("[XAudioProcess] Chain: Limit")
                waveform = cls._process_limit(
                    waveform, output_sr, chain_opts["peak_limit"]
                )
            step += 1
            cls._tick(progress_bar, step)

        # 一个开关都没打开：也算一步，让进度条照常走完
        if step == base_step:
            cls._tick(progress_bar, base_step + 1)

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
        # 没有声音就没什么可压缩的；直接原样返回
        if is_silent(waveform):
            LOGGER.warning(
                "[XAudioProcess] Compress: input is silent, skipping"
            )
            return waveform

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

            # 量不出响度（静音、极短等）时不硬算阈值，
            # 否则会给 FFmpeg 递一个 -inf 参数
            if not is_measurable_lufs(stats_json["input_i"]):
                LOGGER.warning(
                    "[XAudioProcess] Compress: loudness is not "
                    "measurable (input_i=%s); returning audio "
                    "unchanged",
                    stats_json["input_i"],
                )
                return waveform

            actual_lufs = float(stats_json["input_i"])

            # 步骤 3: 计算自适应阈值
            dynamic_offset = (actual_lufs - target_lufs) * 0.3 + config[
                "base_offset"
            ]
            # acompressor 只接受 -60 dB ~ 0 dB：极轻的音频算出来的
            # 阈值会越界，这里兜底夹回合法范围
            adaptive_threshold = clamp_compressor_threshold_db(
                actual_lufs + dynamic_offset
            )

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
                output_path, mmap=False
            )

            if audio_data_out.ndim == 1:
                audio_data_out = audio_data_out.reshape(-1, 1)

            waveform_out = torch.from_numpy(
                np.transpose(audio_data_out, (1, 0))
            ).float()
            waveform_out = torch.clamp(waveform_out, -1.0, 1.0)

            return cls._cleanup_ffmpeg_output(waveform_out, waveform.device)

        except (ffmpeg.Error, OSError, ValueError, RuntimeError) as exc:
            cls._log_ffmpeg_error(exc)
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

        # 静音/近静音输入：FFmpeg loudnorm 无法测量响度，
        # 直接原样返回，避免无意义的处理与报错
        if is_silent(waveform):
            LOGGER.warning(
                "[XAudioProcess] Normalize: input is silent "
                "(peak=%.2e), skipping",
                peak_amplitude(waveform),
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
            # loudnorm 量不出响度时（静音、极短、或全是坏数值），
            # measured_* 会是非法的 -inf，传给滤镜会让 FFmpeg 直接失败；
            # 这种情况下用第一遍的结果，不再做精确调整
            result_path = rough_path
            if is_measurable_lufs(stats_rough["input_i"]):
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
                ).overwrite_output().run(
                    capture_stdout=True, capture_stderr=True
                )

                LOGGER.info(
                    "[XAudioProcess] Normalize: target=%.1f LUFS, input_i=%s",
                    target_lufs,
                    stats_rough["input_i"],
                )
                result_path = output_path
            else:
                LOGGER.warning(
                    "[XAudioProcess] Normalize: loudness is not "
                    "measurable (input_i=%s); keeping the first pass",
                    stats_rough["input_i"],
                )

            # 步骤 5: 读回结果
            sample_rate_out, audio_data_out = wavfile.read(
                result_path, mmap=False
            )

            if audio_data_out.ndim == 1:
                audio_data_out = audio_data_out.reshape(-1, 1)

            waveform_out = torch.from_numpy(
                np.transpose(audio_data_out, (1, 0))
            ).float()
            waveform_out = torch.clamp(waveform_out, -1.0, 1.0)

            return cls._cleanup_ffmpeg_output(waveform_out, waveform.device)

        except (ffmpeg.Error, OSError, ValueError, RuntimeError) as exc:
            cls._log_ffmpeg_error(exc)
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
        # 没有声音就没有峰值可限，直接原样返回
        if is_silent(waveform):
            LOGGER.warning("[XAudioProcess] Limit: input is silent, skipping")
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
                output_path, mmap=False
            )

            if audio_data_out.ndim == 1:
                audio_data_out = audio_data_out.reshape(-1, 1)

            waveform_out = torch.from_numpy(
                np.transpose(audio_data_out, (1, 0))
            ).float()
            waveform_out = torch.clamp(waveform_out, -1.0, 1.0)

            return cls._cleanup_ffmpeg_output(waveform_out, waveform.device)

        except (ffmpeg.Error, OSError, ValueError, RuntimeError) as exc:
            cls._log_ffmpeg_error(exc)
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
    def _cleanup_ffmpeg_output(
        cls, waveform: torch.Tensor, device: torch.device
    ) -> torch.Tensor:
        """
        清理 FFmpeg 处理结果里的坏数值。

        FFmpeg 的 loudnorm 量不出响度时会输出 NaN（静音信号乘
        无穷大增益），这里统一清成 0，保证输出永远是可用的音频。
        """
        cleaned, replaced = sanitize_waveform(waveform)
        if replaced:
            LOGGER.warning(
                "[XAudioProcess] FFmpeg output contained %d non-finite "
                "sample(s); replaced with 0",
                replaced,
            )
        return cleaned.to(device)

    @staticmethod
    def _tick(progress_bar, value: int) -> None:
        """推进进度条（没有进度条时什么都不做）。"""
        if progress_bar is not None:
            progress_bar.update_absolute(value)

    @classmethod
    def _count_steps(cls, mode: dict) -> int:
        """
        统计选中模式下，每条音频要跑几步（用于算进度条总步数）。

        Chain 模式按实际打开的开关数量算（一个都没开算 1 步），
        其它模式算 1 步。
        """
        if mode["mode"] != "Chain":
            return 1
        enabled = sum(
            1
            for key in (
                "chain_resample",
                "chain_compress",
                "chain_normalize",
                "chain_limit",
            )
            if mode.get(key, False)
        )
        return max(enabled, 1)

    @classmethod
    def _log_ffmpeg_error(cls, exc: Exception) -> None:
        """
        把 FFmpeg 的原始报错写进日志。

        否则除了 “Audio processing failed” 之外什么都看不到，
        线上排查只能靠猜。
        """
        stderr = getattr(exc, "stderr", None)
        if not stderr:
            return
        text = stderr.decode("utf-8", "replace").strip()
        if not text:
            return
        LOGGER.error(
            "[XAudioProcess] FFmpeg: %s",
            " | ".join(text.splitlines())[:600],
        )

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
