"""
音频保存节点模块
================

这个模块包含音频保存相关的节点。
"""

import re
from datetime import datetime
from pathlib import Path
from typing import Tuple

import numpy as np
import torch
import folder_paths
from torchaudio.transforms import Resample
from scipy.io import wavfile


class XAudioSave:
    """
    XAudioSave 音频保存节点

    提供音频保存功能，使用WAV无损格式，支持自定义文件名、子文件夹、日期时间标识符、音量标准化和峰值限制。

    功能:
        - 保存音频到ComfyUI默认输出目录
        - 强制使用WAV无损格式(PCM 16-bit)
        - 支持多种采样率(44.1kHz, 48kHz, 96kHz, 192kHz)
        - LUFS音量标准化(默认-14.0 LUFS)
        - 峰值限制(支持三种模式: Disabled, Simple Peak, True Peak)
        - 支持自定义文件名和子文件夹
        - 支持日期时间标识符(%Y%, %m%, %d%, %H%, %M%, %S%)
        - 自动添加序列号防止覆盖(从00001开始)
        - 仅支持单级子文件夹创建
        - 安全防护(防止路径遍历攻击)
        - 输出相对路径(不泄露绝对路径)

    峰值限制模式说明:
        - Disabled: 禁用峰值限制
        - Simple Peak: 简单峰值限制(快速，直接检测采样点峰值)
        - True Peak: 广播标准True Peak限制(慢速，8x过采样，精度高)

    输入:
        audio: 音频对象 (AUDIO)
        filename_prefix: 文件名前缀 (STRING)
        subfolder: 子文件夹名称 (STRING)
        sample_rate: 采样率 (COMBO)
        target_lufs: 目标LUFS值 (FLOAT)
        peak_mode: 峰值限制模式 (COMBO)
        peak_limit: 峰值限制值 (FLOAT)

    输出:
        processed_audio: 处理后的音频(重采样、LUFS标准化、峰值限制)
        save_path: 保存的相对路径 (STRING)

    使用示例:
        filename_prefix="MyAudio_%Y%m%d", subfolder="Audio", sample_rate="48000", target_lufs=-14.0, peak_mode="True Peak", peak_limit=-1.0
        输出: processed_audio(重采样/标准化/峰值限制), save_path="output/Audio/MyAudio_20260114.wav"
    """

    SAMPLE_RATES = {
        "44100": 44100,
        "48000": 48000,
        "96000": 96000,
        "192000": 192000
    }

    @classmethod
    def INPUT_TYPES(cls) -> dict:
        """定义节点的输入类型和约束"""
        return {
            "required": {
                "audio": ("AUDIO", {
                    "tooltip": "Input audio tensor"
                }),
                "filename_prefix": ("STRING", {
                    "default": "ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%",
                    "tooltip": "Filename prefix, supports datetime placeholders: %Y%, %m%, %d%, %H%, %M%, %S%"
                }),
                "subfolder": ("STRING", {
                    "default": "Audio",
                    "tooltip": "Subfolder name (no path separators allowed), supports datetime placeholders: %Y%, %m%, %d%, %H%, %M%, %S%"
                }),
                "sample_rate": (list(cls.SAMPLE_RATES.keys()), {
                    "default": "48000",
                    "tooltip": "Target sample rate for the output audio file"
                }),
                "target_lufs": ("FLOAT", {
                    "default": -14.0,
                    "min": -70.0,
                    "max": 0.0,
                    "step": 0.1,
                    "tooltip": "Target LUFS value for loudness normalization. Lower values make audio quieter. Default -14, Set to -70 to disable."
                }),
                "peak_mode": (["Disabled", "Simple Peak", "True Peak"], {
                    "default": "Simple Peak",
                    "tooltip": "Peak limiting mode: Disabled (no limiting), Simple Peak (fast, sample-point detection), True Peak (Slow, high quality broadcast standard, 8x oversampling)"
                }),
                "peak_limit": ("FLOAT", {
                    "default": -1.0,
                    "min": -6.0,
                    "max": 0.0,
                    "step": 0.1,
                    "tooltip": "Peak limiting value in dB. Only used when peak_mode is not 'Disabled'. Default -1, Values below 0 dB prevent clipping."
                })
            }
        }

    RETURN_TYPES = ("AUDIO", "STRING")
    RETURN_NAMES = ("processed_audio", "save_path")
    OUTPUT_TOOLTIPS = ("Audio after resampling, loudness normalization, and peak limiting", "Saved file path relative to ComfyUI output directory")
    FUNCTION = "save"
    CATEGORY = "♾️ Xz3r0/Audio"

    def save(self, audio: dict, filename_prefix: str, subfolder: str, sample_rate: str, target_lufs: float, peak_mode: str, peak_limit: float) -> Tuple[dict, str]:
        """
        保存音频到ComfyUI输出目录

        Args:
            audio: 音频字典，包含"waveform"和"sample_rate"
            filename_prefix: 文件名前缀(支持日期时间标识符)
            subfolder: 子文件夹名称(单级)
            sample_rate: 采样率选项
            target_lufs: 目标LUFS值
            peak_mode: 峰值限制模式
            peak_limit: 峰值限制值

        Returns:
            (processed_audio, save_path): 处理后的音频和保存的相对路径
        """
        # 获取ComfyUI默认输出目录
        output_dir = self._get_output_directory()

        # 处理日期时间标识符和安全过滤
        safe_filename_prefix = self._sanitize_path(filename_prefix)
        safe_filename_prefix = self._replace_datetime_placeholders(safe_filename_prefix)

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

        # 重采样音频(如果需要)
        if original_sr != target_sr:
            waveform = self._resample_audio(waveform, original_sr, target_sr)

        # 处理LUFS标准化
        final_lufs = target_lufs if target_lufs > -70 else None
        if final_lufs is not None:
            waveform = self._normalize_lufs(waveform, target_sr, final_lufs)

        # 处理峰值限制
        final_peak = peak_limit if peak_limit < 0 else None
        if final_peak is not None:
            if peak_mode == "True Peak":
                waveform = self._limit_true_peak(waveform, final_peak, target_sr)
            elif peak_mode == "Simple Peak":
                waveform = self._limit_simple_peak(waveform, final_peak)

        # 转换为int16格式用于WAV保存
        waveform_int16 = self._float_to_int16(waveform)

        # 转换为numpy数组 (channels, samples) -> (samples, channels)
        audio_data = waveform_int16.numpy().T

        # 生成文件名(添加序列号)
        base_filename = safe_filename_prefix
        final_filename = self._get_unique_filename(save_dir, base_filename, ".wav")

        # 保存音频文件
        save_path = save_dir / final_filename
        self._save_wav(save_path, audio_data, target_sr)

        # 记录相对路径
        relative_path = str(save_path.relative_to(output_dir))

        # 构建 ComfyUI 音频字典格式 (需要 batch 维度)
        processed_audio = {
            "waveform": waveform.unsqueeze(0),
            "sample_rate": target_sr
        }

        return (processed_audio, relative_path)

    def _resample_audio(self, waveform: torch.Tensor, original_sr: int, target_sr: int) -> torch.Tensor:
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

    def _normalize_lufs(self, waveform: torch.Tensor, sample_rate: int, target_lufs: float) -> torch.Tensor:
        """
        LUFS音量标准化

        Args:
            waveform: 音频波形张量 (channels, samples)
            sample_rate: 采样率
            target_lufs: 目标LUFS值

        Returns:
            标准化后的音频波形
        """
        try:
            import pyloudnorm as ln

            # 转换为numpy
            audio_np = waveform.numpy()

            # 创建meter
            meter = ln.Meter(sample_rate)

            # 计算当前LUFS(如果是立体声，使用左右声道平均值)
            if audio_np.shape[0] == 2:
                mono_audio = np.mean(audio_np, axis=0)
                current_lufs = meter.integrated_loudness(mono_audio)
            else:
                current_lufs = meter.integrated_loudness(audio_np[0])

            # 计算增益因子
            if current_lufs != -float('inf'):
                gain = 10 ** ((target_lufs - current_lufs) / 20)
                waveform = waveform * gain

            return waveform
        except ImportError:
            # 如果pyloudnorm不可用，使用简单的RMS标准化
            rms = torch.sqrt(torch.mean(waveform ** 2))
            if rms > 0:
                # 目标RMS约为0.1(约-20dB)
                target_rms = 0.1
                waveform = waveform * (target_rms / rms)
            return waveform

    def _oversample(self, waveform: torch.Tensor, original_sr: int, oversample_factor: int = 8) -> torch.Tensor:
        """
        音频过采样

        Args:
            waveform: 音频波形张量 (channels, samples)
            original_sr: 原始采样率
            oversample_factor: 过采样倍数

        Returns:
            过采样后的音频波形 (channels, samples * oversample_factor)
        """
        target_sr = original_sr * oversample_factor
        return self._resample_audio(waveform, original_sr, target_sr)

    def _lowpass_filter(self, waveform: torch.Tensor, cutoff_freq: float, sample_rate: int) -> torch.Tensor:
        """
        二阶Butterworth低通滤波器

        Args:
            waveform: 音频波形张量 (channels, samples)
            cutoff_freq: 截止频率
            sample_rate: 采样率

        Returns:
            滤波后的音频波形
        """
        # 计算角频率
        nyquist = sample_rate / 2
        normalized_cutoff = cutoff_freq / nyquist
        
        # 二阶Butterworth滤波器设计
        # 计算滤波器系数
        wc = torch.tan(torch.tensor(normalized_cutoff * torch.pi / 2))
        sqrt2 = torch.sqrt(torch.tensor(2.0))
        a0 = 1 + sqrt2 * wc + wc ** 2
        b0 = wc ** 2 / a0
        b1 = 2 * b0
        b2 = b0
        a1 = (2 * (wc ** 2 - 1)) / a0
        a2 = (1 - sqrt2 * wc + wc ** 2) / a0
        
        # 转换为浮点数张量
        b = torch.tensor([b0, b1, b2], dtype=waveform.dtype, device=waveform.device)
        a = torch.tensor([1.0, a1, a2], dtype=waveform.dtype, device=waveform.device)
        
        # 初始化滤波结果
        filtered_waveform = torch.zeros_like(waveform)
        
        # 对每个声道进行滤波
        for ch in range(waveform.shape[0]):
            channel_waveform = waveform[ch, :]
            channel_filtered = torch.zeros_like(channel_waveform)
            
            # 应用滤波器
            for i in range(channel_waveform.shape[0]):
                channel_filtered[i] = b[0] * channel_waveform[i]
                if i > 0:
                    channel_filtered[i] += b[1] * channel_waveform[i-1] - a[1] * channel_filtered[i-1]
                if i > 1:
                    channel_filtered[i] += b[2] * channel_waveform[i-2] - a[2] * channel_filtered[i-2]
            
            filtered_waveform[ch, :] = channel_filtered
        
        return filtered_waveform

    def _undersample(self, waveform: torch.Tensor, original_sr: int, undersample_factor: int = 8) -> torch.Tensor:
        """
        音频降采样（恢复原始采样率）

        Args:
            waveform: 音频波形张量 (channels, samples)
            original_sr: 原始采样率
            undersample_factor: 降采样倍数

        Returns:
            降采样后的音频波形 (channels, samples / undersample_factor)
        """
        target_sr = original_sr
        oversampled_sr = original_sr * undersample_factor
        return self._resample_audio(waveform, oversampled_sr, target_sr)

    def _limit_true_peak(self, waveform: torch.Tensor, peak_limit_db: float, sample_rate: int = 48000, oversample_factor: int = 8) -> torch.Tensor:
        """
        真正的 True Peak 限制

        使用 8x 过采样来检测采样点之间的峰值，符合广播标准。

        Args:
            waveform: 音频波形张量 (channels, samples)
            peak_limit_db: 峰值限制(dB)
            sample_rate: 采样率
            oversample_factor: 过采样倍数（建议使用8x）

        Returns:
            True Peak 限制后的音频波形
        """
        peak_limit_linear = 10 ** (peak_limit_db / 20)
        oversampled_sr = sample_rate * oversample_factor
        
        # 1. 过采样
        oversampled_waveform = self._oversample(waveform, sample_rate, oversample_factor)
        
        # 2. 低通滤波（防止混叠）
        # 截止频率为原始采样率的一半（过采样后）
        # 对每个声道单独处理
        cutoff_freq = sample_rate / 2
        filtered_waveform = self._lowpass_filter(oversampled_waveform, cutoff_freq, oversampled_sr)
        
        # 3. 检测并限制峰值
        # 对所有声道检测峰值
        max_values = torch.max(torch.abs(filtered_waveform), dim=1)
        global_max_value = torch.max(max_values.values)
        
        if global_max_value > peak_limit_linear:
            gain = peak_limit_linear / global_max_value
            filtered_waveform = filtered_waveform * gain
        
        # 4. 恢复原始采样率
        limited_waveform = self._undersample(filtered_waveform, sample_rate, oversample_factor)
        
        return limited_waveform

    def _limit_simple_peak(self, waveform: torch.Tensor, peak_limit_db: float) -> torch.Tensor:
        """
        简单峰值限制

        直接检测采样点峰值，速度快但精度较低。

        Args:
            waveform: 音频波形张量 (channels, samples)
            peak_limit_db: 峰值限制(dB)

        Returns:
            峰值限制后的音频波形
        """
        peak_limit_linear = 10 ** (peak_limit_db / 20)
        
        # 对所有声道检测峰值
        max_values = torch.max(torch.abs(waveform), dim=1)
        global_max_value = torch.max(max_values.values)
        
        if global_max_value > peak_limit_linear:
            gain = peak_limit_linear / global_max_value
            waveform = waveform * gain
        
        return waveform

    def _float_to_int16(self, waveform: torch.Tensor) -> torch.Tensor:
        """
        将浮点音频转换为int16格式

        Args:
            waveform: 浮点音频波形 (channels, samples)

        Returns:
            int16格式音频波形
        """
        # 限制范围并转换
        waveform_clamped = torch.clamp(waveform, -1.0, 1.0)
        return (waveform_clamped * (2 ** 15 - 1)).short()

    def _save_wav(self, path: Path, audio_data: np.ndarray, sample_rate: int):
        """
        保存WAV文件

        Args:
            path: 保存路径
            audio_data: 音频数据 (samples, channels)
            sample_rate: 采样率
        """
        wavfile.write(str(path), sample_rate, audio_data)

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

        # 危险字符集合（使用 set 提高查找效率）
        dangerous_chars = {
            '\\', '/', '..', '.', '|', ':', '*', '?', '"', '<', '>',
            '\n', '\r', '\t', '\x00', '\x0b', '\x0c'
        }

        # 路径遍历模式
        path_traversal_patterns = [
            r'\.\./+',
            r'\.\.\\+',
            r'~',
            r'^\.',
            r'\.$',
            r'^/',
            r'^\\',
        ]

        # 替换危险字符
        safe_path = path
        for char in dangerous_chars:
            safe_path = safe_path.replace(char, '_')

        # 替换路径遍历模式
        for pattern in path_traversal_patterns:
            safe_path = re.sub(pattern, '_', safe_path)

        # 清理连续的下划线
        safe_path = re.sub(r'_+', '_', safe_path)

        # 移除首尾下划线
        safe_path = safe_path.strip('_')

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

    def _get_unique_filename(self, directory: Path, filename: str, extension: str, max_attempts: int = 100000) -> str:
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

        raise FileExistsError(f"无法生成唯一文件名")
