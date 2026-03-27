"""
图像保存节点模块 (V3 API)
=======================

这个模块包含图像保存相关的节点。
"""

import json
from pathlib import Path

import comfy.utils
import numpy as np
import torch
from comfy_api.latest import ComfyExtension, io, ui
from PIL import Image, PngImagePlugin

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
    import folder_paths

    COMFYUI_AVAILABLE = True
except ImportError:
    COMFYUI_AVAILABLE = False


class XImageSave(io.ComfyNode):
    """
    XImageSave 图像保存节点 (V3)

    提供图像保存功能，支持自定义文件名、子文件夹、
    日期时间标识符、元数据保存和安全防护。

    功能：
        - 保存图像到 ComfyUI 默认输出目录
        - 支持自定义文件名和子文件夹
        - 支持日期时间标识符 (%Y%, %m%, %d%, %H%, %M%, %S%)
        - 自动检测同名文件并添加序列号
        - 仅支持单级子文件夹创建
        - 安全防护 (防止路径遍历攻击，禁用路径分隔符)
        - 图像序列支持 (批量保存)
        - 可调节 PNG 压缩级别 (0-9)
        - 元数据保存 (工作流提示词、种子值、生成参数等)
        - 输出相对路径 (不泄露绝对路径)

    输入：
        image_or_mask: 图像或遮罩张量 (IMAGE/MASK)
        filename_prefix: 文件名前缀 (STRING)
        subfolder: 子文件夹名称 (STRING)
        compression_level: PNG 压缩级别 0-9 (INT)
        enable_preview: 是否显示图片预览 (BOOLEAN)
        prompt: 工作流提示词 (隐藏参数，自动注入)
        extra_pnginfo: 额外元数据 (隐藏参数，自动注入)

    输出：
        image_or_mask: 原始输入 (透传)
        save_path: 保存的相对路径 (STRING)

    Usage example:
        filename_prefix="MyImage_%Y%m%d",
        subfolder="Characters",
        compression_level=6
        Output: image_or_mask(original),
        save_path="output/Characters/MyImage_20260114.png"

    元数据说明：
        - 节点自动接收 ComfyUI 注入的隐藏参数 (prompt 和 extra_pnginfo)
        - prompt: 包含完整的工作流提示词 JSON 数据
        - extra_pnginfo: 包含工作流结构、种子值、模型信息等
        - 元数据以 PNG 文本块形式嵌入图像，可通过图像查看器查看
    """

    OUTPUT_DIRECTORY_ERROR = "Unable to create output directory"
    WRITE_IMAGE_ERROR = "Unable to write image file"
    RELATIVE_PATH_ERROR = "Unable to build relative save path"

    @classmethod
    def define_schema(cls):
        """定义节点的输入输出模式"""
        passthrough_template = io.MatchType.Template(
            "image_or_mask_passthrough",
            allowed_types=[io.Image, io.Mask],
        )

        return io.Schema(
            node_id="XImageSave",
            display_name="XImageSave",
            description="Save image or mask with custom filename, "
            "subfolder, datetime placeholders, and metadata",
            category="♾️ Xz3r0/File-Processing",
            is_output_node=True,
            inputs=[
                io.MatchType.Input(
                    "image_or_mask",
                    template=passthrough_template,
                    tooltip="Input image or mask",
                ),
                io.String.Input(
                    "filename_prefix",
                    default="ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%",
                    tooltip="Filename prefix, supports datetime "
                    "placeholders: %Y%, %m%, %d%, %H%, %M%, %S%",
                ),
                io.String.Input(
                    "subfolder",
                    default="Images",
                    tooltip="Subfolder name (no path separators "
                    "allowed), supports datetime "
                    "placeholders: %Y%, %m%, %d%, %H%, %M%, %S%",
                ),
                io.Int.Input(
                    "compression_level",
                    default=5,
                    min=0,
                    max=9,
                    step=1,
                    tooltip="PNG compression level (0=no compression, "
                    "9=maximum compression)",
                ),
                io.Boolean.Input(
                    "enable_preview",
                    default=True,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip=(
                        "Show image preview on this node after saving "
                        "when enabled"
                    ),
                ),
            ],
            outputs=[
                io.MatchType.Output(
                    template=passthrough_template,
                    display_name="image_or_mask",
                    tooltip="Original input image or mask (passed through)",
                ),
                io.String.Output(
                    "save_path",
                    tooltip="Saved file path relative to ComfyUI "
                    "output directory",
                ),
            ],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(
        cls,
        image_or_mask: torch.Tensor,
        filename_prefix: str,
        subfolder: str = "",
        compression_level: int = 5,
        enable_preview: bool = True,
    ) -> io.NodeOutput:
        """
        保存图像到 ComfyUI 输出目录

        Args:
            image_or_mask: 图像或遮罩张量
            filename_prefix: 文件名前缀
            subfolder: 子文件夹路径
            compression_level: PNG 压缩级别 (0-9)
            enable_preview: 是否显示节点图片预览

        Returns:
            NodeOutput: 包含原始输入和保存的相对路径
        """
        normalized_batch = cls._normalize_input_batch(image_or_mask)
        preview_batch = cls._build_preview_batch(normalized_batch)

        # 从隐藏参数获取元数据
        prompt = cls.hidden.prompt if hasattr(cls.hidden, "prompt") else None
        extra_pnginfo = (
            cls.hidden.extra_pnginfo
            if hasattr(cls.hidden, "extra_pnginfo")
            else None
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

        # 保存图像序列
        saved_paths = []
        progress_bar = comfy.utils.ProgressBar(len(normalized_batch))
        for i, img_tensor in enumerate(normalized_batch):
            # 转换张量到 PIL 图像
            img_pil = cls._tensor_to_pil(img_tensor)

            # 生成文件名 (添加序列号)
            filename = safe_filename_prefix
            if len(normalized_batch) > 1:
                filename = f"{filename}_{i:04d}"

            # 检测同名文件并添加序列号
            final_filename = ensure_unique_filename(
                save_dir,
                filename,
                ".png",
            )

            # 生成 PNG 元数据
            pnginfo = cls._generate_pnginfo(prompt, extra_pnginfo)

            # 保存图像
            save_path = resolve_output_subpath(
                output_dir,
                Path(safe_subfolder) / final_filename,
            )
            try:
                if pnginfo:
                    # 使用 Pillow 兼容的方式保存元数据
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
                        save_path,
                        format="PNG",
                        compress_level=compression_level,
                    )
            except OSError as exc:
                raise RuntimeError(cls.WRITE_IMAGE_ERROR) from exc

            # 记录相对路径
            relative_path = cls._build_relative_save_path(
                save_path,
                output_dir,
            )
            saved_paths.append(relative_path)

            # 更新进度条
            progress_bar.update_absolute(i + 1)

        # 输出保存路径 (多个图像用分号分隔)
        save_path_str = ";".join(saved_paths) if saved_paths else ""

        if enable_preview:
            return io.NodeOutput(
                image_or_mask,
                save_path_str,
                ui=ui.PreviewImage(preview_batch, cls=cls),
            )
        return io.NodeOutput(image_or_mask, save_path_str)

    @classmethod
    def _normalize_input_batch(
        cls, image_or_mask: torch.Tensor
    ) -> torch.Tensor:
        """
        将输入统一为可保存的批次张量格式 (B, H, W, C)。
        """
        if image_or_mask is None:
            raise ValueError("Input image_or_mask cannot be empty")
        if not torch.is_tensor(image_or_mask):
            raise ValueError(
                "image_or_mask input must be IMAGE or MASK tensor"
            )

        dims = image_or_mask.dim()
        if dims == 4:
            normalized = image_or_mask
        elif dims == 3:
            # 3D 可能是遮罩批次 (B,H,W) 或单张图像 (H,W,C)。
            if image_or_mask.shape[-1] in (1, 3, 4):
                normalized = image_or_mask.unsqueeze(0)
            else:
                normalized = image_or_mask.unsqueeze(-1)
        elif dims == 2:
            normalized = image_or_mask.unsqueeze(0).unsqueeze(-1)
        else:
            raise ValueError(
                "Expected IMAGE(B,H,W,C) or MASK(B,H,W/H,W), "
                f"got {dims}D tensor"
            )

        if normalized.shape[0] == 0:
            raise ValueError("Input image_or_mask cannot be empty")

        channels = normalized.shape[-1]
        if channels not in (1, 3, 4):
            raise ValueError(
                "Expected channels to be 1, 3, or 4, "
                f"got {channels} channels"
            )
        return normalized

    @classmethod
    def _build_preview_batch(
        cls,
        normalized_batch: torch.Tensor,
    ) -> torch.Tensor:
        """
        为节点预览构建图像批次。
        """
        channels = normalized_batch.shape[-1]
        if channels == 3:
            return normalized_batch
        if channels == 4:
            return normalized_batch[..., :3]
        return normalized_batch.repeat(1, 1, 1, 3)

    @classmethod
    def _generate_pnginfo(cls, prompt, extra_pnginfo):
        """
        生成 PNG 元数据。

        Args:
            prompt: 工作流提示词。
            extra_pnginfo: 额外的 PNG 元数据。

        Returns:
            字典格式的 PNG 元数据或 None。
        """
        # 检查是否有元数据
        if prompt is None and extra_pnginfo is None:
            return None

        # 创建元数据字典
        pnginfo = {}

        # 添加 prompt 元数据
        if prompt is not None:
            pnginfo["prompt"] = json.dumps(prompt)

        # 添加额外的 PNG 元数据
        if extra_pnginfo is not None:
            for key, value in extra_pnginfo.items():
                pnginfo[key] = json.dumps(value)

        return pnginfo

    @classmethod
    def _get_output_directory(cls) -> Path:
        """
        获取 ComfyUI 默认输出目录

        Returns:
            输出目录路径
        """
        if COMFYUI_AVAILABLE:
            return Path(folder_paths.get_output_directory())
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

    @classmethod
    def _tensor_to_pil(cls, tensor: torch.Tensor) -> Image.Image:
        """
        将张量转换为 PIL 图像

        Args:
            tensor: 图像张量 (H, W, C) 或 (B, H, W, C)

        Returns:
            PIL 图像对象

        Raises:
            ValueError: 当张量维度或通道数不支持时
        """
        # 先断开梯度图再转到 CPU，避免 numpy 转换报错。
        tensor = tensor.detach().cpu()

        # 处理批次维度：如果是 4D 张量，提取第一个图像
        if tensor.dim() == 4:
            if tensor.shape[0] != 1:
                raise ValueError(
                    f"Expected batch size 1 for 4D tensor, "
                    f"got {tensor.shape[0]}"
                )
            tensor = tensor[0]
        elif tensor.dim() != 3:
            raise ValueError(
                f"Expected 3D (H,W,C) or 4D (1,H,W,C) tensor, "
                f"got {tensor.dim()}D tensor"
            )

        # 验证通道数
        channels = tensor.shape[2]
        if channels not in (1, 3, 4):
            raise ValueError(
                f"Expected image channels to be 1 (grayscale), "
                f"3 (RGB), or 4 (RGBA), got {channels} channels"
            )

        # 确保张量是连续的
        if not tensor.is_contiguous():
            tensor = tensor.contiguous()

        # 转换为 numpy 数组
        numpy_array = tensor.numpy()

        # 转换值范围从 [0, 1] 到 [0, 255]，并确保值在有效范围内
        numpy_array = np.clip(255.0 * numpy_array, 0, 255).astype(np.uint8)

        # 创建 PIL 图像
        if channels == 4:
            # RGBA
            mode = "RGBA"
        elif channels == 3:
            # RGB
            mode = "RGB"
        else:  # channels == 1
            # 灰度图
            mode = "L"
            numpy_array = numpy_array.squeeze(2)

        pil_image = Image.fromarray(numpy_array, mode=mode)

        return pil_image


class Xz3r0Extension(ComfyExtension):
    """Xz3r0 Nodes Extension"""

    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [XImageSave]


async def comfy_entrypoint() -> Xz3r0Extension:
    return Xz3r0Extension()

