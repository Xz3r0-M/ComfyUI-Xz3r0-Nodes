"""
Mathematical operation node module
================

This module contains mathematical calculation related nodes.
"""

import math
from typing import Tuple, Optional


class XMath:
    """
    XMath 数学计算节点

    提供基础数学运算功能，支持双输出格式（整数+浮点数）。

    运算方式:
        - 加法 (+): a + b
        - 减法 (-): a - b
        - 乘法 (×): a × b
        - 除法 (÷): a ÷ b (处理除零错误)
        - 幂运算 (**): a 的 b 次方
        - 取模 (%): a % b (处理除零错误)
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
        input_a=10, input_b=3.2, use_input_a=True, use_input_b=True, operation="Multiplication (×)"
        Output: int_result=32, float_result=32.0
    """

    @classmethod
    def INPUT_TYPES(cls) -> dict:
        """定义节点的输入类型和约束"""
        return {
            "optional": {
                "input_a": ("INT,FLOAT", {
                    "default": 0.0,
                    "min": -1e10,
                    "max": 1e10,
                    "display": "number",
                    "tooltip": "input value A (accepts both INT and FLOAT, takes priority when use_input_a is enabled)"
                }),
                "input_b": ("INT,FLOAT", {
                    "default": 0.0,
                    "min": -1e10,
                    "max": 1e10,
                    "display": "number",
                    "tooltip": "input value B (accepts both INT and FLOAT, takes priority when use_input_b is enabled)"
                }),
            },
            "required": {
                "basic_a": ("FLOAT", {
                    "default": 0.0,
                    "min": -1e10,
                    "max": 1e10,
                    "step": 0.1,
                    "display": "number",
                    "tooltip": "basic value A (FLOAT)"
                }),
                "basic_b": ("FLOAT", {
                    "default": 0.0,
                    "min": -1e10,
                    "max": 1e10,
                    "step": 0.1,
                    "display": "number",
                    "tooltip": "basic value B (FLOAT)"
                }),
                "operation": ([
                    "Addition (+)",
                    "Subtraction (-)",
                    "Multiplication (×)",
                    "Division (÷)",
                    "Power (**)",
                    "Modulo (%)",
                    "Maximum",
                    "Minimum"
                ], {
                    "default": "Addition (+)",
                    "tooltip": "Mathematical operation type"
                }),
                "use_input_a": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "use input value A (input_a takes precedence when enabled)"
                }),
                "use_input_b": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "use input value B (input_b takes precedence when enabled)"
                }),
                "swap_ab": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "swap a and b values"
                })
            }
        }

    RETURN_TYPES = ("INT", "FLOAT")
    RETURN_NAMES = ("int_result", "float_result")
    OUTPUT_TOOLTIPS = ("Integer result (truncated decimal part towards zero)", "Float result (exact value with decimal)")
    FUNCTION = "calculate"
    CATEGORY = "♾️ Xz3r0/Tools"

    def calculate(self, operation: str, basic_a: float = 0.0, basic_b: float = 0.0, input_a: Optional[float] = None, input_b: Optional[float] = None, use_input_a: bool = True, use_input_b: bool = True, swap_ab: bool = False) -> Tuple[int, float]:
        """
        执行数学计算

        Args:
            operation: 计算方式 (下拉菜单选择)
            basic_a: 基础第一个数值 (FLOAT)
            basic_b: 基础第二个数值 (FLOAT)
            input_a: 接收的第一个数值 (INT/FLOAT, 可选)
            input_b: 接收的第二个数值 (INT/FLOAT, 可选)
            use_input_a: 是否优先使用 input_a (BOOLEAN, 默认True)
            use_input_b: 是否优先使用 input_b (BOOLEAN, 默认True)
            swap_ab: 是否交换 a 和 b 的值 (BOOLEAN, 默认False)

        Returns:
            (int_result, float_result): 整数结果(截断)和浮点数结果(精确)
        """
        # 运算映射表
        operations = {
            "Addition (+)": lambda x, y: x + y,
            "Subtraction (-)": lambda x, y: x - y,
            "Multiplication (×)": lambda x, y: x * y,
            "Division (÷)": self._safe_divide,
            "Power (**)": self._safe_power,
            "Modulo (%)": self._safe_modulo,
            "Maximum": max,
            "Minimum": min,
        }

        # 获取计算函数
        calc_func = operations.get(operation)

        if calc_func is None:
            raise ValueError(f"Unknown operation: {operation}")

        # 优先级逻辑：根据各自的开关决定是否使用 input
        # 注意：在 ComfyUI 中，未连接的输入端口会使用 INPUT_TYPES 中定义的默认值（0.0）
        if use_input_a:
            a = input_a if isinstance(input_a, float) else float(input_a)
        else:
            a = basic_a
            
        if use_input_b:
            b = input_b if isinstance(input_b, float) else float(input_b)
        else:
            b = basic_b

        # 交换 a 和 b 的值
        if swap_ab:
            a, b = b, a

        # 执行计算
        try:
            result = calc_func(a, b)
        except ZeroDivisionError:
            raise ValueError("Division by zero")
        except OverflowError:
            # 根据运算类型和操作数符号确定溢出结果
            if operation in ["Multiplication (×)", "Power (**)"]:
                # 乘法：同号为正，异号为负
                # 幂运算：偶指数为正，奇指数同底数符号
                sign_positive = False
                if operation == "Multiplication (×)":
                    sign_positive = (a > 0 and b > 0) or (a < 0 and b < 0)
                else:  # Power
                    if a > 0:
                        sign_positive = True
                    elif b > 0 and int(b) % 2 == 0:
                        sign_positive = True
                return (0, float('inf') if sign_positive else float('-inf'))
            else:
                # 其他运算，简单判断
                return (0, float('inf') if (a > 0 or b > 0) else float('-inf'))
        except ValueError as e:
            raise ValueError(f"Calculation error: {str(e)}")

        # 验证结果有效性
        if math.isnan(result):
            raise ValueError("Calculation resulted in NaN")
        if not math.isfinite(result):
            raise ValueError("Cannot convert infinite result to integer")

        # 返回双格式结果
        return (int(result), float(result))

    def _safe_divide(self, a: float, b: float) -> float:
        """
        安全除法，处理除零情况

        Args:
            a: 被除数
            b: 除数

        Returns:
            除法结果，特殊情况下返回inf或0
        """
        if b == 0:
            if a == 0:
                return 0.0  # 0/0 情况，返回0
            elif a > 0:
                return float('inf')  # 正数/0
            else:
                return float('-inf')  # 负数/0
        return a / b

    def _safe_modulo(self, a: float, b: float) -> float:
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

    def _safe_power(self, a: float, b: float) -> float:
        """
        安全幂运算，处理边界情况

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
        # 检查负底数的指数是否为整数（考虑浮点数精度）
        if a < 0:
            # 使用 math.isclose 检查是否接近整数，避免浮点数精度问题
            if not (math.isclose(b, round(b), rel_tol=1e-9, abs_tol=1e-9)):
                raise ValueError("Negative base with non-integer exponent produces complex result")
        try:
            return a ** b
        except OverflowError:
            return float('inf') if a > 0 else float('-inf')

