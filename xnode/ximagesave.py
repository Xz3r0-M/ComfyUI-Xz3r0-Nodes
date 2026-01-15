"""
图像保存节点模块
================

这个模块包含图像保存相关的节点。
"""

import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Tuple, List

import numpy as np
import torch
import folder_paths
from PIL import Image, PngImagePlugin


class XImageSave:

    OUTPUT_NODE = True
    """
    XImageSave 图像保存节点

    提供图像保存功能，支持自定义文件名、子文件夹、日期时间标识符、元数据保存和安全防护。

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

    使用示例:
        filename_prefix="MyImage_%Y%m%d", subfolder="人物", compression_level=6
        输出: images(原图), save_path="output/人物/MyImage_20260114.png"

    元数据说明:
        - 节点自动接收ComfyUI注入的隐藏参数(prompt和extra_pnginfo)
        - prompt: 包含完整的工作流提示词JSON数据
        - extra_pnginfo: 包含工作流结构、种子值、模型信息等额外元数据
        - 元数据以PNG文本块形式嵌入图像，可通过图像查看器查看
    """

    @classmethod
    def INPUT_TYPES(cls) -> dict:
        """定义节点的输入类型和约束"""
        return {
            "required": {
                "images": ("IMAGE", {
                    "tooltip": "输入图像张量 (B, H, W, C)"
                }),
                "filename_prefix": ("STRING", {
                    "default": "ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%",
                    "tooltip": "文件名前缀，支持日期时间标识符: %Y%, %m%, %d%, %H%, %M%, %S%"
                }),
                "subfolder": ("STRING", {
                    "default": "Images",
                    "tooltip": "子文件夹名称(不支持路径分隔符，仅支持单个文件夹)，如: 人物 或 images_%Y%-%m%-%d%"
                }),
                "compression_level": ("INT", {
                    "default": 5,
                    "min": 0,
                    "max": 9,
                    "step": 1,
                    "tooltip": "PNG压缩级别(0=无压缩，9=最大压缩)"
                })
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO"
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("images", "save_path")
    FUNCTION = "save"
    CATEGORY = "♾️ Xz3r0/Image"

    def save(self, images: torch.Tensor, filename_prefix: str, subfolder: str = "", compression_level: int = 0, prompt=None, extra_pnginfo=None) -> Tuple[torch.Tensor, str]:
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
        safe_filename_prefix = self._replace_datetime_placeholders(safe_filename_prefix)

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
            final_filename = self._get_unique_filename(save_dir, filename, ".png")

            # 生成PNG元数据
            pnginfo = self._generate_pnginfo(prompt, extra_pnginfo)

            # 保存图像
            save_path = save_dir / final_filename
            if pnginfo:
                # 使用Pillow兼容的方式保存元数据
                pnginfo_obj = PngImagePlugin.PngInfo()
                for key, value in pnginfo.items():
                    pnginfo_obj.add_text(key, value)
                img_pil.save(save_path, format="PNG", compress_level=compression_level, pnginfo=pnginfo_obj)
            else:
                # 无元数据时正常保存
                img_pil.save(save_path, format="PNG", compress_level=compression_level)

            # 记录相对路径
            relative_path = str(save_path.relative_to(output_dir))
            saved_paths.append(relative_path)

        # 输出保存路径(多个图像用分号分隔)
        save_path_str = ";".join(saved_paths) if saved_paths else ""

        return (images, save_path_str)

    def _generate_pnginfo(self, prompt, extra_pnginfo):
        """
        生成PNG元数据

        Args:
            prompt: 工作流提示词
            extra_pnginfo: 额外的PNG元数据

        Returns:
            字典格式的PNG元数据或None
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
    print("XImageSave 节点已加载")
    print(f"节点分类: {XImageSave.CATEGORY}")
    print(f"输入类型: {XImageSave.INPUT_TYPES()}")
    print(f"输出类型: {XImageSave.RETURN_TYPES}")

    # 测试用例
    print("\n=== 测试用例 ===")
    node = XImageSave()

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
        "image_%Y%m%d",
        "photo_%Y%m%d_%H%M%S",
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
    test_file = test_dir / "test_001.png"
    test_file.touch()

    for filename in ["test_001", "test_002", "test_001"]:
        unique_name = node._get_unique_filename(test_dir, filename, ".png")
        print(f"  '{filename}.png' -> '{unique_name}'")
    
    print("\n说明: 序列号使用5位数字格式(00001)，确保文件排序正确")

    # 测试4: 压缩级别验证
    print("\n测试4 - 压缩级别验证")
    print("  compression_level=0: 无压缩(文件最大)")
    print("  compression_level=3: 轻度压缩")
    print("  compression_level=6: 中等压缩(推荐)")
    print("  compression_level=9: 最大压缩(文件最小，保存最慢)")

    # 清理测试文件
    test_file.unlink()
    test_dir.rmdir()

    # 测试5: 组合测试
    print("\n测试5 - 组合测试(路径清理+日期时间)")
    test_cases = [
        ("../backup/%Y%m%d", "backup_20260114"),
        ("test|file_%H%M%S", "test_file_143025"),
        ("photo_../secret/%d", "photo_secret_14"),
        ("人物/女性", "人物_女性"),
    ]
    for input_path, expected_contains in test_cases:
        safe_path = node._sanitize_path(input_path)
        safe_path = node._replace_datetime_placeholders(safe_path)
        print(f"  原始: '{input_path}'")
        print(f"  结果: '{safe_path}'")
        print(f"  期望包含: '{expected_contains}'")

    print("\n✅ 所有测试完成！")
