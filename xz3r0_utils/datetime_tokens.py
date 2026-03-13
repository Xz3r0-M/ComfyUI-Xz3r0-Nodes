"""
日期时间标识符替换工具
======================

这个模块只负责将字符串中的日期时间标识符替换为当前时间。
"""

import re
from datetime import datetime

DATETIME_TOKEN_PATTERN = re.compile(r"%(Y|m|d|H|M|S)%")
DATETIME_TOKEN_FORMATS = {
    "%Y%": "%Y",
    "%m%": "%m",
    "%d%": "%d",
    "%H%": "%H",
    "%M%": "%M",
    "%S%": "%S",
}


def replace_datetime_tokens(text: str) -> str:
    """
    替换日期时间标识符

    支持的标识符:
    - %Y%: 年份(4位)
    - %m%: 月份(01-12)
    - %d%: 日期(01-31)
    - %H%: 小时(00-23)
    - %M%: 分钟(00-59)
    - %S%: 秒(00-59)

    Args:
        text: 包含日期时间标识符的文本

    Returns:
        替换后的文本
    """
    if not text:
        return ""

    now = datetime.now()

    # 先生成本次调用的替换表，避免在每次匹配时重复格式化时间。
    replacements = {
        token: now.strftime(format_str)
        for token, format_str in DATETIME_TOKEN_FORMATS.items()
    }

    def replace_match(match: re.Match[str]) -> str:
        """
        使用已生成的替换表，避免重复计算相同时间片段。
        """
        placeholder = match.group()
        return replacements.get(placeholder, placeholder)

    return DATETIME_TOKEN_PATTERN.sub(replace_match, text)
