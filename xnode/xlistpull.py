"""
列表数据拆分节点模块
====================

将列表（XListCreate 等节点产生的列表输出）按元素逐个拆分到
独立输出端口。端口数量由上游 count 值或手动设置的 count_display 动态控制。
"""

from __future__ import annotations

from typing import Any

from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger
except ImportError:
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)

# 最大输出端口数，与 XListCreate 的 Autogrow max 保持一致
_MAX_OUTPUTS = 20


class XListPull(io.ComfyNode):
    """
    XListPull — 将列表按数据拆分到独立输出端口。

    接收上游列表输出（如 XListCreate），每个列表数据输出到对应
    编号的端口（Data 1 ~ Data N）。数量值可通过手动输入的
    count_display 设置，也可通过 count 端口从上游节点连接获取。
    前端扩展根据数量值动态显示/隐藏输出端口。
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        template = io.MatchType.Template("type")

        # 动态生成固定数量的输出端口
        output_ports = []
        for i in range(1, _MAX_OUTPUTS + 1):
            output_ports.append(
                io.MatchType.Output(
                    template=template,
                    display_name=f"Data {i}",
                    tooltip=(
                        f"Data {i} from the list "
                        f"(only active when count >= {i})"
                    ),
                ),
            )

        return io.Schema(
            node_id="XListPull",
            display_name="XListPull",
            description=(
                "Split a list into individual output ports. "
                "Connect from XListCreate (list + count), and "
                "each list item appears on its own output. "
                "Port visibility is controlled by the count value."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            is_input_list=True,
            inputs=[
                io.MatchType.Input(
                    "list_input",
                    template=template,
                    tooltip=(
                        "Input list. Connect a XListCreate or "
                        "any list-type output here."
                    ),
                ),
                # 手动输入的数量值（始终可见的 widget）
                io.Int.Input(
                    "count_display",
                    default=1,
                    min=1,
                    max=_MAX_OUTPUTS,
                    tooltip=(
                        "Number of active output ports. "
                        "When count port is connected, disabled; "
                        "when not connected, manually set here."
                    ),
                ),
                # 可连接的数量端口（force_input，无 widget）
                io.Int.Input(
                    "count",
                    default=0,
                    min=0,
                    max=_MAX_OUTPUTS,
                    force_input=True,
                    optional=True,
                    tooltip=(
                        "Number input port. Connect from another "
                        "node to auto-set the count. When not "
                        "connected, falls back to count_display."
                    ),
                ),
            ],
            outputs=output_ports,
        )

    @classmethod
    def execute(
        cls, list_input: Any, count_display: Any, count: Any
    ) -> io.NodeOutput:
        """
        将列表元素分发到对应编号的输出端口。

        is_input_list=True 时 list_input 为原始 Python list。
        count 来自 force_input 端口（已连接时来自上游，否则为 0）。
        count_display 为手动输入值（始终有效）。
        优先使用 count（若 > 0），否则回退到 count_display。
        """
        # 解包可能被列表包装的值，兼容 None（可选端口未连接）
        def _unwrap(v: Any) -> Any:
            if v is None:
                return 0
            if isinstance(v, list):
                return v[0] if v else 0
            return v

        cnt_raw = _unwrap(count)
        cnt = max(1, min(int(cnt_raw) if cnt_raw else 0, _MAX_OUTPUTS))
        if cnt == 0:
            cnt_disp = _unwrap(count_display)
            cnt = max(1, min(int(cnt_disp) or 1, _MAX_OUTPUTS))

        # 提取列表元素
        if isinstance(list_input, list):
            elements = list_input[:cnt]
        elif list_input is not None:
            elements = [list_input]
        else:
            elements = []

        # 用 None 补齐到固定输出数
        while len(elements) < _MAX_OUTPUTS:
            elements.append(None)

        LOGGER.debug(
            "XListPull split %d active elements (count=%d)",
            cnt,
            cnt,
        )
        return io.NodeOutput(*elements)
