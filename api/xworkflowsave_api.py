"""
XWorkflowSave API 模块
======================

提供自定义 API 接口用于前端传输工作流元数据。
使用内存存储，以 prompt_id 为键存储工作流数据。
支持主动清理，文件保存成功后立即释放内存。
支持执行事件监听自动清理和调试日志功能。
"""

import json
import time
from typing import Any

import server
from aiohttp import web

# ================================
# 日志配置
# ================================

# 日志级别：0=关闭，1=信息，2=详细调试
# 开发者直接修改此变量控制日志输出
LOG_LEVEL: int = 0
INTERNAL_ERROR_MESSAGE = "Internal server error"
_EXECUTION_CLEANUP_REGISTERED = False


def log_info(message: str) -> None:
    """
    输出信息日志

    在 LOG_LEVEL >= 1 时输出到服务器日志。
    用于记录正常操作流程。

    Args:
        message: 日志消息
    """
    if LOG_LEVEL >= 1:
        print(f"[XWorkflowSave] {message}", flush=True)


def log_debug(message: str) -> None:
    """
    输出调试日志

    在 LOG_LEVEL >= 2 时输出到服务器日志。
    用于详细调试信息。

    Args:
        message: 日志消息
    """
    if LOG_LEVEL >= 2:
        print(f"[XWorkflowSave DEBUG] {message}", flush=True)


def log_error(message: str) -> None:
    """
    输出错误日志

    始终输出到服务器日志。
    用于记录错误信息。

    Args:
        message: 日志消息
    """
    print(f"[XWorkflowSave ERROR] {message}", flush=True)


class WorkflowDataStore:
    """
    工作流数据存储管理器

    使用内存字典存储工作流数据，以 prompt_id 为键。
    支持主动清理（推荐）和自动过期清理（备用）。
    """

    _instance = None
    _data: dict[str, dict[str, Any]] = {}
    _timestamps: dict[str, float] = {}
    _expire_seconds: float = 300

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @classmethod
    def store(cls, prompt_id: str, workflow_data: dict) -> None:
        """
        存储工作流数据

        Args:
            prompt_id: 提示 ID，作为存储键
            workflow_data: 工作流数据字典
        """
        cls._data[prompt_id] = workflow_data
        cls._timestamps[prompt_id] = time.time()

    @classmethod
    def retrieve(
        cls, prompt_id: str, auto_cleanup: bool = True
    ) -> dict | None:
        """
        获取工作流数据

        Args:
            prompt_id: 提示 ID
            auto_cleanup: 是否在读取后自动清理（默认 True）

        Returns:
            工作流数据字典，不存在则返回 None
        """
        cls._cleanup_expired()

        if prompt_id in cls._data:
            data = cls._data[prompt_id]
            if auto_cleanup:
                cls.cleanup(prompt_id)
            return data
        return None

    @classmethod
    def cleanup(cls, prompt_id: str) -> bool:
        """
        主动清理指定的工作流数据

        Args:
            prompt_id: 要清理的提示 ID

        Returns:
            是否成功清理
        """
        if prompt_id in cls._data:
            del cls._data[prompt_id]
            cls._timestamps.pop(prompt_id, None)
            return True
        return False

    @classmethod
    def _cleanup_expired(cls) -> None:
        """
        清理过期数据（备用机制）
        """
        current_time = time.time()
        expired_keys = [
            key
            for key, timestamp in cls._timestamps.items()
            if current_time - timestamp > cls._expire_seconds
        ]
        for key in expired_keys:
            cls._data.pop(key, None)
            cls._timestamps.pop(key, None)

    @classmethod
    def get_memory_usage(cls) -> dict:
        """
        获取当前内存使用情况（估算）

        Returns:
            内存使用统计信息
        """
        total_entries = len(cls._data)
        total_size = 0

        for _, value in cls._data.items():
            try:
                size = len(json.dumps(value))
                total_size += size
            except Exception:
                pass

        return {
            "entries": total_entries,
            "estimated_bytes": total_size,
            "estimated_mb": round(total_size / (1024 * 1024), 2),
        }


workflow_store = WorkflowDataStore()


@server.PromptServer.instance.routes.post("/xz3r0/xworkflowsave/capture")
async def capture_workflow(request: web.Request) -> web.Response:
    """
    接收前端捕获的工作流数据
    """
    try:
        data = await request.json()
        prompt_id = data.get("prompt_id")
        workflow = data.get("workflow")

        if not prompt_id:
            return web.json_response(
                {"status": "error", "message": "Missing prompt_id"}, status=400
            )

        if not workflow:
            return web.json_response(
                {"status": "error", "message": "Missing workflow data"},
                status=400,
            )

        workflow_store.store(
            prompt_id,
            {
                "workflow": workflow,
                "mode": data.get("mode", "auto"),
                "timestamp": time.time(),
            },
        )

        log_info(f"Stored workflow data for prompt_id: {prompt_id}")
        return web.json_response({"status": "success"})

    except json.JSONDecodeError:
        return web.json_response(
            {"status": "error", "message": "Invalid JSON"}, status=400
        )
    except Exception as e:
        log_error(f"capture_workflow failed: {type(e).__name__}: {e}")
        return web.json_response(
            {"status": "error", "message": INTERNAL_ERROR_MESSAGE},
            status=500,
        )


@server.PromptServer.instance.routes.post("/xz3r0/xworkflowsave/cleanup")
async def cleanup_workflow(request: web.Request) -> web.Response:
    """
    主动清理工作流数据
    """
    try:
        data = await request.json()
        prompt_id = data.get("prompt_id")

        if not prompt_id:
            return web.json_response(
                {"status": "error", "message": "Missing prompt_id"}, status=400
            )

        cleaned = workflow_store.cleanup(prompt_id)
        return web.json_response({"status": "success", "cleaned": cleaned})

    except json.JSONDecodeError:
        return web.json_response(
            {"status": "error", "message": "Invalid JSON"}, status=400
        )
    except Exception as e:
        log_error(f"cleanup_workflow failed: {type(e).__name__}: {e}")
        return web.json_response(
            {"status": "error", "message": INTERNAL_ERROR_MESSAGE},
            status=500,
        )


@server.PromptServer.instance.routes.get("/xz3r0/xworkflowsave/status")
async def get_status(request: web.Request) -> web.Response:
    """
    获取存储状态（调试用）
    """
    memory_info = workflow_store.get_memory_usage()

    return web.json_response(_build_status_payload(memory_info))


def _build_status_payload(memory_info: dict) -> dict:
    """
    构建状态接口返回数据。
    """
    status_data = {
        "count": memory_info["entries"],
        "memory_usage": {
            "estimated_bytes": memory_info["estimated_bytes"],
            "estimated_mb": memory_info["estimated_mb"],
        },
    }
    if LOG_LEVEL >= 2:
        status_data["stored_prompts"] = list(workflow_store._data.keys())
    return status_data


def register_execution_cleanup() -> None:
    """
    注册执行事件监听，自动清理工作流数据
    """
    global _EXECUTION_CLEANUP_REGISTERED
    if _EXECUTION_CLEANUP_REGISTERED:
        log_debug("Execution cleanup listener already registered")
        return

    original_send_sync = server.PromptServer.instance.send_sync

    def patched_send_sync(event: str, data: dict, sid: str = None) -> None:
        """
        包装后的 send_sync 方法
        """
        original_send_sync(event, data, sid)

        if event in ("execution_success", "execution_error"):
            if isinstance(data, dict):
                prompt_id = data.get("prompt_id")
                if prompt_id:
                    cleaned = workflow_store.cleanup(prompt_id)
                    if cleaned:
                        log_debug(
                            f"Auto-cleaned data for prompt_id: {prompt_id} "
                            f"(event: {event})"
                        )
                    else:
                        log_debug(
                            f"Auto-clean skipped for prompt_id: {prompt_id} "
                            f"(event: {event})"
                        )

    server.PromptServer.instance.send_sync = patched_send_sync
    _EXECUTION_CLEANUP_REGISTERED = True
    log_debug("Execution cleanup listener registered")


register_execution_cleanup()
