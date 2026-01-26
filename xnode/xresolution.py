"""
分辨率设置节点模块
==================

这个模块包含分辨率宽高设置相关的节点。
"""

from typing import Tuple


class XResolution:
    """
    XResolution 分辨率宽高设置节点

    提供分辨率宽高设置功能，支持倍率缩放和宽高互换。

    功能:
        - 设置宽度和高度
        - 支持倍率缩放（同时缩放宽和高）
        - 支持宽高互换
        - 验证分辨率合法性（最小1×1）
        - 支持标准分辨率预设

    输入:
        preset: 标准分辨率预设 (STRING)
        width: 宽度 (INT)
        height: 高度 (INT)
        scale: 缩放倍率 (FLOAT)
        swap: 是否互换宽高 (BOOLEAN)

    输出:
        width: 输出宽度
        height: 输出高度

    使用示例:
        width=1280, height=720, scale=2, swap=False
        输出: width=2560, height=1440

        preset="1920×1080 (16:9)", scale=1, swap=False
        输出: width=1920, height=1080

        width=1280, height=720, scale=2, swap=True
        输出: width=1440, height=2560
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

    @classmethod
    def INPUT_TYPES(cls) -> dict:
        """定义节点的输入类型和约束"""
        return {
            "required": {
                "preset": (list(cls.PRESETS.keys()), {
                    "default": "Custom",
                    "tooltip": "Custom or standard resolution presets"
                }),
                "width": ("INT", {
                    "default": 1280,
                    "min": 1,
                    "max": 16384,
                    "step": 1,
                    "display": "number",
                    "tooltip": "Custom resolution width"
                }),
                "height": ("INT", {
                    "default": 720,
                    "min": 1,
                    "max": 16384,
                    "step": 1,
                    "display": "number",
                    "tooltip": "Custom resolution height"
                }),
                "scale": ("FLOAT", {
                    "default": 1.0,
                    "min": 0.01,
                    "max": 100.0,
                    "step": 0.1,
                    "display": "number",
                    "tooltip": "Scale multiplier"
                }),
                "swap": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Swap width and height"
                })
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    OUTPUT_TOOLTIPS = ("Output resolution width (after preset, scaling, and swap)", "Output resolution height (after preset, scaling, and swap)")
    FUNCTION = "process"
    CATEGORY = "♾️ Xz3r0/Tools"

    def process(self, width: int, height: int, preset: str, scale: float, swap: bool) -> Tuple[int, int]:
        """
        处理分辨率设置

        Args:
            width: 输入宽度
            height: 输入高度
            preset: 标准分辨率预设
            scale: 缩放倍率
            swap: 是否互换宽高

        Returns:
            (output_width, output_height): 处理后的宽度和高度
        """
        if preset in self.PRESETS and preset != "Custom":
            preset_width, preset_height = self.PRESETS[preset]
            if preset_width > 0 and preset_height > 0:
                width = preset_width
                height = preset_height

        if width < 1 or height < 1:
            raise ValueError("宽度和高度必须大于等于1")

        if scale <= 0:
            raise ValueError("缩放倍率必须大于0")

        output_width = int(width * scale)
        output_height = int(height * scale)

        if swap:
            output_width, output_height = output_height, output_width

        return (output_width, output_height)

