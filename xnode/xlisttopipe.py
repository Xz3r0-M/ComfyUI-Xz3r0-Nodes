"""
列表转 XPipe_v2 数据束节点
==========================

将 ComfyUI list 数据展开为合法 XPipe_v2 管道束。
列表元素映射到槽位 1..N（最多 50），其余槽位为 None，名称为空字符串。
数量由 count 端口 / count_display 控制（与 XListPull 一致）。
"""

from __future__ import annotations

from typing import Any

from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger
except ImportError:  # pragma: no cover - 包外脚本运行兜底
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)

XPipeV2Bundle = io.Custom("xpipe_v2")
PIPE_SLOTS = 50


class XListToPipe(io.ComfyNode):
    """将 list 展开为合法 XPipe_v2 数据束。"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        template = io.MatchType.Template(
            "list_element",
            allowed_types=[io.AnyType],
        )
        return io.Schema(
            node_id="XListToPipe",
            display_name="XListToPipe",
            description=(
                "Convert a list into a valid XPipe_v2 bundle. "
                "List items map to slots 1..N (max 50); remaining "
                "slots are None. Names are empty strings. Port count "
                "follows the count input (same pattern as XListPull)."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            is_input_list=True,
            inputs=[
                io.MatchType.Input(
                    "list_input",
                    template=template,
                    optional=True,
                    tooltip=(
                        "List to expand into XPipe_v2 slots. "
                        "Connect XListCreate list output or any "
                        "list-type wire. Leave unconnected for an "
                        "empty bundle."
                    ),
                ),
                io.Int.Input(
                    "count_display",
                    default=1,
                    min=1,
                    max=PIPE_SLOTS,
                    tooltip=(
                        "Number of active XPipe_v2 slots. "
                        "When count port is connected, disabled; "
                        "when not connected, manually set here."
                    ),
                ),
                io.Int.Input(
                    "count",
                    default=0,
                    min=0,
                    max=PIPE_SLOTS,
                    force_input=True,
                    optional=True,
                    tooltip=(
                        "Number input port. Connect from XListCreate "
                        "count (or any INT) to auto-set the slot count. "
                        "When not connected, falls back to count_display."
                    ),
                ),
            ],
            outputs=[
                XPipeV2Bundle.Output(
                    "xpipe_out",
                    display_name="xpipe_out",
                    tooltip=(
                        "Always a valid XPipe_v2 bundle: list items "
                        "in slots 1..N (truncated at 50), empty names, "
                        "None-padded. N is controlled by count."
                    ),
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        list_input: Any = None,
        count_display: Any = 1,
        count: Any = 0,
    ) -> io.NodeOutput:
        """将 list 按 count 展开为 50 槽合法 XPipe_v2 数据束。"""

        def _unwrap(value: Any) -> Any:
            if value is None:
                return 0
            if isinstance(value, list):
                return value[0] if value else 0
            return value

        cnt_raw = _unwrap(count)
        if cnt_raw:
            cnt = max(1, min(int(cnt_raw), PIPE_SLOTS))
        else:
            cnt_disp = _unwrap(count_display)
            cnt = max(1, min(int(cnt_disp) or 1, PIPE_SLOTS))

        if list_input is None:
            items: list[Any] = []
        elif isinstance(list_input, list):
            items = list_input
        elif isinstance(list_input, tuple):
            items = list(list_input)
        else:
            # 与 XListPull 一致：非序列单值包成单元素 list
            items = [list_input]

        # count 决定有效前缀长度；list 更短则后半仍为 None
        active = list(items[:cnt])
        values = active + [None] * (PIPE_SLOTS - len(active))
        names = [""] * PIPE_SLOTS
        xpipe_out = {
            "__xpipe_v2_bundle__": True,
            "__xpipe_v2_version__": 2,
            "values": values,
            "names": names,
        }
        LOGGER.debug(
            "XListToPipe built bundle with count=%d, list_len=%d",
            cnt,
            len(items),
        )
        return io.NodeOutput(xpipe_out)
