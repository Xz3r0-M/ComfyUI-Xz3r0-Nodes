"""
Latent加载节点模块
================

这个模块包含Latent加载相关的节点。
"""

from pathlib import Path

import safetensors.torch
import torch
from comfy_api.latest import io

try:
    from ..xz3r0_utils import (
        resolve_output_subpath,
        sanitize_path_component,
    )
except ImportError:
    # 兼容直接执行测试脚本时从仓库根目录导入 xnode 的场景。
    from xz3r0_utils import (
        resolve_output_subpath,
        sanitize_path_component,
    )

try:
    import folder_paths

    HAS_COMFYUI = True
except ImportError:
    HAS_COMFYUI = False


class XLatentLoad(io.ComfyNode):
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
    NO_LATENT_SELECTED_ERROR = (
        "No latent provided via input port or file selection"
    )
    INVALID_LATENT_FILE_PATH_ERROR = "Invalid latent file path"
    LATENT_FILE_NOT_FOUND_ERROR = "Selected latent file does not exist"
    LATENT_LOAD_FAILED_ERROR = "Unable to load latent file"
    INVALID_LATENT_FILE_CONTENT_ERROR = "Invalid latent file content"

    @classmethod
    def _get_latent_files(cls, directory: Path) -> list[str]:
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
            latent_files.append(relative_path.as_posix())

        return latent_files

    @classmethod
    def _get_latent_file_options(cls) -> list[str]:
        """
        获取Latent文件选项列表

        Returns:
            文件路径列表，包含空字符串作为默认选项
        """
        if HAS_COMFYUI:
            output_dir = Path(folder_paths.get_output_directory())
        else:
            output_dir = Path.cwd()

        latent_files = cls._get_latent_files(output_dir)
        return [""] + sorted(latent_files)

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点的输入类型和约束"""
        # 获取输出目录中的所有.latent文件
        latent_files = cls._get_latent_file_options()

        return io.Schema(
            node_id="XLatentLoad",
            display_name="XLatentLoad",
            description=(
                "Load latent from input port or file "
                "with auto-scanning of output directory"
            ),
            category="♾️ Xz3r0/File-Processing",
            inputs=[
                io.Latent.Input(
                    "latent_input",
                    optional=True,
                    tooltip=(
                        "Input latent from another node "
                        "(higher priority than file loading)"
                    ),
                ),
                io.Combo.Input(
                    "latent_file",
                    options=latent_files,
                    default="",
                    tooltip=(
                        "Latent file to load from ComfyUI output directory"
                    ),
                ),
            ],
            outputs=[
                io.Latent.Output(
                    "latent",
                    tooltip="Loaded latent tensor",
                ),
            ],
        )

    @classmethod
    def execute(
        cls, latent_input: dict | None = None, latent_file: str = ""
    ) -> io.NodeOutput:
        """
        加载Latent

        Args:
            latent_input: 从上游节点接收的Latent（可选）
            latent_file: 从下拉菜单选择的Latent文件路径

        Returns:
            NodeOutput: 包含Latent字典

        Raises:
            RuntimeError: 当输入端口为None且文件不存在时
        """
        # 优先级1: 使用输入端口的Latent
        if latent_input is not None:
            # 验证latent结构
            if not isinstance(latent_input, dict):
                raise ValueError(
                    f"Expected latent to be dict, "
                    f"got {type(latent_input).__name__}"
                )
            if "samples" not in latent_input:
                raise ValueError("Latent missing required 'samples' key")
            samples = latent_input["samples"]
            if not isinstance(samples, torch.Tensor):
                raise ValueError(
                    f"Latent samples must be torch.Tensor, "
                    f"got {type(samples).__name__}"
                )
            # 支持4D图像latent [B,C,H,W] 和 5D视频latent [B,C,T,H,W]
            if samples.dim() == 4:
                # 图像 latent: [B, C, H, W]
                pass
            elif samples.dim() == 5:
                # 视频 latent: [B, C, T, H, W]
                pass
            else:
                raise ValueError(
                    f"Latent samples must be 4D [B,C,H,W] (image) "
                    f"or 5D [B,C,T,H,W] (video), got {samples.dim()}D"
                )
            return io.NodeOutput(latent_input)

        # 优先级2: 从文件加载Latent
        if latent_file:
            # 构建完整文件路径
            if HAS_COMFYUI:
                output_dir = Path(folder_paths.get_output_directory())
            else:
                output_dir = Path.cwd()
            file_path = cls._resolve_safe_latent_file_path(
                output_dir,
                latent_file,
            )

            # 检查文件是否存在
            if not file_path.exists():
                raise RuntimeError(cls.LATENT_FILE_NOT_FOUND_ERROR)

            # 加载Latent文件
            try:
                latent_data = safetensors.torch.load_file(
                    str(file_path), device="cpu"
                )

                # 验证文件包含必需的latent_tensor键
                if "latent_tensor" not in latent_data:
                    raise RuntimeError(
                        cls.INVALID_LATENT_FILE_CONTENT_ERROR
                    )

                # 检查Latent格式版本并应用乘数
                multiplier = 1.0
                if "latent_format_version_0" not in latent_data:
                    multiplier = 1.0 / 0.18215

                # 构建Latent字典，保留所有原始键
                result = {
                    "samples": latent_data["latent_tensor"].float()
                    * multiplier
                }

                # 保留其他可能的键（如noise_mask, batch_index等）
                for key in ["noise_mask", "batch_index", "type"]:
                    if key in latent_data:
                        result[key] = latent_data[key]

                # 验证加载的latent结构
                samples = result["samples"]
                if not isinstance(samples, torch.Tensor):
                    raise ValueError(
                        f"Loaded latent samples must be torch.Tensor, "
                        f"got {type(samples).__name__}"
                    )
                # 支持4D图像latent [B,C,H,W] 和 5D视频latent [B,C,T,H,W]
                if samples.dim() == 4:
                    # 图像 latent: [B, C, H, W]
                    pass
                elif samples.dim() == 5:
                    # 视频 latent: [B, C, T, H, W]
                    pass
                else:
                    raise ValueError(
                        f"Loaded latent samples must be 4D [B,C,H,W] (image) "
                        f"or 5D [B,C,T,H,W] (video), got {samples.dim()}D"
                    )

                return io.NodeOutput(result)

            except RuntimeError:
                raise
            except (OSError, ValueError) as exc:
                raise RuntimeError(cls.LATENT_LOAD_FAILED_ERROR) from exc

        # 优先级3: 两者都无效，弹出警告
        raise RuntimeError(cls.NO_LATENT_SELECTED_ERROR)

    @classmethod
    def _resolve_safe_latent_file_path(
        cls,
        output_dir: Path,
        latent_file: str,
    ) -> Path:
        """
        将输入文件路径清理并限制在输出目录内。
        """
        raw_path = Path(latent_file)
        if raw_path.is_absolute():
            raise RuntimeError(cls.INVALID_LATENT_FILE_PATH_ERROR)

        # 先拒绝显式父级跳转，再做路径片段清理。
        if ".." in raw_path.parts:
            raise RuntimeError(cls.INVALID_LATENT_FILE_PATH_ERROR)

        safe_parts: list[str] = []
        parts = [part for part in raw_path.parts if part not in ("", ".")]
        if not parts:
            raise RuntimeError(cls.INVALID_LATENT_FILE_PATH_ERROR)

        for index, part in enumerate(parts):
            is_last = index == len(parts) - 1

            if is_last:
                file_part = Path(part)
                suffix = file_part.suffix
                stem = file_part.stem if suffix else part
                safe_stem = sanitize_path_component(stem)
                if suffix == ".latent":
                    safe_part = f"{safe_stem}{suffix}"
                else:
                    safe_suffix = sanitize_path_component(suffix)
                    safe_part = f"{safe_stem}{safe_suffix}"
            else:
                safe_part = sanitize_path_component(part)

            if safe_part:
                safe_parts.append(safe_part)

        if not safe_parts:
            raise RuntimeError(cls.INVALID_LATENT_FILE_PATH_ERROR)

        safe_relative_path = Path(*safe_parts)
        try:
            return resolve_output_subpath(output_dir, safe_relative_path)
        except ValueError as exc:
            raise RuntimeError(cls.INVALID_LATENT_FILE_PATH_ERROR) from exc
