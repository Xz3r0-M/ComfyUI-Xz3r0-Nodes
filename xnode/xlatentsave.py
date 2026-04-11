"""
Latent 保存节点模块
=================

这个模块包含 Latent 保存相关的节点。
"""

import json
from pathlib import Path

import torch
from comfy_api.latest import io

try:
    from ..xz3r0_utils import (
        ensure_unique_filename,
        replace_datetime_tokens,
        resolve_output_subpath,
        sanitize_path_component,
    )
except ImportError:
    # 兼容直接执行测试脚本时从仓库根目录导入 xnode 的场景。
    from xz3r0_utils import (
        ensure_unique_filename,
        replace_datetime_tokens,
        resolve_output_subpath,
        sanitize_path_component,
    )

try:
    import comfy.utils
    import folder_paths

    COMFYUI_AVAILABLE = True
except ImportError:
    COMFYUI_AVAILABLE = False


class XLatentSave(io.ComfyNode):
    """
    XLatentSave Latent 保存节点

    提供 Latent 保存功能
    支持自定义文件名、子文件夹、日期时间标识符和安全防护。

    功能：
        - 保存 Latent 到 ComfyUI 默认输出目录
        - 输出 Latent 端口可以传递到其他节点
        - 支持自定义文件名和子文件夹
        - 支持日期时间标识符 (%Y%, %m%, %d%, %H%, %M%, %S%)
        - 自动检测同名文件并添加序列号 (从 00001 开始)
        - 仅支持单级子文件夹创建
        - 安全防护 (防止路径遍历攻击，禁用路径分隔符)
        - 输出相对路径 (不泄露绝对路径)
        - 支持元数据保存

    输入：
        latent: Latent 张量 (LATENT)
        filename_prefix: 文件名前缀 (STRING)
        subfolder: 子文件夹名称 (STRING)

    输出：
        latent: 原始 Latent(透传)
        save_path: 保存的相对路径 (STRING)

    使用示例：
        filename_prefix="MyLatent_%Y%m%d", subfolder="Latents"
        输出：latent(原图), save_path="output/Latents/MyLatent_20260114.latent"

    元数据说明：
        - 节点自动接收 ComfyUI 注入的隐藏参数 (prompt 和 extra_pnginfo)
        - prompt: 包含完整的工作流提示词 JSON 数据
        - extra_pnginfo: 包含工作流结构、种子值、模型信息等额外元数据
        - 元数据以 SafeTensors 格式嵌入 latent 文件
    """

    OUTPUT_DIRECTORY_ERROR = "Unable to create output directory"
    UNIQUE_FILENAME_ERROR = "Unable to generate unique latent filename"
    WRITE_LATENT_ERROR = "Unable to write latent file"
    RELATIVE_PATH_ERROR = "Unable to build relative save path"

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点的输入类型和约束"""
        return io.Schema(
            node_id="XLatentSave",
            display_name="XLatentSave",
            description=(
                "Save latent to ComfyUI output directory with custom "
                "filename, subfolder, and datetime placeholders"
            ),
            category="♾️ Xz3r0/File-Processing",
            is_output_node=True,
            inputs=[
                io.Latent.Input(
                    "latent",
                    tooltip="Input latent tensor to save",
                ),
                io.String.Input(
                    "filename_prefix",
                    default="ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%",
                    tooltip=(
                        "Filename prefix, supports datetime "
                        "placeholders: %Y%, %m%, %d%, %H%, %M%, %S%"
                    ),
                ),
                io.String.Input(
                    "subfolder",
                    default="Latents",
                    tooltip=(
                        "Subfolder name (no path separators allowed), "
                        "supports datetime placeholders: %Y%, %m%, "
                        "%d%, %H%, %M%, %S%"
                    ),
                ),
            ],
            outputs=[
                io.Latent.Output(
                    "latent",
                    tooltip="Original input latent (passed through)",
                ),
                io.String.Output(
                    "save_path",
                    tooltip=(
                        "Saved file path relative to ComfyUI output directory"
                    ),
                ),
            ],
            hidden=[
                io.Hidden.prompt,
                io.Hidden.extra_pnginfo,
            ],
        )

    @classmethod
    def execute(
        cls,
        latent: dict,
        filename_prefix: str,
        subfolder: str = "Latents",
    ) -> io.NodeOutput:
        """
        保存 Latent 到 ComfyUI 输出目录

        Args:
            latent: Latent 字典，包含"samples"键
            filename_prefix: 文件名前缀
            subfolder: 子文件夹路径

        Returns:
            NodeOutput: 包含原始 Latent 和保存的相对路径

        Raises:
            RuntimeError: 当 ComfyUI 环境不可用时
        """
        # 检查 ComfyUI 环境是否可用
        if not COMFYUI_AVAILABLE:
            raise RuntimeError(
                "ComfyUI environment not available, cannot save latent files"
            )

        # 验证 latent 结构
        if not isinstance(latent, dict):
            raise ValueError(
                f"Expected latent to be dict, got {type(latent).__name__}"
            )
        if "samples" not in latent:
            raise ValueError("Latent missing required 'samples' key")
        samples = latent["samples"]
        if not isinstance(samples, torch.Tensor):
            raise ValueError(
                f"Latent samples must be torch.Tensor, "
                f"got {type(samples).__name__}"
            )
        # 支持 4D 图像 latent [B,C,H,W] 和 5D 视频 latent [B,C,T,H,W]
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

        # 获取 ComfyUI 默认输出目录
        output_dir = cls._get_output_directory()

        # 处理日期时间标识符和安全过滤
        safe_filename_prefix = sanitize_path_component(filename_prefix)
        safe_filename_prefix = replace_datetime_tokens(safe_filename_prefix)

        safe_subfolder = sanitize_path_component(subfolder)
        safe_subfolder = replace_datetime_tokens(safe_subfolder)

        # 创建完整保存路径
        save_dir = resolve_output_subpath(output_dir, safe_subfolder)

        # 创建目录 (仅支持单级目录)
        try:
            save_dir.mkdir(exist_ok=True)
        except OSError as exc:
            raise RuntimeError(cls.OUTPUT_DIRECTORY_ERROR) from exc

        # 生成文件名
        base_filename = safe_filename_prefix

        # 检测同名文件并添加序列号 (从 00001 开始)
        try:
            final_filename = ensure_unique_filename(
                save_dir,
                base_filename,
                ".latent",
            )
        except FileExistsError as exc:
            raise RuntimeError(cls.UNIQUE_FILENAME_ERROR) from exc

        # 生成元数据
        metadata = cls._generate_metadata(
            cls.hidden.prompt, cls.hidden.extra_pnginfo
        )

        # 保存 Latent
        save_path = resolve_output_subpath(
            output_dir,
            Path(safe_subfolder) / final_filename,
        )

        # 准备 latent 数据
        latent_tensor = latent["samples"].contiguous()
        output = {
            "latent_tensor": latent_tensor,
            "latent_format_version_0": torch.tensor([]),
        }

        # 保存可选键（如 noise_mask, batch_index, type 等）
        for key in ["noise_mask", "batch_index", "type"]:
            if key in latent:
                output[key] = latent[key]

        # 使用 comfy.utils 保存 latent(支持元数据)
        try:
            comfy.utils.save_torch_file(
                output,
                str(save_path),
                metadata=metadata,
            )
        except OSError as exc:
            raise RuntimeError(cls.WRITE_LATENT_ERROR) from exc

        # 记录相对路径
        relative_path = cls._build_relative_save_path(save_path, output_dir)

        return io.NodeOutput(latent, relative_path)

    @classmethod
    def _generate_metadata(cls, prompt, extra_pnginfo):
        """
        生成元数据

        Args:
            prompt: 工作流提示词
            extra_pnginfo: 额外的元数据

        Returns:
            字典格式的元数据或 None
        """
        # 检查是否有元数据
        if prompt is None and extra_pnginfo is None:
            return None

        # 创建元数据字典
        metadata = {}

        # 添加 prompt 元数据
        if prompt is not None:
            metadata["prompt"] = json.dumps(prompt)

        # 添加额外的元数据
        if extra_pnginfo is not None:
            for key, value in extra_pnginfo.items():
                metadata[key] = json.dumps(value)

        return metadata

    @classmethod
    def _get_output_directory(cls) -> Path:
        """
        获取 ComfyUI 默认输出目录

        Returns:
            输出目录路径
        """
        if COMFYUI_AVAILABLE:
            return Path(folder_paths.get_output_directory())
        else:
            # 测试环境使用临时目录
            return Path("test_output")

    @classmethod
    def _build_relative_save_path(
        cls,
        save_path: Path,
        output_dir: Path,
    ) -> str:
        """
        基于当前实例输出目录构建相对保存路径。
        """
        try:
            return str(Path(save_path).relative_to(output_dir))
        except ValueError as exc:
            raise RuntimeError(cls.RELATIVE_PATH_ERROR) from exc
