"""
Latent加载节点模块
================

这个模块包含Latent加载相关的节点。
"""

import os
from pathlib import Path
from typing import Tuple, List, Optional

import torch
import safetensors.torch

try:
    import folder_paths
    HAS_COMFYUI = True
except ImportError:
    HAS_COMFYUI = False


class XLatentLoad:
    """
    XLatentLoad Latent加载节点

    提供Latent文件加载功能，支持从输入端口接收Latent或从下拉菜单选择文件。

    功能:
        - 支持从上游节点输入Latent（优先级最高）
        - 支持从下拉菜单选择Latent文件（优先级低于输入端口）
        - 自动扫描ComfyUI默认输出目录及其子文件夹中的.latent文件
        - 文件存在性检查和错误提示
        - 支持Latent格式版本自动检测
        - 输出标准Latent格式字典

    输入:
        latent_input: 可选的Latent输入 (LATENT)
        latent_file: 从下拉菜单选择的Latent文件路径 (STRING)

    输出:
        latent: Latent字典 (LATENT)

    使用示例:
        - 从上游节点接收Latent: 连接上游Latent节点到输入端口
        - 从文件加载Latent: 从下拉菜单选择.latent文件

    优先级说明:
        1. 如果输入端口有Latent，直接返回输入的Latent
        2. 如果输入端口为None，则从下拉菜单选择的文件加载Latent
        3. 如果输入端口为None且文件不存在，弹出警告


    """

    @classmethod
    def INPUT_TYPES(cls) -> dict:
        """定义节点的输入类型和约束"""
        # 获取输出目录中的所有.latent文件（包括子文件夹）
        if HAS_COMFYUI:
            output_dir = Path(folder_paths.get_output_directory())
            latent_files = cls._get_latent_files(output_dir)
        else:
            # 测试环境：使用当前目录
            output_dir = Path.cwd()
            latent_files = cls._get_latent_files(output_dir)

        return {
            "optional": {
                "latent_input": ("LATENT", {
                    "tooltip": "Input latent from another node (higher priority than file loading)"
                }),
                "latent_file": ([""] + sorted(latent_files), {
                    "tooltip": "Latent file to load from ComfyUI output directory"
                }),
            }
        }

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("latent",)
    OUTPUT_TOOLTIPS = ("Loaded latent tensor (from input port or file)",)
    FUNCTION = "load"
    CATEGORY = "♾️ Xz3r0/Latent"

    def load(self, latent_input: Optional[dict] = None, latent_file: str = "") -> Tuple[dict]:
        """
        加载Latent

        Args:
            latent_input: 从上游节点接收的Latent（可选）
            latent_file: 从下拉菜单选择的Latent文件路径

        Returns:
            (latent,): Latent字典

        Raises:
            RuntimeError: 当输入端口为None且文件不存在时
        """
        # 优先级1: 使用输入端口的Latent
        if latent_input is not None:
            return (latent_input,)

        # 优先级2: 从文件加载Latent
        if latent_file:
            # 构建完整文件路径
            if HAS_COMFYUI:
                output_dir = Path(folder_paths.get_output_directory())
            else:
                # 测试环境：使用当前目录
                output_dir = Path.cwd()
            file_path = output_dir / latent_file

            # 检查文件是否存在
            if not file_path.exists():
                raise RuntimeError("No latent provided via input port or file selection")

            # 加载Latent文件
            try:
                latent_data = safetensors.torch.load_file(str(file_path), device="cpu")
                
                # 检查Latent格式版本并应用乘数
                multiplier = 1.0
                if "latent_format_version_0" not in latent_data:
                    multiplier = 1.0 / 0.18215

                samples = {"samples": latent_data["latent_tensor"].float() * multiplier}
                return (samples,)

            except Exception as e:
                raise RuntimeError("Failed to load latent file")

        # 优先级3: 两者都无效，弹出警告
        raise RuntimeError("No latent provided via input port or file selection")

    @classmethod
    def _get_latent_files(cls, directory: Path) -> List[str]:
        """
        递归扫描目录，获取所有.latent文件

        Args:
            directory: 要扫描的根目录

        Returns:
            相对路径列表（相对于输出目录）
        """
        latent_files = []

        if not directory.exists():
            return latent_files

        # 递归查找.latent文件
        for latent_file in directory.rglob("*.latent"):
            # 获取相对于输出目录的路径
            relative_path = latent_file.relative_to(directory)
            
            # 使用正斜杠作为路径分隔符（跨平台兼容）
            latent_files.append(str(relative_path).replace(os.sep, "/"))

        return latent_files

