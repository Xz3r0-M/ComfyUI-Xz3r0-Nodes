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

    使用示例:
        a=10.5, b=3.2, operation="乘法 (×)"
        输出: int_result=33, float_result=33.6
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
                    "tooltip": "第一个输入数值"
                }),
                "b": ("FLOAT", {
                    "default": 0.0,
                    "min": -1e10,
                    "max": 1e10,
                    "step": 0.1,
                    "display": "number",
                    "tooltip": "第二个输入数值"
                }),
                "operation": ([
                    "加法 (+)",
                    "减法 (-)",
                    "乘法 (×)",
                    "除法 (÷)",
                    "幂运算 (**)",
                    "取模 (%)",
                    "最大值",
                    "最小值"
                ], {
                    "default": "加法 (+)",
                    "tooltip": "选择计算方式"
                })
            }
        }

    RETURN_TYPES = ("INT", "FLOAT")
    RETURN_NAMES = ("int_result", "float_result")
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
            "加法 (+)": lambda x, y: x + y,
            "减法 (-)": lambda x, y: x - y,
            "乘法 (×)": lambda x, y: x * y,
            "除法 (÷)": self._safe_divide,
            "幂运算 (**)": lambda x, y: x ** y,
            "取模 (%)": self._safe_modulo,
            "最大值": max,
            "最小值": min,
        }

        # 获取计算函数
        calc_func = operations.get(operation)

        if calc_func is None:
            raise ValueError(f"未知的运算方式: {operation}")

        # 执行计算
        try:
            result = calc_func(a, b)
        except Exception as e:
            raise ValueError(f"计算错误 ({operation}): {str(e)}")

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
            raise ValueError("取模运算中除数不能为零")
        return a % b


# 节点类映射（用于本地测试）
if __name__ == "__main__":
    print("XMath 节点已加载")
    print(f"节点分类: {XMath.CATEGORY}")
    print(f"输入类型: {XMath.INPUT_TYPES()}")
    print(f"输出类型: {XMath.RETURN_TYPES}")

    # 测试用例
    print("\n=== 测试用例 ===")
    node = XMath()

    # 测试1: 加法
    int_result, float_result = node.calculate(10.5, 3.2, "加法 (+)")
    print(f"测试1 - 加法: 10.5 + 3.2 = {float_result} (整数: {int_result})")

    # 测试2: 乘法（验证截断）
    int_result, float_result = node.calculate(10.5, 3.2, "乘法 (×)")
    print(f"测试2 - 乘法: 10.5 × 3.2 = {float_result} (整数: {int_result}, 截断验证)")

    # 测试3: 除法
    int_result, float_result = node.calculate(10.0, 3.0, "除法 (÷)")
    print(f"测试3 - 除法: 10.0 ÷ 3.0 = {float_result:.4f} (整数: {int_result})")

    # 测试4: 幂运算
    int_result, float_result = node.calculate(2.5, 3.0, "幂运算 (**)")
    print(f"测试4 - 幂运算: 2.5 ^ 3.0 = {float_result} (整数: {int_result})")

    # 测试5: 最大值
    int_result, float_result = node.calculate(5.7, 8.3, "最大值")
    print(f"测试5 - 最大值: max(5.7, 8.3) = {float_result} (整数: {int_result})")

    # 测试6: 最小值
    int_result, float_result = node.calculate(5.7, 8.3, "最小值")
    print(f"测试6 - 最小值: min(5.7, 8.3) = {float_result} (整数: {int_result})")

    # 测试7: 负数截断（验证向零取整）
    int_result, float_result = node.calculate(-5.7, 2.0, "乘法 (×)")
    print(f"测试7 - 负数截断: -5.7 × 2.0 = {float_result} (整数: {int_result}, 向零取整验证)")

    print("\n✅ 所有测试完成！")
