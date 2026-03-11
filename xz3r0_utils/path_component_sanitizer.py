"""
保存路径组件清理工具
====================

这个模块只负责清理文件名前缀或子文件夹名这类路径组件中的
危险内容，避免路径遍历和多级路径注入。
"""

import re

PATH_COMPONENT_DANGEROUS_CHARS = [
    "\\",
    "/",
    "..",
    ".",
    "|",
    ":",
    "*",
    "?",
    '"',
    "<",
    ">",
    "\n",
    "\r",
    "\t",
    "\x00",
    "\x0b",
    "\x0c",
]
PATH_COMPONENT_UNDERSCORE_PATTERN = re.compile(r"_+")


def sanitize_path_component(path_str: str) -> str:
    """
    清理路径组件，防止遍历攻击并禁用多级目录

    将所有危险字符和路径分隔符替换为下划线，
    确保只保留安全的单级名称。

    Args:
        path_str: 原始路径或文件夹名称

    Returns:
        安全的路径组件
    """
    if not path_str:
        return ""

    safe_path = path_str

    # 先替换明显危险的路径字符，阻断多级路径和非法文件名。
    for char in PATH_COMPONENT_DANGEROUS_CHARS:
        safe_path = safe_path.replace(char, "_")

    # 单独处理波浪线，保持与原始节点实现的清理结果一致。
    safe_path = safe_path.replace("~", "_")

    safe_path = PATH_COMPONENT_UNDERSCORE_PATTERN.sub("_", safe_path)
    return safe_path.strip("_")
