"""
XControlPanel 更新逻辑模块。

提供 ComfyUI 版本对比（GitHub tags + releases 双接口）、git 切换与
依赖安装的纯逻辑实现，以及服务端更新状态机。不依赖 aiohttp / server，
可脱离 HTTP 层单独测试；所有网络与子进程调用均可被 mock。
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

try:
    from .logging_control import get_logger
except ImportError:  # pragma: no cover - 包外运行时的兼容回退
    from logging_control import get_logger

LOGGER = get_logger(__name__)

GITHUB_API_BASE = "https://api.github.com/repos/Comfy-Org/ComfyUI"
TAGS_URL = f"{GITHUB_API_BASE}/tags"
RELEASES_URL = f"{GITHUB_API_BASE}/releases"

REQUEST_TIMEOUT_S = 10.0
FETCH_TAGS_TIMEOUT_S = 120.0
FETCH_CHECKOUT_TIMEOUT_S = 120.0
INSTALL_TIMEOUT_S = 600.0
GIT_QUERY_TIMEOUT_S = 10.0

DEFAULT_CACHE_TTL_S = 300.0
TAGS_PER_PAGE = 100
TAGS_MAX_PAGES = 2  # 200 个最新 tag 已覆盖全部发布版与近期开发版
RELEASES_PER_PAGE = 100
RELEASES_MAX_PAGES = 1  # ComfyUI 发布版不足 100 个，一页足够判定徽标
MAX_ERROR_LENGTH = 2000

_HEADERS = {"User-Agent": "Xz3r0-Nodes-XControlPanel/2.6"}

TOKEN_ENV_VAR = "XZR3O_GITHUB_TOKEN"
_TOKEN_FILE_NAME = "xcontrolpanel_settings.json"
_PENDING_FILE_NAME = "xcontrolpanel_update_pending.json"


def _token_settings_file() -> Path:
    """令牌设置文件（XDataSaved/settings/ 下，与 XDataHub 设置同级）。"""
    return (
        Path(__file__).resolve().parent.parent
        / "XDataSaved"
        / "settings"
        / _TOKEN_FILE_NAME
    )


def _load_token_data() -> dict:
    """读取令牌设置文件内容（文件缺失或损坏时返回空字典）。"""
    path = _token_settings_file()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write_token_data(data: dict) -> None:
    """写入令牌设置文件并收紧权限（Unix 上仅本人可读写）。"""
    path = _token_settings_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    # 令牌属敏感凭据：Unix 上收紧为仅本人可读写（0600），
    # 避免同机其他账号/备份同步读到明文；Windows 上 chmod 能力
    # 有限，失败不影响功能。
    try:
        path.chmod(0o600)
    except OSError:
        pass


def _configured_env_var_name() -> str:
    """返回已配置的环境变量名（空串表示未配置）。"""
    return str(_load_token_data().get("github_token_env_var") or "").strip()


def load_github_token() -> str:
    """
    读取 GitHub 令牌，按优先级：
    配置的环境变量名 → 设置文件中的直接令牌 → 默认环境变量。
    """
    env_var = _configured_env_var_name()
    if env_var:
        env_token = os.environ.get(env_var, "").strip()
        if env_token:
            return env_token
    token = str(_load_token_data().get("github_token") or "").strip()
    if token:
        return token
    return os.environ.get(TOKEN_ENV_VAR, "").strip()


def save_github_token(token: str) -> None:
    """保存或清除（空串）直接令牌；同时清除环境变量名配置。"""
    token = str(token or "").strip()
    data = _load_token_data()
    if token:
        data["github_token"] = token
    else:
        data.pop("github_token", None)
    data.pop("github_token_env_var", None)
    _write_token_data(data)


def save_token_env_var(name: str) -> None:
    """保存或清除（空串）环境变量名；同时清除直接令牌。"""
    name = str(name or "").strip()
    data = _load_token_data()
    if name:
        data["github_token_env_var"] = name
    else:
        data.pop("github_token_env_var", None)
    data.pop("github_token", None)
    _write_token_data(data)


def github_token_source() -> dict:
    """
    返回令牌来源详情。

    source 取值：
    - "env": 环境变量生效中（env_var 为实际使用的变量名）；
    - "unset_env": 已保存变量名，但该变量在当前环境里没有值；
    - "file": 使用设置文件中的直接令牌；
    - "none": 未配置。
    env_var_effective 仅 source=env 时为 True。
    """
    env_var = _configured_env_var_name()
    if env_var:
        effective = bool(os.environ.get(env_var, "").strip())
        return {
            "source": "env" if effective else "unset_env",
            "env_var": env_var,
            "env_var_effective": effective,
        }
    if str(_load_token_data().get("github_token") or "").strip():
        return {"source": "file", "env_var": "", "env_var_effective": False}
    if os.environ.get(TOKEN_ENV_VAR, "").strip():
        return {
            "source": "env",
            "env_var": TOKEN_ENV_VAR,
            "env_var_effective": True,
        }
    return {"source": "none", "env_var": "", "env_var_effective": False}


def _build_headers() -> dict:
    """构造请求头；配置了令牌则附带 Authorization。"""
    headers = dict(_HEADERS)
    token = load_github_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _pending_install_file() -> Path:
    """待安装依赖标记文件（XDataSaved/settings/ 下）。"""
    return (
        Path(__file__).resolve().parent.parent
        / "XDataSaved"
        / "settings"
        / _PENDING_FILE_NAME
    )


def mark_pending_install(tag: str) -> None:
    """写入待安装依赖标记（代码已切换，重启后由 prestartup 完成安装）。"""
    path = _pending_install_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {"pending": True, "tag": tag}, ensure_ascii=False, indent=2
        ),
        encoding="utf-8",
    )


def clear_pending_install() -> None:
    """清除待安装依赖标记。"""
    try:
        _pending_install_file().unlink()
    except OSError:
        pass


def has_pending_install() -> bool:
    """是否存在待安装依赖标记。"""
    return _pending_install_file().exists()


_VERSION_RE = re.compile(r'__version__\s*=\s*["\']([^"\']+)["\']')
_DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")

# 更新阶段：idle → fetching → preparing → installing → done | error
PHASE_IDLE = "idle"
PHASE_FETCHING = "fetching"
PHASE_PREPARING = "preparing"
PHASE_INSTALLING = "installing"
PHASE_DONE = "done"
PHASE_ERROR = "error"

ACTIVE_PHASES = frozenset(
    {
        PHASE_FETCHING,
        PHASE_PREPARING,
        PHASE_INSTALLING,
    }
)

KIND_RELEASE = "release"
KIND_PRERELEASE = "prerelease"
KIND_DEV = "dev"


class UpdateError(Exception):
    """更新流程基类异常。"""


class GitHubRateLimitError(UpdateError):
    """GitHub API 限流（403/429）。带可重试时间（秒）。"""

    def __init__(self, message: str, retry_after: int = 0) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class GitHubNetworkError(UpdateError):
    """网络不可达或请求超时。"""


class UpdateCommandError(UpdateError):
    """git / pip 子进程执行失败（消息含 stderr 原文）。"""


class UpdateAlreadyRunningError(UpdateError):
    """已有更新正在进行。"""


@dataclass(frozen=True)
class RemoteVersion:
    """远程版本条目。"""

    tag: str
    kind: str  # release | prerelease | dev
    published_at: str = ""


# ---------------------------------------------------------------- 版本处理


def parse_version_tag(tag: str) -> tuple[int, ...]:
    """
    把标签解析成可比较的数字元组。

    "v0.3.27" → (0, 3, 27)；"v0.3.28-2025-06-13" → (0, 3, 28)。
    忽略前导 v/V 与日期/预发布后缀，只取点分数字部分。
    """
    cleaned = str(tag or "").lstrip("vV")
    if not cleaned:
        return ()
    parts: list[int] = []
    for part in cleaned.split("-", 1)[0].split("."):
        match = re.match(r"(\d+)", part)
        parts.append(int(match.group(1)) if match else 0)
    return tuple(parts)


def _extract_date(tag: str) -> tuple[int, int, int] | None:
    """提取标签里的日期后缀，如 "2025-06-13" → (2025, 6, 13)。"""
    match = _DATE_RE.search(str(tag or ""))
    if not match:
        return None
    return (int(match.group(1)), int(match.group(2)), int(match.group(3)))


_KIND_RANK = {KIND_RELEASE: 0, KIND_PRERELEASE: 1, KIND_DEV: 2}


def _version_sort_key(item: RemoteVersion) -> tuple:
    """
    生成降序排序键：基础版本号 → 版本类别 → 日期。

    同一基础版本内：发布版 > 预发布 > 开发版；开发版按日期新到旧。
    未知 kind 按最末位排（防御新增 kind 时漏改 _KIND_RANK）。
    """
    date_parts = _extract_date(item.tag) or (0, 0, 0)
    return (
        parse_version_tag(item.tag),
        -_KIND_RANK.get(item.kind, 99),
        date_parts,
        item.tag,
    )


def merge_tags_and_releases(
    tags_json: list, releases_json: list
) -> list[RemoteVersion]:
    """
    合并 tags 与 releases 两个接口结果。

    标签出现在非 draft 的 release 中 → 发布版；prerelease=True → 预发布；
    其余（含仅存在于 draft release 的标签）→ 开发版。按版本降序返回。
    """
    release_info: dict[str, tuple[bool, str]] = {}
    for release in releases_json or []:
        tag_name = str((release or {}).get("tag_name") or "")
        if not tag_name or tag_name in release_info:
            continue
        if release.get("draft"):
            continue
        release_info[tag_name] = (
            bool(release.get("prerelease")),
            str(release.get("published_at") or ""),
        )

    versions: list[RemoteVersion] = []
    for tag_entry in tags_json or []:
        tag = str((tag_entry or {}).get("name") or "")
        if not tag:
            continue
        if tag in release_info:
            prerelease, published_at = release_info[tag]
            kind = KIND_PRERELEASE if prerelease else KIND_RELEASE
        else:
            kind = KIND_DEV
            published_at = ""
        versions.append(
            RemoteVersion(tag=tag, kind=kind, published_at=published_at)
        )

    versions.sort(key=_version_sort_key, reverse=True)
    return versions


# ---------------------------------------------------------------- GitHub 拉取


def _fetch_json(url: str) -> list:
    """GET 一个 GitHub API JSON 端点，失败抛对应 UpdateError。"""
    request = urllib.request.Request(url, headers=_build_headers())
    try:
        with urllib.request.urlopen(
            request, timeout=REQUEST_TIMEOUT_S
        ) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code in (403, 429):
            raise GitHubRateLimitError(
                "GitHub API rate limit reached",
                retry_after=_rate_limit_retry_after(exc),
            ) from exc
        raise GitHubNetworkError(
            f"GitHub API returned HTTP {exc.code}"
        ) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise GitHubNetworkError("Cannot reach GitHub API") from exc


def _rate_limit_retry_after(exc: urllib.error.HTTPError) -> int:
    """从限流响应头估算可重试时间（秒），无法估算返回 0。"""
    headers = getattr(exc, "headers", None)
    if headers is None:
        return 0
    try:
        reset = headers.get("X-RateLimit-Reset")
        if reset:
            remain = int(float(reset) - time.time())
            if remain > 0:
                return remain
    except (TypeError, ValueError):
        pass
    try:
        retry_after = headers.get("Retry-After")
        if retry_after:
            return int(float(retry_after))
    except (TypeError, ValueError):
        pass
    return 0


def _fetch_json_paginated(url: str, per_page: int, max_pages: int) -> list:
    """跟随分页拉取，直到拿满或页数上限。"""
    results: list = []
    page = 1
    while page <= max_pages:
        data = _fetch_json(f"{url}?per_page={per_page}&page={page}")
        if not data:
            break
        results.extend(data)
        if len(data) < per_page:
            break
        page += 1
    return results


def fetch_remote_versions() -> list[RemoteVersion]:
    """拉取最新 tags 与全部 releases，合并成带类别的版本列表。"""
    tags = _fetch_json_paginated(TAGS_URL, TAGS_PER_PAGE, TAGS_MAX_PAGES)
    releases = _fetch_json_paginated(
        RELEASES_URL, RELEASES_PER_PAGE, RELEASES_MAX_PAGES
    )
    return merge_tags_and_releases(tags, releases)


# ---------------------------------------------------------------- 版本缓存


_cache_lock = threading.Lock()
_VERSION_CACHE: dict[str, object] = {"fetched_at": 0.0, "versions": []}


def _version_to_dict(version: RemoteVersion) -> dict:
    return {
        "tag": version.tag,
        "kind": version.kind,
        "published_at": version.published_at,
    }


def cached_versions() -> list[dict]:
    """返回缓存中的版本列表（空列表表示尚未拉取）。"""
    with _cache_lock:
        return [_version_to_dict(v) for v in _VERSION_CACHE["versions"]]  # type: ignore[arg-type]


def cached_versions_fresh() -> bool:
    """缓存是否新鲜（TTL 内且有数据）。"""
    with _cache_lock:
        versions = _VERSION_CACHE["versions"]
        fetched_at = float(_VERSION_CACHE["fetched_at"])
        return (
            bool(versions) and (time.time() - fetched_at) < DEFAULT_CACHE_TTL_S
        )


def refresh_versions() -> list[dict]:
    """强制拉取并更新缓存，返回版本列表（失败抛 UpdateError）。"""
    versions = fetch_remote_versions()
    with _cache_lock:
        _VERSION_CACHE["fetched_at"] = time.time()
        _VERSION_CACHE["versions"] = versions
    return [_version_to_dict(v) for v in versions]


def cached_or_fetch_versions() -> list[dict]:
    """缓存新鲜则直接返回，否则重新拉取。"""
    if cached_versions_fresh():
        return cached_versions()
    return refresh_versions()


# ---------------------------------------------------------------- ComfyUI 定位


def comfyui_root() -> Path:
    """
    定位 ComfyUI 代码根目录。

    用 folder_paths.py 所在目录（即 ComfyUI 安装位置），而不是
    folder_paths.base_path——后者在用户传 --base-directory 时指向
    数据根目录（如 E:/AI），并不是代码目录。.git、comfyui_version.py、
    requirements.txt 都在代码目录里。
    """
    try:
        import folder_paths

        module_file = getattr(folder_paths, "__file__", None)
        if module_file:
            return Path(module_file).resolve().parent
        # 极简 stub 环境（测试）没有 __file__，退回 base_path
        return Path(getattr(folder_paths, "base_path", Path.cwd()))
    except ImportError:  # pragma: no cover - 非 ComfyUI 环境回退
        return Path.cwd()


def get_current_version(root: Path) -> str:
    """从 comfyui_version.py 读取 __version__（正则解析，不 import）。"""
    version_file = Path(root) / "comfyui_version.py"
    try:
        content = version_file.read_text(encoding="utf-8")
    except OSError:
        return ""
    match = _VERSION_RE.search(content)
    return match.group(1) if match else ""


# ---------------------------------------------------------------- git 操作


def _trim_error(text: str) -> str:
    text = (text or "").strip()
    if len(text) > MAX_ERROR_LENGTH:
        text = f"{text[:MAX_ERROR_LENGTH]}…"
    return text


def _run_command(
    args: list[str],
    root: Path,
    timeout: float,
    check: bool = True,
) -> subprocess.CompletedProcess:
    """在 ComfyUI 根目录执行子进程，统一超时与错误包装。"""
    try:
        result = subprocess.run(
            args,
            cwd=str(root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise UpdateCommandError(f"Command not found: {args[0]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise UpdateCommandError(
            f"Command timed out after {timeout:.0f}s: {' '.join(args)}"
        ) from exc

    if check and result.returncode != 0:
        detail = _trim_error(result.stderr or result.stdout)
        raise UpdateCommandError(
            f"{' '.join(args)} failed{': ' + detail if detail else ''}"
        )
    return result


def is_git_repo(root: Path) -> bool:
    """
    是否为 git 工作树。

    优先检查 .git 目录/文件是否存在（不依赖 git 可执行文件，避免
    ComfyUI 进程 PATH 里没有 git 时的误判），再用 git rev-parse 兜底
    覆盖 worktree 等复杂场景。
    """
    root = Path(root)
    if (root / ".git").exists():
        return True
    try:
        result = _run_command(
            ["git", "rev-parse", "--is-inside-work-tree"],
            root,
            GIT_QUERY_TIMEOUT_S,
            check=False,
        )
        if result.returncode == 0:
            return True
        LOGGER.debug(
            "[xcontrolpanel] not a git work tree: %s (rc=%s)",
            root,
            result.returncode,
        )
        return False
    except UpdateCommandError as exc:
        LOGGER.warning(
            "[xcontrolpanel] git detection failed at %s: %s",
            root,
            exc,
        )
        return False


def is_dirty(root: Path) -> bool:
    """
    是否存在未提交的改动。

    只统计已跟踪文件的改动：git checkout --force 只会丢弃已跟踪文件的
    改动，未跟踪文件（status 中 "??" 开头）不受影响，不算脏。
    """
    try:
        result = _run_command(
            ["git", "status", "--porcelain"],
            root,
            GIT_QUERY_TIMEOUT_S,
            check=False,
        )
    except UpdateCommandError as exc:
        LOGGER.warning(
            "[xcontrolpanel] git status failed at %s: %s",
            root,
            exc,
        )
        return False
    if result.returncode != 0:
        return False
    return any(
        not line.startswith("??") for line in result.stdout.splitlines()
    )


def fetch_tags(root: Path) -> None:
    """拉取远端 tags。"""
    _run_command(["git", "fetch", "--tags"], root, FETCH_TAGS_TIMEOUT_S)


def checkout_tag(root: Path, tag: str) -> None:
    """强制切换到目标 tag（丢弃已跟踪文件的本地产物改动）。"""
    _run_command(
        ["git", "checkout", "--force", tag], root, FETCH_CHECKOUT_TIMEOUT_S
    )


def _interpreter_has_pip() -> bool:
    """当前解释器是否带 pip（uv 创建的 venv 通常不带）。"""
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "--version"],
            capture_output=True,
            text=True,
            timeout=GIT_QUERY_TIMEOUT_S,
        )
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def build_install_command(root: Path) -> list[str]:
    """
    构造依赖安装命令。

    优先用 ComfyUI 当前解释器（sys.executable）的 pip——它就是 ComfyUI
    正在运行的解释器，装进去一定正确。若该解释器是 uv 创建的虚拟环境
    （默认不带 pip），改用 uv 装进**同一个解释器**（uv pip install
    --python <sys.executable>），而不是错误的 uv pip --system。
    """
    requirements = str(Path(root) / "requirements.txt")
    if not _interpreter_has_pip():
        uv = shutil.which("uv")
        if uv:
            return [
                uv,
                "pip",
                "install",
                "--python",
                sys.executable,
                "-r",
                requirements,
            ]
    # 无 pip 也无 uv 时仍回退到 pip 命令（会失败，由调用方重试/报错）。
    return [sys.executable, "-m", "pip", "install", "-r", requirements]


def install_requirements(root: Path) -> None:
    """安装 requirements.txt；解释器无 pip 时自动改用 uv 重试一次。"""
    try:
        _run_command(build_install_command(root), root, INSTALL_TIMEOUT_S)
    except UpdateCommandError as exc:
        if "No module named pip" not in str(exc):
            raise
        uv = shutil.which("uv")
        if uv is None:
            raise
        _run_command(
            [
                uv,
                "pip",
                "install",
                "--python",
                sys.executable,
                "-r",
                str(Path(root) / "requirements.txt"),
            ],
            root,
            INSTALL_TIMEOUT_S,
        )


# ---------------------------------------------------------------- 更新状态机


@dataclass
class UpdateState:
    """更新流程状态（服务端单例）。"""

    phase: str = PHASE_IDLE
    detail: str = ""
    target_tag: str = ""
    error: str = ""
    error_kind: str = ""
    started_at: float = 0.0
    finished_at: float = 0.0

    @property
    def active(self) -> bool:
        return self.phase in ACTIVE_PHASES


_update_lock = threading.RLock()
_UPDATE_STATE = UpdateState()


def get_update_state() -> dict:
    """返回当前更新状态的字典快照。"""
    with _update_lock:
        return _state_to_dict(_UPDATE_STATE)


def _state_to_dict(state: UpdateState) -> dict:
    return {
        "phase": state.phase,
        "detail": state.detail,
        "target_tag": state.target_tag,
        "error": state.error,
        "error_kind": state.error_kind,
        "active": state.active,
        "started_at": state.started_at,
        "finished_at": state.finished_at,
    }


_FILE_LOCK_MARKERS = (
    "拒绝访问",
    "os error 5",
    "failed to remove",
    "access is denied",
    "errno 5",
)


def detect_file_locked(message: str) -> bool:
    """错误信息是否指向 Windows 文件占用（DLL 被运行中进程加载）。"""
    lowered = str(message or "").lower()
    return any(marker.lower() in lowered for marker in _FILE_LOCK_MARKERS)


def run_update_sync(root: Path, tag: str, state: UpdateState) -> None:
    """同步执行 fetch → checkout → pip 全流程（测试可直接调用）。"""

    def set_phase(phase: str, detail: str = "") -> None:
        with _update_lock:
            state.phase = phase
            state.detail = detail

    def finish(
        phase: str,
        detail: str | None = None,
        error: str = "",
        error_kind: str = "",
    ) -> None:
        """写入终态；detail 为 None 时保留当前值（如失败分支的进度提示）。"""
        with _update_lock:
            state.phase = phase
            if detail is not None:
                state.detail = detail
            state.error = error
            state.error_kind = error_kind
            state.finished_at = time.time()

    try:
        set_phase(PHASE_FETCHING, "git fetch --tags")
        fetch_tags(root)

        set_phase(PHASE_PREPARING, f"git checkout --force {tag}")
        checkout_tag(root, tag)

        set_phase(PHASE_INSTALLING, "install requirements.txt")
        try:
            install_requirements(root)
        except UpdateCommandError as exc:
            if not detect_file_locked(str(exc)):
                raise
            # Windows 文件占用：代码已切换，依赖留到重启后由 prestartup 完成
            mark_pending_install(tag)
            finish(
                PHASE_DONE,
                "pending_restart",
                _trim_error(str(exc)),
                "pending_restart",
            )
            return

        finish(PHASE_DONE, detail="")
    except UpdateError as exc:
        finish(
            PHASE_ERROR,
            error=_trim_error(str(exc)),
            error_kind=("file_locked" if detect_file_locked(str(exc)) else ""),
        )
    except Exception as exc:  # noqa: BLE001 - 兜底记录
        LOGGER.error("[xcontrolpanel] update failed unexpectedly: %s", exc)
        finish(PHASE_ERROR, error=_trim_error(f"Unexpected error: {exc}"))


def start_update(root: Path, tag: str) -> None:
    """在后台线程启动更新；已有更新进行中则抛 UpdateAlreadyRunningError。"""
    global _UPDATE_STATE
    with _update_lock:
        if _UPDATE_STATE.active:
            raise UpdateAlreadyRunningError("an update is already running")
        state = UpdateState(
            phase=PHASE_FETCHING,
            detail="git fetch --tags",
            target_tag=tag,
            started_at=time.time(),
        )
        _UPDATE_STATE = state

    thread = threading.Thread(
        target=run_update_sync,
        args=(root, tag, state),
        daemon=True,
        name="xcontrolpanel-update",
    )
    thread.start()
