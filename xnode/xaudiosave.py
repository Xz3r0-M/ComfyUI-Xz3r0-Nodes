"""
音频保存节点模块
================

这个模块包含音频保存相关的节点。
"""

import os
import re
import tempfile
from datetime import datetime
from pathlib import Path

import ffmpeg
import folder_paths
import numpy as np
import torch
from scipy.io import wavfile
from torchaudio.transforms import Resample


class XAudioSave:
    OUTPUT_NODE = True
    """
    XAudioSave 音频保存节点

    提供音频保存功能，使用WAV无损格式，支持自定义文件名、子文件夹、日期时间标识符、音量标准化和峰值限制。

    功能:
        - 保存音频到ComfyUI默认输出目录
        - 强制使用WAV无损格式(PCM 16-bit)
        - 支持多种采样率(44.1kHz, 48kHz, 96kHz, 192kHz)
        - LUFS音量标准化(默认-14.1 LUFS)
        - 峰值限制(支持两种模式: Disabled, True Peak)
        - 支持自定义文件名和子文件夹
        - 支持日期时间标识符(%Y%, %m%, %d%, %H%, %M%, %S%)
        - 自动添加序列号防止覆盖(从00001开始)
        - 仅支持单级子文件夹创建
        - 安全防护(防止路径遍历攻击)
        - 输出相对路径(不泄露绝对路径)

    峰值限制模式说明:
        - Disabled: 禁用峰值限制
        - True Peak: 广播标准True Peak限制(8x过采样，精度高)

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
        filename_prefix="MyAudio_%Y%m%d", subfolder="Audio",
        sample_rate="48000", target_lufs=-14.0,
        peak_mode="True Peak", peak_limit=-1.0
        输出: processed_audio(重采样/标准化/峰值限制),
        save_path="output/Audio/MyAudio_20260114.wav"
    """

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
                            "Filename prefix, supports datetime placeholders: %Y%, %m%, %d%, %H%, %M%, %S%"
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
                "peak_mode": (
                    ["Disabled", "True Peak"],
                    {
                        "default": "True Peak",
                        "tooltip": (
                            "Peak limiting mode: Disabled (no limiting), "
                            "True Peak (Broadcast standard, 8x oversampling)"
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
                            "Only used when peak_mode is not 'Disabled'. "
                            "Default -1.1, Values below 0 dB prevent clipping."
                        ),
                    },
                ),
            }
        }

    RETURN_TYPES = ("AUDIO", "STRING")
    RETURN_NAMES = ("processed_audio", "save_path")
    OUTPUT_TOOLTIPS = (
        "Audio after resampling, loudness normalization, and peak limiting",
        "Saved file path relative to ComfyUI output directory",
    )
    FUNCTION = "save"
    CATEGORY = "♾️ Xz3r0/Audio"

    def save(
        self,
        audio: dict,
        filename_prefix: str,
        subfolder: str,
        sample_rate: str,
        target_lufs: float,
        peak_mode: str,
        peak_limit: float,
    ) -> tuple[dict, str]:
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

        # 重采样音频(如果需要)
        if original_sr != target_sr:
            waveform = self._resample_audio(waveform, original_sr, target_sr)

        # 生成文件名(添加序列号)
        base_filename = safe_filename_prefix
        final_filename = self._get_unique_filename(
            save_dir, base_filename, ".wav"
        )

        # 保存路径
        save_path = save_dir / final_filename

        # 处理LUFS标准化和峰值限制
        final_lufs = target_lufs if target_lufs > -70 else None
        final_peak = peak_limit if peak_limit < 0 else None
        if final_lufs is not None:
            waveform = self._normalize_lufs(
                waveform,
                target_sr,
                final_lufs,
                peak_mode,
                final_peak if final_peak is not None else 0,
                save_path,
            )
        else:
            # 没有LUFS标准化时，手动保存
            waveform_int16 = self._float_to_int16(waveform)
            audio_data = waveform_int16.numpy().T
            self._save_wav(save_path, audio_data, target_sr)

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

    def _normalize_lufs(
        self,
        waveform: torch.Tensor,
        sample_rate: int,
        target_lufs: float,
        peak_mode: str,
        peak_limit_db: float,
        final_save_path: Path,
    ) -> torch.Tensor:
        """
        LUFS音量标准化和峰值限制 (使用 FFmpeg loudnorm 滤镜，支持任意声道数)

        Args:
            waveform: 音频波形张量 (channels, samples)
            sample_rate: 采样率
            target_lufs: 目标LUFS值
            peak_mode: 峰值限制模式 (Disabled, True Peak)
            peak_limit_db: 峰值限制值(dB)
            final_save_path: 最终保存路径

        Returns:
            标准化后的音频波形
        """
        import shutil

        audio_np = waveform.numpy()
        files_to_cleanup = []

        try:
            print("[XAudioSave] Starting LUFS normalization...")
            print(
                f"[XAudioSave] Target LUFS: {target_lufs}, Peak mode: {peak_mode}, Peak limit: {peak_limit_db} dB"
            )

            ffmpeg_path = shutil.which("ffmpeg")
            print(f"[XAudioSave] FFmpeg executable path: {ffmpeg_path}")

            if not ffmpeg_path:
                print("[XAudioSave] ERROR: FFmpeg not found in PATH")
                print(
                    f"[XAudioSave] Current PATH: {os.environ.get('PATH', 'Not set')}"
                )
                raise RuntimeError(
                    "FFmpeg executable not found. Please install FFmpeg and add it to your system PATH."
                )

            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False
            ) as input_file:
                input_path = input_file.name
                files_to_cleanup.append(input_path)

            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False
            ) as output_file:
                output_path = output_file.name
                files_to_cleanup.append(output_path)

            audio_data = audio_np.T
            wavfile.write(input_path, sample_rate, audio_data)
            print(f"[XAudioSave] Input file created: {input_path}")
            print(f"[XAudioSave] Output file: {output_path}")

            print(
                "[XAudioSave] Starting pass 1: collecting loudness statistics..."
            )

            import json

            stdout, stderr = (
                ffmpeg.input(input_path)
                .filter(
                    "loudnorm",
                    I=target_lufs,
                    TP=peak_limit_db if peak_limit_db < 0 else -1.0,
                    print_format="json",
                )
                .output(
                    "NUL" if os.name == "nt" else "/dev/null", format="null"
                )
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
            stderr_str = stderr.decode("utf-8")

            import re

            stats_json = None
            json_match = re.search(r'\{[^{}]*"input_i"[^{}]*\}', stderr_str)
            if json_match:
                try:
                    stats_json = json.loads(json_match.group(0))
                except json.JSONDecodeError:
                    pass

            if stats_json is None:
                print(
                    "[XAudioSave] Warning: Could not parse loudnorm stats from stderr"
                )
                print(f"[XAudioSave] Stderr output: {stderr_str}")
                return waveform

            measured_i = str(stats_json["input_i"])
            measured_lra = str(stats_json["input_lra"])
            measured_tp = str(stats_json["input_tp"])
            measured_thresh = str(stats_json["input_thresh"])
            offset = str(stats_json["target_offset"])

            print(
                "[XAudioSave] Measured - I: "
                f"{measured_i}, LRA: {measured_lra}, TP: {measured_tp}, "
                f"Thresh: {measured_thresh}, Offset: {offset}"
            )

            tp_value = (
                0
                if peak_mode == "Disabled"
                else (peak_limit_db if peak_limit_db < 0 else -1.0)
            )
            print(
                f"[XAudioSave] Target - I: {target_lufs}, TP: {tp_value}, Peak mode: {peak_mode}"
            )

            print("[XAudioSave] Starting pass 2: applying normalization...")

            loudnorm_filter = (
                f"loudnorm=I={target_lufs}:TP={tp_value}:"
                f"measured_I={measured_i}:measured_LRA={measured_lra}:"
                f"measured_TP={measured_tp}:measured_thresh={measured_thresh}:"
                f"offset={offset}:print_format=summary,"
                f"aresample={sample_rate}:resampler=soxr"
            )

            print(f"[XAudioSave] Filter chain: {loudnorm_filter}")

            stdout2, stderr2 = (
                ffmpeg.input(input_path)
                .output(
                    output_path,
                    acodec="pcm_s16le",
                    af=loudnorm_filter,
                    ar=sample_rate,
                    **{"loglevel": "info"},
                )
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )

            print("[XAudioSave] Pass 2 summary:")
            print(f"[XAudioSave] {stderr2.decode('utf-8')}")

            print("[XAudioSave] FFmpeg processing completed successfully")

            import shutil

            shutil.copy2(output_path, final_save_path)

            final_size = os.path.getsize(final_save_path)
            print(
                f"[XAudioSave] Copied to: {final_save_path} ({final_size} bytes)"
            )

            print("[XAudioSave] Verifying final file...")
            _, verify_stderr = (
                ffmpeg.input(str(final_save_path))
                .filter("ebur128", peak="true")
                .output(
                    "NUL" if os.name == "nt" else "/dev/null",
                    format="null",
                    **{"loglevel": "error"},
                )
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
            verify_output = verify_stderr.decode("utf-8")
            for line in reversed(verify_output.split("\n")):
                if "I:" in line or "TP:" in line:
                    print(f"[XAudioSave] Final: {line.strip()}")
                    break

            sample_rate_out, audio_data_out = wavfile.read(
                output_path, mmap=True
            )

            if audio_data_out.ndim == 1:
                audio_data_out = audio_data_out.reshape(-1, 1)

            waveform_normalized = (
                torch.from_numpy(audio_data_out.T).float() / 32768.0
            )
            waveform_normalized = torch.clamp(waveform_normalized, -1.0, 1.0)

            try:
                waveform_normalized = waveform_normalized.to(
                    waveform.device, non_blocking=True
                )
            except RuntimeError:
                print(
                    f"[XAudioSave] Warning: Could not transfer audio to device {waveform.device}. Using CPU."
                )
                waveform_normalized = waveform_normalized.to("cpu")

            print("[XAudioSave] LUFS normalization completed")
            return waveform_normalized
        except ffmpeg.Error as e:
            print("[XAudioSave] ERROR: FFmpeg loudnorm failed")
            print(f"[XAudioSave] Error details: {e}")
            if e.stderr:
                print(
                    f"[XAudioSave] FFmpeg stderr: {e.stderr.decode('utf-8')}"
                )
            if e.stdout:
                print(
                    f"[XAudioSave] FFmpeg stdout: {e.stdout.decode('utf-8')}"
                )
            print("[XAudioSave] Using original audio without normalization.")
            return waveform
        except Exception as e:
            import traceback

            print(
                "[XAudioSave] ERROR: Unexpected error during loudness normalization"
            )
            print(f"[XAudioSave] Exception type: {type(e).__name__}")
            print(f"[XAudioSave] Exception message: {e}")
            print("[XAudioSave] Traceback:")
            print(traceback.format_exc())
            print("[XAudioSave] Using original audio without normalization.")
            return waveform
        finally:
            for path in files_to_cleanup:
                if os.path.exists(path):
                    try:
                        os.remove(path)
                    except Exception:
                        pass

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
        return (waveform_clamped * (2**15 - 1)).short()

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
