"""
控制面板节点模块。

提供无需输入/输出端口的即时操作面板。
"""

from comfy_api.latest import io


class XControlPanel(io.ComfyNode):
    """XControlPanel 纯面板节点。"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义无输入/无输出的控制面板节点。"""
        return io.Schema(
            node_id="XControlPanel",
            display_name="XControlPanel",
            description=(
                "Panel-only control node for immediate ComfyUI actions. "
                "Currently provides a manual restart button."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            is_output_node=False,
            not_idempotent=True,
            inputs=[],
            outputs=[],
        )

    @classmethod
    def execute(cls) -> io.NodeOutput:
        """面板操作由前端按钮触发，工作流执行时不产生输出。"""
        return io.NodeOutput()
