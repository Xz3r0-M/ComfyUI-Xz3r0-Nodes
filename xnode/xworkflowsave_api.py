"""
XWorkflowSave API 模块
======================

提供自定义 API 接口用于前端传输工作流元数据。
使用内存存储，以 prompt_id 为键存储工作流数据。
支持主动清理，文件保存成功后立即释放内存。
"""

import json
import time
from typing import Any

import server
from aiohttp import web


class WorkflowDataStore:
    """
    工作流数据存储管理器

    使用内存字典存储工作流数据，以 prompt_id 为键。
    支持主动清理（推荐）和自动过期清理（备用）。
    """

    _instance = None
    _data: dict[str, dict[str, Any]] = {}
    _timestamps: dict[str, float] = {}
    _expire_seconds: float = 300  # 5分钟过期（备用机制）

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @classmethod
    def store(cls, prompt_id: str, workflow_data: dict) -> None:
        """
        存储工作流数据

        Args:
            prompt_id: 提示ID，作为存储键
            workflow_data: 工作流数据字典
        """
        cls._data[prompt_id] = workflow_data
        cls._timestamps[prompt_id] = time.time()

    @classmethod
    def retrieve(cls, prompt_id: str, auto_cleanup: bool = True) -> dict | None:
        """
        获取工作流数据

        Args:
            prompt_id: 提示ID
            auto_cleanup: 是否在读取后自动清理（默认True）

        Returns:
            工作流数据字典，不存在则返回None
        """
        cls._cleanup_expired()

        if prompt_id in cls._data:
            data = cls._data[prompt_id]

            # 默认在读取后立即清理，释放内存
            if auto_cleanup:
                cls.cleanup(prompt_id)

            return data
        return None

    @classmethod
    def cleanup(cls, prompt_id: str) -> bool:
        """
        主动清理指定的工作流数据

        Args:
            prompt_id: 要清理的提示ID

        Returns:
            是否成功清理（True表示数据存在并已清理）
        """
        if prompt_id in cls._data:
            # 删除数据释放内存
            del cls._data[prompt_id]
            cls._timestamps.pop(prompt_id, None)
            return True
        return False

    @classmethod
    def _cleanup_expired(cls) -> None:
        """清理过期数据（备用机制）"""
        current_time = time.time()
        expired_keys = [
            key for key, timestamp in cls._timestamps.items()
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

        for key, value in cls._data.items():
            # 估算数据大小（粗略计算）
            try:
                size = len(json.dumps(value))
                total_size += size
            except Exception:
                pass

        return {
            "entries": total_entries,
            "estimated_bytes": total_size,
            "estimated_mb": round(total_size / (1024 * 1024), 2)
        }


# 全局数据存储实例
workflow_store = WorkflowDataStore()


# ================================
# API 路由定义
# ================================

@server.PromptServer.instance.routes.post(
    "/xz3r0/xworkflowsave/capture"
)
async def capture_workflow(request: web.Request) -> web.Response:
    """
    接收前端捕获的工作流数据

    Request Body:
        {
            "prompt_id": "uuid-string",
            "workflow": { ... },
            "mode": "full" | "auto"
        }

    Returns:
        {"status": "success"} 或错误信息
    """
    try:
        data = await request.json()
        prompt_id = data.get("prompt_id")
        workflow = data.get("workflow")

        if not prompt_id:
            return web.json_response(
                {"status": "error", "message": "Missing prompt_id"},
                status=400
            )

        if not workflow:
            return web.json_response(
                {"status": "error", "message": "Missing workflow data"},
                status=400
            )

        # 存储数据
        workflow_store.store(prompt_id, {
            "workflow": workflow,
            "mode": data.get("mode", "auto"),
            "timestamp": time.time()
        })

        return web.json_response({"status": "success"})

    except json.JSONDecodeError:
        return web.json_response(
            {"status": "error", "message": "Invalid JSON"},
            status=400
        )
    except Exception as e:
        return web.json_response(
            {"status": "error", "message": str(e)},
            status=500
        )


@server.PromptServer.instance.routes.post(
    "/xz3r0/xworkflowsave/cleanup"
)
async def cleanup_workflow(request: web.Request) -> web.Response:
    """
    主动清理工作流数据

    Request Body:
        {
            "prompt_id": "uuid-string"
        }

    Returns:
        {"status": "success", "cleaned": true/false}
    """
    try:
        data = await request.json()
        prompt_id = data.get("prompt_id")

        if not prompt_id:
            return web.json_response(
                {"status": "error", "message": "Missing prompt_id"},
                status=400
            )

        cleaned = workflow_store.cleanup(prompt_id)

        return web.json_response({
            "status": "success",
            "cleaned": cleaned
        })

    except json.JSONDecodeError:
        return web.json_response(
            {"status": "error", "message": "Invalid JSON"},
            status=400
        )
    except Exception as e:
        return web.json_response(
            {"status": "error", "message": str(e)},
            status=500
        )


@server.PromptServer.instance.routes.get(
    "/xz3r0/xworkflowsave/status"
)
async def get_status(request: web.Request) -> web.Response:
    """
    获取存储状态（调试用）

    Returns:
        当前存储的数据键列表和内存使用情况
    """
    memory_info = workflow_store.get_memory_usage()

    return web.json_response({
        "stored_prompts": list(workflow_store._data.keys()),
        "count": memory_info["entries"],
        "memory_usage": {
            "estimated_bytes": memory_info["estimated_bytes"],
            "estimated_mb": memory_info["estimated_mb"]
        }
    })
