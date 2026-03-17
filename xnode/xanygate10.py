"""
十路任意类型开关门控节点模块
============================

这个模块提供 10 路 MatchType 输入输出与递归输出能力。
"""

from typing import Any

from comfy_api.latest import io


class XAnyGate10(io.ComfyNode):
    """
    十路任意类型开关门控节点

    设计目标：
        1. 每一路都可单独开关控制是否输出
        2. 输入输出使用 MatchType，自动保持类型一致
        3. 提供递归输出，从第 1 路向后寻找首个有效值
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点输入输出与约束。"""
        template_1 = io.MatchType.Template("gate_1")
        template_2 = io.MatchType.Template("gate_2")
        template_3 = io.MatchType.Template("gate_3")
        template_4 = io.MatchType.Template("gate_4")
        template_5 = io.MatchType.Template("gate_5")
        template_6 = io.MatchType.Template("gate_6")
        template_7 = io.MatchType.Template("gate_7")
        template_8 = io.MatchType.Template("gate_8")
        template_9 = io.MatchType.Template("gate_9")
        template_10 = io.MatchType.Template("gate_10")
        recursive_template = io.MatchType.Template("recursive_gate")

        return io.Schema(
            node_id="XAnyGate10",
            display_name="XAnyGate10",
            description=(
                "10-channel MatchType gate node with per-channel switches "
                "and recursive output using customizable channel order."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            inputs=[
                io.MatchType.Input(
                    "input_1",
                    template=template_1,
                    optional=True,
                    tooltip="Channel 1 input (optional MatchType input)",
                ),
                io.MatchType.Input(
                    "input_2",
                    template=template_2,
                    optional=True,
                    tooltip="Channel 2 input (optional MatchType input)",
                ),
                io.MatchType.Input(
                    "input_3",
                    template=template_3,
                    optional=True,
                    tooltip="Channel 3 input (optional MatchType input)",
                ),
                io.MatchType.Input(
                    "input_4",
                    template=template_4,
                    optional=True,
                    tooltip="Channel 4 input (optional MatchType input)",
                ),
                io.MatchType.Input(
                    "input_5",
                    template=template_5,
                    optional=True,
                    tooltip="Channel 5 input (optional MatchType input)",
                ),
                io.MatchType.Input(
                    "input_6",
                    template=template_6,
                    optional=True,
                    tooltip="Channel 6 input (optional MatchType input)",
                ),
                io.MatchType.Input(
                    "input_7",
                    template=template_7,
                    optional=True,
                    tooltip="Channel 7 input (optional MatchType input)",
                ),
                io.MatchType.Input(
                    "input_8",
                    template=template_8,
                    optional=True,
                    tooltip="Channel 8 input (optional MatchType input)",
                ),
                io.MatchType.Input(
                    "input_9",
                    template=template_9,
                    optional=True,
                    tooltip="Channel 9 input (optional MatchType input)",
                ),
                io.MatchType.Input(
                    "input_10",
                    template=template_10,
                    optional=True,
                    tooltip="Channel 10 input (optional MatchType input)",
                ),
                io.Boolean.Input(
                    "enable_1",
                    default=True,
                    tooltip="Enable channel 1 output",
                ),
                io.Boolean.Input(
                    "enable_2",
                    default=True,
                    tooltip="Enable channel 2 output",
                ),
                io.Boolean.Input(
                    "enable_3",
                    default=True,
                    tooltip="Enable channel 3 output",
                ),
                io.Boolean.Input(
                    "enable_4",
                    default=True,
                    tooltip="Enable channel 4 output",
                ),
                io.Boolean.Input(
                    "enable_5",
                    default=True,
                    tooltip="Enable channel 5 output",
                ),
                io.Boolean.Input(
                    "enable_6",
                    default=True,
                    tooltip="Enable channel 6 output",
                ),
                io.Boolean.Input(
                    "enable_7",
                    default=True,
                    tooltip="Enable channel 7 output",
                ),
                io.Boolean.Input(
                    "enable_8",
                    default=True,
                    tooltip="Enable channel 8 output",
                ),
                io.Boolean.Input(
                    "enable_9",
                    default=True,
                    tooltip="Enable channel 9 output",
                ),
                io.Boolean.Input(
                    "enable_10",
                    default=True,
                    tooltip="Enable channel 10 output",
                ),
                io.Boolean.Input(
                    "enable_recursive",
                    default=True,
                    tooltip=(
                        "Enable recursive output lookup using recursive_order"
                    ),
                ),
                io.String.Input(
                    "recursive_order",
                    default="1-2-3-4-5-6-7-8-9-10",
                    tooltip=(
                        "Recursive channel order list using '-' separator "
                        "(example: 1-3-5-7-9 or 5-9-3-7-1)"
                    ),
                ),
            ],
            outputs=[
                io.MatchType.Output(
                    template=template_1,
                    display_name="output_1",
                ),
                io.MatchType.Output(
                    template=template_2,
                    display_name="output_2",
                ),
                io.MatchType.Output(
                    template=template_3,
                    display_name="output_3",
                ),
                io.MatchType.Output(
                    template=template_4,
                    display_name="output_4",
                ),
                io.MatchType.Output(
                    template=template_5,
                    display_name="output_5",
                ),
                io.MatchType.Output(
                    template=template_6,
                    display_name="output_6",
                ),
                io.MatchType.Output(
                    template=template_7,
                    display_name="output_7",
                ),
                io.MatchType.Output(
                    template=template_8,
                    display_name="output_8",
                ),
                io.MatchType.Output(
                    template=template_9,
                    display_name="output_9",
                ),
                io.MatchType.Output(
                    template=template_10,
                    display_name="output_10",
                ),
                io.MatchType.Output(
                    template=recursive_template,
                    display_name="recursive_output",
                ),
            ],
        )

    @classmethod
    def _resolve_channel_value(
        cls,
        enabled: bool,
        input_value: Any = None,
    ) -> Any:
        """
        解析单路输出值。

        说明：
            关闭或未连接都返回 None，用于保持与 bypass 相同行为。
        """
        if not enabled:
            return None
        if input_value is None:
            return None
        return input_value

    @classmethod
    def _resolve_recursive_output(
        cls,
        enable_recursive: bool,
        recursive_order: str,
        outputs: list[Any],
    ) -> Any:
        """
        解析递归输出。

        说明：
            递归开关关闭时直接返回 None；
            开启后按 recursive_order 从左到右返回首个非 None 值。
        """
        if not enable_recursive:
            return None

        ordered_indexes = cls._parse_recursive_order(recursive_order)
        for ordered_index in ordered_indexes:
            output_value = outputs[ordered_index]
            if output_value is not None:
                return output_value
        return None

    @classmethod
    def _parse_recursive_order(cls, recursive_order: str) -> list[int]:
        """
        解析递归顺序字符串并返回 0-based 索引列表。

        规则：
            1. 格式必须为数字通过 '-' 连接
            2. 仅允许 1~10
            3. 不允许重复数字
            4. 不允许空片段
        """
        if recursive_order is None:
            raise ValueError("recursive_order format is invalid")

        normalized = recursive_order.strip()
        if not normalized:
            raise ValueError("recursive_order format is invalid")

        parts = normalized.split("-")
        ordered_indexes: list[int] = []
        seen_channels: set[int] = set()

        for part in parts:
            item = part.strip()
            if not item:
                raise ValueError("recursive_order format is invalid")
            if not item.isdigit():
                raise ValueError("recursive_order format is invalid")

            channel_number = int(item)
            if channel_number < 1 or channel_number > 10:
                raise ValueError("recursive_order channel must be 1-10")
            if channel_number in seen_channels:
                raise ValueError("recursive_order contains duplicate channel")

            seen_channels.add(channel_number)
            ordered_indexes.append(channel_number - 1)

        return ordered_indexes

    @classmethod
    def execute(
        cls,
        input_1: Any = None,
        input_2: Any = None,
        input_3: Any = None,
        input_4: Any = None,
        input_5: Any = None,
        input_6: Any = None,
        input_7: Any = None,
        input_8: Any = None,
        input_9: Any = None,
        input_10: Any = None,
        enable_1: bool = True,
        enable_2: bool = True,
        enable_3: bool = True,
        enable_4: bool = True,
        enable_5: bool = True,
        enable_6: bool = True,
        enable_7: bool = True,
        enable_8: bool = True,
        enable_9: bool = True,
        enable_10: bool = True,
        enable_recursive: bool = True,
        recursive_order: str = "1-2-3-4-5-6-7-8-9-10",
    ) -> io.NodeOutput:
        """
        执行十路开关门控与递归输出。

        工作流程：
            1. 逐路根据开关和输入值生成 output_1 到 output_10
            2. 根据递归开关决定是否计算 recursive_output
            3. 返回 11 个输出（10 路输出 + 递归输出）
        """
        output_1 = cls._resolve_channel_value(enable_1, input_1)
        output_2 = cls._resolve_channel_value(enable_2, input_2)
        output_3 = cls._resolve_channel_value(enable_3, input_3)
        output_4 = cls._resolve_channel_value(enable_4, input_4)
        output_5 = cls._resolve_channel_value(enable_5, input_5)
        output_6 = cls._resolve_channel_value(enable_6, input_6)
        output_7 = cls._resolve_channel_value(enable_7, input_7)
        output_8 = cls._resolve_channel_value(enable_8, input_8)
        output_9 = cls._resolve_channel_value(enable_9, input_9)
        output_10 = cls._resolve_channel_value(enable_10, input_10)

        outputs = [
            output_1,
            output_2,
            output_3,
            output_4,
            output_5,
            output_6,
            output_7,
            output_8,
            output_9,
            output_10,
        ]
        recursive_output = cls._resolve_recursive_output(
            enable_recursive,
            recursive_order,
            outputs,
        )

        return io.NodeOutput(
            output_1,
            output_2,
            output_3,
            output_4,
            output_5,
            output_6,
            output_7,
            output_8,
            output_9,
            output_10,
            recursive_output,
        )
