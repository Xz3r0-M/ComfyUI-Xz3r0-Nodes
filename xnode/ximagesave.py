"""
图像保存节点模块
================

这个模块包含图像保存相关的节点。
"""

import json
import re
from datetime import datetime
from pathlib import Path

import folder_paths
import numpy as np
import torch
from PIL import Image, PngImagePlugin


class XImageSave:
    OUTPUT_NODE = True
    """
    XImageSave 图像保存节点

    提供图像保存功能，支持自定义文件名、子文件夹、
    日期时间标识符、元数据保存和安全防护。

    功能:
        - 保存图像到ComfyUI默认输出目录
        - 支持自定义文件名和子文件夹
        - 支持日期时间标识符(%Y%, %m%, %d%, %H%, %M%, %S%)
        - 自动检测同名文件并添加序列号
        - 仅支持单级子文件夹创建
        - 安全防护(防止路径遍历攻击，禁用路径分隔符)
        - 图像序列支持(批量保存)
        - 可调节PNG压缩级别(0-9)
        - 元数据保存(工作流提示词、种子值、生成参数等)
        - 输出相对路径(不泄露绝对路径)

    输入:
        images: 图像张量 (IMAGE)
        filename_prefix: 文件名前缀 (STRING)
        subfolder: 子文件夹名称 (STRING)
        compression_level: PNG压缩级别 0-9 (INT)
        prompt: 工作流提示词(隐藏参数，自动注入)
        extra_pnginfo: 额外元数据(隐藏参数，自动注入)

    输出:
        images: 原始图像(透传)
        save_path: 保存的相对路径 (STRING)

    Usage example:
        filename_prefix="MyImage_%Y%m%d",
        subfolder="Characters",
        compression_level=6
        Output: images(original),
        save_path="output/Characters/MyImage_20260114.png"

    元数据说明:
        - 节点自动接收ComfyUI注入的隐藏参数(prompt和extra_pnginfo)
        - prompt: 包含完整的工作流提示词JSON数据
        - extra_pnginfo: 包含工作流结构、种子值、模型信息等
        - 元数据以PNG文本块形式嵌入图像，可通过图像查看器查看
    """

    @classmethod
    def INPUT_TYPES(cls) -> dict:
        """定义节点的输入类型和约束"""
        return {
            "required": {
                "images": (
                    "IMAGE",
                    {"tooltip": "Input image tensor (B, H, W, C)"},
                ),
                "filename_prefix": (
                    "STRING",
                    {
                        "default": "ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%",
                        "tooltip": (
                            "Filename prefix, supports datetime "
                            "placeholders: %Y%, %m%, %d%, %H%, %M%, %S%"
                        ),
                    },
                ),
                "subfolder": (
                    "STRING",
                    {
                        "default": "Images",
                        "tooltip": (
                            "Subfolder name (no path separators "
                            "allowed), supports datetime "
                            "placeholders: %Y%, %m%, %d%, %H%, "
                            "%M%, %S%"
                        ),
                    },
                ),
                "compression_level": (
                    "INT",
                    {
                        "default": 5,
                        "min": 0,
                        "max": 9,
                        "step": 1,
                        "tooltip": (
                            "PNG compression level (0=no compression, "
                            "9=maximum compression)"
                        ),
                    },
                ),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("images", "save_path")
    OUTPUT_TOOLTIPS = (
        "Original input images (passed through)",
        "Saved file path relative to ComfyUI output directory",
    )
    FUNCTION = "save"
    CATEGORY = "♾️ Xz3r0/File-Processing"

    def save(
        self,
        images: torch.Tensor,
        filename_prefix: str,
        subfolder: str = "",
        compression_level: int = 0,
        prompt=None,
        extra_pnginfo=None,
    ) -> tuple[torch.Tensor, str]:
        """
        保存图像到ComfyUI输出目录

        Args:
            images: 图像张量 (B, H, W, C)
            filename_prefix: 文件名前缀
            subfolder: 子文件夹路径
            compression_level: PNG压缩级别(0-9)
            prompt: 工作流提示词(元数据)
            extra_pnginfo: 额外的PNG元数据

        Returns:
            (images, save_path): 原始图像和保存的相对路径
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

        # 保存图像序列
        saved_paths = []
        for i, img_tensor in enumerate(images):
            # 转换张量到PIL图像
            img_pil = self._tensor_to_pil(img_tensor)

            # 生成文件名(添加序列号)
            filename = safe_filename_prefix
            if len(images) > 1:
                filename = f"{filename}_{i:04d}"

            # 检测同名文件并添加序列号
            final_filename = self._get_unique_filename(
                save_dir, filename, ".png"
            )

            # 生成PNG元数据
            pnginfo = self._generate_pnginfo(prompt, extra_pnginfo)

            # 保存图像
            save_path = save_dir / final_filename
            if pnginfo:
                # 使用Pillow兼容的方式保存元数据
                pnginfo_obj = PngImagePlugin.PngInfo()
                for key, value in pnginfo.items():
                    pnginfo_obj.add_text(key, value)
                img_pil.save(
                    save_path,
                    format="PNG",
                    compress_level=compression_level,
                    pnginfo=pnginfo_obj,
                )
            else:
                # 无元数据时正常保存
                img_pil.save(
                    save_path, format="PNG", compress_level=compression_level
                )

            # 记录相对路径
            relative_path = str(save_path.relative_to(output_dir))
            saved_paths.append(relative_path)

        # 输出保存路径(多个图像用分号分隔)
        save_path_str = ";".join(saved_paths) if saved_paths else ""

        return (images, save_path_str)

    def _generate_pnginfo(self, prompt, extra_pnginfo):
        """
        生成PNG元数据。

        Args:
            prompt: 工作流提示词。
            extra_pnginfo: 额外的PNG元数据。

        Returns:
            字典格式的PNG元数据或None。
        """
        # 检查是否有元数据
        if prompt is None and extra_pnginfo is None:
            return None

        # 创建元数据字典
        pnginfo = {}

        # 添加prompt元数据
        if prompt is not None:
            pnginfo["prompt"] = json.dumps(prompt)

        # 添加额外的PNG元数据
        if extra_pnginfo is not None:
            for key, value in extra_pnginfo.items():
                pnginfo[key] = json.dumps(value)

        return pnginfo

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
            raise ValueError(
                "Unsupported tensor dimension, expected 3 or 4 dimensions"
            )

        # 转换值范围从[0, 1]到[0, 255]，并确保值在有效范围内
        numpy_array = np.clip(255.0 * numpy_array, 0, 255).astype(np.uint8)

        # 创建PIL图像
        if numpy_array.shape[2] == 4:
            # RGBA
            mode = "RGBA"
        elif numpy_array.shape[2] == 3:
            # RGB
            mode = "RGB"
        elif numpy_array.shape[2] == 1:
            # 灰度图
            mode = "L"
            numpy_array = numpy_array.squeeze(2)
        else:
            raise ValueError("Unsupported channel count")

        pil_image = Image.fromarray(numpy_array, mode=mode)

        return pil_image


NODE_CLASS_MAPPINGS = {
    "XImageSave": XImageSave,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "XImageSave": "XImageSave",
}
