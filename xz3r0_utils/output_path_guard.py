"""
输出路径落地守卫工具
====================

这个模块只负责在最终保存前校验目标路径是否仍然位于允许的
输出目录内，作为比字符串清理更严格的最后一道防线。
"""

from pathlib import Path


def resolve_output_subpath(
    output_dir: Path,
    relative_path: str | Path = "",
) -> Path:
    """
    将相对路径解析为输出目录内的安全路径

    这个函数不会清理输入字符串，而是在最终路径层面做严格校验：
    1. 保留输出目录当前实例看到的原始路径形式
    2. 解析输出目录的真实路径用于安全校验
    2. 拒绝绝对路径输入
    3. 将相对路径拼接到输出目录，得到对外可见路径
    4. 将候选路径解析为真实路径并确认仍位于输出目录内

    Args:
        output_dir: 允许写入的输出根目录
        relative_path: 基于输出目录的相对路径

    Returns:
        基于输出目录原始路径形式的安全路径

    Raises:
        ValueError: output_dir 为空路径时抛出
        ValueError: relative_path 为绝对路径时抛出
        ValueError: 解析后路径逃出输出目录时抛出
    """
    output_root = Path(output_dir)
    if str(output_root) == "":
        raise ValueError("output_dir must not be empty")

    resolved_output_root = output_root.resolve(strict=False)
    candidate_relative_path = Path(relative_path)

    if candidate_relative_path.is_absolute():
        raise ValueError("Absolute paths are not allowed")

    candidate_display_path = output_root / candidate_relative_path
    resolved_candidate_path = candidate_display_path.resolve(strict=False)

    try:
        resolved_candidate_path.relative_to(resolved_output_root)
    except ValueError as exc:
        raise ValueError(
            "Resolved path escapes output directory"
        ) from exc

    return candidate_display_path
