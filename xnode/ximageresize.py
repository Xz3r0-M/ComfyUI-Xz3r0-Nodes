"""
自动图像缩放节点模块
==================

这个模块包含自动图像缩放节点，提供批次统一缩放功能。
"""

import math

import comfy.utils
import torch
from comfy_api.latest import io

# 常量定义
PIXELS_PER_MEGAPIXEL = 1_000_000  # 每百万像素的像素数
MAX_MEGAPIXELS = 100.0  # 最大百万像素限制（防止显存溢出）


class XImageResize(io.ComfyNode):
    """
    XImageResize 自动图像缩放节点

    这个节点只处理图像缩放，不处理遮罩。
    批处理时遵循官方风格：整批统一计算目标尺寸并统一缩放。

    功能:
        - 自动识别横屏/竖屏/正方形
        - 按长边或短边缩放（可切换）
        - 按百万像素缩放（精确控制输出像素数）
        - 按缩放倍率缩放
        - 保持原始宽高比，永不变形
        - 支持分辨率整除调整（适配模型要求）
        - 支持分辨率偏移调整（适配特殊模型要求）
        - 支持批量图像处理（图片序列）
        - 支持多种插值算法（双线性/双三次/最近邻/区域/Lanczos）

    输入:
        images: 输入图像张量 (IMAGE)
        scale_mode: 缩放模式 (STRING)
        edge_mode: 缩放基准 (STRING)
        target_edge: 目标边长 (INT, 范围 64-8192)
        megapixels: 百万像素 (FLOAT, 范围 0.1-100)
        scale_multiplier: 缩放倍率 (FLOAT, 范围 0.1-10)
        divisible: 整除数 (INT, 范围 1-128)
        divisible_mode: 整除模式 (STRING)
        width_offset: 宽度偏移 (INT, 范围 -128 到 128)
        height_offset: 高度偏移 (INT, 范围 -128 到 128)

    输出:
        Processed_Images: 缩放后的图像张量 (B, H, W, C)
        width: 输出分辨率宽度
        height: 输出分辨率高度
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点的输入类型和约束。"""
        return io.Schema(
            node_id="XImageResize",
            display_name="XImageResize",
            description="Automatic image resize with batch-unified scaling "
            "and divisible adjustment support",
            category="♾️ Xz3r0/File-Processing",
            inputs=[
                io.Image.Input(
                    "images",
                    tooltip="Input images",
                ),
                io.Combo.Input(
                    "scale_mode",
                    options=[
                        "Nearest-exact",
                        "Bilinear",
                        "Area",
                        "Bicubic",
                        "Lanczos",
                    ],
                    default="Bilinear",
                    tooltip="Select interpolation algorithm: "
                    "Nearest-exact=fastest, "
                    "Bilinear=fast & medium quality, "
                    "Area=best for downsampling, "
                    "Bicubic=medium speed & high quality, "
                    "Lanczos=slow & highest quality",
                ),
                io.Combo.Input(
                    "edge_mode",
                    options=[
                        "Long",
                        "Short",
                        "Megapixels",
                        "Scale Multiplier",
                    ],
                    default="Long",
                    tooltip="Select scaling mode: Long=long edge, "
                    "Short=short edge, Megapixels=target pixels, "
                    "Scale Multiplier=scale by multiplier",
                ),
                io.Int.Input(
                    "target_edge",
                    default=1280,
                    min=64,
                    max=8192,
                    step=64,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Target edge length in pixels "
                    "(ignored in Megapixels and Scale Multiplier modes)",
                ),
                io.Float.Input(
                    "megapixels",
                    default=1.0,
                    min=0.1,
                    max=100.0,
                    step=0.1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Only used in Megapixels mode "
                    "as target value (must be >0)",
                ),
                io.Float.Input(
                    "scale_multiplier",
                    default=1.0,
                    min=0.1,
                    max=10.0,
                    step=0.1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Scale multiplier "
                    "(only used in Scale Multiplier mode)",
                ),
                io.Combo.Input(
                    "divisible_mode",
                    options=["Disabled", "Nearest", "Up", "Down"],
                    default="Disabled",
                    tooltip="How to adjust resolution to be divisible: "
                    "Disabled=no adjustment, Nearest=round to nearest "
                    "multiple, Up=round up, Down=round down",
                ),
                io.Int.Input(
                    "divisible",
                    default=16,
                    min=1,
                    max=128,
                    step=1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Make resolution divisible by this number "
                    "(set to 1 to disable, common values: 8, 16, 32, 64)",
                ),
                io.Int.Input(
                    "width_offset",
                    default=0,
                    min=-128,
                    max=128,
                    step=1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Add offset to output width "
                    "(positive=increase, negative=decrease, default=0)",
                ),
                io.Int.Input(
                    "height_offset",
                    default=0,
                    min=-128,
                    max=128,
                    step=1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Add offset to output height "
                    "(positive=increase, negative=decrease, default=0)",
                ),
            ],
            outputs=[
                io.Image.Output(
                    "Processed_Images",
                    tooltip="Scaled images",
                ),
                io.Int.Output(
                    "width",
                    tooltip="Output resolution width",
                ),
                io.Int.Output(
                    "height",
                    tooltip="Output resolution height",
                ),
            ],
        )

    @classmethod
    def validate_inputs(
        cls,
        images: torch.Tensor,
        scale_mode: str,
        edge_mode: str,
        target_edge: int,
        megapixels: float,
        scale_multiplier: float,
        divisible_mode: str,
        divisible: int,
        width_offset: int,
        height_offset: int,
    ) -> bool | str:
        """
        验证输入参数的有效性。

        Returns:
            True if valid, or error message string if invalid
        """
        if edge_mode == "Megapixels" and megapixels <= 0:
            return "Megapixels mode requires megapixels > 0"

        if edge_mode == "Scale Multiplier" and scale_multiplier <= 0:
            return "Scale Multiplier mode requires scale_multiplier > 0"

        return True

    @classmethod
    def execute(
        cls,
        images: torch.Tensor,
        scale_mode: str,
        edge_mode: str,
        target_edge: int,
        megapixels: float,
        scale_multiplier: float,
        divisible_mode: str,
        divisible: int,
        width_offset: int,
        height_offset: int,
    ) -> io.NodeOutput:
        """
        批次统一处理图像缩放。
        """
        if images is None or len(images) == 0:
            raise ValueError("Input images cannot be empty")

        if images.dim() != 4:
            raise ValueError(
                "Expected image tensor shape (B,H,W,C), "
                f"got {images.dim()}D tensor"
            )

        _, height, width, _ = images.shape

        long_edge = max(width, height)
        short_edge = min(width, height)

        if edge_mode == "Megapixels":
            target_mp = min(megapixels, MAX_MEGAPIXELS)
            if target_mp < megapixels:
                print(
                    f"Warning: megapixels value {megapixels} exceeds "
                    f"maximum limit of {MAX_MEGAPIXELS}, "
                    f"clamped to {target_mp}"
                )
            target_pixels = int(target_mp * PIXELS_PER_MEGAPIXEL)
            current_pixels = width * height
            scale = math.sqrt(target_pixels / current_pixels)
            new_width = round(width * scale)
            new_height = round(height * scale)
        elif edge_mode == "Scale Multiplier":
            new_width = round(width * scale_multiplier)
            new_height = round(height * scale_multiplier)
        else:
            if edge_mode == "Long":
                base_edge = long_edge
            else:
                base_edge = short_edge
            scale = target_edge / base_edge
            new_width = round(width * scale)
            new_height = round(height * scale)

        if divisible_mode != "Disabled" and divisible > 1:
            new_width = cls._make_divisible(
                new_width, divisible, divisible_mode
            )
            new_height = cls._make_divisible(
                new_height, divisible, divisible_mode
            )

        new_width = max(new_width + width_offset, 1)
        new_height = max(new_height + height_offset, 1)

        image_batch = images.movedim(-1, 1)
        if not image_batch.is_contiguous():
            image_batch = image_batch.contiguous()

        scaled_batch = comfy.utils.common_upscale(
            image_batch,
            new_width,
            new_height,
            upscale_method=scale_mode.lower(),
            crop="disabled",
        )
        output_tensor = scaled_batch.movedim(1, -1)

        progress_bar = comfy.utils.ProgressBar(1)
        progress_bar.update_absolute(1)

        return io.NodeOutput(output_tensor, new_width, new_height)

    @staticmethod
    def _make_divisible(value: int, divisor: int, mode: str = "Up") -> int:
        """
        调整数值使其可被除数整除。
        """
        if divisor <= 1:
            return value

        remainder = value % divisor
        if remainder == 0:
            return value

        if mode == "Down":
            return value - remainder
        if mode == "Up":
            return value + (divisor - remainder)

        if remainder <= divisor // 2:
            return value - remainder
        return value + (divisor - remainder)
