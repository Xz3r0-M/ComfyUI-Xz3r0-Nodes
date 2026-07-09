"""
XPrimitiveCombo 节点模块 (V3 API)
================================

桥接任意节点的 COMBO widget 控件，将其选中值作为 STRING 输出，
同时保持对被桥接控件的反向控制（类 PrimitiveNode 行为）。

架构：Python 后端持有隐藏的 combo_string widget + STRING + COMBO 双输出；
COMBO 输出使用通配类型（*），前端覆盖为 "COMBO" 以仅限 COMBO 连接。
前端扩展负责动态创建匹配目标 widget 的控件并双向同步值。
"""

from __future__ import annotations

from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger
except ImportError:
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)

# COMBO 输出使用通配类型（*），前端覆盖为 "COMBO" 以仅限 COMBO 连接。
_ComboWildcard = io.Custom("*")


class XPrimitiveCombo(io.ComfyNode):
    """
    XPrimitiveCombo — 桥接 COMBO widget 并输出 STRING。

    前端行为（web/xprimitive_extension.js）：
        1. COMBO 输出端口（slot 0）连接目标 COMBO widget 时动态创建匹配控件
        2. 控件值变化 → 同步到目标 widget + 写回 combo_string 隐藏 widget
        3. Python execute() 读取 combo_string → STRING + COMBO 双输出

    Python 后端职责：
        - 持有隐藏的 combo_string widget（前端写入，Python 读取）
        - 通过 STRING 输出传给下游节点
        - 通过 COMBO 输出将值注入目标 widget 输入
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="XPrimitiveCombo",
            display_name="XPrimitiveCombo",
            description=(
                "Bridge to any node's COMBO widget input and output "
                "the selected value as a STRING. Connect the COMBO "
                "output to a target widget, then use the STRING "
                "output downstream."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            inputs=[
                io.String.Input(
                    "combo_string",
                    default="",
                    socketless=True,
                    extra_dict={"hidden": True},
                    tooltip="Internal: synced from target widget selection",
                ),
            ],
            outputs=[
                _ComboWildcard.Output(
                    "COMBO",
                    tooltip=(
                        "Connect to a target node's COMBO widget to "
                        "pass the selected value"
                    ),
                ),
                io.String.Output(
                    "STRING",
                    tooltip="The selected widget value as a string",
                ),
            ],
        )

    @classmethod
    def execute(cls, combo_string: str = "") -> io.NodeOutput:
        """返回当前选中值（双输出：COMBO + STRING）。"""
        LOGGER.debug("XPrimitiveCombo execute combo_string=%r", combo_string)
        value = str(combo_string)
        return io.NodeOutput(value, value)


def NODE_CLASS_MAPPINGS():
    return [XPrimitiveCombo]
