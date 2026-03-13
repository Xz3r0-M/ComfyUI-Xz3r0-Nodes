"""
唯一文件名生成工具
==================

这个模块只负责为保存文件生成不覆盖旧文件的唯一文件名。
"""

from pathlib import Path

DEFAULT_MAX_FILENAME_ATTEMPTS = 100000


def ensure_unique_filename(
    directory: Path,
    filename: str,
    extension: str,
    max_attempts: int = DEFAULT_MAX_FILENAME_ATTEMPTS,
) -> str:
    """
    确保文件名在目标目录中唯一

    如果文件名不存在则直接使用，存在则添加序列号。

    Args:
        directory: 目录路径
        filename: 基础文件名
        extension: 文件扩展名
        max_attempts: 最大尝试次数，用于防止无限循环

    Returns:
        唯一的文件名

    Raises:
        ValueError: max_attempts 小于 1 时抛出
        FileExistsError: 无法生成唯一文件名时抛出
    """
    if max_attempts < 1:
        raise ValueError("max_attempts must be >= 1")

    # 第一次优先尝试原始文件名，后续再按五位序列号递增。
    for counter in range(max_attempts):
        if counter == 0:
            candidate = f"{filename}{extension}"
        else:
            candidate = f"{filename}_{counter:05d}{extension}"

        candidate_path = directory / candidate
        if not candidate_path.exists():
            return candidate

    raise FileExistsError("Unable to generate unique filename")
