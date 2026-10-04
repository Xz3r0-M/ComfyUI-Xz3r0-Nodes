"""
音频输入防护工具
================

音频节点把波形交给 FFmpeg 之前，先在这里做三件事：

- 坏数值清理：把 NaN / Inf 换成 0。这类数值会一路串到 FFmpeg 的
  滤镜参数里，或在落盘文件里留下满幅爆音。
- 无声判定：按峰值判断，跟音频长短无关。
- 参数兜底：FFmpeg 的 acompressor / loudnorm 只接受固定范围的
  参数，量不出响度时算出来的值会越界，这里夹回合法范围。

这些函数不修改输入张量，节点可以安全地在自己的输入上调用。
"""

import math

import torch

# 峰值低于该值（约 -100 dBFS，比 16bit 最小量化台阶还小）
# 即视为没有声音，跳过响度相关的处理。
SILENCE_PEAK_THRESHOLD = 1e-5

# FFmpeg acompressor 的 threshold 只接受 -60 dB ~ 0 dB
# （线性 0.000976563 ~ 1），越界会报
# "Numerical result out of range" 并让整个滤镜图失败。
COMPRESSOR_MIN_THRESHOLD_DB = -60.0
COMPRESSOR_MAX_THRESHOLD_DB = 0.0

# FFmpeg loudnorm 的 measured_* 参数有效范围（dB）。
LOUDNORM_MIN_LUFS = -99.0
LOUDNORM_MAX_LUFS = 0.0


def sanitize_waveform(waveform: torch.Tensor) -> tuple[torch.Tensor, int]:
    """
    把波形里的 NaN / Inf 换成 0。

    Args:
        waveform: 音频波形张量（任意形状）

    Returns:
        (清理后的张量, 被替换的采样点个数)。输入本身就是干净的
        时候原样返回，不做拷贝。
    """
    if waveform.numel() == 0:
        return waveform, 0
    if torch.isfinite(waveform).all():
        return waveform, 0

    replaced = int((~torch.isfinite(waveform)).sum().item())
    cleaned = torch.nan_to_num(waveform, nan=0.0, posinf=0.0, neginf=0.0)
    return cleaned, replaced


def peak_amplitude(waveform: torch.Tensor) -> float:
    """
    返回波形的峰值绝对值；空音频返回 0.0。
    """
    if waveform.numel() == 0:
        return 0.0
    return float(waveform.abs().max().item())


def is_silent(waveform: torch.Tensor) -> bool:
    """
    判断音频是否没有声音（峰值低于阈值）。

    用峰值而不是能量和，判断结果不会随音频变长而改变。
    空音频视为没有声音。
    """
    return peak_amplitude(waveform) < SILENCE_PEAK_THRESHOLD


def clamp_compressor_threshold_db(value: float) -> float:
    """
    把 acompressor 的自适应阈值夹到 -60 dB ~ 0 dB。

    量不出响度（当前值可能是 -inf / NaN）时落到下限，
    效果等于不压缩，而不是让 FFmpeg 报错。
    """
    if math.isnan(value):
        return COMPRESSOR_MIN_THRESHOLD_DB
    return min(
        max(value, COMPRESSOR_MIN_THRESHOLD_DB),
        COMPRESSOR_MAX_THRESHOLD_DB,
    )


def is_measurable_lufs(value) -> bool:
    """
    判断 loudnorm 量出来的响度是否可用。

    静音、极短或全是坏数值的音频会让 loudnorm 给出 -inf / NaN，
    这类值不能原样传给下一遍 loudnorm（它只接受 -99 dB ~ 0 dB）。
    """
    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    if not math.isfinite(number):
        return False
    return LOUDNORM_MIN_LUFS <= number <= LOUDNORM_MAX_LUFS
