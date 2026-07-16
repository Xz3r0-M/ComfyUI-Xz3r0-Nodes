"""
XController 通用控制组件共享工具模块
========================

为 XKnob、XFaderH、XFaderV、XToggle、XButton、XYPad 等节点
提供值映射函数和样式枚举定义。
"""

import json
from enum import Enum

# ============================================================
# 样式枚举（仅形状，无色——颜色由前端 ComfyUI CSS 变量接管）
# ============================================================

class KnobShape(str, Enum):
    """旋钮造型。"""

    CIRCLE = "circle"
    ROUNDED_RECT = "rounded_rect"
    HEXAGON = "hexagon"


class HandleShape(str, Enum):
    """滑块 / 推子手柄形状。"""

    CIRCLE = "circle"
    SQUARE = "square"
    DIAMOND = "diamond"


class ToggleStyle(str, Enum):
    """开关样式。"""

    SWITCH = "switch"
    PADDLE = "paddle"
    DOT = "dot"


class ButtonStyle(str, Enum):
    """按压按钮样式。"""

    ROUNDED = "rounded"
    SQUARE = "square"
    PILL = "pill"


class ValueMode(str, Enum):
    """数值模式。"""

    RANGE = "Range"
    STEPS = "Steps"
    PERCENTAGE = "Percentage"


class ButtonMode(str, Enum):
    """按压按钮行为模式。"""

    INCREASE = "increase"
    DECREASE = "decrease"
    TOGGLE = "toggle"


# ============================================================
# 值映射函数
# ============================================================


def map_range(
    normalized: float,
    out_min: float,
    out_max: float,
) -> float:
    """将 0~1 归一化值映射到目标范围。

    Args:
        normalized: 归一化值，范围 [0.0, 1.0]。
        out_min: 输出最小值。
        out_max: 输出最大值。

    Returns:
        映射后的值，范围 [out_min, out_max]。
    """
    return out_min + normalized * (out_max - out_min)


def snap_to_steps(normalized: float, steps: list[float]) -> float:
    """将归一化值吸附到最近的分段档位。

    Args:
        normalized: 归一化值，范围 [0.0, 1.0]。
        steps: 有序档位列表（从小到大）。

    Returns:
        最接近的档位值。

    Raises:
        ValueError: steps 为空时。
    """
    if not steps:
        raise ValueError("steps must not be empty")

    # 归一化 0~1 映射到 steps 的索引范围 0 ~ len(steps)-1
    target = normalized * (len(steps) - 1)
    idx = int(round(target))
    idx = max(0, min(idx, len(steps) - 1))
    return steps[idx]


def apply_percentage(
    normalized: float,
    base: float,
    pct_min: float,
    pct_max: float,
) -> float:
    """基于静态基础值的百分比偏移。

    Args:
        normalized: 归一化值，范围 [0.0, 1.0]。
        base: 静态基础值。
        pct_min: 百分比下限（如 -50 表示 -50%）。
        pct_max: 百分比上限（如 50 表示 +50%）。

    Returns:
        base * (1 + 百分比偏移)。
    """
    pct = map_range(normalized, pct_min, pct_max)
    return base * (1.0 + pct / 100.0)


def parse_steps_json(json_str: str) -> list[float]:
    """解析用户输入的 JSON 档位数组。

    Args:
        json_str: JSON 格式的字符串，如 ``"[0, 0.5, 1.0]"``。

    Returns:
        解析后的浮点数列表。

    Raises:
        ValueError: 格式不合法或空数组时。
    """
    raw = json_str.strip()
    if not raw:
        raise ValueError("steps string must not be empty")

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in steps: {exc}") from exc

    if not isinstance(parsed, list):
        raise ValueError(
            "steps must be a JSON array, got "
            f"{type(parsed).__name__}",
        )

    if len(parsed) == 0:
        raise ValueError("steps array must not be empty")

    result: list[float] = []
    for item in parsed:
        try:
            result.append(float(item))
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"Invalid step value: {item!r}",
            ) from exc

    return result


def compute_output(
    normalized: float,
    mode: ValueMode,
    out_min: float | None = None,
    out_max: float | None = None,
    steps: list[float] | None = None,
    base: float | None = None,
    pct_min: float | None = None,
    pct_max: float | None = None,
) -> float:
    """根据数值模式计算最终输出值。

    Args:
        normalized: 控件原始归一化值 [0.0, 1.0]。
        mode: 数值模式。
        out_min: Range 模式的最小值。
        out_max: Range 模式的最大值。
        steps: Steps 模式的档位列表。
        base: Percentage 模式的基础值。
        pct_min: Percentage 模式的百分比下限。
        pct_max: Percentage 模式的百分比上限。

    Returns:
        计算后的最终输出值。
    """
    if mode == ValueMode.RANGE:
        return map_range(normalized, out_min or 0.0, out_max or 1.0)
    if mode == ValueMode.STEPS:
        return snap_to_steps(normalized, steps or [0.0, 1.0])
    if mode == ValueMode.PERCENTAGE:
        return apply_percentage(
            normalized,
            base or 1.0,
            pct_min or -100.0,
            pct_max or 100.0,
        )
    # fallback — 不应到达
    return normalized


def normalize_to_unit(
    value: float,
    mode: ValueMode,
    out_min: float,
    out_max: float,
    steps: list[float] | None = None,
    base: float | None = None,
    pct_min: float | None = None,
    pct_max: float | None = None,
) -> float:
    """将输出值反向映射回归一化 0~1（用于前端初始化）。

    保证前端控件能在工作流加载时恢复到正确的视觉位置。

    Args:
        value: 输出值。
        mode: 数值模式。
        out_min, out_max: Range 模式边界。
        steps: Steps 模式档位列表。
        base, pct_min, pct_max: Percentage 模式参数。

    Returns:
        归一化值 [0.0, 1.0]。
    """
    if mode == ValueMode.RANGE:
        denom = out_max - out_min
        if denom == 0.0:
            return 0.0
        return max(0.0, min(1.0, (value - out_min) / denom))

    if mode == ValueMode.STEPS:
        if not steps:
            return 0.0
        # 找最接近 value 的档位索引
        best_idx = 0
        best_dist = float("inf")
        for i, s in enumerate(steps):
            dist = abs(value - s)
            if dist < best_dist:
                best_dist = dist
                best_idx = i
        denom = len(steps) - 1
        if denom == 0:
            return 0.0
        return best_idx / denom

    if mode == ValueMode.PERCENTAGE:
        if base and base != 0.0:
            pct = (value / base - 1.0) * 100.0
        else:
            pct = 0.0
        pct_range = pct_max - pct_min
        if pct_range == 0.0:
            return 0.0
        return max(0.0, min(1.0, (pct - pct_min) / pct_range))

    return 0.0
