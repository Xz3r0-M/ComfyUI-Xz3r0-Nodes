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
        "Custom (自定义)": (0, 0),
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
                    "default": "Custom (自定义)",
                    "tooltip": "选择标准分辨率预设"
                }),
                "width": ("INT", {
                    "default": 1280,
                    "min": 1,
                    "max": 16384,
                    "step": 1,
                    "display": "number",
                    "tooltip": "分辨率宽度"
                }),
                "height": ("INT", {
                    "default": 720,
                    "min": 1,
                    "max": 16384,
                    "step": 1,
                    "display": "number",
                    "tooltip": "分辨率高度"
                }),
                "scale": ("FLOAT", {
                    "default": 1.0,
                    "min": 0.01,
                    "max": 100.0,
                    "step": 0.1,
                    "display": "number",
                    "tooltip": "缩放倍率"
                }),
                "swap": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "互换宽度和高度"
                })
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
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
        if preset in self.PRESETS and preset != "Custom (自定义)":
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


# 节点类映射（用于本地测试）
if __name__ == "__main__":
    print("XResolution 节点已加载")
    print(f"节点分类: {XResolution.CATEGORY}")
    print(f"输入类型: {XResolution.INPUT_TYPES()}")
    print(f"输出类型: {XResolution.RETURN_TYPES}")

    # 测试用例
    print("\n=== 测试用例 ===")
    node = XResolution()

    # 测试1: 预设分辨率 1920×1080
    out_w, out_h = node.process(1280, 720, "1920×1080 (16:9)", 1.0, False)
    print(f"测试1 - 预设 1920×1080: {out_w}×{out_h}")

    # 测试2: 预设分辨率 1280×720 + 缩放
    out_w, out_h = node.process(1280, 720, "1280×720 (16:9)", 2.0, False)
    print(f"测试2 - 预设 1280×720 ×2: {out_w}×{out_h}")

    # 测试3: 预设分辨率 1080×1080 (正方形)
    out_w, out_h = node.process(1280, 720, "1080×1080 (1:1)", 1.0, False)
    print(f"测试3 - 预设 1080×1080: {out_w}×{out_h}")

    # 测试4: 预设分辨率 + 互换
    out_w, out_h = node.process(1280, 720, "1920×1080 (16:9)", 1.0, True)
    print(f"测试4 - 预设 1920×1080 互换: {out_w}×{out_h}")

    # 测试5: 自定义值 + 缩放
    out_w, out_h = node.process(1280, 720, "Custom (自定义)", 2.0, False)
    print(f"测试5 - 自定义 1280×720 ×2: {out_w}×{out_h}")

    # 测试6: 预设分辨率 4:3 比例
    out_w, out_h = node.process(1280, 720, "1600×1200 (4:3)", 1.0, False)
    print(f"测试6 - 预设 1600×1200 (4:3): {out_w}×{out_h}")

    # 测试7: XGA标准分辨率 1024×768
    out_w, out_h = node.process(1280, 720, "1024×768 (4:3)", 1.0, False)
    print(f"测试7 - 预设 1024×768 (XGA): {out_w}×{out_h}")

    # 测试8: 16:10宽屏比例 1920×1200
    out_w, out_h = node.process(1280, 720, "1920×1200 (16:10)", 1.0, False)
    print(f"测试8 - 预设 1920×1200 (16:10): {out_w}×{out_h}")

    # 测试9: SXGA标准 1280×1024 (5:4)
    out_w, out_h = node.process(1280, 720, "1280×1024 (5:4)", 1.0, False)
    print(f"测试9 - 预设 1280×1024 (5:4): {out_w}×{out_h}")

    # 测试10: 超宽屏 21:9 比例 3440×1440
    out_w, out_h = node.process(1280, 720, "3440×1440 (21:9)", 1.0, False)
    print(f"测试10 - 预设 3440×1440 (21:9): {out_w}×{out_h}")

    # 测试11: 预设 + 互换 = 竖屏 (9:16)
    out_w, out_h = node.process(1280, 720, "1920×1080 (16:9)", 1.0, True)
    print(f"测试11 - 预设 1920×1080 互换(9:16): {out_w}×{out_h}")

    # 测试12: 4K 分辨率
    out_w, out_h = node.process(1280, 720, "3840×2160 (16:9)", 1.0, False)
    print(f"测试12 - 预设 3840×2160 (4K): {out_w}×{out_h}")

    # 测试13: 预设 512×512 + 缩放 + 互换
    out_w, out_h = node.process(1280, 720, "512×512 (1:1)", 2.0, True)
    print(f"测试13 - 预设 512×512 ×2 互换: {out_w}×{out_h}")

    # 测试14: SDXL 常用分辨率
    out_w, out_h = node.process(1280, 720, "1024×1024 (1:1)", 1.0, False)
    print(f"测试14 - 预设 1024×1024 (SDXL): {out_w}×{out_h}")

    print("\n✅ 所有测试完成！")
