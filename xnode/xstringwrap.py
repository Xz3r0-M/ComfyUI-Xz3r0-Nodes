"""
字符串前后分隔包装节点模块
==========================

这个模块提供极简字符串包装功能。
"""

from comfy_api.latest import io

try:
    from .xstringgroup import XStringGroup
except ImportError:
    from xstringgroup import XStringGroup


class XStringWrap(io.ComfyNode):
    """
    XStringWrap 字符串包装节点

    按照前后分隔生效策略，将输入文本进行包装并输出。

    处理流程：
        1. 检查节点开关，关闭则输出空字符串
        2. 检查文本是否为空，空则输出空字符串
        3. 解析前后分隔符和生效模式
        4. 拼接并输出结果字符串
    """

    APPLY_MODE_OPTIONS = [
        "both",
        "prefix_only",
        "suffix_only",
    ]

    @classmethod
    def _resolve_apply_mode(cls, apply_mode: str) -> str:
        """
        解析分隔生效模式并校验输入值。
        """
        if apply_mode not in cls.APPLY_MODE_OPTIONS:
            raise ValueError(f"Invalid apply mode: {apply_mode}")
        return apply_mode

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点的输入类型和约束"""
        return io.Schema(
            node_id="XStringWrap",
            display_name="XStringWrap",
            description=(
                "Wrap text with prefix/suffix separators using "
                "a simple apply mode"
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            inputs=[
                io.Boolean.Input(
                    "enabled",
                    default=True,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip="Enable output; if disabled, output is empty",
                ),
                io.Combo.Input(
                    "apply_mode",
                    options=cls.APPLY_MODE_OPTIONS,
                    default="both",
                    tooltip=(
                        "Separator apply mode (both: prefix+suffix, "
                        "prefix_only: only prefix, suffix_only: only suffix)"
                    ),
                ),
                io.Combo.Input(
                    "prefix_separator",
                    options=XStringGroup.SEPARATION_METHOD_OPTIONS,
                    default="none",
                    tooltip=(
                        "Prefix separator before text "
                        "(none/newline/space/comma/comma_space/"
                        "period/period_space)"
                    ),
                ),
                io.String.Input(
                    "text",
                    multiline=True,
                    default="",
                    tooltip="Main text to wrap",
                ),
                io.Combo.Input(
                    "suffix_separator",
                    options=XStringGroup.SEPARATION_METHOD_OPTIONS,
                    default="none",
                    tooltip=(
                        "Suffix separator after text "
                        "(none/newline/space/comma/comma_space/"
                        "period/period_space)"
                    ),
                ),
            ],
            outputs=[
                io.String.Output(
                    "wrapped_text",
                    tooltip="Wrapped string output",
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        enabled: bool,
        apply_mode: str,
        prefix_separator: str,
        text: str,
        suffix_separator: str,
    ) -> io.NodeOutput:
        """
        执行文本包装。

        说明：
            - 节点关闭时静默输出空字符串
            - 文本为空时静默输出空字符串
        """
        if not enabled:
            return io.NodeOutput("")

        if text == "":
            return io.NodeOutput("")

        resolved_mode = cls._resolve_apply_mode(apply_mode)
        prefix = XStringGroup._resolve_separation_method(prefix_separator)
        suffix = XStringGroup._resolve_separation_method(suffix_separator)

        if resolved_mode == "both":
            result = f"{prefix}{text}{suffix}"
        elif resolved_mode == "prefix_only":
            result = f"{prefix}{text}"
        else:
            result = f"{text}{suffix}"

        return io.NodeOutput(result)
