"""
Latent保存节点模块
=================

这个模块包含Latent保存相关的节点。
"""

import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Tuple

import torch

# 尝试导入ComfyUI依赖模块(用于实际运行环境)
try:
    import folder_paths
    import comfy.utils
    COMFYUI_AVAILABLE = True
except ImportError:
    # 测试环境下这些模块可能不可用
    COMFYUI_AVAILABLE = False


class XLatentSave:

    OUTPUT_NODE = True
    """
    XLatentSave Latent保存节点

    提供Latent保存功能,支持自定义文件名、子文件夹、日期时间标识符和安全防护。

    功能:
        - 保存Latent到ComfyUI默认输出目录
        - 输出Latent端口可以传递到其他节点
        - 支持自定义文件名和子文件夹
        - 支持日期时间标识符(%Y%, %m%, %d%, %H%, %M%, %S%)
        - 自动检测同名文件并添加序列号(从00001开始)
        - 仅支持单级子文件夹创建
        - 安全防护(防止路径遍历攻击,禁用路径分隔符)
        - 输出相对路径(不泄露绝对路径)
        - 支持元数据保存

    输入:
        latent: Latent张量 (LATENT)
        filename_prefix: 文件名前缀 (STRING)
        subfolder: 子文件夹名称 (STRING)
        prompt: 工作流提示词(隐藏参数,自动注入)
        extra_pnginfo: 额外元数据(隐藏参数,自动注入)

    输出:
        latent: 原始Latent(透传)
        save_path: 保存的相对路径 (STRING)

    使用示例:
        filename_prefix="MyLatent_%Y%m%d", subfolder="Latents"
        输出: latent(原图), save_path="output/Latents/MyLatent_20260114.latent"

    元数据说明:
        - 节点自动接收ComfyUI注入的隐藏参数(prompt和extra_pnginfo)
        - prompt: 包含完整的工作流提示词JSON数据
        - extra_pnginfo: 包含工作流结构、种子值、模型信息等额外元数据
        - 元数据以SafeTensors格式嵌入latent文件
    """

    @classmethod
    def INPUT_TYPES(cls) -> dict:
        """定义节点的输入类型和约束"""
        return {
            "required": {
                "latent": ("LATENT", {
                    "tooltip": "输入Latent张量"
                }),
                "filename_prefix": ("STRING", {
                    "default": "ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%",
                    "tooltip": "文件名前缀,支持日期时间标识符: %Y%, %m%, %d%, %H%, %M%, %S%"
                }),
                "subfolder": ("STRING", {
                    "default": "",
                    "tooltip": "子文件夹名称(不支持路径分隔符,仅支持单个文件夹),如: Latents 或 latents_%Y%-%m%-%d%"
                })
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO"
            }
        }

    RETURN_TYPES = ("LATENT", "STRING")
    RETURN_NAMES = ("latent", "save_path")
    FUNCTION = "save"
    CATEGORY = "♾️ Xz3r0/Latent"

    def save(self, latent: dict, filename_prefix: str, subfolder: str = "Latents", prompt=None, extra_pnginfo=None) -> Tuple[dict, str]:
        """
        保存Latent到ComfyUI输出目录

        Args:
            latent: Latent字典,包含"samples"键
            filename_prefix: 文件名前缀
            subfolder: 子文件夹路径
            prompt: 工作流提示词(元数据)
            extra_pnginfo: 额外的元数据

        Returns:
            (latent, save_path): 原始Latent和保存的相对路径
        """
        # 检查ComfyUI环境是否可用
        if not COMFYUI_AVAILABLE:
            raise RuntimeError("ComfyUI环境不可用,无法保存Latent文件")

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

        # 生成文件名
        base_filename = safe_filename_prefix

        # 检测同名文件并添加序列号(从00001开始)
        final_filename = self._get_unique_filename(save_dir, base_filename, ".latent")

        # 生成元数据
        metadata = self._generate_metadata(prompt, extra_pnginfo)

        # 保存Latent
        save_path = save_dir / final_filename

        # 准备latent数据
        latent_tensor = latent["samples"].contiguous()
        output = {
            "latent_tensor": latent_tensor,
            "latent_format_version_0": torch.tensor([])
        }

        # 使用comfy.utils保存latent(支持元数据)
        comfy.utils.save_torch_file(output, str(save_path), metadata=metadata)

        # 记录相对路径
        relative_path = str(save_path.relative_to(output_dir))

        return (latent, relative_path)

    def _generate_metadata(self, prompt, extra_pnginfo):
        """
        生成元数据

        Args:
            prompt: 工作流提示词
            extra_pnginfo: 额外的元数据

        Returns:
            字典格式的元数据或None
        """
        # 检查是否有元数据
        if prompt is None and extra_pnginfo is None:
            return None

        # 创建元数据字典
        metadata = {}

        # 添加prompt元数据
        if prompt is not None:
            metadata["prompt"] = json.dumps(prompt)

        # 添加额外的元数据
        if extra_pnginfo is not None:
            for key, value in extra_pnginfo.items():
                metadata[key] = json.dumps(value)

        return metadata

    def _get_output_directory(self) -> Path:
        """
        获取ComfyUI默认输出目录

        Returns:
            输出目录路径
        """
        if COMFYUI_AVAILABLE:
            return Path(folder_paths.get_output_directory())
        else:
            # 测试环境使用临时目录
            return Path("test_output")

    def _sanitize_path(self, path: str) -> str:
        """
        清理路径,防止遍历攻击并禁用多级目录

        将所有危险字符和路径分隔符替换为下划线,确保只允许单级文件夹名称

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

        # 使用正则表达式替换,确保完整匹配 %Y%, %m% 等格式
        def replace_match(match):
            placeholder = match.group()
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
            return placeholder

        # 匹配 %X% 格式(X为Y,m,d,H,M,S)
        pattern = r'%(Y|m|d|H|M|S)%'
        result = re.sub(pattern, replace_match, text)

        return result

    def _get_unique_filename(self, directory: Path, filename: str, extension: str) -> str:
        """
        获取唯一的文件名，避免覆盖

        如果文件名不存在则直接使用，存在则添加序列号

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


# 节点类映射(用于本地测试)
if __name__ == "__main__":
    print("XLatentSave 节点已加载")
    print(f"节点分类: {XLatentSave.CATEGORY}")
    print(f"输入类型: {XLatentSave.INPUT_TYPES()}")
    print(f"输出类型: {XLatentSave.RETURN_TYPES}")
    
    # 检查ComfyUI环境
    if not COMFYUI_AVAILABLE:
        print("\n⚠️  ComfyUI环境不可用,运行独立测试模式")

    # 测试用例
    print("\n=== 测试用例 ===")
    node = XLatentSave()

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
        "latent_%Y%%m%%d%",
        "photo_%Y%%m%%d%_%H%%M%%S%",
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
    test_file1 = test_dir / "test_001.latent"
    test_file2 = test_dir / "test_001_00001.latent"
    test_file1.touch()
    test_file2.touch()

    for filename in ["test_001", "test_002", "test_001"]:
        unique_name = node._get_unique_filename(test_dir, filename, ".latent")
        print(f"  '{filename}.latent' -> '{unique_name}'")

    print("\n说明: 文件不存在时不添加序列号，存在时从00001开始添加")

    # 清理测试文件
    test_file1.unlink()
    test_file2.unlink()
    test_dir.rmdir()

    # 测试4: 组合测试
    print("\n测试4 - 组合测试(路径清理+日期时间)")
    test_cases = [
        ("../backup/%Y%%m%%d%", "backup_20260114"),
        ("test|file_%H%%M%%S%", "test_file_143025"),
        ("photo_../secret/%d%", "photo_secret_14"),
        ("Latents/人物", "Latents_人物"),
    ]
    for input_path, expected_contains in test_cases:
        safe_path = node._sanitize_path(input_path)
        safe_path = node._replace_datetime_placeholders(safe_path)
        print(f"  原始: '{input_path}'")
        print(f"  结果: '{safe_path}'")
        print(f"  期望包含: '{expected_contains}'")

    # 测试5: Latent保存模拟测试
    print("\n测试5 - Latent保存模拟测试")
    print("  说明: 此测试模拟Latent保存流程(不实际保存文件)")

    if COMFYUI_AVAILABLE:
        # 模拟latent数据
        mock_latent = {
            "samples": torch.randn(1, 4, 32, 32)
        }

        # 测试文件名处理
        test_filename = "test_latent"
        test_subfolder = "Latents"

        # 处理日期时间
        safe_filename = node._replace_datetime_placeholders(node._sanitize_path(test_filename))
        safe_subfolder = node._replace_datetime_placeholders(node._sanitize_path(test_subfolder))

        print(f"  原始文件名: {test_filename}")
        print(f"  安全文件名: {safe_filename}")
        print(f"  原始子文件夹: {test_subfolder}")
        print(f"  安全子文件夹: {safe_subfolder}")
    else:
        print("  跳过Latent保存测试(ComfyUI环境不可用)")

    # 测试元数据生成
    print("\n测试6 - 元数据生成测试")
    test_prompt = {"text": "a beautiful landscape"}
    test_extra = {"workflow": {"version": 1.0}}

    metadata = node._generate_metadata(test_prompt, test_extra)
    if metadata:
        print("  元数据生成成功:")
        for key, value in metadata.items():
            print(f"    {key}: {value[:50]}...")
    else:
        print("  元数据为空")

    print("\n✅ 所有测试完成！")
