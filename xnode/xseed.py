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

    使用原生 seed 输入和原生生成控件，并在输出阶段按
    位数上限做截断或可选补零处理。
    """

    MAX_DIGITS = 20

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点输入输出模式。"""
        max_seed = (2**64) - 1
        return io.Schema(
            node_id="XSeed",
            display_name="XSeed",
            description=(
                "Generate non-negative seed value with native seed control, "
                "then apply max-digit truncation and optional zero padding"
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            inputs=[
                io.Int.Input(
                    "digits",
                    default=20,
                    min=1,
                    max=cls.MAX_DIGITS,
                    step=1,
                    display_mode=io.NumberDisplay.number,
                    tooltip=(
                        "Max digit limit for output seed "
                        "(1 to 20 digits)"
                    ),
                ),
                io.Boolean.Input(
                    "pad_to_limit",
                    default=False,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip=(
                        "Pad trailing zeros to reach the digit limit when "
                        "seed length is below the limit. Since random seeds "
                        "in the 64-bit range are usually high-digit values, "
                        "this option is rarely triggered in practice."
                    ),
                ),
                io.Int.Input(
                    "seed_value",
                    default=1,
                    min=0,
                    max=max_seed,
                    step=1,
                    control_after_generate=True,
                    display_mode=io.NumberDisplay.number,
                    tooltip=(
                        "Base non-negative seed value. "
                        "Control-after-generate is enabled."
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
        pad_to_limit: bool = False,
        seed_value: int = 1,
    ) -> io.NodeOutput:
        """执行种子生成。"""
        normalized_digits = cls._normalize_digits(digits)
        normalized_seed = cls._normalize_seed(
            seed_value=seed_value,
            digit_limit=normalized_digits,
            pad_to_limit=pad_to_limit,
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
        pad_to_limit: bool,
    ) -> int:
        """按位数上限规则归一化种子。"""
        if not isinstance(seed_value, int):
            raise ValueError("seed_value must be an integer")
        if seed_value < 0:
            raise ValueError("seed_value must be non-negative")

        seed_text = str(seed_value)
        seed_len = len(seed_text)

        if seed_len > digit_limit:
            normalized_text = seed_text[:digit_limit]
        elif seed_len < digit_limit and pad_to_limit:
            normalized_text = seed_text + ("0" * (digit_limit - seed_len))
        else:
            normalized_text = seed_text
        return int(normalized_text)

