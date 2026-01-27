"""
数学运算节点模块
================

这个模块包含数学计算相关的节点。
"""

from typing import Tuple


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
        a: 第一个数值 (FLOAT)
        b: 第二个数值 (FLOAT)
        operation: 计算方式 (下拉菜单选择)

    输出:
        int_result: 整数结果，截断小数部分（向零取整）
        float_result: 浮点数结果，保留精确值

    Usage example:
        a=10.5, b=3.2, operation="Multiplication (×)"
        Output: int_result=33, float_result=33.6
    """

    @classmethod
    def INPUT_TYPES(cls) -> dict:
        """定义节点的输入类型和约束"""
        return {
            "required": {
                "a": ("FLOAT", {
                    "default": 0.0,
                    "min": -1e10,
                    "max": 1e10,
                    "step": 0.1,
                    "display": "number",
                    "tooltip": "First input value"
                }),
                "b": ("FLOAT", {
                    "default": 0.0,
                    "min": -1e10,
                    "max": 1e10,
                    "step": 0.1,
                    "display": "number",
                    "tooltip": "Second input value"
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
                })
            }
        }

    RETURN_TYPES = ("INT", "FLOAT")
    RETURN_NAMES = ("int_result", "float_result")
    OUTPUT_TOOLTIPS = ("Integer result (truncated decimal part towards zero)", "Float result (exact value with decimal)")
    FUNCTION = "calculate"
    CATEGORY = "♾️ Xz3r0/Tools"

    def calculate(self, a: float, b: float, operation: str) -> Tuple[int, float]:
        """
        执行数学计算

        Args:
            a: 第一个数值
            b: 第二个数值
            operation: 计算方式

        Returns:
            (int_result, float_result): 整数结果(截断)和浮点数结果(精确)
        """
        # 运算映射表
        operations = {
            "Addition (+)": lambda x, y: x + y,
            "Subtraction (-)": lambda x, y: x - y,
            "Multiplication (×)": lambda x, y: x * y,
            "Division (÷)": self._safe_divide,
            "Power (**)": lambda x, y: x ** y,
            "Modulo (%)": self._safe_modulo,
            "Maximum": max,
            "Minimum": min,
        }

        # 获取计算函数
        calc_func = operations.get(operation)

        if calc_func is None:
            raise ValueError("Unknown operation")

        # 执行计算
        try:
            result = calc_func(a, b)
        except Exception as e:
            raise ValueError("Calculation error")

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

