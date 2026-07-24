"""
XController 通用控制组件节点模块 (V3 API)
======================================

单一节点通过下拉菜单切换控件类型：旋钮、横向滑块、竖向推子、
开关、按压按钮、XY 坐标面板。

所有配置参数均为 socketless hidden widget——前端自定义 UI 渲染，
原生 ComfyUI widget 完全不可见。
"""

from __future__ import annotations

from enum import Enum

from comfy_api.latest import io

try:
    from ..xz3r0_utils import (
        ButtonMode,
        ButtonStyle,
        KnobShape,
        ToggleStyle,
        ValueMode,
        compute_output,
        get_logger,
        map_range,
        parse_steps_json,
    )
except ImportError:
    from xz3r0_utils import (
        ButtonMode,
        ButtonStyle,
        KnobShape,
        ToggleStyle,
        ValueMode,
        compute_output,
        get_logger,
        map_range,
        parse_steps_json,
    )

LOGGER = get_logger(__name__)


class ControlType(str, Enum):
    """控件类型枚举。"""

    KNOB = "Knob"
    FADER_H = "FaderH"
    FADER_V = "FaderV"
    TOGGLE = "Toggle"
    BUTTON = "Button"
    XY_PAD = "XYPad"


# 🔒 所有配置 widget 的隐藏模板——socketless + extra_dict hidden
_H = {"socketless": True, "extra_dict": {"hidden": True}}


class XController(io.ComfyNode):
    """XController — 通用控制组件，通过下拉菜单切换控件类型。"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="XController",
            display_name="XController",
            description=(
                "Universal control node. Select control type via "
                "dropdown: Knob, Horizontal Fader, Vertical Fader, "
                "Toggle, Button, or XY Pad. Supports Range, Steps, "
                "and Percentage value modes for analog controls."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            not_idempotent=True,
            inputs=[
                # ================================================
                # 控件类型
                # ================================================
                io.Combo.Input(
                    "control_type",
                    options=ControlType,
                    default=ControlType.KNOB,
                    **_H,
                    tooltip=(
                        "Select the visible controller: Knob, horizontal "
                        "fader, vertical fader, Toggle, hold Button, or "
                        "XY Pad."
                    ),
                ),
                # ================================================
                # 数值模式（模拟控件共用）
                # ================================================
                io.Combo.Input(
                    "value_mode",
                    options=ValueMode,
                    default=ValueMode.RANGE,
                    **_H,
                    tooltip=(
                        "Controls how a 0-1 position becomes FLOAT output: "
                        "Range, Steps, or Percentage."
                    ),
                ),
                # Range
                io.Float.Input("min", default=0.0, **{"step": 0.01, **_H},  # noqa: PIE928
                               tooltip="Lowest FLOAT output in Range mode."),
                io.Float.Input("max", default=1.0, **{"step": 0.01, **_H},
                               tooltip="Highest FLOAT output in Range mode."),
                io.Float.Input("step", default=0.01, **{"step": 0.001, **_H},
                               tooltip=("Range snap size and hold-button "
                                        "increment. Use 0 to disable "
                                        "snapping.")),
                io.Float.Input(
                    "default_value", default=0.5,
                    **{"step": 0.01, **_H},
                     tooltip=("Default Range value used as the intended "
                              "reset/start value.")),
                # Steps
                io.String.Input("steps",
                                default="[0.0, 0.25, 0.5, 0.75, 1.0]",
                                **_H,
                                 tooltip=("JSON array of discrete FLOAT "
                                          "outputs, for example "
                                          "[0, 0.25, 0.5, 1].")),
                io.Int.Input(
                    "default_step_index", default=2, **_H,
                    tooltip=(
                         "Default step index, starting at 0. The button "
                         "moves one index per repeat."),),
                # Percentage
                io.Float.Input(
                    "base_value", default=100.0,
                    **{"step": 0.01, **_H},
                    tooltip=("Base value used before applying the "
                             "percentage offset.")),
                io.Float.Input("pct_min", default=-50.0, **{"step": 0.1, **_H},
                               tooltip=("Minimum percentage offset. Negative "
                                        "values reduce the base value.")),
                io.Float.Input("pct_max", default=50.0, **{"step": 0.1, **_H},
                               tooltip=("Maximum percentage offset. Positive "
                                        "values increase the base value.")),
                io.Float.Input(
                    "default_pct", default=0.0,
                    **{"step": 0.1, **_H},
                    tooltip=("Default percentage offset used as the "
                             "intended reset/start value.")),
                # ================================================
                # 样式 —— 模拟控件形状
                # ================================================
                io.Combo.Input("shape", options=KnobShape,
                               default=KnobShape.CIRCLE, **_H,
                               tooltip=("Visual shape for knobs, or handle "
                                        "shape for horizontal/vertical "
                                        "faders.")),
                # ================================================
                # 样式 —— 开关 / 按钮
                # ================================================
                io.Combo.Input("toggle_style", options=ToggleStyle,
                               default=ToggleStyle.SWITCH, **_H,
                               tooltip=("Visual style of the boolean toggle. "
                                        "It changes BOOLEAN and outputs 0 "
                                        "or 1 on FLOAT.")),
                io.Boolean.Input("default_state", default=True, **_H,
                                 label_on="Enabled", label_off="Disabled",
                                  tooltip=("Default boolean state for Toggle "
                                           "when no saved state exists.")),
                io.Combo.Input("button_mode", options=ButtonMode,
                               default=ButtonMode.INCREASE, **_H,
                               tooltip=("Increase: hold to raise value."
                                        " Decrease: hold to lower value."
                                        " Toggle: click between min and max")),
                io.Combo.Input("button_style", options=ButtonStyle,
                               default=ButtonStyle.ROUNDED, **_H,
                               tooltip=("Visual shape of the hold button. "
                                        "The button also reports pressed "
                                        "state on BOOLEAN.")),
                # ================================================
                # XY Pad 配置
                # ================================================
                io.Float.Input("x_min", default=0.0,
                               **{"step": 0.01, **_H},
                               tooltip="Lowest X output value "
                                        "for the XY Pad."),
                io.Float.Input("x_max", default=1.0,
                               **{"step": 0.01, **_H},
                               tooltip="Highest X output value "
                                        "for the XY Pad."),
                io.Float.Input("x_step", default=0.01, **{"step": 0.001, **_H},
                               tooltip=("Snap size for X output. Use 0 to "
                                        "disable X snapping.")),
                io.Float.Input(
                    "x_default", default=0.5,
                    **{"step": 0.01, **_H},
                    tooltip=("Default X value used as the intended "
                             "reset/start value.")),
                io.Float.Input("y_min", default=0.0,
                               **{"step": 0.01, **_H},
                               tooltip="Lowest Y output value "
                                        "for the XY Pad."),
                io.Float.Input("y_max", default=1.0,
                               **{"step": 0.01, **_H},
                               tooltip="Highest Y output value "
                                        "for the XY Pad."),
                io.Float.Input("y_step", default=0.01, **{"step": 0.001, **_H},
                               tooltip=("Snap size for Y output. Use 0 to "
                                        "disable Y snapping.")),
                io.Float.Input(
                    "y_default", default=0.5,
                    **{"step": 0.01, **_H},
                    tooltip=("Default Y value used as the intended "
                             "reset/start value.")),
                io.Boolean.Input("crosshair_visible", default=True, **_H,
                                 label_on="Enabled", label_off="Disabled",
                                 tooltip=("Show guide lines through the "
                                          "current XY point.")),
                io.Boolean.Input("grid_visible", default=True, **_H,
                                 label_on="Enabled", label_off="Disabled",
                                 tooltip=("Show a subtle grid behind the "
                                          "XY Pad for easier positioning.")),
                # ================================================
                # 隐藏：当前值（前端写入）
                # ================================================
                io.Float.Input("_normalized", default=0.5,
                               min=0.0, max=1.0, step=0.0001,
                               socketless=True,
                               extra_dict={"hidden": True},
                               tooltip=("Internal: current normalized"
                                        " value (analog controls)")),
                io.Boolean.Input("_state", default=False,
                                 label_on="Enabled", label_off="Disabled",
                                 socketless=True,
                                 extra_dict={"hidden": True},
                                 tooltip="Internal: current state"),
                io.Float.Input("_x_normalized", default=0.5,
                               min=0.0, max=1.0, step=0.0001,
                               socketless=True,
                               extra_dict={"hidden": True},
                               tooltip="Internal: current normalized X"),
                io.Float.Input("_y_normalized", default=0.5,
                               min=0.0, max=1.0, step=0.0001,
                               socketless=True,
                               extra_dict={"hidden": True},
                               tooltip="Internal: current normalized Y"),
            ],
            outputs=[
                io.Float.Output("FLOAT",
                                 tooltip="Current value (analog controls)"),
                io.Int.Output("INT",
                              tooltip="FLOAT output truncated toward zero"),
                io.Boolean.Output("BOOLEAN",
                                  tooltip="Current state (toggle / button)"),
                io.Float.Output("X", tooltip="Current X coordinate"),
                io.Float.Output("Y", tooltip="Current Y coordinate"),
            ],
        )

    @classmethod
    def execute(  # noqa: PLR0913, PLR0912
        cls,
        control_type: str = "Knob",
        value_mode: str = "Range",
        min: float = 0.0,
        max: float = 1.0,
        step: float = 0.01,
        default_value: float = 0.5,  # noqa: ARG003
        steps: str = "[0.0, 0.25, 0.5, 0.75, 1.0]",
        default_step_index: int = 2,  # noqa: ARG003
        base_value: float = 100.0,
        pct_min: float = -50.0,
        pct_max: float = 50.0,
        default_pct: float = 0.0,  # noqa: ARG003
        shape: str = "circle",  # noqa: ARG003
        toggle_style: str = "switch",  # noqa: ARG003
        default_state: bool = True,  # noqa: ARG003
        button_mode: str = "increase",  # noqa: ARG003
        button_style: str = "rounded",  # noqa: ARG003
        x_min: float = 0.0,
        x_max: float = 1.0,
        x_step: float = 0.01,
        x_default: float = 0.5,  # noqa: ARG003
        y_min: float = 0.0,
        y_max: float = 1.0,
        y_step: float = 0.01,
        y_default: float = 0.5,  # noqa: ARG003
        crosshair_visible: bool = True,  # noqa: ARG003
        grid_visible: bool = True,  # noqa: ARG003
        _normalized: float = 0.5,
        _state: bool = False,
        _x_normalized: float = 0.5,
        _y_normalized: float = 0.5,
    ) -> io.NodeOutput:
        """根据控件类型计算输出。"""
        ctype = ControlType(control_type)

        if ctype in (ControlType.KNOB, ControlType.FADER_H,
                     ControlType.FADER_V, ControlType.BUTTON):
            mode = ValueMode(value_mode)
            try:
                steps_list = parse_steps_json(steps)
            except ValueError:
                steps_list = [0.0, 1.0]
            result = compute_output(
                normalized=_normalized,
                mode=mode,
                out_min=min,
                out_max=max,
                steps=steps_list,
                base=base_value,
                pct_min=pct_min,
                pct_max=pct_max,
            )
            if mode == ValueMode.RANGE and step > 0:
                result = round(result / step) * step
            return io.NodeOutput(result, int(result), _state, 0.0, 0.0)

        if ctype == ControlType.TOGGLE:
            val = 1.0 if _state else 0.0
            return io.NodeOutput(val, int(val), _state, 0.0, 0.0)

        if ctype == ControlType.XY_PAD:
            x_val = map_range(_x_normalized, x_min, x_max)
            y_val = map_range(_y_normalized, y_min, y_max)
            if x_step > 0:
                x_val = round(x_val / x_step) * x_step
            if y_step > 0:
                y_val = round(y_val / y_step) * y_step
            return io.NodeOutput(0.0, 0, False, x_val, y_val)

        return io.NodeOutput(0.0, 0, False, 0.0, 0.0)
