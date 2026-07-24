"""
Seed 生成节点模块
=================

这个模块包含种子值生成节点。
"""

from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger
except ImportError:
    # 兼容直接执行测试脚本时从仓库根目录导入 xnode 的场景。
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)
XDataSeedType = io.Custom("xdata_seed")


class XSeed(io.ComfyNode):
    """
    XSeed 种子生成节点

    使用自定义前端控件管理种子值，并在输出阶段按
    位数上限做截断处理。随机生成、手动输入、
    执行时随机、复用上次种子值均由前端自定义组件处理。
    """

    MAX_DIGITS = 20

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点输入输出模式。"""
        return io.Schema(
            node_id="XSeed",
            display_name="XSeed",
            description=(
                "Generate non-negative seed value with custom seed UI, "
                "then apply max-digit truncation"
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            inputs=[
                io.Int.Input(
                    "digits",
                    default=10,
                    min=1,
                    max=cls.MAX_DIGITS,
                    step=1,
                    display_mode=io.NumberDisplay.number,
                    tooltip=(
                        "Max digit limit for output seed "
                        "(1 to 20 digits)"
                    ),
                ),
                io.String.Input(
                    "seed_string",
                    default="1",
                    socketless=True,
                    extra_dict={"hidden": True},
                    tooltip=(
                        "Internal: seed value from custom UI. "
                        "Written by the frontend extension."
                    ),
                ),
                io.String.Input(
                    "last_seed_string",
                    default="",
                    socketless=True,
                    extra_dict={"hidden": True},
                    tooltip=(
                        "Internal: last applied seed value. "
                        "Written by the frontend on execution."
                    ),
                ),
                io.Boolean.Input(
                    "random_on_execute",
                    default=False,
                    socketless=True,
                    extra_dict={"hidden": True},
                    tooltip=(
                        "Internal: random-on-execute toggle state. "
                        "Persisted across workflow saves."
                    ),
                ),
                io.Boolean.Input(
                    "last_seed_locked",
                    default=False,
                    socketless=True,
                    extra_dict={"hidden": True},
                    tooltip=(
                        "Internal: lock last-seed from being overwritten. "
                        "Persisted across workflow saves."
                    ),
                ),
            ],
            outputs=[
                io.Int.Output(
                    "seed_int",
                    tooltip="Final normalized non-negative seed integer",
                ),
                XDataSeedType.Output(
                    "xdata_seed",
                    tooltip="xdata_seed payload for downstream data saving",
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        digits: int = 20,
        seed_string: str = "1",
        last_seed_string: str = "",
        random_on_execute: bool = False,
        last_seed_locked: bool = False,
    ) -> io.NodeOutput:
        """执行种子生成。"""
        normalized_digits = cls._normalize_digits(digits)
        seed_value = cls._parse_seed_string(seed_string)
        normalized_seed = cls._normalize_seed(
            seed_value=seed_value,
            digit_limit=normalized_digits,
        )

        payload = {
            "data_type": "seed",
            "seed": normalized_seed,
            "digits": normalized_digits,
            "source": "XSeed",
        }
        LOGGER.debug(
            "XSeed generated seed=%s digits=%s",
            normalized_seed,
            normalized_digits,
        )
        return io.NodeOutput(normalized_seed, payload)

    @classmethod
    def _parse_seed_string(cls, seed_string: str) -> int:
        """将前端传入的种子字符串解析为整数。"""
        if not isinstance(seed_string, str):
            raise ValueError("seed_string must be a string")
        stripped = seed_string.strip()
        if not stripped:
            raise ValueError("seed_string must not be empty")
        if not stripped.isdigit():
            raise ValueError("seed_string must be a non-negative integer")
        return int(stripped)

    @classmethod
    def _normalize_digits(cls, digits: int) -> int:
        """校验并返回有效位数。"""
        if not isinstance(digits, int):
            raise ValueError("digits must be an integer")
        if digits < 1 or digits > cls.MAX_DIGITS:
            raise ValueError("digits must be between 1 and 20")
        return digits

    @classmethod
    def _normalize_seed(
        cls,
        seed_value: int,
        digit_limit: int,
    ) -> int:
        """按位数上限规则截断种子。"""
        if not isinstance(seed_value, int):
            raise ValueError("seed_value must be an integer")
        if seed_value < 0:
            raise ValueError("seed_value must be non-negative")

        seed_text = str(seed_value)
        seed_len = len(seed_text)

        if seed_len > digit_limit:
            normalized_text = seed_text[:digit_limit]
        else:
            normalized_text = seed_text
        return int(normalized_text)
