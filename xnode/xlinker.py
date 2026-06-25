"""
XLinker 连线显隐透传节点
========================

提供一路任意类型透传 + 用户自由笔记文本，并在节点 widget 区提供
4 态连线显隐切换按钮（不隐藏 / 仅隐藏输入线 / 仅隐藏输出线 / 全部隐藏）。

连线隐藏为纯前端特性，后端不参与。
"""

from typing import Any

from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger
except ImportError:  # pragma: no cover - 包外脚本运行兜底
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)


class XLinker(io.ComfyNode):
    """
    透传节点，携带用户笔记。

    输入（可选任意类型）直通输出；多行文本控件留存用户备注。
    widget 区按钮可单独隐藏输入/输出连线，便于整理复杂工作流。
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        template = io.MatchType.Template(
            "linker_slot",
            allowed_types=[io.AnyType],
        )

        return io.Schema(
            node_id="XLinker",
            display_name="XLinker",
            description=(
                "Passthrough node with a note text area. One any-type "
                "input passes directly to one any-type output. A node widget "
                "button toggles link visibility: show all, hide input links "
                "only, hide output links only, or hide both."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            inputs=[
                io.MatchType.Input(
                    "any_input",
                    template=template,
                    optional=True,
                    tooltip=(
                        "Input (any type). "
                        "Passed through to the output unchanged."
                    ),
                ),
                io.String.Input(
                    "note_text",
                    default="",
                    multiline=True,
                    tooltip=(
                        "Freeform note text. Use this to annotate the "
                        "workflow — the value is ignored during execution."
                    ),
                ),
            ],
            outputs=[
                io.MatchType.Output(
                    template=template,
                    display_name="any_output",
                    tooltip="Passthrough output (same data type as input).",
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        any_input: Any = None,
        note_text: str = "",
    ) -> io.NodeOutput:
        """透传输入值，笔记文本不参与计算。"""
        return io.NodeOutput(any_input)
