"""
列表创建节点模块
================

基于 ComfyUI 官方 CreateList，额外输出列表元素数量（从 1 开始计数）。
搭配 XListPull 使用，通过数量值驱动输出端口动态展开。
"""

from __future__ import annotations

from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger
except ImportError:
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)

# 最大输入槽数，与 XListPull 输出端口数保持一致
_MAX_SLOTS = 20


class XListCreate(io.ComfyNode):
    """
    XListCreate — 创建列表并输出元素数量。

    与官方 CreateList 类似，通过 Autogrow 动态增加输入端口，
    将所有输入合并为一个列表输出。额外输出一个 INT 类型的
    "count" 值（1-based），供 XListPull 动态展开输出端口。
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        template_matchtype = io.MatchType.Template("type")
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
                "Create a list from multiple inputs and output "
                "the element count (1-based). Pair with XListPull "
                "to split the list back into individual outputs."
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
                    tooltip="Combined list of all inputs",
                ),
                io.Int.Output(
                    display_name="count",
                    tooltip=(
                        "Number of elements in the list (1-based). "
                        "Connect to XListPull to control its output "
                        "port expansion."
                    ),
                ),
            ],
        )

    @classmethod
    def execute(cls, inputs: io.Autogrow.Type) -> io.NodeOutput:
        """合并所有输入为列表，同时输出元素数量。"""
        output_list = []
        for input_data in inputs.values():
            if input_data is not None:
                output_list += input_data
        count = len(output_list)
        LOGGER.debug(
            "XListCreate list built with %d elements", count
        )
        return io.NodeOutput(output_list, count)
