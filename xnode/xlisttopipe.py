"""
列表转 XPipe 数据束节点
======================

将 ComfyUI list 数据展开为合法 XPipe 管道束。
列表元素映射到槽位 1..N（最多 50），其余槽位为 None，名称为空字符串。
数量由 count 端口 / count_display 控制（与 XListPull 一致）。
"""

from __future__ import annotations

import re
from typing import Any

from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger
except ImportError:  # pragma: no cover - 包外脚本运行兜底
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)

XPipeBundle = io.Custom("xpipe")
PIPE_SLOTS = 50


class XListToPipe(io.ComfyNode):
    """将 list 展开为合法 XPipe 数据束。"""

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
                "Turn a list into an XPipe bundle so it can flow through "
                "the XPipe family. Items fill slots 1..N (up to 50); "
                "unused slots stay empty (None). The count input sets "
                "how many slots the bundle has. Connect the names input "
                "to give each slot a real name."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            is_input_list=True,
            inputs=[
                io.MatchType.Input(
                    "list_input",
                    template=template,
                    optional=True,
                    tooltip=(
                        "The list to put into the bundle. Connect "
                        "XListCreate's list output or any other list here. "
                        "Leave unconnected to create an empty bundle."
                    ),
                ),
                io.Int.Input(
                    "count_display",
                    default=1,
                    min=1,
                    max=PIPE_SLOTS,
                    tooltip=(
                        "How many slots the bundle has. Auto-disabled when "
                        "the count port is connected; otherwise set it "
                        "manually here."
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
                        "Sets how many slots the bundle has. Connect "
                        "XListCreate's count (or any number) here; leave "
                        "unconnected to use the number field above."
                    ),
                ),
                io.String.Input(
                    "names",
                    force_input=True,
                    optional=True,
                    tooltip=(
                        "Optional slot names, one per item, in the same "
                        "order as the list. Connect XMediaListGet's "
                        "image_names / video_names / audio_names so the "
                        "bundle carries real file names instead of blank "
                        "slots. Shorter than the list: the rest stay "
                        "blank. Leave unconnected for blank names."
                    ),
                ),
            ],
            outputs=[
                XPipeBundle.Output(
                    "xpipe_out",
                    display_name="xpipe_out",
                    tooltip=(
                        "The XPipe bundle holding your list items in slots "
                        "1..N (max 50). Empty slots are None. N follows "
                        "the count input."
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
        names: Any = None,
    ) -> io.NodeOutput:
        """将 list 按 count 展开为 50 槽合法 XPipe 数据束。"""

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
        slot_names = [""] * PIPE_SLOTS
        # 名字按位置对应：上游（例如 XMediaListGet 的 image_names）给几个
        # 就填几个，多的截掉、少的留空。不接这个口就全是空名字，和以前
        # 一模一样。
        for index, name in enumerate(cls._split_names(names)[:cnt]):
            text = str(name or "").strip()
            if text:
                slot_names[index] = text
        xpipe_out = {
            "__xpipe_bundle__": True,
            "__xpipe_version__": 1,
            "values": values,
            "names": slot_names,
        }
        LOGGER.debug(
            "XListToPipe built bundle with count=%d, list_len=%d",
            cnt,
            len(items),
        )
        return io.NodeOutput(xpipe_out)

    @staticmethod
    def _split_names(value: Any) -> list[str]:
        """把 names 输入摊平成一串名字。

        三种形状都认：连接来的列表（直接就是 `["a.png", "b.png"]`）、
        包了一层的批量列表（`[["a.png", "b.png"]]`）、以及一行一个的纯
        字符串。认不出来就当没给。
        """
        if value is None:
            return []
        if isinstance(value, str):
            return [
                part.strip()
                for part in re.split(r"[\r\n]+", value)
                if part.strip()
            ]
        if isinstance(value, (list, tuple)):
            flattened: list[str] = []
            for item in value:
                if isinstance(item, (list, tuple)):
                    flattened.extend(
                        str(sub) for sub in item if sub is not None
                    )
                elif item is not None:
                    flattened.append(str(item))
            return flattened
        return [str(value)]
