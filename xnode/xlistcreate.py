"""
列表创建节点模块
================

基于 ComfyUI 官方 CreateList，额外输出列表元素数量（从 1 开始计数）。
搭配 XListPull 使用，通过数量值驱动输出端口动态展开。
输出 slot_map 供 XListRestore 按原输入槽位还原稀疏 list。
"""

from __future__ import annotations

import re
from typing import Any

from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger
except ImportError:
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)

# 最大输入槽数，与 XListPull 输出端口数保持一致
_MAX_SLOTS = 50

XListSlotMapIO = io.Custom("xlist_slot_map")
_SLOT_KEY_RE = re.compile(r"^input(\d+)$")


def _parse_slot_index(key: str, fallback_i: int) -> tuple[int, int]:
    """返回 (slot_1based, next_fallback_i)。

    可解析 ``inputN`` → (N, fallback_i 不变)；
    否则用遍历序号兜底 → (fallback_i+1, fallback_i+1)。
    """
    if isinstance(key, str):
        m = _SLOT_KEY_RE.match(key)
        if m:
            return int(m.group(1)), fallback_i
    nxt = fallback_i + 1
    return nxt, nxt


class XListCreate(io.ComfyNode):
    """
    XListCreate — 创建稠密列表并输出元素数量与 slot_map。

    与官方 CreateList 类似，通过 Autogrow 动态增加输入端口，
    将所有非 None 输入合并为稠密列表输出。额外输出 INT 类型的
    "count"（稠密长度）与 slot_map（供 XListRestore 还原稀疏槽位）。
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        template_matchtype = io.MatchType.Template(
            "list_element",
            allowed_types=[io.AnyType],
        )
        template_autogrow = io.Autogrow.TemplateNames(
            input=io.MatchType.Input(
                "input",
                template=template_matchtype,
                tooltip="Connect any data to add it to the list",
            ),
            names=[f"input{i}" for i in range(1, _MAX_SLOTS + 1)],
        )
        return io.Schema(
            node_id="XListCreate",
            display_name="XListCreate",
            description=(
                "Create a dense list from multiple inputs (None "
                "elements skipped), output the dense count, and a "
                "slot_map for restoring original input positions. "
                "Pair with XListPull for dense split, or XListRestore "
                "to scatter back with None placeholders."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            is_input_list=True,
            search_aliases=["Image Iterator", "Text Iterator",
                             "Iterator", "List Builder"],
            inputs=[
                io.Autogrow.Input(
                    "inputs",
                    template=template_autogrow,
                    tooltip="Connect inputs to add them to the list",
                ),
            ],
            outputs=[
                io.MatchType.Output(
                    template=template_matchtype,
                    is_output_list=True,
                    display_name="list",
                    tooltip=(
                        "Dense list of all non-None input elements "
                        "(MatchType, same as inputs). Length equals "
                        "count."
                    ),
                ),
                io.Int.Output(
                    display_name="count",
                    tooltip=(
                        "Number of elements in the dense list. "
                        "Connect to XListPull to control output "
                        "port expansion."
                    ),
                ),
                XListSlotMapIO.Output(
                    display_name="slot_map",
                    tooltip=(
                        "Structure only (no media). Maps each dense "
                        "list index to a 1-based XListCreate input "
                        "slot and records width. Connect to "
                        "XListRestore to rebuild a sparse list with "
                        "None in empty slots."
                    ),
                ),
            ],
        )

    @classmethod
    def execute(cls, inputs: io.Autogrow.Type) -> io.NodeOutput:
        """合并非 None 输入为稠密 list，并输出 slot_map。"""
        output_list: list[Any] = []
        indices: list[int] = []
        width = 0
        fallback_i = 0

        for key, input_data in inputs.items():
            slot, fallback_i = _parse_slot_index(key, fallback_i)
            width = max(width, slot)
            if input_data is None:
                continue
            items = (
                list(input_data)
                if isinstance(input_data, (list, tuple))
                else [input_data]
            )
            for item in items:
                if item is not None:
                    output_list.append(item)
                    indices.append(slot)

        count = len(output_list)
        slot_map = {
            "__xlist_slot_map__": True,
            "__xlist_slot_map_version__": 1,
            "indices": indices,
            "width": width,
        }
        LOGGER.debug(
            "XListCreate dense list built with %d elements (width=%d)",
            count,
            width,
        )
        return io.NodeOutput(output_list, count, slot_map)
