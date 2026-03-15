"""
日期时间字符串节点模块
=======================

这个模块提供日期时间格式化字符串输出功能。
"""

from datetime import datetime

from comfy_api.latest import io


class XDateTimeString(io.ComfyNode):
    """
    日期时间字符串节点

    生成包含日期时间标识符的格式化字符串，用于链接给本身
    不支持日期标识符的节点作为文件名或其他用途。

    功能：
        - 支持自定义格式模板
        - 支持多种日期时间占位符 (%Y%, %m%, %d%, %H%, %M%, %S%)
        - 支持添加前缀和后缀
        - 实时生成当前日期时间字符串

    输入：
        format_template: 格式模板字符串 (STRING)
        prefix: 前缀字符串 (STRING)
        suffix: 后缀字符串 (STRING)

    输出：
        datetime_string: 格式化后的日期时间字符串 (STRING)

    Usage example:
        prefix="Image_",
        format_template="%Y%-%m%-%d%_%H%-%M%-%S%",
        suffix="_v1"
        Output: "Image_2026-01-14_143052_v1"

    支持的占位符：
        %Y% - 四位年份 (如：2026)
        %m% - 两位月份 (01-12)
        %d% - 两位日期 (01-31)
        %H% - 两位小时 (00-23)
        %M% - 两位分钟 (00-59)
        %S% - 两位秒数 (00-59)
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点的输入类型和约束"""
        return io.Schema(
            node_id="XDateTimeString",
            display_name="XDateTimeString",
            description=(
                "Generate a formatted string containing date and time "
                "identifiers for use in filenames or other purposes"
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            inputs=[
                io.String.Input(
                    "prefix",
                    default="",
                    tooltip="Prefix string, added before datetime",
                ),
                io.String.Input(
                    "format_template",
                    default="%Y%-%m%-%d%_%H%-%M%-%S%",
                    tooltip=(
                        "Datetime format template, supports: "
                        "%Y%(year), %m%(month), %d%(day), "
                        "%H%(hour), %M%(minute), %S%(second)"
                    ),
                ),
                io.String.Input(
                    "suffix",
                    default="",
                    tooltip="Suffix string, added after datetime",
                ),
            ],
            outputs=[
                io.String.Output(
                    "datetime_string",
                    tooltip="Formatted datetime string",
                ),
            ],
        )

    @classmethod
    def fingerprint_inputs(
        cls,
        prefix: str,
        format_template: str,
        suffix: str,
    ) -> float:
        """
        生成输入指纹，确保每次执行都生成新的时间戳

        由于日期时间是实时变化的，返回当前时间戳作为指纹
        确保节点不会缓存结果
        """
        import time

        return time.time()

    @classmethod
    def execute(
        cls,
        prefix: str,
        format_template: str,
        suffix: str,
    ) -> io.NodeOutput:
        """
        生成日期时间字符串

        Args:
            prefix: 前缀字符串
            format_template: 日期时间格式模板
            suffix: 后缀字符串

        Returns:
            NodeOutput: 包含格式化后的完整字符串
        """
        # 替换日期时间占位符
        datetime_str = cls._replace_datetime_placeholders(format_template)

        # 组合前缀、日期时间字符串和后缀
        result = f"{prefix}{datetime_str}{suffix}"

        return io.NodeOutput(result)

    @classmethod
    def _replace_datetime_placeholders(cls, text: str) -> str:
        """
        替换日期时间标识符

        Args:
            text: 包含日期时间标识符的文本

        Returns:
            替换后的文本
        """
        if not text:
            return ""

        now = datetime.now()

        replacements = {
            "%Y%": now.strftime("%Y"),
            "%m%": now.strftime("%m"),
            "%d%": now.strftime("%d"),
            "%H%": now.strftime("%H"),
            "%M%": now.strftime("%M"),
            "%S%": now.strftime("%S"),
        }

        result = text
        for placeholder, value in replacements.items():
            result = result.replace(placeholder, value)

        return result
