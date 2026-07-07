"""
XPrimitiveCombo 节点模块 (V3 API)
================================

桥接任意节点的 COMBO widget 控件，将其选中值作为 STRING 输出，
同时保持对被桥接控件的反向控制（类 PrimitiveNode 行为）。

架构：Python 后端持有隐藏的 bridge_value widget + STRING 输出；
前端扩展负责动态创建匹配目标 widget 的控件并双向同步值。
"""

from __future__ import annotations

from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger
except ImportError:
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)


class XPrimitiveCombo(io.ComfyNode):
    """
    XPrimitiveCombo — 桥接 COMBO widget 并输出 STRING。

    前端行为（web/xprimitive_extension.js）：
        1. 在节点上添加第二个输出端口 (type=*) 作为桥接端口
        2. 连接到目标节点的 widget 输入时，读取目标配置并动态创建匹配控件
        3. 控件值变化 → 同步到目标 widget + 写回 bridge_value 隐藏 widget
        4. Python execute() 读取 bridge_value → 通过 STRING 输出传给下游

    Python 后端职责：
        - 持有隐藏的 bridge_value widget（前端写入，Python 读取）
        - 通过 STRING 输出将当前选中值传给下游节点
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="XPrimitiveCombo",
            display_name="XPrimitiveCombo",
            description=(
                "Bridge to any node's widget input and output the "
                "selected value as a STRING. Connect the BRIDGE "
                "output to a target widget, then use the STRING "
                "output downstream."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            inputs=[
                io.String.Input(
                    "bridge_value",
                    default="",
                    socketless=True,
                    extra_dict={"hidden": True},
                    tooltip="Internal: synced from bridged widget selection",
                ),
            ],
            outputs=[
                io.String.Output(
                    "STRING",
                    tooltip="The selected widget value as a string",
                ),
            ],
        )

    @classmethod
    def execute(cls, bridge_value: str = "") -> io.NodeOutput:
        """返回当前桥接选中值的字符串表示。"""
        LOGGER.debug("XPrimitiveCombo execute bridge_value=%r", bridge_value)
        return io.NodeOutput(str(bridge_value))


def NODE_CLASS_MAPPINGS():
    return [XPrimitiveCombo]
