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
                    "tooltip": "从上游节点接收的Latent（优先级高于文件加载）"
                }),
                "latent_file": ([""] + sorted(latent_files), {
                    "tooltip": "从下拉菜单选择Latent文件（仅当输入端口为None时生效）"
                }),
            }
        }

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("latent",)
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
                raise RuntimeError("接收端口和下拉菜单的Latent不存在")

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
                raise RuntimeError(f"加载Latent文件失败: {str(e)}")

        # 优先级3: 两者都无效，弹出警告
        raise RuntimeError("接收端口和下拉菜单的Latent不存在")

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


# 节点类映射（用于本地测试）
if __name__ == "__main__":
    print("XLatentLoad 节点已加载")
    print(f"节点分类: {XLatentLoad.CATEGORY}")
    print(f"输入类型: {XLatentLoad.INPUT_TYPES()}")
    print(f"输出类型: {XLatentLoad.RETURN_TYPES}")

    # 测试用例
    print("\n=== 测试用例 ===")
    node = XLatentLoad()

    # 测试1: Latent文件扫描
    print("\n测试1 - Latent文件扫描")
    try:
        if HAS_COMFYUI:
            output_dir = Path(folder_paths.get_output_directory())
        else:
            output_dir = Path.cwd()
        print(f"  输出目录: {output_dir}")
        
        latent_files = XLatentLoad._get_latent_files(output_dir)
        print(f"  找到 {len(latent_files)} 个.latent文件")
        
        if latent_files:
            print("  前5个文件:")
            for i, file in enumerate(latent_files[:5], 1):
                print(f"    {i}. {file}")
        else:
            print("  未找到.latent文件")
            print("  提示: 请先在ComfyUI中生成并保存一些Latent文件")
    except Exception as e:
        print(f"  错误: {e}")

    # 测试2: 输入优先级测试
    print("\n测试2 - 输入优先级测试")
    
    # 创建模拟的Latent输入
    mock_latent_input = {
        "samples": torch.randn(1, 4, 32, 32)
    }
    
    # 测试2a: 有输入端口的情况
    print("\n  测试2a - 有输入端口")
    try:
        result = node.load(latent_input=mock_latent_input, latent_file="")
        print(f"    结果: 成功返回输入的Latent")
        print(f"    Latent形状: {result[0]['samples'].shape}")
    except Exception as e:
        print(f"    错误: {e}")

    # 测试2b: 无输入端口，无文件选择
    print("\n  测试2b - 无输入端口，无文件选择")
    try:
        result = node.load(latent_input=None, latent_file="")
        print(f"    结果: {result}")
    except RuntimeError as e:
        print(f"    预期错误: {e}")

    # 测试2c: 无输入端口，文件不存在
    print("\n  测试2c - 无输入端口，文件不存在")
    try:
        result = node.load(latent_input=None, latent_file="nonexistent.latent")
        print(f"    结果: {result}")
    except RuntimeError as e:
        print(f"    预期错误: {e}")

    # 测试3: 实际文件加载测试（如果存在文件）
    print("\n测试3 - 实际文件加载测试")
    try:
        if HAS_COMFYUI:
            output_dir = Path(folder_paths.get_output_directory())
        else:
            output_dir = Path.cwd()
        latent_files = XLatentLoad._get_latent_files(output_dir)
        
        if latent_files:
            test_file = latent_files[0]
            print(f"  测试文件: {test_file}")
            
            try:
                result = node.load(latent_input=None, latent_file=test_file)
                print(f"  加载成功!")
                print(f"  Latent形状: {result[0]['samples'].shape}")
                print(f"  Latent设备: {result[0]['samples'].device}")
                print(f"  Latent类型: {result[0]['samples'].dtype}")
            except Exception as e:
                print(f"  加载失败: {e}")
        else:
            print("  跳过: 未找到可用的.latent文件")
    except Exception as e:
        print(f"  错误: {e}")

    # 测试4: INPUT_TYPES动态更新测试
    print("\n测试4 - INPUT_TYPES动态更新测试")
    print("  说明: INPUT_TYPES会在每次打开节点菜单时自动更新")
    print("  当前可用文件数量:")
    input_types = XLatentLoad.INPUT_TYPES()
    file_options = input_types["optional"]["latent_file"][0]
    print(f"  总计: {len(file_options)} 个选项")
    print(f"  其中空选项: 1 个")
    print(f"  文件选项: {len(file_options) - 1} 个")

    print("\n✅ 所有测试完成！")
    print("\n使用说明:")
    print("1. 连接上游Latent节点到输入端口时，将直接使用该Latent")
    print("2. 未连接输入端口时，从下拉菜单选择.latent文件加载")
    print("3. 如果输入为空且文件不存在，将弹出错误提示")
    print("4. 下拉菜单会自动扫描输出目录及其所有子文件夹中的.latent文件")
