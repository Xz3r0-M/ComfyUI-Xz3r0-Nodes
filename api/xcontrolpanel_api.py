"""
XControlPanel API 模块。

提供控制面板节点前端按钮所需的 ComfyUI 重启接口。
"""

import os
import sys
import threading
from pathlib import Path

from aiohttp import web

import server

try:
    from ..xz3r0_utils import get_logger
except ImportError:
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)
INTERNAL_ERROR_MESSAGE = "Internal server error"
_RESTART_LOCK = threading.RLock()
_RESTART_SCHEDULED = False
_SIMPLE_FORM_CONTENT_TYPES = frozenset({
    "application/x-www-form-urlencoded",
    "multipart/form-data",
    "text/plain",
})


def _reject_simple_form_content_type(request: web.Request) -> web.Response | None:
    """拒绝可由跨站普通表单直接提交的 Content-Type。"""
    if request.content_type in _SIMPLE_FORM_CONTENT_TYPES:
        return web.json_response(
            {
                "status": "error",
                "message": "Invalid Content-Type for this endpoint",
            },
            status=400,
        )
    return None


def _build_restart_args() -> list[str]:
    """构造当前 ComfyUI 进程的重启参数。"""
    sys_argv = list(sys.argv)
    if "--windows-standalone-build" in sys_argv:
        sys_argv.remove("--windows-standalone-build")

    if sys_argv and sys_argv[0].endswith("__main__.py"):
        module_name = Path(sys_argv[0]).parent.name
        return [sys.executable, "-m", module_name, *sys_argv[1:]]

    if sys.platform.startswith("win32") and sys_argv:
        return [
            f'"{sys.executable}"',
            f'"{sys_argv[0]}"',
            *sys_argv[1:],
        ]

    return [sys.executable, *sys_argv]


def _restart_process() -> None:
    """执行实际重启动作。"""
    cli_session = os.environ.get("__COMFY_CLI_SESSION__")
    if cli_session:
        Path(f"{cli_session}.reboot").touch()
        LOGGER.info("[XControlPanel] Restarting ComfyUI via CLI session")
        os._exit(0)

    restart_args = _build_restart_args()
    LOGGER.info("[XControlPanel] Restarting ComfyUI")
    os.execv(sys.executable, restart_args)


def _schedule_restart() -> None:
    """延迟触发重启，让 HTTP 响应先返回到前端。"""
    global _RESTART_SCHEDULED

    with _RESTART_LOCK:
        if _RESTART_SCHEDULED:
            return
        _RESTART_SCHEDULED = True

    timer = threading.Timer(0.35, _restart_process)
    timer.daemon = True
    timer.start()


@server.PromptServer.instance.routes.post("/xz3r0/xcontrolpanel/restart")
async def xcontrolpanel_restart(request: web.Request) -> web.Response:
    """处理 XControlPanel 前端触发的 ComfyUI 重启请求。"""
    rejected = _reject_simple_form_content_type(request)
    if rejected is not None:
        return rejected

    try:
        _schedule_restart()
        return web.json_response({
            "status": "success",
            "message": "Restart scheduled",
        })

    except Exception as exc:
        LOGGER.error(
            "[XControlPanel] restart failed: %s: %s",
            type(exc).__name__,
            exc,
        )
        return web.json_response(
            {"status": "error", "message": INTERNAL_ERROR_MESSAGE},
            status=500,
        )
