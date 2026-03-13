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
from comfy_api.latest import ComfyExtension, io
from PIL import Image, PngImagePlugin
from typing_extensions import override

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
    OUTPUT_DIRECTORY_ERROR = "Unable to create output directory"
    WRITE_IMAGE_ERROR = "Unable to write image file"
    RELATIVE_PATH_ERROR = "Unable to build relative save path"

    @classmethod
    def define_schema(cls):
        """定义节点的输入输出模式"""
        return io.Schema(
            node_id="XImageSave",
            display_name="XImageSave",
            description="Save images with custom filename, subfolder, "
            "datetime placeholders, and metadata",
            category="♾️ Xz3r0/File-Processing",
            is_output_node=True,
            inputs=[
                io.Image.Input(
                    "images",
                    tooltip="Input image",
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
            ],
            outputs=[
                io.Image.Output(
                    "images",
                    tooltip="Original input images (passed through)",
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
        images: torch.Tensor,
        filename_prefix: str,
        subfolder: str = "",
        compression_level: int = 5,
    ) -> io.NodeOutput:
        """
        保存图像到ComfyUI输出目录

        Args:
            images: 图像张量 (B, H, W, C)
            filename_prefix: 文件名前缀
            subfolder: 子文件夹路径
            compression_level: PNG压缩级别(0-9)

        Returns:
            NodeOutput: 包含原始图像和保存的相对路径
        """
        if images is None or len(images) == 0:
            raise ValueError("Input images cannot be empty")

        if images.dim() != 4:
            raise ValueError(
                "Expected image tensor shape (B,H,W,C), "
                f"got {images.dim()}D tensor"
            )

        # 从隐藏参数获取元数据
        prompt = cls.hidden.prompt if hasattr(cls.hidden, "prompt") else None
        extra_pnginfo = (
            cls.hidden.extra_pnginfo
            if hasattr(cls.hidden, "extra_pnginfo")
            else None
        )

        # 获取ComfyUI默认输出目录
        output_dir = cls._get_output_directory()

        # 处理日期时间标识符和安全过滤
        safe_filename_prefix = sanitize_path_component(filename_prefix)
        safe_filename_prefix = replace_datetime_tokens(
            safe_filename_prefix
        )

        safe_subfolder = sanitize_path_component(subfolder)
        safe_subfolder = replace_datetime_tokens(safe_subfolder)

        # 创建完整保存路径
        save_dir = resolve_output_subpath(output_dir, safe_subfolder)

        # 创建目录(仅支持单级目录)
        try:
            save_dir.mkdir(exist_ok=True)
        except OSError as exc:
            raise RuntimeError(cls.OUTPUT_DIRECTORY_ERROR) from exc

        # 保存图像序列
        saved_paths = []
        progress_bar = comfy.utils.ProgressBar(len(images))
        for i, img_tensor in enumerate(images):
            # 转换张量到PIL图像
            img_pil = cls._tensor_to_pil(img_tensor)

            # 生成文件名(添加序列号)
            filename = safe_filename_prefix
            if len(images) > 1:
                filename = f"{filename}_{i:04d}"

            # 检测同名文件并添加序列号
            final_filename = ensure_unique_filename(
                save_dir,
                filename,
                ".png",
            )

            # 生成PNG元数据
            pnginfo = cls._generate_pnginfo(prompt, extra_pnginfo)

            # 保存图像
            save_path = resolve_output_subpath(
                output_dir,
                Path(safe_subfolder) / final_filename,
            )
            try:
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

        # 输出保存路径(多个图像用分号分隔)
        save_path_str = ";".join(saved_paths) if saved_paths else ""

        return io.NodeOutput(images, save_path_str)

    @classmethod
    def _generate_pnginfo(cls, prompt, extra_pnginfo):
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

    @classmethod
    def _get_output_directory(cls) -> Path:
        """
        获取ComfyUI默认输出目录

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

    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [XImageSave]


async def comfy_entrypoint() -> Xz3r0Extension:
    return Xz3r0Extension()
