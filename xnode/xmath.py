"""
Mathematical operation node module
================

This module contains mathematical calculation related nodes.
"""

import math

from comfy_api.latest import io


class XMath(io.ComfyNode):
    """
    XMath 数学计算节点

    提供基础数学运算功能，支持双输出格式（整数+浮点数）。

    运算方式:
        - 加法 (+): a + b
        - 减法 (-): a - b
        - 乘法 (×): a × b
        - 除法 (÷): a ÷ b
        - 幂运算 (**): a 的 b 次方
        - 取模 (%): a % b
        - 最大值: max(a, b)
        - 最小值: min(a, b)

    输入:
        operation: 计算方式 (下拉菜单选择)
        basic_a: 基础第一个数值 (FLOAT)
        basic_b: 基础第二个数值 (FLOAT)
        input_a: 接收的第一个数值 (INT/FLOAT, 可选，连接时优先使用)
        input_b: 接收的第二个数值 (INT/FLOAT, 可选，连接时优先使用)

    输出:
        int_result: 整数结果，截断小数部分（向零取整）
        float_result: 浮点数结果，保留精确值

    优先级逻辑:
        如果 use_input_a 为 True，则使用 input_a（如果未连接则为默认值 0.0）
        否则使用 basic_a
        同样的逻辑适用于 use_input_b、input_b 和 basic_b

    Usage example:
        input_a=10, input_b=3.2, use_input_a=True,
        use_input_b=True, operation="Multiplication (×)"
        Output: int_result=32, float_result=32.0
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点的输入类型和约束"""
        return io.Schema(
            node_id="XMath",
            display_name="XMath",
            description="数学计算节点，支持多种运算方式和双输出格式",
            category="♾️ Xz3r0/Workflow-Processing",
            inputs=[
                # 可选输入 - 接收其他节点的输出
                io.MultiType.Input(
                    "input_a",
                    types=[io.Int, io.Float],
                    tooltip=(
                        "input value A (accepts both INT and FLOAT, "
                        "takes priority when use_input_a is enabled)"
                    ),
                    optional=True,
                ),
                io.MultiType.Input(
                    "input_b",
                    types=[io.Int, io.Float],
                    tooltip=(
                        "input value B (accepts both INT and FLOAT, "
                        "takes priority when use_input_b is enabled)"
                    ),
                    optional=True,
                ),
                # 基础输入 - 手动设置的默认值
                io.Float.Input(
                    "basic_a",
                    default=0.0,
                    min=-1e10,
                    max=1e10,
                    step=0.1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="basic value A (FLOAT)",
                ),
                io.Float.Input(
                    "basic_b",
                    default=0.0,
                    min=-1e10,
                    max=1e10,
                    step=0.1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="basic value B (FLOAT)",
                ),
                # 运算类型选择
                io.Combo.Input(
                    "operation",
                    options=[
                        "Addition (+)",
                        "Subtraction (-)",
                        "Multiplication (×)",
                        "Division (÷)",
                        "Power (**)",
                        "Modulo (%)",
                        "Maximum",
                        "Minimum",
                    ],
                    default="Addition (+)",
                    tooltip="Mathematical operation type",
                ),
                # 控制开关
                io.Boolean.Input(
                    "use_input_a",
                    default=True,
                    tooltip=(
                        "use input value A (input_a takes "
                        "precedence when enabled, fallbacks "
                        "to basic_a if not connected to "
                        "other node)"
                    ),
                ),
                io.Boolean.Input(
                    "use_input_b",
                    default=True,
                    tooltip=(
                        "use input value B (input_b takes "
                        "precedence when enabled, fallbacks "
                        "to basic_b if not connected to "
                        "other node)"
                    ),
                ),
                io.Boolean.Input(
                    "swap_ab",
                    default=False,
                    tooltip="swap a and b values",
                ),
            ],
            outputs=[
                io.Int.Output(
                    "int_result",
                    tooltip=(
                        "Integer result (truncated decimal part towards zero)"
                    ),
                ),
                io.Float.Output(
                    "float_result",
                    tooltip="Float result (exact value with decimal)",
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        input_a: float | None = None,
        input_b: float | None = None,
        basic_a: float = 0.0,
        basic_b: float = 0.0,
        operation: str = "Addition (+)",
        use_input_a: bool = True,
        use_input_b: bool = True,
        swap_ab: bool = False,
    ) -> io.NodeOutput:
        """
        执行数学计算

        Args:
            input_a: 接收的第一个数值 (INT/FLOAT, 可选)
            input_b: 接收的第二个数值 (INT/FLOAT, 可选)
            basic_a: 基础第一个数值 (FLOAT)
            basic_b: 基础第二个数值 (FLOAT)
            operation: 计算方式 (下拉菜单选择)
            use_input_a: 是否优先使用 input_a (BOOLEAN, 默认True)
            use_input_b: 是否优先使用 input_b (BOOLEAN, 默认True)
            swap_ab: 是否交换 a 和 b 的值 (BOOLEAN, 默认False)

        Returns:
            NodeOutput: 包含整数结果(截断)和浮点数结果(精确)
        """
        # 运算映射表
        operations = {
            "Addition (+)": lambda x, y: x + y,
            "Subtraction (-)": lambda x, y: x - y,
            "Multiplication (×)": lambda x, y: x * y,
            "Division (÷)": cls._safe_divide,
            "Power (**)": cls._safe_power,
            "Modulo (%)": cls._safe_modulo,
            "Maximum": max,
            "Minimum": min,
        }

        # 获取计算函数
        calc_func = operations.get(operation)

        if calc_func is None:
            raise ValueError(f"Unknown operation: {operation}")

        # 优先级逻辑：根据各自的开关决定是否使用 input
        # 如果启用使用 input 但端口未连接（值为 None），则回退到 basic 值
        if use_input_a and input_a is not None:
            a = input_a if isinstance(input_a, float) else float(input_a)
        else:
            a = basic_a

        if use_input_b and input_b is not None:
            b = input_b if isinstance(input_b, float) else float(input_b)
        else:
            b = basic_b

        # 交换 a 和 b 的值
        if swap_ab:
            a, b = b, a

        # 执行计算，非法输入统一转换为明确英文错误
        try:
            result = calc_func(a, b)
        except ZeroDivisionError:
            raise ValueError("Division by zero") from None
        except OverflowError:
            raise ValueError("Calculation overflow") from None
        except ValueError as e:
            raise ValueError(f"Calculation error: {str(e)}") from None

        # 先拦住复数等非常规结果，避免后续数学函数直接抛出原始异常
        if isinstance(result, complex):
            raise ValueError("Complex results are not supported")

        # 验证结果有效性
        if math.isnan(result):
            raise ValueError("Calculation result is NaN")
        if not math.isfinite(result):
            raise ValueError("Calculation result is infinite")

        # 返回双格式结果
        return io.NodeOutput(int(result), float(result))

    @classmethod
    def _safe_divide(cls, a: float, b: float) -> float:
        """
        安全除法，遇到除零时直接报错

        Args:
            a: 被除数
            b: 除数

        Returns:
            除法结果

        Raises:
            ValueError: 当除数为零时
        """
        if b == 0:
            raise ValueError("Division by zero")
        return a / b

    @classmethod
    def _safe_modulo(cls, a: float, b: float) -> float:
        """
        安全取模，处理除零情况

        Args:
            a: 被取模数
            b: 模数

        Returns:
            取模结果

        Raises:
            ValueError: 当模数为零时
        """
        if b == 0:
            raise ValueError("Division by zero in modulo operation")
        return a % b

    @classmethod
    def _safe_power(cls, a: float, b: float) -> float:
        """
        安全幂运算，明确拒绝会产生复数或溢出的输入

        Args:
            a: 底数
            b: 指数

        Returns:
            幂运算结果

        Raises:
            ValueError: 当运算无效时（如 0 的负数次方）
        """
        if a == 0 and b < 0:
            raise ValueError("0 raised to negative power is undefined")

        # 负底数只允许整数指数，否则结果会落入复数域。
        if a < 0:
            if not float(b).is_integer():
                raise ValueError(
                    "Negative base with non-integer exponent "
                    "produces complex result"
                )
            b = int(b)

        try:
            return a**b
        except OverflowError:
            raise ValueError("Power operation overflow") from None
