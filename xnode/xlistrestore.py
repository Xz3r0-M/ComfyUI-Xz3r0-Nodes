"""列表结构还原节点模块
====================

按 XListCreate 输出的 slot_map，将稠密 list 散射回含 None 占位的稀疏 list。
"""

from __future__ import annotations

from typing import Any

from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger
except ImportError:
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)

XListSlotMapIO = io.Custom("xlist_slot_map")
_MAX_SLOTS = 50  # 与 XListCreate._MAX_SLOTS / XListPull._MAX_OUTPUTS 一致


class XListRestore(io.ComfyNode):
    """按 slot_map 将稠密 list 还原为稀疏 list（空位 None）。"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        # 与 XListCreate / XListPull 一致：list 元素类型通过 MatchType 透传
        template = io.MatchType.Template(
            "list_element",
            allowed_types=[io.AnyType],
        )
        return io.Schema(
            node_id="XListRestore",
            display_name="XListRestore",
            description=(
                "Scatter a dense list back into a sparse list using "
                "slot_map from XListCreate. Empty slots are None "
                "(same as a disabled gate channel). Connect the sparse "
                "list + count to XListPull or XListToPipe if needed."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            is_input_list=True,
            inputs=[
                io.MatchType.Input(
                    "list_input",
                    template=template,
                    tooltip=(
                        "Dense list to scatter. Usually XListCreate "
                        "list output (optionally after batch processing). "
                        "Element type matches the connected list."
                    ),
                ),
                XListSlotMapIO.Input(
                    "slot_map",
                    tooltip=(
                        "Structure map from XListCreate.slot_map "
                        "(indices + width). Not media data."
                    ),
                ),
            ],
            outputs=[
                io.MatchType.Output(
                    template=template,
                    display_name="list",
                    is_output_list=True,
                    tooltip=(
                        "Sparse list with None in empty slots. "
                        "Length equals count (slot_map width). "
                        "Element type matches list_input."
                    ),
                ),
                io.Int.Output(
                    display_name="count",
                    tooltip=(
                        "Sparse width from slot_map. Connect to "
                        "XListPull / XListToPipe for port expansion."
                    ),
                ),
            ],
        )

    @classmethod
    def execute(cls, list_input: Any, slot_map: Any) -> io.NodeOutput:
        """按 slot_map 将稠密 list 散射为稀疏 list（空位 None）。"""
        if isinstance(list_input, (list, tuple)):
            items = list(list_input)
        elif list_input is None:
            items = []
        else:
            items = [list_input]

        if isinstance(slot_map, list):
            slot_map = slot_map[0] if slot_map else None

        if not (
            isinstance(slot_map, dict)
            and slot_map.get("__xlist_slot_map__") is True
            and slot_map.get("__xlist_slot_map_version__") == 1
        ):
            raise ValueError(
                "slot_map must be a valid xlist_slot_map from XListCreate"
            )

        indices = slot_map["indices"]
        if not isinstance(indices, list):
            raise ValueError(
                "slot_map must be a valid xlist_slot_map from XListCreate"
            )

        width = max(0, min(int(slot_map["width"]), _MAX_SLOTS))
        if width == 0:
            return io.NodeOutput([], 0)

        if len(items) != len(indices):
            raise ValueError(
                "list length must match slot_map indices length"
            )

        sparse: list[Any] = [None] * width
        for item, slot in zip(items, indices, strict=True):
            s = int(slot)
            if s < 1 or s > width:
                raise ValueError(
                    f"slot index {s} out of range for width {width}"
                )
            sparse[s - 1] = item

        LOGGER.debug(
            "XListRestore scattered %d items into width %d",
            len(items),
            width,
        )
        return io.NodeOutput(sparse, width)
