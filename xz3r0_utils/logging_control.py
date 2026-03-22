"""
日志总控模块
============

集中管理插件日志级别，支持全局默认级别、模块覆盖和环境变量覆盖。
"""

import logging
import os

# 日志级别说明（由低到高）：
# - DEBUG:
#   用于开发排查细节（中间变量、逐步诊断信息）。
#   仅在级别设置为 DEBUG 时显示。
# - INFO:
#   用于关键流程信息（开始/完成/主要状态）。
#   在级别设置为 INFO 或 DEBUG 时显示。
# - WARNING:
#   用于可恢复问题（参数回退、环境缺失、自动降级）。
#   在级别设置为 WARNING / INFO / DEBUG 时显示。
# - ERROR:
#   用于失败或必须关注的问题。
#   在任何常见级别下都会显示（除 CRITICAL-only 场景）。
#
# 默认全局级别为 INFO：
# - 会显示 INFO / WARNING / ERROR
# - 不显示 DEBUG
# 如果全局改为 WARNING：
# - 会显示 WARNING / ERROR
# - 不显示 DEBUG / INFO
# 如果全局改为 ERROR：
# - 仅显示 ERROR
#
# 推荐使用方式：
# - 开发节点阶段：
#   只把当前正在开发的模块设为 DEBUG（建议用模块覆盖，
#   不建议全局都开 DEBUG），便于查看详细诊断信息。
# - 节点交付给用户后：
#   将该模块恢复为 INFO（或删除模块覆盖让其跟随全局 INFO），
#   保留关键流程提示并减少日志噪声。
DEFAULT_LOG_LEVEL = "INFO"

# 模块覆盖级别（单文件总控）：
# 键为模块 logger 名称，值为日志级别字符串。
# 开发时你只需要改这里，就能单独控制某个节点/API 的输出级别。
# 例如把 xnode.xaudiosave 改成 DEBUG：
# - 该模块会显示 DEBUG / INFO / WARNING / ERROR
# - 其他模块仍按全局级别过滤
MODULE_LOG_LEVELS: dict[str, str] = {
    "__init__": "INFO",
    "api.xdatahub_api": "INFO",
    "api.xworkflowsave_api": "INFO",
    "xnode.xaudiosave": "INFO",
    "xnode.xdatasave": "INFO",
    "xnode.ximageresize": "INFO",
    "xnode.xseed": "INFO",
}

_CONFIGURED = False


def _normalize_level(level_name: str) -> int:
    """
    将字符串日志级别转换为 logging 常量，非法值回退到 INFO。
    """
    return getattr(logging, level_name.upper(), logging.INFO)


def _read_default_level() -> int:
    """
    读取全局默认日志级别，支持环境变量覆盖。

    环境变量优先级：
        1) XZ3R0_LOG_LEVEL
        2) DEFAULT_LOG_LEVEL 常量

    示例：
        XZ3R0_LOG_LEVEL=DEBUG
        -> 全局显示 DEBUG/INFO/WARNING/ERROR
    """
    env_level = os.getenv("XZ3R0_LOG_LEVEL")
    if env_level:
        return _normalize_level(env_level)
    return _normalize_level(DEFAULT_LOG_LEVEL)


def _read_module_overrides() -> dict[str, int]:
    """
    读取模块覆盖级别。

    环境变量格式：
        XZ3R0_LOG_MODULE_LEVELS="xnode.xaudiosave=DEBUG,api.xworkflowsave_api=WARNING"

    行为说明：
        - 该环境变量会覆盖 MODULE_LOG_LEVELS 中同名模块的级别。
        - 只影响指定模块，不影响其他模块。
    """
    overrides = {
        module_name: _normalize_level(level_name)
        for module_name, level_name in MODULE_LOG_LEVELS.items()
    }

    env_overrides = os.getenv("XZ3R0_LOG_MODULE_LEVELS", "").strip()
    if not env_overrides:
        return overrides

    for item in env_overrides.split(","):
        pair = item.strip()
        if not pair or "=" not in pair:
            continue
        module_name, level_name = pair.split("=", 1)
        module_name = module_name.strip()
        level_name = level_name.strip()
        if not module_name:
            continue
        overrides[module_name] = _normalize_level(level_name)
    return overrides


def configure_logging(force: bool = False) -> None:
    """
    初始化日志配置，仅执行一次（除非 force=True）。

    显示判定规则：
        1) 先看全局级别（DEFAULT_LOG_LEVEL 或 XZ3R0_LOG_LEVEL）
        2) 再看模块覆盖（MODULE_LOG_LEVELS 或
           XZ3R0_LOG_MODULE_LEVELS）
        3) 如果模块有覆盖，则按模块级别判定显示
    """
    global _CONFIGURED

    if _CONFIGURED and not force:
        return

    # 仅在未配置 handler 时建立基础输出，避免重复日志。
    root_logger = logging.getLogger()
    if not root_logger.handlers:
        logging.basicConfig(
            level=_read_default_level(),
            format="[%(levelname)s] %(name)s: %(message)s",
        )
    else:
        root_logger.setLevel(_read_default_level())

    for module_name, module_level in _read_module_overrides().items():
        logging.getLogger(module_name).setLevel(module_level)

    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    """
    获取统一管理的 logger。
    """
    return logging.getLogger(name)
