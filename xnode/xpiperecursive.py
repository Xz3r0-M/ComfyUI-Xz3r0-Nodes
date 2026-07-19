"""从 XPipe_v2 数据束中返回首个有效值。"""

from typing import Any

from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger
except ImportError:  # pragma: no cover - 包外脚本运行兜底
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)

XPipeV2Bundle = io.Custom("xpipe_v2")


class XPipeRecursive(io.ComfyNode):
    """按槽位顺序返回 XPipe_v2 数据束中的首个有效值。"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义数据束输入、空字符串策略和任意类型输出。"""
        return io.Schema(
            node_id="XPipeRecursive",
            display_name="XPipeRecursive",
            description=(
                "Return the first non-None value from an XPipe_v2 bundle."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            inputs=[
                XPipeV2Bundle.Input(
                    "xpipe_in",
                    tooltip="XPipe_v2 bundle to scan from slot 1 to 50",
                ),
                io.Boolean.Input(
                    "empty_string_as_none",
                    default=False,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip=(
                        "Treat an exact empty string as None and continue "
                        "scanning"
                    ),
                ),
            ],
            outputs=[
                io.AnyType.Output(
                    "recursive_output",
                    display_name="recursive_output",
                    tooltip="First accepted value found from slot 1 to 50",
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        xpipe_in: Any,
        empty_string_as_none: bool = False,
    ) -> io.NodeOutput:
        """校验数据束，并按槽位顺序返回首个有效值。"""
        if not (
            isinstance(xpipe_in, dict)
            and xpipe_in.get("__xpipe_v2_bundle__") is True
            and xpipe_in.get("__xpipe_v2_version__") == 2
        ):
            raise ValueError("xpipe_in must be a valid XPipe_v2 bundle")

        values = xpipe_in.get("values")
        if not isinstance(values, list):
            values = []
        for value in values[:50]:
            if value is None:
                continue
            if (
                empty_string_as_none
                and isinstance(value, str)
                and value == ""
            ):
                continue
            return io.NodeOutput(value)
        return io.NodeOutput(None)
