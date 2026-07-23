"""
XMemoryCleanup API 模块
======================

提供 XMemoryCleanup 节点前端按钮所需的清理接口。
"""

import gc
import json
import threading

import execution
import server
from aiohttp import web

try:
    import comfy.model_management as comfy_model_management
except ImportError:
    comfy_model_management = None

try:
    from ..xz3r0_utils import get_logger
except ImportError:
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)
INTERNAL_ERROR_MESSAGE = "Internal server error"
ACTION_MODELS = "models"
ACTION_EXECUTION_CACHE = "execution_cache"
ACTION_MODELS_AND_EXECUTION_CACHE = "models_and_execution_cache"
VALID_ACTIONS = {
    ACTION_MODELS,
    ACTION_EXECUTION_CACHE,
    ACTION_MODELS_AND_EXECUTION_CACHE,
}
_EXECUTOR_TRACK_LOCK = threading.RLock()
_CLEANUP_ACTION_LOCK = threading.RLock()
_LATEST_PROMPT_EXECUTOR = None
_TRACKER_INSTALLED = False


def _install_prompt_executor_tracker() -> None:
    """安装 PromptExecutor 跟踪器，保存当前执行器引用。"""
    global _TRACKER_INSTALLED

    if _TRACKER_INSTALLED:
        return

    original_init = execution.PromptExecutor.__init__
    if getattr(original_init, "__xmemorycleanup_wrapped__", False):
        _TRACKER_INSTALLED = True
        return

    def wrapped_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        global _LATEST_PROMPT_EXECUTOR
        with _EXECUTOR_TRACK_LOCK:
            _LATEST_PROMPT_EXECUTOR = self

    wrapped_init.__xmemorycleanup_wrapped__ = True
    execution.PromptExecutor.__init__ = wrapped_init
    _TRACKER_INSTALLED = True


def _get_prompt_executor():
    """获取当前 ComfyUI PromptExecutor 实例。"""
    with _EXECUTOR_TRACK_LOCK:
        return _LATEST_PROMPT_EXECUTOR


def _require_model_management():
    """返回 ComfyUI model_management 模块。"""
    if comfy_model_management is None:
        raise RuntimeError("ComfyUI model management is unavailable")
    return comfy_model_management


def _clear_models_only() -> None:
    """卸载所有模型并执行基础垃圾回收。"""
    model_management = _require_model_management()
    model_management.unload_all_models()
    model_management.cleanup_models_gc()
    gc.collect()


def _clear_execution_cache_only() -> None:
    """重置 PromptExecutor，清理 Execution Cache。"""
    prompt_executor = _get_prompt_executor()
    if prompt_executor is None:
        raise RuntimeError("Prompt executor is unavailable")
    prompt_executor.reset()
    gc.collect()


def _count_loaded_models() -> int:
    """返回当前已加载模型数量。"""
    model_management = _require_model_management()
    try:
        return len(model_management.loaded_models())
    except Exception:
        return 0


def _count_execution_cache_entries() -> int:
    """返回当前 Execution Cache 中可复用结果数量。"""
    prompt_executor = _get_prompt_executor()
    if prompt_executor is None:
        return 0
    try:
        return len(prompt_executor.caches.outputs.all_node_ids())
    except Exception:
        return 0


def _perform_cleanup_action(action: str) -> dict[str, int]:
    """执行指定清理动作。"""
    result = {
        "models_cleared": 0,
        "execution_cache_entries_cleared": 0,
    }

    if action == ACTION_MODELS:
        result["models_cleared"] = _count_loaded_models()
        _clear_models_only()
        return result
    if action == ACTION_EXECUTION_CACHE:
        result[
            "execution_cache_entries_cleared"
        ] = _count_execution_cache_entries()
        _clear_execution_cache_only()
        return result
    if action == ACTION_MODELS_AND_EXECUTION_CACHE:
        result["models_cleared"] = _count_loaded_models()
        result[
            "execution_cache_entries_cleared"
        ] = _count_execution_cache_entries()
        _clear_models_only()
        _clear_execution_cache_only()
        return result
    raise ValueError("Unsupported cleanup action")


@server.PromptServer.instance.routes.post("/xz3r0/xmemorycleanup/action")
async def xmemorycleanup_action(request: web.Request) -> web.Response:
    """执行 XMemoryCleanup 前端按钮触发的清理动作。"""
    try:
        data = await request.json()
        action = str(data.get("action", "")).strip()

        if action not in VALID_ACTIONS:
            return web.json_response(
                {"status": "error", "message": "Invalid action"},
                status=400,
            )

        prompt_queue = server.PromptServer.instance.prompt_queue
        with _CLEANUP_ACTION_LOCK, prompt_queue.mutex:
            if prompt_queue.get_tasks_remaining() > 0:
                return web.json_response(
                    {
                        "status": "error",
                        "message": (
                            "Cleanup is unavailable while execution is active"
                        ),
                    },
                    status=409,
                )
            result = _perform_cleanup_action(action)

        return web.json_response({
            "status": "success",
            "action": action,
            **result,
        })

    except json.JSONDecodeError:
        return web.json_response(
            {"status": "error", "message": "Invalid JSON"},
            status=400,
        )
    except Exception as exc:
        LOGGER.error(
            "[XMemoryCleanup] action failed: %s: %s",
            type(exc).__name__,
            exc,
        )
        return web.json_response(
            {"status": "error", "message": INTERNAL_ERROR_MESSAGE},
            status=500,
        )


_install_prompt_executor_tracker()
