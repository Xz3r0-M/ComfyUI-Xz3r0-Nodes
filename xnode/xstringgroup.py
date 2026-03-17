"""
字符串分组节点模块
==================

这个模块提供多字符串分组和选择功能。
"""

from comfy_api.latest import io


class XStringGroup(io.ComfyNode):
    """
    字符串分组节点

    将多个字符串按照指定的分隔方法组合在一起，
    同时支持选择其中一个字符串单独输出。

    功能：
        - 支持最多 5 个字符串输入
        - 支持多种分隔方法（无、换行、空格、逗号等）
        - 可选择输出特定字符串
        - 同时输出组合字符串和所有原始字符串

    输入：
        select_string: 选择要输出的字符串编号 (COMBO: 1-5)
        string_1: 第一个字符串 (STRING)
        separation_method_1_2: 字符串 1 和 2 之间的分隔方法 (COMBO)
        string_2: 第二个字符串 (STRING)
        separation_method_2_3: 字符串 2 和 3 之间的分隔方法 (COMBO)
        string_3: 第三个字符串 (STRING)
        separation_method_3_4: 字符串 3 和 4 之间的分隔方法 (COMBO)
        string_4: 第四个字符串 (STRING)
        separation_method_4_5: 字符串 4 和 5 之间的分隔方法 (COMBO)
        string_5: 第五个字符串 (STRING)

    输出：
        total_string: 组合后的完整字符串
        selected_string: 根据 select_string 选择的字符串
        string_1-5: 原始字符串 1-5

    Usage example:
        string_1="Hello"
        separation_method_1_2="space"
        string_2="World"
        select_string="2"
        Output total_string: "Hello World"
        Output selected_string: "World"
    """

    SEPARATION_METHOD_OPTIONS = [
        "none",
        "newline",
        "space",
        "comma",
        "comma_space",
        "period",
        "period_space",
    ]

    SELECT_STRING_OPTIONS = ["1", "2", "3", "4", "5"]

    SEPARATION_METHOD_MAP = {
        "none": "",
        "newline": "\n",
        "space": " ",
        "comma": ",",
        "comma_space": ", ",
        "period": ".",
        "period_space": ". ",
    }

    @classmethod
    def _resolve_separation_method(cls, method_name: str) -> str:
        """
        将前端分隔选项解析为实际分隔符。

        这里主动校验输入，避免工作流数据异常时直接抛出底层
        KeyError，让前端拿到更稳定、可理解的英文错误。
        """
        separator = cls.SEPARATION_METHOD_MAP.get(method_name)
        if separator is None:
            raise ValueError(f"Invalid separation method: {method_name}")
        return separator

    @classmethod
    def _resolve_selected_string(
        cls,
        select_string: str,
        strings: list[str],
    ) -> str:
        """
        解析用户选择的字符串编号。

        这里统一拦截非法编号，避免出现 ValueError 或 IndexError
        这类不友好的底层异常文本。
        """
        try:
            selected_index = int(select_string) - 1
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"Invalid select_string value: {select_string}"
            ) from exc

        if selected_index < 0 or selected_index >= len(strings):
            raise ValueError(f"Invalid select_string value: {select_string}")

        return strings[selected_index]

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点的输入类型和约束"""
        return io.Schema(
            node_id="XStringGroup",
            display_name="XStringGroup",
            description=(
                "Group multiple strings with customizable separation "
                "methods and select one to output"
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            inputs=[
                io.Combo.Input(
                    "select_string",
                    options=cls.SELECT_STRING_OPTIONS,
                    default="1",
                    tooltip="Select which string to output (1-5)",
                ),
                io.String.Input(
                    "string_1",
                    multiline=True,
                    default="",
                    tooltip="First multiline string input",
                ),
                io.Combo.Input(
                    "separation_method_1_2",
                    options=cls.SEPARATION_METHOD_OPTIONS,
                    default="none",
                    tooltip=(
                        "Separation method between String 1 and "
                        "String 2 (none: '', newline: \\n, space: ' ', "
                        "comma: ',', comma_space: ', ', period: '.', "
                        "period_space: '. ')"
                    ),
                ),
                io.String.Input(
                    "string_2",
                    multiline=True,
                    default="",
                    tooltip="Second multiline string input",
                ),
                io.Combo.Input(
                    "separation_method_2_3",
                    options=cls.SEPARATION_METHOD_OPTIONS,
                    default="none",
                    tooltip=(
                        "Separation method between String 2 and "
                        "String 3 (none: '', newline: \\n, space: ' ', "
                        "comma: ',', comma_space: ', ', period: '.', "
                        "period_space: '. ')"
                    ),
                ),
                io.String.Input(
                    "string_3",
                    multiline=True,
                    default="",
                    tooltip="Third multiline string input",
                ),
                io.Combo.Input(
                    "separation_method_3_4",
                    options=cls.SEPARATION_METHOD_OPTIONS,
                    default="none",
                    tooltip=(
                        "Separation method between String 3 and "
                        "String 4 (none: '', newline: \\n, space: ' ', "
                        "comma: ',', comma_space: ', ', period: '.', "
                        "period_space: '. ')"
                    ),
                ),
                io.String.Input(
                    "string_4",
                    multiline=True,
                    default="",
                    tooltip="Fourth multiline string input",
                ),
                io.Combo.Input(
                    "separation_method_4_5",
                    options=cls.SEPARATION_METHOD_OPTIONS,
                    default="none",
                    tooltip=(
                        "Separation method between String 4 and "
                        "String 5 (none: '', newline: \\n, space: ' ', "
                        "comma: ',', comma_space: ', ', period: '.', "
                        "period_space: '. ')"
                    ),
                ),
                io.String.Input(
                    "string_5",
                    multiline=True,
                    default="",
                    tooltip="Fifth multiline string input",
                ),
            ],
            outputs=[
                io.String.Output(
                    "total_string",
                    tooltip="Output of all grouped strings "
                    "(with separation methods)",
                ),
                io.String.Output(
                    "selected_string",
                    tooltip="Selected string output based on select_string",
                ),
                io.String.Output(
                    "string_1",
                    tooltip="Original output of String 1",
                ),
                io.String.Output(
                    "string_2",
                    tooltip="Original output of String 2",
                ),
                io.String.Output(
                    "string_3",
                    tooltip="Original output of String 3",
                ),
                io.String.Output(
                    "string_4",
                    tooltip="Original output of String 4",
                ),
                io.String.Output(
                    "string_5",
                    tooltip="Original output of String 5",
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        select_string: str,
        string_1: str,
        separation_method_1_2: str,
        string_2: str,
        separation_method_2_3: str,
        string_3: str,
        separation_method_3_4: str,
        string_4: str,
        separation_method_4_5: str,
        string_5: str,
    ) -> io.NodeOutput:
        """
        执行字符串分组和选择

        Args:
            select_string: 选择的字符串编号
            string_1: 字符串 1
            separation_method_1_2: 分隔方法 1-2
            string_2: 字符串 2
            separation_method_2_3: 分隔方法 2-3
            string_3: 字符串 3
            separation_method_3_4: 分隔方法 3-4
            string_4: 字符串 4
            separation_method_4_5: 分隔方法 4-5
            string_5: 字符串 5

        Returns:
            NodeOutput: 包含组合字符串、选中字符串和所有原始字符串
        """
        sm_1_2 = cls._resolve_separation_method(separation_method_1_2)
        sm_2_3 = cls._resolve_separation_method(separation_method_2_3)
        sm_3_4 = cls._resolve_separation_method(separation_method_3_4)
        sm_4_5 = cls._resolve_separation_method(separation_method_4_5)

        grouped_string = (
            string_1
            + sm_1_2
            + string_2
            + sm_2_3
            + string_3
            + sm_3_4
            + string_4
            + sm_4_5
            + string_5
        )

        strings = [string_1, string_2, string_3, string_4, string_5]
        selected_string = cls._resolve_selected_string(
            select_string,
            strings,
        )

        return io.NodeOutput(
            grouped_string,
            selected_string,
            string_1,
            string_2,
            string_3,
            string_4,
            string_5,
        )
