"""
自动图像缩放节点模块
==================

这个模块包含自动图像缩放节点，提供批次统一缩放功能。
"""

import math
from typing import Any

import comfy.utils
import torch
from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger
except ImportError:
    from xz3r0_utils import get_logger

# 常量定义
PIXELS_PER_MEGAPIXEL = 1_000_000  # 每百万像素的像素数
MAX_MEGAPIXELS = 100.0  # 最大百万像素限制（防止显存溢出）
LOGGER = get_logger(__name__)
ResizeSettingsIO = io.Custom("XZ3R0_RESIZE_SETTINGS")
SETTINGS_FIELDS = (
    "scale_mode",
    "edge_mode",
    "resize_condition",
    "target_edge",
    "scale_multiplier",
    "megapixels",
    "divisible_mode",
    "divisible",
    "width_offset",
    "height_offset",
)
VALID_SCALE_MODES = {
    "Nearest-exact",
    "Bilinear",
    "Area",
    "Bicubic",
    "Lanczos",
}
VALID_EDGE_MODES = {
    "Long",
    "Short",
    "Megapixels",
    "Scale Multiplier",
}
VALID_RESIZE_CONDITIONS = {
    "Always",
    "Only if Larger",
    "Only if Smaller",
}
VALID_DIVISIBLE_MODES = {
    "Disabled",
    "Nearest",
    "Up",
    "Down",
}


class XImageResize(io.ComfyNode):
    """
    XImageResize 自动图像缩放节点

    这个节点支持图像或遮罩缩放，但每次只处理一个输入端口。
    批处理时遵循官方风格：整批统一计算目标尺寸并统一缩放。

    功能：
        - 自动识别横屏/竖屏/正方形
        - 按长边或短边缩放（可切换）
        - 按百万像素缩放（精确控制输出像素数）
        - 按缩放倍率缩放
        - 支持按条件缩放（总是/仅图像大于目标/仅图像小于目标）
        - 保持原始宽高比，永不变形
        - 支持分辨率整除调整（适配模型要求）
        - 支持分辨率偏移调整（适配特殊模型要求）
        - 支持批量图像处理（图片序列）
        - 支持多种插值算法（双线性/双三次/最近邻/区域/Lanczos）

    输入：
        image_or_mask: 输入图像或遮罩张量 (IMAGE/MASK)
        resize_settings_in: 上游设置输入 (专用设置类型，可选)
        use_passed_settings: 是否用于本节点缩放计算 (BOOLEAN)
        output_resize_settings: 是否输出缩放设置 (BOOLEAN)
        scale_mode: 缩放模式 (STRING)
        edge_mode: 缩放基准 (STRING)
        resize_condition: 缩放条件 (STRING)
        target_edge: 目标边长 (INT, 范围 64-8192)
        megapixels: 百万像素 (FLOAT, 范围 0.1-100)
        scale_multiplier: 缩放倍率 (FLOAT, 范围 0.1-10)
        divisible: 整除数 (INT, 范围 1-128)
        divisible_mode: 整除模式 (STRING)
        width_offset: 宽度偏移 (INT, 范围 -128 到 128)
        height_offset: 高度偏移 (INT, 范围 -128 到 128)

    输出：
        Processed_Data: 缩放后的图像或遮罩张量
        width: 输出分辨率宽度
        height: 输出分辨率高度
        resize_settings_out: 继续传递给下游的专用设置链或空值
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点的输入类型和约束。"""
        passthrough_template = io.MatchType.Template(
            "image_or_mask_passthrough",
            allowed_types=[io.Image, io.Mask],
        )

        return io.Schema(
            node_id="XImageResize",
            display_name="XImageResize",
            description="Automatic image resize with batch-unified scaling "
            "and divisible adjustment support",
            category="♾️ Xz3r0/File-Processing",
            inputs=[
                io.MatchType.Input(
                    "image_or_mask",
                    template=passthrough_template,
                    tooltip="Input image or mask",
                ),
                ResizeSettingsIO.Input(
                    "resize_settings_in",
                    optional=True,
                    tooltip="Optional resize settings from previous "
                    "XImageResize node",
                ),
                io.Boolean.Input(
                    "use_passed_settings",
                    default=True,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip="When enabled and settings input is connected, "
                    "use passed settings for this node's resize "
                    "calculation. When disabled, this node uses local panel "
                    "values only.",
                ),
                io.Boolean.Input(
                    "output_resize_settings",
                    default=True,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip="When disabled, resize_settings_out outputs "
                    "empty value, equivalent to leaving this port "
                    "unconnected.",
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
                    "Lanczos=slow & highest quality. "
                    "For MASK input, Nearest-exact is recommended "
                    "to avoid edge drift.",
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
                io.Combo.Input(
                    "resize_condition",
                    options=[
                        "Always",
                        "Only if Larger",
                        "Only if Smaller",
                    ],
                    default="Always",
                    tooltip="Resize condition for Long/Short/Megapixels: "
                    "Always=always resize, "
                    "Only if Larger=resize only when image is larger than "
                    "target, "
                    "Only if Smaller=resize only when image is smaller than "
                    "target. Ignored in Scale Multiplier mode. If the "
                    "condition is not met, resizing is skipped, but "
                    "divisible and offset are still applied.",
                ),
                io.Int.Input(
                    "target_edge",
                    default=1280,
                    min=64,
                    max=8192,
                    step=1,
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
                io.MatchType.Output(
                    template=passthrough_template,
                    display_name="Processed_Data",
                    tooltip="Resized image or mask output tensor",
                ),
                io.Int.Output(
                    "width",
                    tooltip="Output resolution width",
                ),
                io.Int.Output(
                    "height",
                    tooltip="Output resolution height",
                ),
                ResizeSettingsIO.Output(
                    "resize_settings_out",
                    tooltip=(
                        "Settings passed to downstream nodes. If valid "
                        "upstream settings exist, this output keeps "
                        "forwarding the chain-origin settings."
                    ),
                ),
            ],
        )

    @classmethod
    def validate_inputs(
        cls,
        image_or_mask: torch.Tensor,
        scale_mode: str,
        edge_mode: str,
        resize_condition: str,
        target_edge: int,
        megapixels: float,
        scale_multiplier: float,
        divisible_mode: str,
        divisible: int,
        width_offset: int,
        height_offset: int,
        resize_settings_in: Any = None,
        use_passed_settings: bool = True,
        output_resize_settings: bool = True,
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

        if resize_condition not in VALID_RESIZE_CONDITIONS:
            return "Invalid resize_condition value"

        return True

    @classmethod
    def execute(
        cls,
        image_or_mask: torch.Tensor,
        scale_mode: str,
        edge_mode: str,
        resize_condition: str,
        target_edge: int,
        megapixels: float,
        scale_multiplier: float,
        divisible_mode: str,
        divisible: int,
        width_offset: int,
        height_offset: int,
        resize_settings_in: Any = None,
        use_passed_settings: bool = True,
        output_resize_settings: bool = True,
    ) -> io.NodeOutput:
        """
        批次统一处理图像或遮罩缩放。
        """
        tensor, input_kind, original_dims = cls._normalize_input_tensor(
            image_or_mask
        )

        panel_settings = cls._build_settings(
            scale_mode=scale_mode,
            edge_mode=edge_mode,
            resize_condition=resize_condition,
            target_edge=target_edge,
            scale_multiplier=scale_multiplier,
            megapixels=megapixels,
            divisible_mode=divisible_mode,
            divisible=divisible,
            width_offset=width_offset,
            height_offset=height_offset,
        )
        passed_settings = cls._parse_settings_input(resize_settings_in)

        # 保持链路来源稳定：只要有有效上游，就继续向下游透传该设置。
        settings_for_output = panel_settings
        if passed_settings is not None:
            settings_for_output = passed_settings

        # 开关只影响本节点本次缩放，不影响设置链向下游传递。
        effective_settings = panel_settings
        if use_passed_settings and passed_settings is not None:
            effective_settings = passed_settings

        scale_mode = effective_settings["scale_mode"]
        edge_mode = effective_settings["edge_mode"]
        resize_condition = effective_settings["resize_condition"]
        target_edge = effective_settings["target_edge"]
        scale_multiplier = effective_settings["scale_multiplier"]
        megapixels = effective_settings["megapixels"]
        divisible_mode = effective_settings["divisible_mode"]
        divisible = effective_settings["divisible"]
        width_offset = effective_settings["width_offset"]
        height_offset = effective_settings["height_offset"]

        _, height, width, _ = tensor.shape

        long_edge = max(width, height)
        short_edge = min(width, height)

        if edge_mode == "Megapixels":
            target_mp = min(megapixels, MAX_MEGAPIXELS)
            if target_mp < megapixels:
                LOGGER.warning(
                    "Megapixels value %s exceeds maximum limit of %s, "
                    "clamped to %s",
                    megapixels,
                    MAX_MEGAPIXELS,
                    target_mp,
                )
            target_pixels = int(target_mp * PIXELS_PER_MEGAPIXEL)
            current_pixels = width * height
            should_resize = cls._should_resize(
                resize_condition,
                current_pixels,
                target_pixels,
            )
            if should_resize:
                scale = math.sqrt(target_pixels / current_pixels)
                new_width = round(width * scale)
                new_height = round(height * scale)
            else:
                new_width = width
                new_height = height
        elif edge_mode == "Scale Multiplier":
            new_width = round(width * scale_multiplier)
            new_height = round(height * scale_multiplier)
        else:
            if edge_mode == "Long":
                base_edge = long_edge
            else:
                base_edge = short_edge
            should_resize = cls._should_resize(
                resize_condition,
                base_edge,
                target_edge,
            )
            if should_resize:
                scale = target_edge / base_edge
                new_width = round(width * scale)
                new_height = round(height * scale)
            else:
                new_width = width
                new_height = height

        if divisible_mode != "Disabled" and divisible > 1:
            new_width = cls._make_divisible(
                new_width, divisible, divisible_mode
            )
            new_height = cls._make_divisible(
                new_height, divisible, divisible_mode
            )

        new_width = max(new_width + width_offset, 1)
        new_height = max(new_height + height_offset, 1)

        data_batch = tensor.movedim(-1, 1)
        if not data_batch.is_contiguous():
            data_batch = data_batch.contiguous()

        scaled_batch = comfy.utils.common_upscale(
            data_batch,
            new_width,
            new_height,
            upscale_method=scale_mode.lower(),
            crop="disabled",
        )
        if scaled_batch.dim() != data_batch.dim():
            scaled_batch = scaled_batch.movedim(-1, -2).unsqueeze(1)
        output_tensor = scaled_batch.movedim(1, -1)
        restored_output = cls._restore_output_tensor(
            output_tensor,
            input_kind,
            original_dims,
        )

        progress_bar = comfy.utils.ProgressBar(1)
        progress_bar.update_absolute(1)

        settings_out: dict[str, Any] | None = settings_for_output
        if not output_resize_settings:
            settings_out = None

        return io.NodeOutput(
            restored_output,
            new_width,
            new_height,
            settings_out,
        )

    @staticmethod
    def _normalize_input_tensor(
        image_or_mask: torch.Tensor,
    ) -> tuple[torch.Tensor, str, int]:
        """
        将输入统一成 (B,H,W,C) 便于复用同一套缩放逻辑。
        """
        if image_or_mask is None:
            raise ValueError("Input image_or_mask cannot be empty")
        if not torch.is_tensor(image_or_mask):
            raise ValueError(
                "image_or_mask input must be IMAGE or MASK tensor"
            )

        dims = image_or_mask.dim()
        if dims == 4:
            if image_or_mask.shape[0] == 0:
                raise ValueError("Input image_or_mask cannot be empty")
            return image_or_mask, "image", 4
        if dims == 3:
            if image_or_mask.shape[0] == 0:
                raise ValueError("Input image_or_mask cannot be empty")
            return image_or_mask.unsqueeze(-1), "mask", 3
        if dims == 2:
            return image_or_mask.unsqueeze(0).unsqueeze(-1), "mask", 2

        raise ValueError(
            f"Expected IMAGE(B,H,W,C) or MASK(H,W)/(B,H,W), got {dims}D tensor"
        )

    @staticmethod
    def _restore_output_tensor(
        output_tensor: torch.Tensor,
        input_kind: str,
        original_dims: int,
    ) -> torch.Tensor:
        """
        将缩放结果恢复到输入对应的数据形状。
        """
        if input_kind == "image":
            return output_tensor

        mask_tensor = output_tensor[..., 0]
        if original_dims == 2:
            return mask_tensor[0]
        return mask_tensor

    @classmethod
    def _build_settings(
        cls,
        scale_mode: str,
        edge_mode: str,
        resize_condition: str,
        target_edge: int,
        scale_multiplier: float,
        megapixels: float,
        divisible_mode: str,
        divisible: int,
        width_offset: int,
        height_offset: int,
    ) -> dict[str, Any]:
        """
        统一构建设置字典，保证输出结构稳定。
        """
        return {
            "scale_mode": scale_mode,
            "edge_mode": edge_mode,
            "resize_condition": resize_condition,
            "target_edge": target_edge,
            "scale_multiplier": scale_multiplier,
            "megapixels": megapixels,
            "divisible_mode": divisible_mode,
            "divisible": divisible,
            "width_offset": width_offset,
            "height_offset": height_offset,
        }

    @classmethod
    def _parse_settings_input(
        cls,
        resize_settings_in: Any,
    ) -> dict[str, Any] | None:
        """
        解析上游设置输入；无效输入直接回退到面板设置。
        """
        if not isinstance(resize_settings_in, dict):
            return None

        if not all(field in resize_settings_in for field in SETTINGS_FIELDS):
            return None

        scale_mode = resize_settings_in["scale_mode"]
        edge_mode = resize_settings_in["edge_mode"]
        resize_condition = resize_settings_in["resize_condition"]
        target_edge = resize_settings_in["target_edge"]
        scale_multiplier = resize_settings_in["scale_multiplier"]
        megapixels = resize_settings_in["megapixels"]
        divisible_mode = resize_settings_in["divisible_mode"]
        divisible = resize_settings_in["divisible"]
        width_offset = resize_settings_in["width_offset"]
        height_offset = resize_settings_in["height_offset"]

        if scale_mode not in VALID_SCALE_MODES:
            return None
        if edge_mode not in VALID_EDGE_MODES:
            return None
        if resize_condition not in VALID_RESIZE_CONDITIONS:
            return None
        if divisible_mode not in VALID_DIVISIBLE_MODES:
            return None
        if not cls._is_int_value(target_edge):
            return None
        if not cls._is_int_value(divisible):
            return None
        if not cls._is_int_value(width_offset):
            return None
        if not cls._is_int_value(height_offset):
            return None
        if not cls._is_real_number(scale_multiplier):
            return None
        if not cls._is_real_number(megapixels):
            return None

        if target_edge < 64 or target_edge > 8192:
            return None
        if divisible < 1 or divisible > 128:
            return None
        if width_offset < -128 or width_offset > 128:
            return None
        if height_offset < -128 or height_offset > 128:
            return None
        if scale_multiplier <= 0:
            return None
        if megapixels <= 0:
            return None

        return cls._build_settings(
            scale_mode=scale_mode,
            edge_mode=edge_mode,
            resize_condition=resize_condition,
            target_edge=target_edge,
            scale_multiplier=scale_multiplier,
            megapixels=megapixels,
            divisible_mode=divisible_mode,
            divisible=divisible,
            width_offset=width_offset,
            height_offset=height_offset,
        )

    @staticmethod
    def _is_real_number(value: Any) -> bool:
        """
        只接受 int/float，且排除 bool。
        """
        return isinstance(value, (int, float)) and not isinstance(value, bool)

    @staticmethod
    def _is_int_value(value: Any) -> bool:
        """
        只接受 int，且排除 bool。
        """
        return isinstance(value, int) and not isinstance(value, bool)

    @staticmethod
    def _should_resize(
        resize_condition: str,
        current_value: int,
        target_value: int,
    ) -> bool:
        """
        根据缩放条件判断是否执行缩放。
        """
        if resize_condition == "Only if Larger":
            return current_value > target_value
        if resize_condition == "Only if Smaller":
            return current_value < target_value
        return True

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
