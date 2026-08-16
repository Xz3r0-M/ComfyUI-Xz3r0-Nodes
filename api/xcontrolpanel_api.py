"""
XControlPanel API 模块。

提供控制面板节点前端按钮所需的 ComfyUI 重启接口。
"""

import os
import sys
import threading
from pathlib import Path

import server
from aiohttp import web

try:
    from ..xz3r0_utils import get_logger, xcontrolpanel_updater
except ImportError:
    from xz3r0_utils import get_logger, xcontrolpanel_updater
LOGGER = get_logger(__name__)
INTERNAL_ERROR_MESSAGE = "Internal server error"
_RESTART_LOCK = threading.RLock()
_RESTART_SCHEDULED = False
_SIMPLE_FORM_CONTENT_TYPES = frozenset(
    {
        "application/x-www-form-urlencoded",
        "multipart/form-data",
        "text/plain",
    }
)


def _reject_simple_form_content_type(
    request: web.Request,
) -> web.Response | None:
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


async def _read_json_payload(request: web.Request) -> object | None:
    """读取 JSON 请求体；非法 JSON 返回 None。"""
    try:
        return await request.json()
    except Exception:
        return None


def _cached_versions_or_error(
    code: str,
    status: int,
    retry_after: int | None = None,
    token_configured: bool | None = None,
) -> web.Response:
    """
    拉取失败时优先降级返回上次缓存；无缓存则返回对应错误。

    retry_after 为 None 表示该错误没有重试时间（如纯网络错误）。
    token_configured 仅在限流错误时附带，供前端引导用户配置令牌。
    """
    cached = xcontrolpanel_updater.cached_versions()
    if cached:
        response: dict = {
            "status": "success",
            "versions": cached,
            "from_cache": True,
        }
        if retry_after is not None:
            response["retry_after"] = retry_after
        return web.json_response(response)

    response = {"status": "error", "code": code}
    if retry_after is not None:
        response["retry_after"] = retry_after
    if token_configured is not None:
        response["token_configured"] = token_configured
    return web.json_response(response, status=status)


def _build_restart_args() -> list[str]:
    """构造当前 ComfyUI 进程的重启参数。"""
    sys_argv = list(sys.argv)
    if "--windows-standalone-build" in sys_argv:
        sys_argv.remove("--windows-standalone-build")

    if sys_argv and sys_argv[0].endswith("__main__.py"):
        module_name = Path(sys_argv[0]).parent.name
        return [sys.executable, "-m", module_name, *sys_argv[1:]]

    if sys.platform.startswith("win32") and sys_argv:
        # os.execv 不经过命令行 shell，不会剥离引号：手动给路径包
        # 引号会把引号变成参数内容本身，导致新进程找不到文件。
        # 含空格路径由 execv 自行处理，这里必须用原始路径。
        return [sys.executable, sys_argv[0], *sys_argv[1:]]

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
        return web.json_response(
            {
                "status": "success",
                "message": "Restart scheduled",
            }
        )

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


@server.PromptServer.instance.routes.get("/xz3r0/xcontrolpanel/update/status")
async def xcontrolpanel_update_status(request: web.Request) -> web.Response:
    """返回更新支持状态、当前版本与进行中的更新状态。"""
    root = xcontrolpanel_updater.comfyui_root()
    supported = xcontrolpanel_updater.is_git_repo(root)
    current_version = xcontrolpanel_updater.get_current_version(root)
    LOGGER.debug(
        "[XControlPanel] update status: root=%s supported=%s version=%s",
        root,
        supported,
        current_version,
    )
    return web.json_response(
        {
            "status": "success",
            "data": {
                "supported": supported,
                "current_version": current_version,
                "dirty": xcontrolpanel_updater.is_dirty(root)
                if supported
                else False,
                "versions": xcontrolpanel_updater.cached_versions(),
                "update": xcontrolpanel_updater.get_update_state(),
            },
        }
    )


@server.PromptServer.instance.routes.post(
    "/xz3r0/xcontrolpanel/update/refresh"
)
async def xcontrolpanel_update_refresh(request: web.Request) -> web.Response:
    """拉取 GitHub 最新版本列表；限流/断网时降级返回上次缓存。"""
    rejected = _reject_simple_form_content_type(request)
    if rejected is not None:
        return rejected

    try:
        versions = xcontrolpanel_updater.refresh_versions()
    except xcontrolpanel_updater.GitHubRateLimitError as exc:
        return _cached_versions_or_error(
            "rate_limit",
            429,
            exc.retry_after,
            xcontrolpanel_updater.github_token_source()["source"] != "none",
        )
    except xcontrolpanel_updater.GitHubNetworkError:
        return _cached_versions_or_error("network", 502)
    except Exception as exc:
        LOGGER.error(
            "[XControlPanel] update refresh failed: %s: %s",
            type(exc).__name__,
            exc,
        )
        return web.json_response(
            {
                "status": "error",
                "code": "internal",
                "message": INTERNAL_ERROR_MESSAGE,
            },
            status=500,
        )

    return web.json_response({"status": "success", "versions": versions})


@server.PromptServer.instance.routes.post("/xz3r0/xcontrolpanel/update/start")
async def xcontrolpanel_update_start(request: web.Request) -> web.Response:
    """校验目标版本并在后台启动更新流程。"""
    rejected = _reject_simple_form_content_type(request)
    if rejected is not None:
        return rejected

    payload = await _read_json_payload(request)

    if payload is None:
        return web.json_response(
            {
                "status": "error",
                "code": "bad_request",
                "message": "Invalid JSON",
            },
            status=400,
        )

    tag = payload.get("tag") if isinstance(payload, dict) else None
    if not isinstance(tag, str) or not tag.strip():
        return web.json_response(
            {
                "status": "error",
                "code": "bad_request",
                "message": "Missing tag",
            },
            status=400,
        )
    tag = tag.strip()

    root = xcontrolpanel_updater.comfyui_root()
    if not xcontrolpanel_updater.is_git_repo(root):
        return web.json_response(
            {"status": "error", "code": "not_git"},
            status=400,
        )

    versions = xcontrolpanel_updater.cached_versions()
    if not versions:
        # 缓存为空时需要现拉；拉取失败按失败类型直接报错，
        # 不能降级成 unknown_tag（会误导用户以为版本号写错）。
        try:
            versions = xcontrolpanel_updater.cached_or_fetch_versions()
        except xcontrolpanel_updater.GitHubRateLimitError as exc:
            return web.json_response(
                {
                    "status": "error",
                    "code": "rate_limit",
                    "retry_after": exc.retry_after,
                    "token_configured": (
                        xcontrolpanel_updater.github_token_source()["source"]
                        != "none"
                    ),
                },
                status=429,
            )
        except xcontrolpanel_updater.GitHubNetworkError:
            return web.json_response(
                {"status": "error", "code": "network"},
                status=502,
            )
        except xcontrolpanel_updater.UpdateError as exc:
            LOGGER.warning(
                "[XControlPanel] update start fetch failed: %s",
                exc,
            )
            return web.json_response(
                {"status": "error", "code": "unavailable"},
                status=503,
            )
    if not any(v["tag"] == tag for v in versions):
        return web.json_response(
            {"status": "error", "code": "unknown_tag"},
            status=400,
        )

    current = xcontrolpanel_updater.get_current_version(root)
    if tag.lstrip("vV") == current.lstrip("vV"):
        return web.json_response(
            {"status": "error", "code": "already_current"},
            status=400,
        )

    try:
        xcontrolpanel_updater.start_update(root, tag)
    except xcontrolpanel_updater.UpdateAlreadyRunningError:
        return web.json_response(
            {"status": "error", "code": "busy"},
            status=409,
        )
    except Exception as exc:
        LOGGER.error(
            "[XControlPanel] update start failed: %s: %s",
            type(exc).__name__,
            exc,
        )
        return web.json_response(
            {
                "status": "error",
                "code": "internal",
                "message": INTERNAL_ERROR_MESSAGE,
            },
            status=500,
        )

    return web.json_response(
        {"status": "success", "message": "Update started"}
    )


@server.PromptServer.instance.routes.get("/xz3r0/xcontrolpanel/update/token")
async def xcontrolpanel_update_token_get(
    request: web.Request,
) -> web.Response:
    """返回令牌配置状态（不返回令牌明文）。"""
    info = xcontrolpanel_updater.github_token_source()
    return web.json_response(
        {
            "status": "success",
            "configured": info["source"] != "none",
            "source": info["source"],
            "env_var": info["env_var"],
            "env_var_effective": info["env_var_effective"],
        }
    )


@server.PromptServer.instance.routes.post("/xz3r0/xcontrolpanel/update/token")
async def xcontrolpanel_update_token_set(
    request: web.Request,
) -> web.Response:
    """保存令牌配置：mode=token 存直接令牌；mode=env_var 存环境变量名。"""
    rejected = _reject_simple_form_content_type(request)
    if rejected is not None:
        return rejected

    payload = await _read_json_payload(request)

    if payload is None:
        return web.json_response(
            {
                "status": "error",
                "code": "bad_request",
                "message": "Invalid JSON",
            },
            status=400,
        )

    mode = payload.get("mode") if isinstance(payload, dict) else None
    if mode is None:
        mode = "token"  # 兼容旧请求体（只带 token 字段）

    try:
        if mode == "env_var":
            name = payload.get("env_var")
            if name is not None and not isinstance(name, str):
                return web.json_response(
                    {
                        "status": "error",
                        "code": "bad_request",
                        "message": "Invalid env_var",
                    },
                    status=400,
                )
            xcontrolpanel_updater.save_token_env_var(name or "")
        elif mode == "token":
            token = payload.get("token")
            if token is not None and not isinstance(token, str):
                return web.json_response(
                    {
                        "status": "error",
                        "code": "bad_request",
                        "message": "Invalid token",
                    },
                    status=400,
                )
            xcontrolpanel_updater.save_github_token(token or "")
        else:
            return web.json_response(
                {
                    "status": "error",
                    "code": "bad_request",
                    "message": "Invalid mode",
                },
                status=400,
            )
    except Exception as exc:
        LOGGER.error(
            "[XControlPanel] save token failed: %s: %s",
            type(exc).__name__,
            exc,
        )
        return web.json_response(
            {
                "status": "error",
                "code": "internal",
                "message": INTERNAL_ERROR_MESSAGE,
            },
            status=500,
        )

    info = xcontrolpanel_updater.github_token_source()
    return web.json_response(
        {
            "status": "success",
            "configured": info["source"] != "none",
            "source": info["source"],
            "env_var": info["env_var"],
            "env_var_effective": info["env_var_effective"],
        }
    )
