"""
分辨率设置节点模块
==================

这个模块包含分辨率宽高设置相关的节点。
"""

import math

from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger
except ImportError:  # pragma: no cover - 包外脚本运行兜底
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)

PIXELS_PER_MEGAPIXEL = 1_000_000  # 每百万像素的像素数
MAX_MEGAPIXELS = 100.0  # 最大百万像素限制（防止显存溢出）
# 尺寸模式：直接给宽高 / 按总像素数 / 只给一边让另一边跟比例算
SIZE_MODE_RESOLUTION = "Resolution"
SIZE_MODE_MEGAPIXELS = "Megapixels"
SIZE_MODE_WIDTH_ONLY = "Width only"
SIZE_MODE_HEIGHT_ONLY = "Height only"
SIZE_MODE_VALUES = (
    SIZE_MODE_RESOLUTION,
    SIZE_MODE_MEGAPIXELS,
    SIZE_MODE_WIDTH_ONLY,
    SIZE_MODE_HEIGHT_ONLY,
)
# 只给一边的两个模式（另一边由比例算出来）
SIZE_MODES_SINGLE_EDGE = (
    SIZE_MODE_WIDTH_ONLY,
    SIZE_MODE_HEIGHT_ONLY,
)
# 宽高（比例参考）的最大值，与宽高输入框的范围保持一致
MAX_BASE_EDGE = 16384
# 画面比例的两个特殊档位：按所接图像 / 手动填宽:高
ASPECT_RATIO_FROM_IMAGE = "From image"
ASPECT_RATIO_CUSTOM = "Custom"
DEFAULT_ASPECT_RATIO = "1:1"
DEFAULT_RATIO_WIDTH = 16
DEFAULT_RATIO_HEIGHT = 9
MAX_RATIO_EDGE = 1000


class XResolution(io.ComfyNode):
    """
    XResolution 分辨率宽高设置节点

    提供分辨率宽高设置功能，支持倍率缩放和宽高互换。

    功能：
        - 设置宽度和高度
        - 支持倍率缩放（同时缩放宽和高）
        - 支持按总像素数（百万像素）+ 画面比例算尺寸
        - 支持只给宽度或只给高度，另一边按画面比例自动算
        - 画面比例可用固定档位、按所接图像、或手动填宽:高
        - 支持宽高互换
        - 验证分辨率合法性（最小 1×1）
        - 支持标准分辨率预设
        - 支持分辨率整除调整（可被指定整数整除）
        - 支持分辨率偏移调整（适配特殊模型要求）

    输入：
        size_mode: 尺寸模式 (STRING)
            Resolution = 按宽高 / 预设；Megapixels = 按总像素数；
            Width only / Height only = 只给一边，另一边按比例算
        preset: 标准分辨率预设 (STRING)
            仅在 Resolution 模式生效
        width: 宽度 (INT)
            Resolution：预设为 Custom 时决定尺寸；
            Width only：就是要给的那一边；
            Megapixels / Height only：不用
        height: 高度 (INT)
            与 width 对称
        aspect_ratio: 画面比例 (STRING)
            Megapixels / Width only / Height only 用。固定档位直接查表，
            From image = 用所接图像的比例，Custom = 用手动填的宽:高
        ratio_width: 自定义比例左边 (INT)
            只在 aspect_ratio = Custom 时出现并生效
        ratio_height: 自定义比例右边 (INT)
            只在 aspect_ratio = Custom 时出现并生效
        megapixels: 百万像素 (FLOAT)
            仅在 Megapixels 模式生效
        scale: 缩放倍率 (FLOAT)
            除 Megapixels 外的模式都生效
        swap: 是否互换宽高 (BOOLEAN)
        divisible: 整除数 (INT)
            使分辨率可被该数整除（设置为 1 时禁用，常用值：8、16、32、64）
        divisible_mode: 整除模式 (STRING: "Disabled", "Nearest", "Up", "Down")
        width_offset: 宽度偏移 (INT, 范围 -128 到 128)
            在最终分辨率上添加的偏移值（正数=增加，负数=减少）
        height_offset: 高度偏移 (INT, 范围 -128 到 128)
            在最终分辨率上添加的偏移值（正数=增加，负数=减少）
        image_or_mask: 图像或遮罩输入 (IMAGE/MASK, 可选)
            Resolution 模式下直接用它的分辨率；比例选 From image 时
            用它算画面比例

    输出：
        width: 输出宽度
        height: 输出高度

    使用示例：
        width=1280, height=720, scale=2, swap=False
        输出：width=2560, height=1440

        preset="1920×1080 (16:9)", scale=1, swap=False
        输出：width=1920, height=1080

        width=1280, height=720, scale=2, swap=True
        输出：width=1440, height=2560

        preset="1920×1080 (16:9)", divisible=16, divisible_mode="Up"
        输出：width=1920, height=1088 (1080 向上取整到 16 的倍数)

        size_mode="Megapixels", aspect_ratio="16:9", megapixels=1.0
        输出：width=1333, height=750 (约 100 万像素)

        size_mode="Width only", aspect_ratio="16:9", width=1920
        输出：width=1920, height=1080

        size_mode="Height only", aspect_ratio="4:3", height=600
        输出：width=800, height=600

        size_mode="Width only", aspect_ratio="Custom",
        ratio_width=16, ratio_height=9, width=1920
        输出：width=1920, height=1080 (比例来自手动填的 16:9)

        size_mode="Megapixels", aspect_ratio="From image", megapixels=2.0
        接一张 1024×512 的图
        输出：width=2000, height=1000 (比例取自图像)
    """

    PRESETS = {
        "Custom": (0, 0),
        "3840×2160 (16:9)": (3840, 2160),
        "2560×1440 (16:9)": (2560, 1440),
        "2048×1152 (16:9)": (2048, 1152),
        "1920×1080 (16:9)": (1920, 1080),
        "1600×900 (16:9)": (1600, 900),
        "1366×768 (16:9)": (1366, 768),
        "1280×720 (16:9)": (1280, 720),
        "1024×576 (16:9)": (1024, 576),
        "2048×2048 (1:1)": (2048, 2048),
        "1536×1536 (1:1)": (1536, 1536),
        "1080×1080 (1:1)": (1080, 1080),
        "1024×1024 (1:1)": (1024, 1024),
        "512×512 (1:1)": (512, 512),
        "2048×1536 (4:3)": (2048, 1536),
        "1920×1440 (4:3)": (1920, 1440),
        "1600×1200 (4:3)": (1600, 1200),
        "1440×1080 (4:3)": (1440, 1080),
        "1280×960 (4:3)": (1280, 960),
        "1024×768 (4:3)": (1024, 768),
        "800×600 (4:3)": (800, 600),
        "640×480 (4:3)": (640, 480),
        "1920×1200 (16:10)": (1920, 1200),
        "1680×1050 (16:10)": (1680, 1050),
        "1440×900 (16:10)": (1440, 900),
        "1280×800 (16:10)": (1280, 800),
        "1280×1024 (5:4)": (1280, 1024),
        "3440×1440 (21:9)": (3440, 1440),
        "2560×1080 (21:9)": (2560, 1080),
        "896×1024 (7:8)": (896, 1024),
        "832×1216 (11:16)": (832, 1216),
    }

    # 常见画面比例（固定档位；另外还有「按图像」和「自定义」两档）
    ASPECT_RATIOS = {
        "1:1": (1, 1),
        "5:4": (5, 4),
        "4:3": (4, 3),
        "3:2": (3, 2),
        "16:10": (16, 10),
        "16:9": (16, 9),
        "21:9": (21, 9),
        "4:5": (4, 5),
        "3:4": (3, 4),
        "2:3": (2, 3),
        "9:16": (9, 16),
        "1:2": (1, 2),
        "9:21": (9, 21),
    }

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点的输入类型和约束"""
        return io.Schema(
            node_id="XResolution",
            display_name="XResolution",
            description="Resolution settings: fixed size (preset or custom "
            "width and height) or megapixels mode driven by an aspect "
            "ratio, plus scaling, swap, divisible adjustment and offsets",
            category="♾️ Xz3r0/Workflow-Processing",
            inputs=[
                io.MultiType.Input(
                    "image_or_mask",
                    types=[io.Image, io.Mask],
                    optional=True,
                    tooltip="Image or mask input: its resolution becomes "
                    "the base size (and the aspect ratio in Megapixels "
                    "mode when the ratio is Custom), overriding the "
                    "settings below",
                ),
                io.Combo.Input(
                    "size_mode",
                    options=list(SIZE_MODE_VALUES),
                    default=SIZE_MODE_RESOLUTION,
                    tooltip="How the size is decided: Resolution = the exact "
                    "width and height (from a preset or typed in), "
                    "Megapixels = an aspect ratio plus a total pixel count, "
                    "Width only / Height only = type one edge and let the "
                    "aspect ratio work out the other one",
                ),
                io.Combo.Input(
                    "preset",
                    options=list(cls.PRESETS.keys()),
                    default="Custom",
                    tooltip="Fixed resolution preset (only used in "
                    "Resolution mode; a preset other than Custom overrides "
                    "the width and height below)",
                ),
                io.Int.Input(
                    "width",
                    default=1280,
                    min=1,
                    max=MAX_BASE_EDGE,
                    step=1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Width (Resolution mode with a Custom preset: "
                    "the exact width; Width only mode: the one edge you "
                    "type; not used in Megapixels / Height only modes)",
                ),
                io.Int.Input(
                    "height",
                    default=720,
                    min=1,
                    max=MAX_BASE_EDGE,
                    step=1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Height (Resolution mode with a Custom preset: "
                    "the exact height; Height only mode: the one edge you "
                    "type; not used in Megapixels / Width only modes)",
                ),
                io.Combo.Input(
                    "aspect_ratio",
                    options=cls.aspect_ratio_options(),
                    default=DEFAULT_ASPECT_RATIO,
                    tooltip="Aspect ratio used by Megapixels / Width only / "
                    "Height only (ignored in Resolution mode): Custom = "
                    "type it in the two boxes below, From image = take it "
                    "from the connected image, the rest are common fixed "
                    "ratios",
                ),
                io.Int.Input(
                    "ratio_width",
                    default=DEFAULT_RATIO_WIDTH,
                    min=1,
                    max=MAX_RATIO_EDGE,
                    step=1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Custom aspect ratio: left side of the "
                    "width:height pair (only shown when the ratio is "
                    "Custom)",
                ),
                io.Int.Input(
                    "ratio_height",
                    default=DEFAULT_RATIO_HEIGHT,
                    min=1,
                    max=MAX_RATIO_EDGE,
                    step=1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Custom aspect ratio: right side of the "
                    "width:height pair (only shown when the ratio is "
                    "Custom)",
                ),
                io.Float.Input(
                    "megapixels",
                    default=1.0,
                    min=0.1,
                    max=MAX_MEGAPIXELS,
                    step=0.1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Target total pixel count in megapixels (only "
                    "used in Megapixels mode)",
                ),
                io.Float.Input(
                    "scale",
                    default=1.0,
                    min=0.01,
                    max=100.0,
                    step=0.1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Scale multiplier (every mode except Megapixels)",
                ),
                io.Boolean.Input(
                    "swap",
                    default=False,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip="Swap width and height",
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
                    "(positive=increase, negative=decrease)",
                ),
                io.Int.Input(
                    "height_offset",
                    default=0,
                    min=-128,
                    max=128,
                    step=1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Add offset to output height "
                    "(positive=increase, negative=decrease)",
                ),
            ],
            outputs=[
                io.Int.Output(
                    "width",
                    tooltip="Output resolution width "
                    "(after size mode, swap, divisible adjustment, "
                    "and offset)",
                ),
                io.Int.Output(
                    "height",
                    tooltip="Output resolution height "
                    "(after size mode, swap, divisible adjustment, "
                    "and offset)",
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        width: int,
        height: int,
        preset: str,
        scale: float,
        swap: bool,
        divisible: int,
        divisible_mode: str,
        width_offset: int,
        height_offset: int,
        image_or_mask=None,
        size_mode: str = SIZE_MODE_RESOLUTION,
        aspect_ratio: str = DEFAULT_ASPECT_RATIO,
        ratio_width: int = DEFAULT_RATIO_WIDTH,
        ratio_height: int = DEFAULT_RATIO_HEIGHT,
        megapixels: float = 1.0,
    ) -> io.NodeOutput:
        """
        处理分辨率设置

        处理流程：
            1. 需要比例的模式（百万像素 + 两个单边模式）先把比例解成
               宽高比：固定档位 / 来自图像 / 手动填的宽:高
            2. 确定基准尺寸：图像输入（仅 Resolution）/ 预设（仅
               Resolution）/ 宽高框
            3. 决定输出尺寸：直接乘倍率 / 按总像素数 + 比例 / 只给一边
               让另一边跟比例算
            4. 应用宽高互换
            5. 应用整除调整
            6. 应用分辨率偏移
            7. 确保最小尺寸

        Args:
            width: 输入宽度
            height: 输入高度
            preset: 固定分辨率预设（仅 Resolution 模式）
            image_or_mask: 图像或遮罩输入（IMAGE/MASK，可选）
            scale: 缩放倍率（除 Megapixels 外的模式）
            swap: 是否互换宽高
            divisible: 使分辨率可被该数整除
            divisible_mode: 整除模式 (Nearest/Up/Down)
            width_offset: 宽度偏移值，范围 -128 到 128
                在最终分辨率上添加的偏移值（正数=增加，负数=减少，0=禁用）
            height_offset: 高度偏移值，范围 -128 到 128
                在最终分辨率上添加的偏移值（正数=增加，负数=减少，0=禁用）
            size_mode: 尺寸模式（Resolution / Megapixels /
                Width only / Height only）
            aspect_ratio: 画面比例（Megapixels / Width only /
                Height only 用）
            ratio_width: 自定义比例的左边（仅 Custom）
            ratio_height: 自定义比例的右边（仅 Custom）
            megapixels: 目标像素总数（百万），仅 Megapixels 模式下生效

        Returns:
            NodeOutput: 包含处理后的宽度和高度
        """
        if size_mode not in SIZE_MODE_VALUES:
            raise ValueError(f"Unsupported size mode: {size_mode}")

        use_megapixels = size_mode == SIZE_MODE_MEGAPIXELS
        single_edge = size_mode in SIZE_MODES_SINGLE_EDGE

        # 比例只在「不是直接给宽高」的模式里才需要解析
        ratio = None
        if use_megapixels or single_edge:
            ratio = cls._resolve_ratio(
                aspect_ratio,
                ratio_width,
                ratio_height,
                image_or_mask,
            )

        if use_megapixels:
            output_width, output_height = cls._size_from_megapixels(
                ratio,
                megapixels,
            )
        else:
            if image_or_mask is not None and not single_edge:
                width, height = cls._extract_image_or_mask_resolution(
                    image_or_mask
                )
            elif size_mode == SIZE_MODE_RESOLUTION and preset in cls.PRESETS:
                preset_width, preset_height = cls.PRESETS[preset]
                if preset_width > 0 and preset_height > 0:
                    width = preset_width
                    height = preset_height

            if width < 1 or height < 1:
                raise ValueError(
                    "Width and height must be greater than or equal to 1"
                )
            if scale is None:
                raise ValueError("Scale multiplier is required")
            if scale <= 0:
                raise ValueError(
                    "Scale multiplier must be greater than 0"
                )

            if single_edge:
                output_width, output_height = cls._size_from_single_edge(
                    width,
                    height,
                    size_mode,
                    ratio,
                    scale,
                )
            else:
                output_width = int(width * scale)
                output_height = int(height * scale)

        if swap:
            output_width, output_height = output_height, output_width

        # 应用整除调整
        if divisible_mode != "Disabled" and divisible > 1:
            output_width = cls._make_divisible(
                output_width, divisible, divisible_mode
            )
            output_height = cls._make_divisible(
                output_height, divisible, divisible_mode
            )

        # 应用分辨率偏移
        output_width = output_width + width_offset
        output_height = output_height + height_offset

        # 确保最小尺寸
        output_width = max(output_width, 1)
        output_height = max(output_height, 1)

        return io.NodeOutput(output_width, output_height)

    @classmethod
    def aspect_ratio_options(cls) -> list[str]:
        """
        画面比例下拉的完整选项。

        顺序讲究：**默认档必须排第一**——下拉框打开时会自动滚到当前选中的
        那一项，默认档若不是第一个，一打开就看不到它上面还有什么，容易被
        误以为「列表里只有这些」。所以顺序是：

            1:1（默认） → Custom → From image → 其它固定比例
        """
        return [
            DEFAULT_ASPECT_RATIO,
            ASPECT_RATIO_CUSTOM,
            ASPECT_RATIO_FROM_IMAGE,
            *[
                name
                for name in cls.ASPECT_RATIOS
                if name != DEFAULT_ASPECT_RATIO
            ],
        ]

    @classmethod
    def _resolve_ratio(
        cls,
        aspect_ratio: str,
        ratio_width: int,
        ratio_height: int,
        image_or_mask=None,
    ) -> tuple[int, int]:
        """
        把「画面比例」这个名字解成正的宽高比。

        - 固定档位：直接查表；
        - From image：用所接图像（或遮罩）的分辨率；
        - Custom：用手动填的宽:高两个数。
        """
        if aspect_ratio == ASPECT_RATIO_CUSTOM:
            if ratio_width is None or ratio_height is None:
                raise ValueError(
                    "Custom aspect ratio needs both ratio numbers"
                )
            if ratio_width < 1 or ratio_height < 1:
                raise ValueError(
                    "Custom aspect ratio numbers must be greater than "
                    "or equal to 1"
                )
            return int(ratio_width), int(ratio_height)

        if aspect_ratio == ASPECT_RATIO_FROM_IMAGE:
            if image_or_mask is None:
                raise ValueError(
                    "Aspect ratio 'From image' needs an image or mask "
                    "input"
                )
            image_width, image_height = (
                cls._extract_image_or_mask_resolution(image_or_mask)
            )
            if image_width < 1 or image_height < 1:
                raise ValueError(
                    "Image resolution must be greater than or equal to 1"
                )
            return image_width, image_height

        if aspect_ratio not in cls.ASPECT_RATIOS:
            raise ValueError(
                f"Unsupported aspect ratio: {aspect_ratio}"
            )
        return cls.ASPECT_RATIOS[aspect_ratio]

    @classmethod
    def _size_from_single_edge(
        cls,
        width: int,
        height: int,
        size_mode: str,
        ratio: tuple[int, int],
        scale: float,
    ) -> tuple[int, int]:
        """
        「只给一边」：给定边乘倍率，另一边由比例算出来。
        """
        ratio_width, ratio_height = ratio

        if size_mode == SIZE_MODE_WIDTH_ONLY:
            output_width = int(width * scale)
            output_height = round(
                output_width * ratio_height / ratio_width
            )
            return output_width, output_height

        output_height = int(height * scale)
        output_width = round(output_height * ratio_width / ratio_height)
        return output_width, output_height

    @classmethod
    def _size_from_megapixels(
        cls,
        ratio: tuple[int, int],
        megapixels: float,
    ) -> tuple[int, int]:
        """
        按「总像素数 + 画面比例」算尺寸。
        """
        if megapixels is None:
            raise ValueError("Megapixels mode requires a megapixels value")
        if megapixels <= 0:
            raise ValueError("Megapixels value must be greater than 0")

        ratio_width, ratio_height = ratio

        target_mp = min(float(megapixels), MAX_MEGAPIXELS)
        if target_mp < float(megapixels):
            LOGGER.warning(
                "Megapixels value %s exceeds maximum limit of %s, "
                "clamped to %s",
                megapixels,
                MAX_MEGAPIXELS,
                target_mp,
            )

        target_pixels = target_mp * PIXELS_PER_MEGAPIXEL
        # 保持比例分配总像素：宽高各自开方再取整
        output_width = round(
            math.sqrt(target_pixels * ratio_width / ratio_height)
        )
        output_height = round(
            math.sqrt(target_pixels * ratio_height / ratio_width)
        )
        return max(output_width, 1), max(output_height, 1)

    @staticmethod
    def _extract_image_or_mask_resolution(image_or_mask) -> tuple[int, int]:
        """
        从 IMAGE/MASK 输入中提取分辨率（width, height）。
        """
        shape = getattr(image_or_mask, "shape", None)
        if shape is None:
            raise ValueError(
                "image_or_mask input must be IMAGE or MASK tensor"
            )

        dims = len(shape)
        if dims == 2:
            height, width = int(shape[0]), int(shape[1])
        elif dims == 3:
            last_dim = int(shape[-1])
            if last_dim in {1, 3, 4}:
                height, width = int(shape[0]), int(shape[1])
            else:
                height, width = int(shape[-2]), int(shape[-1])
        elif dims == 4:
            height, width = int(shape[-3]), int(shape[-2])
        else:
            raise ValueError(
                "Unsupported image_or_mask tensor shape"
            )

        if width < 1 or height < 1:
            raise ValueError(
                "image_or_mask resolution must be >= 1"
            )

        return width, height

    @staticmethod
    def _make_divisible(value: int, divisor: int, mode: str = "Up") -> int:
        """
        调整数值使其可被除数整除

        Args:
            value: 原始数值
            divisor: 除数
            mode: 整除模式 ("Nearest", "Up", "Down")

        Returns:
            调整后的数值
        """
        if divisor <= 1:
            return value

        remainder = value % divisor

        if remainder == 0:
            return value

        if mode == "Down":
            # 向下取整
            return value - remainder
        elif mode == "Up":
            # 向上取整
            return value + (divisor - remainder)
        else:  # Nearest
            # 最接近的倍数
            if remainder <= divisor // 2:
                return value - remainder
            else:
                return value + (divisor - remainder)
