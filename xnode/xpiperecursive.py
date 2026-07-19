"""从 XPipe_v2 数据束中按可配置顺序返回首个有效值。"""

from typing import Any

from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger
except ImportError:  # pragma: no cover - 包外脚本运行兜底
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)

PIPE_SLOTS = 50
XPipeV2Bundle = io.Custom("xpipe_v2")
DEFAULT_RECURSIVE_ORDER = "-".join(
    str(index) for index in range(1, PIPE_SLOTS + 1)
)


class XPipeRecursive(io.ComfyNode):
    """按可配置递归顺序返回 XPipe_v2 数据束中的首个有效值。"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义数据束输入、空字符串策略、递归顺序和任意类型输出。"""
        return io.Schema(
            node_id="XPipeRecursive",
            display_name="XPipeRecursive",
            description=(
                "Return the first non-None value from an XPipe_v2 bundle "
                "using a customizable recursive slot order."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            inputs=[
                XPipeV2Bundle.Input(
                    "xpipe_in",
                    tooltip=(
                        "XPipe_v2 bundle scanned by recursive_order "
                        f"(slots 1-{PIPE_SLOTS})"
                    ),
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
                io.String.Input(
                    "recursive_order",
                    default=DEFAULT_RECURSIVE_ORDER,
                    tooltip=(
                        "Recursive slot order list using '-' separator "
                        f"(example: 1-3-5 or 50-1-2). Only 1-{PIPE_SLOTS} "
                        "is allowed and duplicates are forbidden."
                    ),
                ),
            ],
            outputs=[
                io.AnyType.Output(
                    "recursive_output",
                    display_name="recursive_output",
                    tooltip=(
                        "First accepted value found by recursive_order "
                        f"from slots 1-{PIPE_SLOTS}"
                    ),
                ),
            ],
        )

    @classmethod
    def _parse_recursive_order(cls, recursive_order: str) -> list[int]:
        """
        解析递归顺序字符串并返回 0-based 索引列表。

        规则：
            1. 格式必须为数字通过 '-' 连接
            2. 仅允许 1~PIPE_SLOTS
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
        seen_slots: set[int] = set()

        for part in parts:
            item = part.strip()
            if not item:
                raise ValueError("recursive_order format is invalid")
            if not item.isdigit():
                raise ValueError("recursive_order format is invalid")

            slot_number = int(item)
            if slot_number < 1 or slot_number > PIPE_SLOTS:
                raise ValueError(
                    f"recursive_order slot must be 1-{PIPE_SLOTS}"
                )
            if slot_number in seen_slots:
                raise ValueError("recursive_order contains duplicate slot")

            seen_slots.add(slot_number)
            ordered_indexes.append(slot_number - 1)

        return ordered_indexes

    @classmethod
    def _is_rejected(cls, value: Any, empty_string_as_none: bool) -> bool:
        """判断值是否应跳过并继续扫描。"""
        if value is None:
            return True
        return bool(
            empty_string_as_none
            and isinstance(value, str)
            and value == ""
        )

    @classmethod
    def execute(
        cls,
        xpipe_in: Any,
        empty_string_as_none: bool = False,
        recursive_order: str = DEFAULT_RECURSIVE_ORDER,
    ) -> io.NodeOutput:
        """校验数据束，并按 recursive_order 返回首个有效值。"""
        if not (
            isinstance(xpipe_in, dict)
            and xpipe_in.get("__xpipe_v2_bundle__") is True
            and xpipe_in.get("__xpipe_v2_version__") == 2
        ):
            raise ValueError("xpipe_in must be a valid XPipe_v2 bundle")

        values = xpipe_in.get("values")
        if not isinstance(values, list):
            values = []
        padded = list(values[:PIPE_SLOTS])
        padded += [None] * (PIPE_SLOTS - len(padded))

        for index in cls._parse_recursive_order(recursive_order):
            value = padded[index]
            if cls._is_rejected(value, empty_string_as_none):
                continue
            return io.NodeOutput(value)
        return io.NodeOutput(None)
