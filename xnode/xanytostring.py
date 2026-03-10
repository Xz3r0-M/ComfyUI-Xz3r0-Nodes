"""
任意数据转字符串节点模块
========================

这个模块提供将任意输入数据转换为字符串的节点。
"""

from typing import Any

from comfy_api.latest import io


class XAnyToString(io.ComfyNode):
    """
    任意数据转字符串节点

    将任意类型输入转换为字符串输出，同时保留原始数据透传。

    功能:
        - 接收任意类型输入
        - 使用 Python 原生 str() 转换为字符串
        - 同时输出原始数据，方便继续连接下游节点

    输入:
        anything: 任意输入类型 (ANY)

    输出:
        anything: 原始输入数据 (ANY)
        string: 转换后的字符串 (STRING)

    Usage example:
        anything=123
        Output anything: 123
        Output string: "123"
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点的输入类型和约束"""
        return io.Schema(
            node_id="XAnyToString",
            display_name="XAnyToString",
            description=(
                "Convert any input data to a string using Python str() "
                "while also passing the original data through"
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            inputs=[
                io.AnyType.Input(
                    "anything",
                    tooltip=(
                        "Any input type to convert into a string using "
                        "Python str()"
                    ),
                ),
            ],
            outputs=[
                io.AnyType.Output(
                    "anything",
                    tooltip="Original input data passed through unchanged",
                ),
                io.String.Output(
                    "string",
                    tooltip="String converted from the input using str()",
                ),
            ],
        )

    @classmethod
    def execute(cls, anything: Any) -> io.NodeOutput:
        """
        执行任意数据转字符串

        Args:
            anything: 任意输入数据

        Returns:
            NodeOutput: 包含原始输入和转换后的字符串
        """
        string_value = str(anything)
        return io.NodeOutput(anything, string_value)
