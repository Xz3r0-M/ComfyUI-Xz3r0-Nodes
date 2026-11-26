"""
自动图像缩放节点模块
==================

这个模块包含自动图像缩放节点，提供批次统一缩放功能。
"""

import math
import re
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
MAX_CANVAS_SIZE = 16384  # 补边目标画布的最大边长
DEFAULT_PAD_RATIO = "None"  # 补边比例默认（= 无比例，手填画布宽高）
# 补边可用的画面比例（None 之外都是「长边 : 短边」的意思）
PAD_RATIOS = {
    "1:1": (1, 1),
    "5:4": (5, 4),
    "4:3": (4, 3),
    "3:2": (3, 2),
    "16:10": (16, 10),
    "16:9": (16, 9),
    "21:9": (21, 9),
    "4:5": (5, 4),
    "3:4": (4, 3),
    "2:3": (3, 2),
    "9:16": (16, 9),
    "1:2": (2, 1),
    "9:21": (21, 9),
}
# 这些档位是「竖着的」：宽 < 高，算画布时长边落在高度上
PORTRAIT_PAD_RATIOS = {"4:5", "3:4", "2:3", "9:16", "1:2", "9:21"}
DEFAULT_PAD_SIZE = 1024  # 补边目标宽高的默认值
DEFAULT_PAD_COLOR = "#FFFFFF"  # 补边颜色默认值（白）
# 补边颜色只认十六进制：#RRGGBB 或 #RGB，井号可省略
PAD_COLOR_PATTERN = re.compile(r"^#?(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$")
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
    "pad_enabled",
    "pad_ratio",
    "pad_width",
    "pad_height",
    "pad_color",
)
VALID_SCALE_MODES = {
    "Nearest-exact",
    "Bilinear",
    "Area",
    "Bicubic",
    "Lanczos",
}
VALID_EDGE_MODES = {
    "None",
    "Long",
    "Short",
    "Width",
    "Height",
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
        - 支持补边到目标画布（居中放置，按指定颜色填底，永不裁切）
        - 补边时自动生成「补出来的那一块」的遮罩，可直接交给采样节点重绘
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
        pad_enabled: 是否补边到目标画布 (BOOLEAN，默认关闭)
        pad_width: 补边目标画布宽 (INT, 范围 16-16384)
        pad_height: 补边目标画布高 (INT, 范围 16-16384)
        pad_color: 补边颜色 (STRING, #RRGGBB 十六进制)
        pad_ratio: 补边画布比例 (STRING，None=用画布宽高；选比例则自动算)
        skip_on_empty: 无输入时输出 None (BOOLEAN，默认关闭)

    输出：
        Processed_Data: 缩放后的图像或遮罩张量
        width: 输出分辨率宽度
        height: 输出分辨率高度
        resize_settings_out: 继续传递给下游的专用设置链或空值
        pad_mask: 新补出来的区域遮罩（1=补出来的，0=原画面）
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
            description="Automatic image resize with batch-unified scaling, "
            "divisible adjustment and canvas padding support",
            category="♾️ Xz3r0/Workflow-Processing",
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
                        "None",
                        "Long",
                        "Short",
                        "Width",
                        "Height",
                        "Megapixels",
                        "Scale Multiplier",
                    ],
                    default="Long",
                    tooltip="Select scaling mode: None=keep the original "
                    "size (only divisible, offset and pad apply), "
                    "Long=long edge, Short=short edge, "
                    "Width=width, Height=height, "
                    "Megapixels=target pixels, "
                    "Scale Multiplier=scale by multiplier. Every mode "
                    "keeps the picture's own aspect ratio",
                ),
                io.Combo.Input(
                    "resize_condition",
                    options=[
                        "Always",
                        "Only if Larger",
                        "Only if Smaller",
                    ],
                    default="Always",
                    tooltip="Resize condition for Long/Short/Width/Height/"
                    "Megapixels: "
                    "Always=always resize, "
                    "Only if Larger=resize only when image is larger than "
                    "target, "
                    "Only if Smaller=resize only when image is smaller than "
                    "target. Ignored in None and Scale Multiplier modes. "
                    "If the condition is not met, resizing is skipped, but "
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
                io.Boolean.Input(
                    "pad_enabled",
                    default=False,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip="When enabled, the image is placed in the "
                    "middle of a canvas of the target width and height, "
                    "and the empty area is filled with the pad color. "
                    "Nothing is cropped: a side that is already larger "
                    "than its target keeps its own size, and if both "
                    "sides are already large enough, the image is output "
                    "unchanged. Padding runs after scaling, so if the "
                    "scale mode already made the image bigger than the "
                    "target nothing is padded - pick scale mode None to "
                    "pad the original picture without scaling it.",
                ),
                io.Combo.Input(
                    "pad_ratio",
                    options=[DEFAULT_PAD_RATIO, *PAD_RATIOS],
                    default=DEFAULT_PAD_RATIO,
                    tooltip="Canvas shape when padding: None = no "
                    "ratio, use the pad width and height exactly as "
                    "typed; pick a ratio = the canvas grows to the "
                    "smallest canvas of that shape that still fits "
                    "the whole picture (a 1080x1080 picture with "
                    "16:9 gives a 1920x1080 canvas, so width and "
                    "height are ignored). Nothing is ever cropped.",
                ),
                io.Int.Input(
                    "pad_width",
                    default=DEFAULT_PAD_SIZE,
                    min=16,
                    max=MAX_CANVAS_SIZE,
                    step=1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Target canvas width in pixels. Only pads when "
                    "the image is narrower than this value; ignored when "
                    "pad is disabled.",
                ),
                io.Int.Input(
                    "pad_height",
                    default=DEFAULT_PAD_SIZE,
                    min=16,
                    max=MAX_CANVAS_SIZE,
                    step=1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Target canvas height in pixels. Only pads when "
                    "the image is shorter than this value; ignored when "
                    "pad is disabled.",
                ),
                io.String.Input(
                    "pad_color",
                    default=DEFAULT_PAD_COLOR,
                    tooltip="Color of the padded area as #RRGGBB hex, for "
                    "example #FFFFFF for white. Masks ignore the color: "
                    "padded area always counts as not masked.",
                ),
                io.Boolean.Input(
                    "skip_on_empty",
                    default=False,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip="When enabled, outputs None for all ports "
                    "if no input image is connected, "
                    "instead of raising an error.",
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
                io.Mask.Output(
                    "pad_mask",
                    tooltip="Mask of the newly added area: 1 where the "
                    "canvas was filled, 0 on the original picture. "
                    "Connect it to a sampling node's mask input to "
                    "repaint only the new border. All 0 when nothing "
                    "was padded.",
                ),
            ],
        )

    @classmethod
    def validate_inputs(
        cls,
        image_or_mask: Any,
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
        pad_enabled: bool = False,
        pad_width: int = DEFAULT_PAD_SIZE,
        pad_height: int = DEFAULT_PAD_SIZE,
        pad_color: str = DEFAULT_PAD_COLOR,
        pad_ratio: str = DEFAULT_PAD_RATIO,
        resize_settings_in: Any = None,
        use_passed_settings: bool = True,
        output_resize_settings: bool = True,
        skip_on_empty: bool = False,
    ) -> bool | str:
        """
        验证输入参数的有效性。

        Returns:
            True if valid, or error message string if invalid
        """
        # 接了上游线的输入，在「校验阶段」拿到的是 None —— 上游还没算，
        # 真实值只有执行时才知道（ComfyUI 的 execution.get_input_data 对
        # 链接输入写的就是 None）。所以这些项在有值时才检查，None 直接放行，
        # 否则会抛 `'<=' not supported between 'int' and 'NoneType'`。
        if scale_mode is not None and scale_mode not in VALID_SCALE_MODES:
            return "Invalid scale_mode value"
        if edge_mode is not None and edge_mode not in VALID_EDGE_MODES:
            return "Invalid edge_mode value"
        if (
            divisible_mode is not None
            and divisible_mode not in VALID_DIVISIBLE_MODES
        ):
            return "Invalid divisible_mode value"
        if (
            resize_condition is not None
            and resize_condition not in VALID_RESIZE_CONDITIONS
        ):
            return "Invalid resize_condition value"

        if target_edge is not None and not (64 <= target_edge <= 8192):
            return "target_edge must be between 64 and 8192"
        if divisible is not None and not (1 <= divisible <= 128):
            return "divisible must be between 1 and 128"
        if width_offset is not None and not (-128 <= width_offset <= 128):
            return "width_offset must be between -128 and 128"
        if height_offset is not None and not (-128 <= height_offset <= 128):
            return "height_offset must be between -128 and 128"

        if (
            edge_mode == "Megapixels"
            and megapixels is not None
            and megapixels <= 0
        ):
            return "Megapixels mode requires megapixels > 0"
        if (
            edge_mode == "Scale Multiplier"
            and scale_multiplier is not None
            and scale_multiplier <= 0
        ):
            return "Scale Multiplier mode requires scale_multiplier > 0"

        # 补边关闭时这三项不参与计算，不把旧值当成错误拦下来
        if pad_enabled:
            if pad_width is not None and not (
                16 <= pad_width <= MAX_CANVAS_SIZE
            ):
                return f"pad_width must be 16-{MAX_CANVAS_SIZE}"
            if pad_height is not None and not (
                16 <= pad_height <= MAX_CANVAS_SIZE
            ):
                return f"pad_height must be 16-{MAX_CANVAS_SIZE}"
            if (
                pad_color is not None
                and cls._parse_pad_color(pad_color) is None
            ):
                return "pad_color must be a hex color such as #FFFFFF"
            if pad_ratio is not None and pad_ratio not in (
                DEFAULT_PAD_RATIO,
                *PAD_RATIOS,
            ):
                return "Invalid pad_ratio value"

        return True

    @classmethod
    def execute(
        cls,
        image_or_mask: Any,
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
        pad_enabled: bool = False,
        pad_width: int = DEFAULT_PAD_SIZE,
        pad_height: int = DEFAULT_PAD_SIZE,
        pad_color: str = DEFAULT_PAD_COLOR,
        pad_ratio: str = DEFAULT_PAD_RATIO,
        resize_settings_in: Any = None,
        use_passed_settings: bool = True,
        output_resize_settings: bool = True,
        skip_on_empty: bool = False,
    ) -> io.NodeOutput:
        """
        批次统一处理图像或遮罩缩放。
        """
        # 前置解析：当启用上游设置时，从 passed settings 继承
        # skip_on_empty（放在早返检查之前，确保上游的
        # skip_on_empty=True 对 None 输入也生效）
        if use_passed_settings and isinstance(resize_settings_in, dict):
            upstream_skip = resize_settings_in.get("skip_on_empty")
            if isinstance(upstream_skip, bool):
                skip_on_empty = upstream_skip

        # 当 skip_on_empty 开启且输入为空时，直接输出 None 跳过报错
        if image_or_mask is None and skip_on_empty:
            LOGGER.info(
                "Input is None and skip_on_empty enabled, "
                "returning None"
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
                pad_enabled=pad_enabled,
                pad_width=pad_width,
                pad_height=pad_height,
                pad_color=pad_color,
                pad_ratio=pad_ratio,
                skip_on_empty=skip_on_empty,
            )
            passed_settings = cls._parse_settings_input(
                resize_settings_in
            )
            settings_for_output = panel_settings
            if passed_settings is not None:
                settings_for_output = passed_settings
            settings_out: dict[str, Any] | None = settings_for_output
            if not output_resize_settings:
                settings_out = None
            return io.NodeOutput(None, None, None, settings_out, None)

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
            pad_enabled=pad_enabled,
            pad_width=pad_width,
            pad_height=pad_height,
            pad_color=pad_color,
            pad_ratio=pad_ratio,
            skip_on_empty=skip_on_empty,
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

        # 从 effective_settings 同步 skip_on_empty，使上游开关可继承
        skip_on_empty = bool(effective_settings.get("skip_on_empty", False))

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
        pad_enabled = bool(effective_settings["pad_enabled"])
        pad_width = effective_settings["pad_width"]
        pad_height = effective_settings["pad_height"]
        pad_color = effective_settings["pad_color"]
        pad_ratio = effective_settings["pad_ratio"]

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
        elif edge_mode == "None":
            # 不缩放：只留原尺寸，后面的整除/偏移/补边照常生效
            new_width = width
            new_height = height
        elif edge_mode in ("Width", "Height"):
            # 按宽 / 按高：明确指定用哪条边当基准，不用去猜长边短边
            base_edge = width if edge_mode == "Width" else height
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

        # 补边放在缩放、整除、偏移之后：先把画面缩好，再放进目标画布。
        # 遮罩输入时把它自己的遮罩带进画布，补出来的那一圈统一记为 1。
        content_mask = output_tensor[..., 0] if input_kind == "mask" else None
        pad_mask = None
        if pad_enabled:
            pad_rgb = cls._parse_pad_color(pad_color)
            if pad_rgb is None:
                raise ValueError(
                    "pad_color must be a hex color such as #FFFFFF"
                )
            before_width = output_tensor.shape[2]
            before_height = output_tensor.shape[1]
            target_width, target_height = pad_width, pad_height
            if pad_ratio != DEFAULT_PAD_RATIO:
                # 选了比例：画布自动长到「刚好装下画面」的该比例尺寸，
                # 手填的宽高这时不参与
                target_width, target_height = cls._canvas_from_ratio(
                    pad_ratio,
                    before_width,
                    before_height,
                )
            output_tensor, new_width, new_height, pad_mask = (
                cls._pad_to_target(
                    output_tensor,
                    target_width,
                    target_height,
                    input_kind,
                    pad_rgb,
                    content_mask,
                )
            )
            # 补边是「只补不裁」：画面本来就比目标大时什么都不做。这种
            # 情况安静地不补最容易被当成 bug（常见原因：缩放已经把画面
            # 放大到超过补边目标），所以留一行日志。
            if new_width == before_width and new_height == before_height:
                LOGGER.info(
                    "Pad skipped: image %sx%s already reaches the pad "
                    "target %sx%s",
                    before_width,
                    before_height,
                    target_width,
                    target_height,
                )
        if pad_mask is None:
            # 没补边：没有需要重绘的地方，遮罩全 0
            pad_mask = output_tensor.new_zeros(
                (
                    output_tensor.shape[0],
                    output_tensor.shape[1],
                    output_tensor.shape[2],
                )
            )

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
            pad_mask,
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
        pad_enabled: bool = False,
        pad_width: int = DEFAULT_PAD_SIZE,
        pad_height: int = DEFAULT_PAD_SIZE,
        pad_color: str = DEFAULT_PAD_COLOR,
        pad_ratio: str = DEFAULT_PAD_RATIO,
        skip_on_empty: bool = False,
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
            "pad_enabled": pad_enabled,
            "pad_ratio": pad_ratio,
            "pad_width": pad_width,
            "pad_height": pad_height,
            "pad_color": pad_color,
            "skip_on_empty": skip_on_empty,
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
        pad_enabled = resize_settings_in["pad_enabled"]
        pad_width = resize_settings_in["pad_width"]
        pad_height = resize_settings_in["pad_height"]
        pad_color = resize_settings_in["pad_color"]
        pad_ratio = resize_settings_in["pad_ratio"]
        skip_on_empty = resize_settings_in["skip_on_empty"]

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

        if not isinstance(skip_on_empty, bool):
            return None
        if not isinstance(pad_enabled, bool):
            return None
        if not cls._is_int_value(pad_width):
            return None
        if not cls._is_int_value(pad_height):
            return None
        if not isinstance(pad_color, str):
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

        if pad_width < 16 or pad_width > MAX_CANVAS_SIZE:
            return None
        if pad_height < 16 or pad_height > MAX_CANVAS_SIZE:
            return None
        if pad_ratio not in (DEFAULT_PAD_RATIO, *PAD_RATIOS):
            # 没启用补边时旧的错写值统一成默认，不掐断整条设置链
            if pad_enabled:
                return None
            pad_ratio = DEFAULT_PAD_RATIO
        if cls._parse_pad_color(pad_color) is None:
            # 补边关闭时颜色不参与计算：旧的错写值统一成默认值，
            # 不因此掐断整条设置链
            if pad_enabled:
                return None
            pad_color = DEFAULT_PAD_COLOR

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
            pad_enabled=pad_enabled,
            pad_width=pad_width,
            pad_height=pad_height,
            pad_color=pad_color,
            pad_ratio=pad_ratio,
            skip_on_empty=skip_on_empty,
        )

    @staticmethod
    def _parse_pad_color(value: Any) -> tuple[float, float, float] | None:
        """
        把 #RRGGBB / #RGB 转成 0-1 的 RGB 三元组；格式不对返回 None。
        """
        if not isinstance(value, str):
            return None
        text = value.strip()
        if not PAD_COLOR_PATTERN.match(text):
            return None
        digits = text.lstrip("#")
        if len(digits) == 3:
            digits = "".join(char * 2 for char in digits)
        return (
            int(digits[0:2], 16) / 255.0,
            int(digits[2:4], 16) / 255.0,
            int(digits[4:6], 16) / 255.0,
        )

    @classmethod
    def _canvas_from_ratio(
        cls,
        ratio_name: str,
        width: int,
        height: int,
    ) -> tuple[int, int]:
        """
        按选定比例算出「刚好装得下画面」的最小画布。

        画面不动、不裁，画布自己长大到该比例：1080x1080 的方图配 16:9，
        画布就是 1920x1080；配 9:16 则反过来是 1080x1920。
        另一条边向上取整，保证一定装得下（宁可多补一像素也不裁）。
        """
        long_side, short_side = PAD_RATIOS[ratio_name]
        if ratio_name in PORTRAIT_PAD_RATIOS:
            ratio_width, ratio_height = short_side, long_side
        else:
            ratio_width, ratio_height = long_side, short_side

        # 画面比画布比例「更宽」时由宽度定，否则由高度定
        if width * ratio_height >= height * ratio_width:
            canvas_width = width
            canvas_height = math.ceil(width * ratio_height / ratio_width)
        else:
            canvas_height = height
            canvas_width = math.ceil(height * ratio_width / ratio_height)

        return canvas_width, canvas_height

    @staticmethod
    def _pad_to_target(
        tensor: torch.Tensor,
        target_width: int,
        target_height: int,
        input_kind: str,
        color: tuple[float, float, float],
        content_mask: torch.Tensor | None = None,
    ) -> tuple[torch.Tensor, int, int, torch.Tensor]:
        """
        把画面居中放进目标画布；已经够大的边保持原样，绝不裁切。

        同时给出「补出来的那一圈」在哪的遮罩：补出来的地方是 1，原画面
        保持自己的遮罩（图像输入就是 0）。下游采样节点拿着这个遮罩就只
        重绘新补的边。
        """
        batch, height, width, channels = tensor.shape
        canvas_width = max(width, target_width)
        canvas_height = max(height, target_height)
        if content_mask is None:
            content_mask = tensor.new_zeros((batch, height, width))
        # 先整块当成「都是新补的」，再把原画面那块盖回去
        canvas_mask = tensor.new_ones((batch, canvas_height, canvas_width))

        if canvas_width == width and canvas_height == height:
            canvas_mask[:, :, :] = content_mask
            return tensor, width, height, canvas_mask

        left = (canvas_width - width) // 2
        top = (canvas_height - height) // 2
        canvas = tensor.new_zeros(
            (batch, canvas_height, canvas_width, channels)
        )
        # 图像用指定颜色填底；遮罩默认就是 0（等于「这里没选中」）
        if input_kind == "image":
            for index in range(min(3, channels)):
                canvas[..., index] = color[index]
        canvas[:, top : top + height, left : left + width, :] = tensor
        canvas_mask[:, top : top + height, left : left + width] = content_mask
        return canvas, canvas_width, canvas_height, canvas_mask

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
