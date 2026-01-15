"""
视频保存节点模块
================

这个模块包含视频保存相关的节点。
"""

import json
import os
import re
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Tuple, List, Optional

import numpy as np
import torch
from PIL import Image

# 尝试导入ComfyUI的folder_paths模块
try:
    import folder_paths
    HAS_FOLDER_PATHS = True
except ImportError:
    HAS_FOLDER_PATHS = False


class XVideoSave:
    """
    XVideoSave 视频保存节点

    提供将图像序列保存为视频的功能，使用FFmpeg编码，支持无损视频保存。

    功能:
        - 使用FFmpeg将图像序列保存为MKV格式视频
        - 优先使用系统环境变量中的FFmpeg，回退到ffmpeg-python包
        - H.265/HEVC编码，yuv444p10le像素格式，CRF 0（无损）
        - 支持自定义FPS（每秒帧数）
        - 支持自定义文件名和子文件夹
        - 支持日期时间标识符(%Y%, %m%, %d%, %H%, %M%, %S%)
        - 自动检测同名文件并添加序列号
        - 仅支持单级子文件夹创建
        - 安全防护(防止路径遍历攻击)
        - 输出相对路径(不泄露绝对路径)

    输入:
        images: 图像张量序列 (IMAGE)
        fps: 每秒帧数 (INT)
        filename_prefix: 文件名前缀 (STRING)
        subfolder: 子文件夹名称 (STRING)

    输出:
        images: 原始图像(透传)
        save_path: 保存的相对路径 (STRING)

    使用示例:
        fps=30, filename_prefix="MyVideo_%Y%m%d", subfolder="videos"
        输出: images(原图), save_path="output/videos/MyVideo_20260114.mkv"

    FFmpeg参数说明:
        - vcodec: libx265 (H.265/HEVC编码)
        - pix_fmt: yuv444p10le (10位YUV 4:4:4采样，无损)
        - crf: 0 (质量因子，0为无损)
        - preset: fast (编码速度预设)
        - 容器格式: MKV
    """

    FFMPEG_PARAMS = {
        "vcodec": "libx265",
        "pix_fmt": "yuv444p10le",
        "crf": 0,
        "preset": "fast"
    }

    @classmethod
    def INPUT_TYPES(cls) -> dict:
        """定义节点的输入类型和约束"""
        return {
            "required": {
                "images": ("IMAGE", {
                    "tooltip": "输入图像张量序列 (B, H, W, C)"
                }),
                "fps": ("INT", {
                    "default": 24,
                    "min": 1,
                    "max": 240,
                    "step": 1,
                    "tooltip": "视频每秒帧数(FPS)"
                }),
                "filename_prefix": ("STRING", {
                    "default": "ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%",
                    "tooltip": "文件名前缀，支持日期时间标识符: %Y%, %m%, %d%, %H%, %M%, %S%"
                }),
                "subfolder": ("STRING", {
                    "default": "Videos",
                    "tooltip": "子文件夹名称(不支持路径分隔符，仅支持单个文件夹)，如: videos 或 videos_%Y%-%m%-%d%"
                })
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("images", "save_path")
    FUNCTION = "save"
    CATEGORY = "♾️ Xz3r0/Video"

    def save(self, images: torch.Tensor, fps: int, filename_prefix: str, subfolder: str = "") -> Tuple[torch.Tensor, str]:
        """
        保存图像序列为视频

        Args:
            images: 图像张量序列 (B, H, W, C)
            fps: 每秒帧数
            filename_prefix: 文件名前缀
            subfolder: 子文件夹路径

        Returns:
            (images, save_path): 原始图像和保存的相对路径
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

        # 检测同名文件并添加序列号
        final_filename = self._get_unique_filename(save_dir, safe_filename_prefix, ".mkv")

        # 保存路径
        save_path = save_dir / final_filename

        # 使用FFmpeg保存视频
        self._save_video_with_ffmpeg(images, fps, save_path)

        # 输出相对路径
        relative_path = str(save_path.relative_to(output_dir))

        return (images, relative_path)

    def _get_output_directory(self) -> Path:
        """
        获取ComfyUI默认输出目录

        Returns:
            输出目录路径
        """
        if HAS_FOLDER_PATHS:
            return Path(folder_paths.get_output_directory())
        else:
            # 回退到当前目录的output文件夹
            output_dir = Path.cwd() / "output"
            output_dir.mkdir(exist_ok=True)
            return output_dir

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
            '\\', '/', '..', '.', '|', ':', '*', '?', '"', '<', '>',
            '\n', '\r', '\t', '\x00', '\x0b', '\x0c'
        ]

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

        Args:
            text: 包含日期时间标识符的文本

        Returns:
            替换后的文本
        """
        if not text:
            return ""

        now = datetime.now()

        def replace_match(match):
            placeholder = match.group(0)
            if placeholder == "%Y%":
                return now.strftime("%Y")
            elif placeholder == "%m%":
                return now.strftime("%m")
            elif placeholder == "%d%":
                return now.strftime("%d")
            elif placeholder == "%H%":
                return now.strftime("%H")
            elif placeholder == "%M%":
                return now.strftime("%M")
            elif placeholder == "%S%":
                return now.strftime("%S")
            else:
                return placeholder

        result = re.sub(r'%[YmdHMSmd]%', replace_match, text)

        return result

    def _get_unique_filename(self, directory: Path, filename: str, extension: str) -> str:
        """
        获取唯一的文件名，避免覆盖

        Args:
            directory: 目录路径
            filename: 基础文件名
            extension: 文件扩展名

        Returns:
            唯一的文件名
        """
        base_name = filename
        counter = 0

        while True:
            if counter == 0:
                candidate = f"{base_name}{extension}"
            else:
                candidate = f"{base_name}_{counter:05d}{extension}"

            candidate_path = directory / candidate

            if not candidate_path.exists():
                return candidate

            counter += 1

    def _save_video_with_ffmpeg(self, images: torch.Tensor, fps: int, output_path: Path):
        """
        使用FFmpeg保存视频

        优先使用系统FFmpeg，回退到ffmpeg-python包

        Args:
            images: 图像张量序列 (B, H, W, C)
            fps: 每秒帧数
            output_path: 输出视频路径
        """
        # 转换图像序列为PIL图像列表
        pil_images = [self._tensor_to_pil(img) for img in images]

        # 尝试使用系统FFmpeg
        if self._try_system_ffmpeg(pil_images, fps, output_path):
            return

        # 回退到ffmpeg-python包
        self._save_with_ffmpeg_python(pil_images, fps, output_path)

    def _try_system_ffmpeg(self, pil_images: List[Image.Image], fps: int, output_path: Path) -> bool:
        """
        尝试使用系统FFmpeg保存视频

        Args:
            pil_images: PIL图像列表
            fps: 每秒帧数
            output_path: 输出视频路径

        Returns:
            是否成功
        """
        # 检测系统FFmpeg
        ffmpeg_path = self._find_system_ffmpeg()
        if not ffmpeg_path:
            return False

        try:
            # 创建临时目录保存图像序列
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_dir_path = Path(temp_dir)

                # 保存图像序列
                for i, img in enumerate(pil_images):
                    img_path = temp_dir_path / f"frame_{i:06d}.png"
                    img.save(img_path, format="PNG")

                # 构建FFmpeg命令
                input_pattern = temp_dir_path / "frame_%06d.png"
                cmd = [
                    str(ffmpeg_path),
                    "-y",  # 覆盖输出文件
                    "-framerate", str(fps),
                    "-i", str(input_pattern),
                    "-c:v", self.FFMPEG_PARAMS["vcodec"],
                    "-pix_fmt", self.FFMPEG_PARAMS["pix_fmt"],
                    "-crf", str(self.FFMPEG_PARAMS["crf"]),
                    "-preset", self.FFMPEG_PARAMS["preset"],
                    str(output_path)
                ]

                # 执行FFmpeg命令
                result = subprocess.run(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    check=True
                )

                return True

        except subprocess.CalledProcessError as e:
            print(f"[XVideoSave] FFmpeg执行失败: {e}")
            print(f"[XVideoSave] stderr: {e.stderr}")
            return False
        except Exception as e:
            print(f"[XVideoSave] 系统FFmpeg出错: {e}")
            return False

    def _find_system_ffmpeg(self) -> Optional[Path]:
        """
        查找系统FFmpeg

        Returns:
            FFmpeg路径或None
        """
        # 检查环境变量PATH中的ffmpeg
        ffmpeg_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"

        try:
            # 尝试which/where命令
            if os.name == "nt":
                result = subprocess.run(
                    ["where", ffmpeg_name],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True
                )
            else:
                result = subprocess.run(
                    ["which", ffmpeg_name],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True
                )

            if result.returncode == 0 and result.stdout.strip():
                # 取第一行结果
                ffmpeg_path = result.stdout.strip().split('\n')[0]
                return Path(ffmpeg_path)

        except Exception as e:
            print(f"[XVideoSave] 查找系统FFmpeg失败: {e}")

        return None

    def _save_with_ffmpeg_python(self, pil_images: List[Image.Image], fps: int, output_path: Path):
        """
        使用ffmpeg-python包保存视频

        Args:
            pil_images: PIL图像列表
            fps: 每秒帧数
            output_path: 输出视频路径
        """
        try:
            import ffmpeg

            # 创建临时目录保存图像序列
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_dir_path = Path(temp_dir)

                # 保存图像序列
                for i, img in enumerate(pil_images):
                    img_path = temp_dir_path / f"frame_{i:06d}.png"
                    img.save(img_path, format="PNG")

                # 构建ffmpeg-python命令
                input_pattern = str(temp_dir_path / "frame_%06d.png")
                (
                    ffmpeg
                    .input(input_pattern, framerate=fps)
                    .output(
                        str(output_path),
                        vcodec=self.FFMPEG_PARAMS["vcodec"],
                        pix_fmt=self.FFMPEG_PARAMS["pix_fmt"],
                        crf=self.FFMPEG_PARAMS["crf"],
                        preset=self.FFMPEG_PARAMS["preset"]
                    )
                    .overwrite_output()
                    .run(capture_stdout=True, capture_stderr=True)
                )

        except ImportError:
            raise RuntimeError(
                "未找到FFmpeg！请安装FFmpeg：\n"
                "1. 安装系统FFmpeg: https://ffmpeg.org/download.html\n"
                "2. 或安装ffmpeg-python包: pip install ffmpeg-python"
            )
        except ffmpeg.Error as e:
            print(f"[XVideoSave] ffmpeg-python错误: {e.stderr.decode('utf-8')}")
            raise
        except Exception as e:
            print(f"[XVideoSave] ffmpeg-python保存失败: {e}")
            raise

    def _tensor_to_pil(self, tensor: torch.Tensor) -> Image.Image:
        """
        将张量转换为PIL图像

        Args:
            tensor: 图像张量 (H, W, C) 或 (B, H, W, C)

        Returns:
            PIL图像对象
        """
        # 确保张量在CPU上
        tensor = tensor.cpu()

        # 处理批次维度：如果是4D张量，取第一个图像
        if tensor.dim() == 4:
            tensor = tensor[0]

        # 转换为numpy数组并移除多余维度（使用squeeze）
        if tensor.dim() == 3:
            numpy_array = tensor.numpy()
        else:
            raise ValueError(f"不支持的张量维度: {tensor.dim()}，期望3维或4维")

        # 转换值范围从[0, 1]到[0, 255]，并确保值在有效范围内
        numpy_array = np.clip(255.0 * numpy_array, 0, 255).astype(np.uint8)

        # 创建PIL图像
        if numpy_array.shape[2] == 4:
            # RGBA
            mode = 'RGBA'
        elif numpy_array.shape[2] == 3:
            # RGB
            mode = 'RGB'
        elif numpy_array.shape[2] == 1:
            # 灰度图
            mode = 'L'
            numpy_array = numpy_array.squeeze(2)
        else:
            raise ValueError(f"不支持的通道数: {numpy_array.shape[2]}")

        pil_image = Image.fromarray(numpy_array, mode=mode)

        return pil_image


# 节点类映射（用于本地测试）
if __name__ == "__main__":
    try:
        import folder_paths
        print("XVideoSave 节点已加载")
        print(f"节点分类: {XVideoSave.CATEGORY}")
        print(f"输入类型: {XVideoSave.INPUT_TYPES()}")
        print(f"输出类型: {XVideoSave.RETURN_TYPES}")
        print(f"FFmpeg参数: {XVideoSave.FFMPEG_PARAMS}")

        # 测试用例
        print("\n=== 测试用例 ===")
        node = XVideoSave()
    except ImportError:
        print("⚠️  警告: 未检测到ComfyUI环境(folder_paths模块)")
        print("   以下测试仅测试辅助函数，不涉及folder_paths依赖\n")

        # 创建模拟类用于测试辅助函数
        class MockXVideoSave:
            FFMPEG_PARAMS = {
                "vcodec": "libx265",
                "pix_fmt": "yuv444p10le",
                "crf": 0,
                "preset": "fast"
            }

            def _sanitize_path(self, path: str) -> str:
                if not path:
                    return ""

                dangerous_chars = [
                    '\\', '/', '..', '.', '|', ':', '*', '?', '"', '<', '>',
                    '\n', '\r', '\t', '\x00', '\x0b', '\x0c'
                ]

                path_traversal_patterns = [
                    r'\.\./+',
                    r'\.\.\\+',
                    r'~',
                    r'^\.',
                    r'\.$',
                    r'^/',
                    r'^\\',
                ]

                safe_path = path
                for char in dangerous_chars:
                    safe_path = safe_path.replace(char, '_')

                for pattern in path_traversal_patterns:
                    safe_path = re.sub(pattern, '_', safe_path)

                safe_path = re.sub(r'_+', '_', safe_path)
                safe_path = safe_path.strip('_')

                return safe_path

            def _replace_datetime_placeholders(self, text: str) -> str:
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

            def _get_unique_filename(self, directory: Path, filename: str, extension: str) -> str:
                base_name = filename
                counter = 0

                while True:
                    if counter == 0:
                        candidate = f"{base_name}{extension}"
                    else:
                        candidate = f"{base_name}_{counter:05d}{extension}"

                    candidate_path = directory / candidate

                    if not candidate_path.exists():
                        return candidate

                    counter += 1

            def _find_system_ffmpeg(self) -> Optional[Path]:
                ffmpeg_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"

                try:
                    if os.name == "nt":
                        result = subprocess.run(
                            ["where", ffmpeg_name],
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            text=True
                        )
                    else:
                        result = subprocess.run(
                            ["which", ffmpeg_name],
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            text=True
                        )

                    if result.returncode == 0 and result.stdout.strip():
                        ffmpeg_path = result.stdout.strip().split('\n')[0]
                        return Path(ffmpeg_path)

                except Exception as e:
                    print(f"[XVideoSave] 查找系统FFmpeg失败: {e}")

                return None

            def _tensor_to_pil(self, tensor: torch.Tensor) -> Image.Image:
                tensor = tensor.cpu()

                if tensor.dim() == 4:
                    tensor = tensor[0]

                if tensor.dim() == 3:
                    numpy_array = tensor.numpy()
                else:
                    raise ValueError(f"不支持的张量维度: {tensor.dim()}，期望3维或4维")

                numpy_array = np.clip(255.0 * numpy_array, 0, 255).astype(np.uint8)

                if numpy_array.shape[2] == 4:
                    mode = 'RGBA'
                elif numpy_array.shape[2] == 3:
                    mode = 'RGB'
                elif numpy_array.shape[2] == 1:
                    mode = 'L'
                    numpy_array = numpy_array.squeeze(2)
                else:
                    raise ValueError(f"不支持的通道数: {numpy_array.shape[2]}")

                pil_image = Image.fromarray(numpy_array, mode=mode)
                return pil_image

        node = MockXVideoSave()
        ffmpeg_params = node.FFMPEG_PARAMS

        # 测试1: 路径清理
        print("\n测试1 - 路径清理")
        test_paths = [
            "normal",
            "../etc/passwd",
            "../../../system",
            "~/home/user",
            "test/../hidden",
            "file.txt",
            "path/to/file",
            "test|file",
            "file<test>",
        ]
        for path in test_paths:
            safe_path = node._sanitize_path(path)
            print(f"  原始: '{path}' -> 安全: '{safe_path}'")

        # 测试2: 日期时间替换
        print("\n测试2 - 日期时间替换")
        test_names = [
            "video_%Y%%m%%d%",
            "clip_%Y%%m%%d%_%H%%M%%S%",
            "test_%Y%/test_%m%",
            "",
            "no_placeholder",
        ]
        for name in test_names:
            result = node._replace_datetime_placeholders(name)
            print(f"  原始: '{name}' -> 替换: '{result}'")

        # 测试3: 唯一文件名生成
        print("\n测试3 - 唯一文件名生成")
        test_dir = Path("test_output")
        test_dir.mkdir(exist_ok=True)

        # 创建测试文件
        test_file = test_dir / "test_001.mkv"
        test_file.touch()

        for filename in ["test_001", "test_002", "test_001"]:
            unique_name = node._get_unique_filename(test_dir, filename, ".mkv")
            print(f"  '{filename}.mkv' -> '{unique_name}'")

        print("\n说明: 序列号使用5位数字格式(00001)，确保文件排序正确")

        # 清理测试文件
        test_file.unlink()
        test_dir.rmdir()

        # 测试4: FFmpeg参数验证
        print("\n测试4 - FFmpeg参数验证")
        print(f"  编码器: {ffmpeg_params['vcodec']} (H.265/HEVC)")
        print(f"  像素格式: {ffmpeg_params['pix_fmt']} (10位YUV 4:4:4)")
        print(f"  质量因子: {ffmpeg_params['crf']} (0=无损)")
        print(f"  预设: {ffmpeg_params['preset']} (fast)")
        print(f"  容器格式: MKV")

        # 测试5: 系统FFmpeg检测
        print("\n测试5 - 系统FFmpeg检测")
        ffmpeg_path = node._find_system_ffmpeg()
        if ffmpeg_path:
            print(f"  ✅ 找到系统FFmpeg: {ffmpeg_path}")
        else:
            print(f"  ⚠️  未找到系统FFmpeg，将使用ffmpeg-python包")

        # 测试6: 组合测试
        print("\n测试6 - 组合测试(路径清理+日期时间)")
        test_cases = [
            ("../backup/%Y%%m%%d%", "backup_"),
            ("test|video_%H%%M%%S%", "test_video_"),
            ("video_../secret/%d", "video_secret_"),
            ("视频/测试", "视频_测试"),
        ]
        for input_path, expected_contains in test_cases:
            safe_path = node._sanitize_path(input_path)
            safe_path = node._replace_datetime_placeholders(safe_path)
            print(f"  原始: '{input_path}'")
            print(f"  结果: '{safe_path}'")

        # 测试7: 张量转换测试
        print("\n测试7 - 张量转换测试")
        try:
            # 创建测试张量
            test_tensor = torch.rand(3, 512, 512, 3)
            pil_img = node._tensor_to_pil(test_tensor)
            print(f"  ✅ 张量转换成功: {test_tensor.shape} -> {pil_img.size} {pil_img.mode}")

            # 测试批次张量
            batch_tensor = torch.rand(10, 3, 512, 512, 3)
            for i in range(min(3, len(batch_tensor))):
                pil_img = node._tensor_to_pil(batch_tensor[i])
                print(f"  ✅ 批次张量[{i}]转换成功: {pil_img.size} {pil_img.mode}")

        except Exception as e:
            print(f"  ❌ 张量转换失败: {e}")

        print("\n✅ 所有测试完成！")
