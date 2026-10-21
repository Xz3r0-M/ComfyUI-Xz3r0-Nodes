"""
XControlPanel 启动早期钩子（prestartup）。

ComfyUI 在 import torch 等核心依赖之前执行本文件（main.py 的
execute_prestartup_script），此时没有任何 C 扩展被进程占用，是完成
「待安装依赖」的唯一可靠时机（Windows 上运行中更新会被占用文件卡住）。

⚠️ 执行方式是 `importlib.util.spec_from_file_location` + `exec_module`，
也就是「当模块导入」，**不是**「当脚本运行」：`__name__` 是文件路径而
不是 `"__main__"`。所以文件末尾必须用 `_should_autorun(__name__)` 触发，
只写 `if __name__ == "__main__":` 的话，这个钩子永远不会真正干活（历史
bug：标记写得好好的、启动日志里却什么都不动）。

无待安装标记时立即返回，不影响启动速度。
"""

import collections
import importlib.metadata
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

_MARKER_FILE = (
    Path(__file__).resolve().parent
    / "XDataSaved"
    / "settings"
    / "xcontrolpanel_update_pending.json"
)
# 30 分钟：网络慢或依赖多时 10 分钟可能不够（审查报告 §3.2.1）
_INSTALL_TIMEOUT_S = 1800.0
# 连续失败几次就退回切换前的版本，免得一直启动不了
_MAX_INSTALL_ATTEMPTS = 2
_GIT_TIMEOUT_S = 120
# 一次启动里最多试这么多次（普通失败）
_INSTALL_TRIES = 3
_RETRY_DELAY_S = 2.0
# 撞到「文件还被占用」时：先盯着那个文件，等它真的放开（而不是盲等）
_LOCK_WAIT_S = 20.0
_LOCK_POLL_S = 1.0
_LOCK_MAX_TRIES = 4
# 从错误输出里叼出被占用的文件路径。
# uv 有时写成 `...\aimdo.dll`（反引号），有时是
# "failed to rename file from X to Y" 这种裸路径，两种都要认。
_LOCK_PATH_RE = re.compile(r"`([^`]+\.(?:dll|pyd|so|so\.\d+))`", re.IGNORECASE)
_BARE_PATH_RE = re.compile(
    r"([A-Za-z]:\\[^:*?\"<>|\r\n]+\.(?:dll|pyd|so))"
    r"|(/[^:*?\"<>|\r\n]+\.(?:dll|pyd|so))",
    re.IGNORECASE,
)
# 等更早那个 ComfyUI 进程退出的最长时间（只等待，不强制结束）
_SIBLING_WAIT_S = 5.0
# 接力进程的命令行里带这个标记，用来把它和「真正的 ComfyUI 进程」区分开
_RELAUNCH_FLAG = "--xcontrolpanel-relauncher"
_PIN_RE = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9_.\-]*)\s*==\s*([^\s;#]+)")

# 日志前缀用节点名，让用户在启动日志里一眼看出信息来源
_LOG_TAG = "[XControlPanel]"
# 安装输出同时留一份到文件，重启后再来查也有据可依
_LOG_FILE_NAME = "xcontrolpanel_install.log"
_LOG_MAX_BYTES = 512 * 1024
# 失败时只把最后这么多行当成错误摘要（前面是常规进度）
_TAIL_LINES = 30
# 认错误签名要扫更多行（uv 的 Caused by 在末尾几行，但要往前找 warning）
_COLLECT_LINES = 400
# 「文件被别的进程占着」类错误：等一会儿再试通常就好了
_LOCK_HINTS = (
    "拒绝访问",
    "access is denied",
    "os error 5",
    "being used by another process",
    "另一个程序正在使用此文件",
    "cannot access the file",
)
# 「安装记录残缺」类错误：旧包的 dist-info 没有 RECORD，卸不干净
_BROKEN_DIST_HINTS = ("missing `record`", "missing record")


def _log_file() -> Path:
    """安装日志文件（与待安装标记放一起，测试跟着标记一起隔离）。"""
    return _MARKER_FILE.parent / _LOG_FILE_NAME


def _say(message: str, error: bool = False) -> None:
    """只打到 cmd 控制台（不进日志文件）。"""
    print(
        f"{_LOG_TAG} {message}",
        file=sys.stderr if error else sys.stdout,
        flush=True,
    )


def _log(message: str, error: bool = False) -> None:
    """打到 cmd 控制台，同时追加到安装日志文件。"""
    _say(message, error=error)
    try:
        path = _log_file()
        if path.exists() and path.stat().st_size > _LOG_MAX_BYTES:
            # 只留最近一段，避免日志无限长大
            tail = path.read_text(encoding="utf-8", errors="replace")
            path.write_text(
                "…truncated…\n" + tail[-_LOG_MAX_BYTES // 2 :],
                encoding="utf-8",
            )
        with path.open("a", encoding="utf-8") as handle:
            handle.write(message + "\n")
    except OSError:
        pass


def _pins(root: Path) -> dict[str, str]:
    """requirements.txt 里 `包名==版本` 的固定项（跳过带平台标记的行）。"""
    path = Path(root) / "requirements.txt"
    pins: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return pins
    for raw in lines:
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("-") or ";" in line:
            continue
        match = _PIN_RE.match(line)
        if match:
            pins[match.group(1).lower()] = match.group(2)
    return pins


def _module_importable(dist_name: str) -> bool:
    """
    这个包对应的模块能不能导入。

    为什么要这一步：某些安装损坏过（dist-info 少了 RECORD），版本号读
    不出来，但模块本身是好的。只按元数据判断会误判成「没装」，进而每次
    切换都被判失败、最后误回滚。
    """
    candidates = {
        dist_name.replace("-", "_"),
        dist_name.replace("-", "_").lower(),
    }
    for name in candidates:
        try:
            if importlib.util.find_spec(name) is not None:
                return True
        except (ImportError, ValueError):
            continue
    return False


def _pin_problems(root: Path) -> list[str]:
    """
    装完之后核对：固定版本项是不是真的装成了。

    为什么要核对：uv/pip 中途失败时不会回滚。实测过一次切换里
    `aimdo.dll` 被占用，uv 在「先卸载、再安装」的中途报错退出，
    结果另外两个包（comfyui-workflow-templates 等）被卸掉没装回来 ——
    命令返回非 0 能发现，但「返回 0 却少了包」只能靠这里核对。
    """
    problems: list[str] = []
    for name, want in _pins(root).items():
        try:
            have = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            if not _module_importable(name):
                problems.append(f"{name}=={want} (not installed)")
            continue
        except Exception:  # noqa: BLE001 - 元数据异常不该拦住启动
            continue
        if have != want:
            problems.append(f"{name}=={want} (installed {have})")
    return problems


def _pins_satisfied(root: Path) -> bool:
    """
    是不是所有固定版本项都已经装成了？

    这个判断用的是**严格**标准（元数据必须能报出确切版本），比
    `_pin_problems` 严：后者为了不误回滚会容忍元数据损坏，但拿来当
    「跳过安装」的依据就太宽松了 —— 元数据坏了恰恰说明需要重装。

    为什么要先判断：安装是最危险的动作（要卸载、要覆盖 dll）。已经满足
    时直接跳过，就完全不会碰被别的进程占着的文件 —— 这也是 ComfyUI-
    Manager 很少撞锁的真正原因（它每个包都先 `is_installed` 跳过）。
    """
    pins = _pins(root)
    if not pins:
        return True
    for name, want in pins.items():
        try:
            if importlib.metadata.version(name) != want:
                return False
        except Exception:  # noqa: BLE001 - 读不出来就当作没装好
            return False
    return True


def _reinstall_command(root: Path, specs: list[str]) -> list[str]:
    """
    强制重装指定的包（修「dist-info 在、文件却被删」这类半坏状态）。

    uv 用 `--reinstall-package`，pip 没有这个参数，改用
    `--force-reinstall --no-deps` 单独装这几个。
    """
    command = _install_command(root)
    if command and Path(command[0]).name.lower().startswith("uv"):
        for spec in specs:
            command = [*command, "--reinstall-package", spec.split("==")[0]]
        return command
    return [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--force-reinstall",
        "--no-deps",
        *specs,
    ]


@dataclass
class _InstallResult:
    """一次安装尝试的结果。"""

    ok: bool = False
    detail: str = ""
    exc: BaseException | None = None
    lines: list[str] = field(default_factory=list)

    def mentions(self, hints: tuple[str, ...]) -> bool:
        blob = "\n".join(self.lines).lower()
        return any(hint.lower() in blob for hint in hints)

    @property
    def file_locked(self) -> bool:
        return self.mentions(_LOCK_HINTS)

    @property
    def broken_metadata(self) -> bool:
        return self.mentions(_BROKEN_DIST_HINTS)


def _failed(detail: str, exc: BaseException | None = None) -> _InstallResult:
    return _InstallResult(ok=False, detail=detail, exc=exc)


def _run_install(root: Path, command: list[str]) -> _InstallResult:
    """
    跑一次安装命令。

    输出必须**实时打到控制台**：这个钩子在 ComfyUI 起界面之前跑，用户
    盯着 cmd 窗口是唯一能看见进度的地方；如果按老办法 `capture_output`
    把输出收进变量里，装几分钟窗口里一行字都不动，看起来就像什么都没
    发生（用户已经这么误会过一次）。
    """
    try:
        process = subprocess.Popen(
            command,
            cwd=str(root),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            # 中文 Windows 默认 GBK，uv 输出是 UTF-8：不指定就会半路
            # UnicodeDecodeError 中断读取，连真正的报错都看不到。
            errors="replace",
            bufsize=1,
        )
    except OSError as exc:
        return _failed(f"{type(exc).__name__}: {exc}", exc)

    timed_out = {"hit": False}

    def _kill() -> None:
        timed_out["hit"] = True
        try:
            process.kill()
        except OSError:
            pass

    watchdog = threading.Timer(_INSTALL_TIMEOUT_S, _kill)
    watchdog.daemon = True
    watchdog.start()
    tail: collections.deque[str] = collections.deque(maxlen=_TAIL_LINES)
    collected: list[str] = []
    try:
        stream = process.stdout
        if stream is not None:
            for raw in stream:
                line = raw.rstrip()
                if not line:
                    continue
                tail.append(line)
                if len(collected) < _COLLECT_LINES:
                    collected.append(line)
                _log("  " + line)
        code = process.wait()
    except Exception as exc:  # noqa: BLE001 - 读流出错也要收尾
        try:
            process.kill()
        except OSError:
            pass
        return _InstallResult(
            detail=f"{type(exc).__name__}: {exc}", exc=exc, lines=collected
        )
    finally:
        watchdog.cancel()

    if timed_out["hit"]:
        exc = subprocess.TimeoutExpired(
            cmd=command, timeout=_INSTALL_TIMEOUT_S
        )
        return _InstallResult(
            detail=f"TimeoutExpired: {_INSTALL_TIMEOUT_S:.0f}s",
            exc=exc,
            lines=collected,
        )
    if code == 0:
        return _InstallResult(ok=True, lines=collected)
    return _InstallResult(detail="\n".join(tail).strip(), lines=collected)


def _safe_install(root: Path, command: list[str]) -> _InstallResult:
    """包一层异常兜底：安装环节怎么炸都不该让 ComfyUI 起不来。"""
    try:
        return _run_install(root, command)
    except Exception as exc:  # noqa: BLE001 - 启动路径必须兜住
        return _failed(f"{type(exc).__name__}: {exc}", exc)


def _site_packages() -> Path | None:
    """当前解释器的 site-packages（装包就落在这里）。"""
    try:
        import sysconfig  # noqa: PLC0415 - 只在需要时导入

        paths = sysconfig.get_paths()
    except Exception:  # noqa: BLE001 - 取不到就别动文件
        return None
    for key in ("purelib", "platlib"):
        value = paths.get(key)
        if value and Path(value).is_dir():
            return Path(value)
    return None


def _normalize(name: str) -> str:
    """包名归一化（PEP 503）：连字符/下划线/点等价，大小写无关。"""
    return re.sub(r"[-_.]+", "-", name).strip().lower()


def _drop_broken_dist_info(root: Path) -> list[str]:
    """
    删掉「没有 RECORD 文件」的残缺 dist-info。

    这种残留会让 uv 报 `Failed to uninstall ... due to missing RECORD
    file`，然后卸不干净也装不上（用户实测卡在 comfy_aimdo 0.5.5→0.5.6）。
    包本身是坏的，删这份元数据是安全的：紧接着的安装会重新写一份。
    只碰 requirements.txt 里固定版本那些包，别的目录一概不动。
    """
    site = _site_packages()
    if site is None:
        return []
    wanted = {_normalize(name) for name in _pins(root)}
    removed: list[str] = []
    for entry in site.iterdir():
        name = entry.name
        if not entry.is_dir() or not name.endswith(".dist-info"):
            continue
        # dist-info 目录名用下划线（comfy_kitchen-0.2.31），
        # requirements.txt 里是连字符（comfy-kitchen），统一后再比
        dist = _normalize(name[: -len(".dist-info")].split("-")[0])
        if dist not in wanted:
            continue
        if (entry / "RECORD").exists():
            continue
        try:
            shutil.rmtree(entry)
        except OSError as exc:
            _log_error(f"Cannot remove broken metadata {name}: {exc}")
            continue
        removed.append(name)
    return removed


def _locked_paths(result: _InstallResult) -> list[Path]:
    """从失败输出里找出被占用的文件。"""
    found: list[Path] = []

    def _remember(raw: str) -> None:
        path = Path(raw)
        if path not in found:
            found.append(path)

    for line in result.lines:
        for match in _LOCK_PATH_RE.finditer(line):
            _remember(match.group(1))
        for match in _BARE_PATH_RE.finditer(line):
            _remember(match.group(1) or match.group(2))
    return found


def _file_is_locked(path: Path) -> bool:
    """
    这个文件现在还被别的进程占着吗？

    Windows 上被加载成模块的 dll/pyd 仍然可以只读打开，但拿不到写权限，
    所以用「能不能以读写方式打开」来判断。
    """
    try:
        with path.open("r+b"):
            return False
    except FileNotFoundError:
        return False
    except OSError:
        return True


def _wait_until_free(paths: list[Path], timeout: float) -> bool:
    """盯着这些文件，直到它们都被放开（或超时）。"""
    if not paths:
        return False
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not any(_file_is_locked(path) for path in paths):
            return True
        time.sleep(_LOCK_POLL_S)
    return not any(_file_is_locked(path) for path in paths)


def _own_start_time() -> float | None:
    """本进程的启动时刻（拿不到就返回 None，后面就保守不动手）。"""
    try:
        import psutil  # noqa: PLC0415

        return psutil.Process(os.getpid()).create_time()
    except Exception:  # noqa: BLE001 - 没有 psutil 就算了
        return None


def _python_processes() -> list[dict]:
    """列出其它 python 进程（pid + 命令行），用于找「谁占着文件」。"""
    me = os.getpid()
    try:
        import psutil  # noqa: PLC0415 - 有就用，信息最全

        found = []
        for proc in psutil.process_iter(
            ["pid", "name", "cmdline", "create_time"]
        ):
            try:
                info = proc.info
                name = (info.get("name") or "").lower()
                if not name.startswith("python") or info.get("pid") == me:
                    continue
                found.append(
                    {
                        "pid": int(info.get("pid") or 0),
                        "cmdline": " ".join(info.get("cmdline") or []),
                        "create_time": info.get("create_time"),
                    }
                )
            except Exception:  # noqa: BLE001, S112 - 拿不到就跳过
                continue
        return found
    except ImportError:
        pass
    if sys.platform != "win32":
        return []
    try:
        output = subprocess.run(
            [
                "tasklist",
                "/FI",
                "IMAGENAME eq python.exe",
                "/FO",
                "CSV",
                "/NH",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    found = []
    for line in output.splitlines():
        parts = line.replace('"', "").split(",")
        if len(parts) >= 2 and parts[1].isdigit() and parts[1] != str(me):
            found.append({"pid": int(parts[1]), "cmdline": ""})
    return found


def _looks_like_comfyui(cmdline: str) -> bool:
    """
    这条命令行是不是另一个 ComfyUI 主进程。

    只认 `main.py` / `__main__.py` / `-m comfyui` 这几种明确形态。**不能**
    只看命令行里有没有 "comfyui" 字样 —— venv 路径 `comfyui-xz3r0` 这种
    会误伤，把无关的 python 当成 ComfyUI 白等好几秒。
    """
    text = cmdline.replace("\\", "/").lower()
    # 接力进程的命令行里含有 main.py 这段源码文本，会把「自己」误判成
    # 另一个 ComfyUI（实测过：白等 5 秒 + 往控制台打一整段源码）
    if _RELAUNCH_FLAG in cmdline:
        return False
    if "main.py" in text or "__main__.py" in text:
        return True
    return " -m comfyui" in text


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        import psutil  # noqa: PLC0415

        return psutil.pid_exists(pid)
    except ImportError:
        pass
    if sys.platform == "win32":
        try:
            import ctypes  # noqa: PLC0415

            kernel32 = ctypes.windll.kernel32
            handle = kernel32.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED
            if not handle:
                return False
            try:
                code = ctypes.c_ulong()
                if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                    return False
                return code.value == 259  # STILL_ACTIVE
            finally:
                kernel32.CloseHandle(handle)
        except Exception:  # noqa: BLE001 - 判断不出来就当还活着
            return True
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except OSError:
        return True


def _stale_siblings() -> list[dict]:
    """
    找出「同一条启动链里更早的那个 ComfyUI 进程」。

    只认三种特征同时成立：命令行像 ComfyUI、比本进程启动得早、还活着。
    比本进程晚的不算（那可能是刚起来的新进程，绝不能动）。
    """
    started = _own_start_time()
    if started is None:
        return []
    me = os.getpid()
    found = []
    for proc in _python_processes():
        pid = int(proc.get("pid") or 0)
        created = proc.get("create_time")
        if pid == me or created is None or created >= started:
            continue
        if not _looks_like_comfyui(proc.get("cmdline") or ""):
            continue
        if not _pid_alive(pid):
            continue
        found.append(proc)
    return found


def _clear_stale_siblings(timeout: float = _SIBLING_WAIT_S) -> list[str]:
    """
    等「更早启动的那个 ComfyUI 进程」自己退出，只等、**绝不动手**。

    ⚠️ 这里曾经试过「等不到就 TerminateProcess 掉它」，结果把用户正在
    启动的 ComfyUI 干掉了，直接启动不了。原因是这种判断根本不可靠：
      * 10 秒等待期间 PID 可能被系统回收再分配，杀掉的会是别的进程；
      * 那个进程可能正是即将接手服务的那个，杀了就等于自杀；
      * 从启动前的钩子里结束别人的进程，本来就不该由这个模块决定。
    所以退回「只等待 + 只报告」：等不到就照常尝试安装，装不上由重试和
    日志负责说明。
    """
    deadline = time.monotonic() + timeout
    siblings: list[dict] = []
    announced = False
    while time.monotonic() < deadline:
        siblings = _stale_siblings()
        if not siblings:
            return []
        if not announced:
            _log(
                "an older ComfyUI process is still running ("
                + ", ".join(f"pid {p['pid']}" for p in siblings)
                + ") - waiting up to "
                f"{timeout:.0f}s for it to exit…"
            )
            announced = True
        time.sleep(_LOCK_POLL_S)
    return [
        f"pid {p['pid']} {(p.get('cmdline') or '')[:80]}".strip()
        for p in siblings
    ]


def _other_python_processes() -> list[str]:
    """
    还有哪些 python 进程在跑（以及它们在跑什么）。

    用户看到 `拒绝访问` 时最需要知道的就是「谁占着这个 dll」——实测常见
    原因是另一个 ComfyUI 窗口没关，这时再怎么重试都装不上。
    """
    return [
        f"pid {proc['pid']} {(proc.get('cmdline') or '')[:120]}".strip()
        for proc in _python_processes()
    ]


def _problems_for_targeted_install(root: Path) -> list[str]:
    """需要动文件的固定版本项：版本不符，或元数据读不出来（半坏）。"""
    return [
        item
        for item in _pin_problems(root)
        if "not installed" in item or "installed " in item
    ]


def _install_individually(root: Path, problems: list[str]) -> list[str]:
    """
    把没对上的包一个个单独装（最多 20 个），返回仍然没装好的。

    一个包被占用时，整批安装会失败，但其它包其实装上了；逐个装能让
    「被占用的那个」不再拖累别人。
    """
    specs = _problem_specs(problems)[:20]
    remaining: list[str] = []
    for spec in specs:
        _log(f"installing {spec} on its own…")
        result = _safe_install(root, _spec_command(spec))
        if not result.ok:
            _log_error(f"{spec} could not be installed: {result.detail}")
            remaining.append(spec)
    return remaining


def _retry_delay(attempt: int) -> float:
    """退避：重启瞬间旧进程可能还占着文件，等得越久越可能成功。"""
    return _RETRY_DELAY_S * (3 ** (attempt - 1))


def _describe_pins(root: Path) -> str:
    """把固定版本项的当前版本拼成一行，写进启动日志方便核对。"""
    parts = []
    for name in _pins(root):
        try:
            parts.append(f"{name} {importlib.metadata.version(name)}")
        except Exception:  # noqa: BLE001 - 只用于日志
            parts.append(f"{name} ?")
    return ", ".join(parts) if parts else "nothing pinned"


def _problem_specs(problems: list[str]) -> list[str]:
    """从 `name==ver (…)` 里取出 `name==ver`，给强制重装用。"""
    specs = []
    for item in problems:
        spec = item.split(" ", 1)[0]
        if "==" in spec:
            specs.append(spec)
    return specs


def _comfyui_root() -> Path:
    """定位 ComfyUI 代码根（folder_paths.py 所在目录）。"""
    try:
        import folder_paths  # noqa: PLC0415 - prestartup 阶段才可用的模块

        module_file = getattr(folder_paths, "__file__", None)
        if module_file:
            return Path(module_file).resolve().parent
    except ImportError:
        pass
    # 兜底：custom_nodes/本扩展 → 上级上级即 ComfyUI 根
    return Path(__file__).resolve().parent.parent.parent


def _has_module(name: str) -> bool:
    """这个 Python 环境里能不能 `python -m <name>`。"""
    try:
        result = subprocess.run(
            [sys.executable, "-m", name, "--version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def _has_pip() -> bool:
    return _has_module("pip")


def _install_prefix() -> list[str]:
    """
    安装命令的前缀（到 `install` 为止）。

    顺序很重要：有 pip 用 pip；没有 pip 就找 uv 可执行文件；连 uv 都不在
    PATH 上时用 `python -m uv`（ComfyUI-Manager 在同样的「没有 pip」环境
    里就是这么干的）；全都不可用才退回 pip 命令，至少让错误看得见。
    """
    if not _has_pip():
        uv = shutil.which("uv")
        if uv:
            return [uv, "pip", "install", "--python", sys.executable]
        if _has_module("uv"):
            return [
                sys.executable,
                "-m",
                "uv",
                "pip",
                "install",
                "--python",
                sys.executable,
            ]
    return [sys.executable, "-m", "pip", "install"]


def _install_command(root: Path) -> list[str]:
    """整份 requirements.txt 一起装。"""
    return [*_install_prefix(), "-r", str(root / "requirements.txt")]


def _spec_command(spec: str) -> list[str]:
    """只装一个包（`包名==版本`）。

    为什么要能单独装：整批安装时只要有一个文件被占用，整条命令就返回失
    败，但其它包其实已经装上了 —— 逐个补装能把「能装的」都装好，只把真
    正被锁的那个留在旧版本，而不是全军覆没。
    """
    return [*_install_prefix(), spec]


def _pending_data() -> dict:
    if not _MARKER_FILE.exists():
        return {}
    try:
        return json.loads(_MARKER_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _save_pending(data: dict) -> None:
    try:
        _MARKER_FILE.parent.mkdir(parents=True, exist_ok=True)
        _MARKER_FILE.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError as exc:
        _log_error(f"Cannot update the pending marker: {exc}")


def _clear_pending() -> None:
    try:
        _MARKER_FILE.unlink()
    except OSError:
        pass


def _rollback(root: Path, previous: str) -> bool:
    """把 ComfyUI 代码退回切换前的版本。"""
    try:
        result = subprocess.run(
            ["git", "checkout", "--force", previous],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=_GIT_TIMEOUT_S,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        _log_error(f"Rollback failed: {exc}. Please switch version manually.")
        return False
    if result.returncode != 0:
        _log_error(
            "Rollback failed (exit code "
            f"{result.returncode}): {result.stderr.strip()}"
        )
        return False
    return True


def _manual_hint(root: Path) -> str:
    """给一条能直接粘贴的补救命令。"""
    return " ".join([*_install_command(root), "--reinstall"])


def _handle_failure(
    root: Path, data: dict, message: str, locked: bool = False
) -> None:
    """
    安装失败后的处理：先留着标记下次再试，连续失败就退回旧版本。

    只保留标记的话，一旦这个版本的依赖永远装不上（网络、包被删等），
    用户每次启动都会崩，只能手动去 git 切换 —— 这不该由用户来兜底。

    但「回滚」是很重的操作（等于把用户降级），所以只有一个前提才做：
    真的有包**缺失**。如果只是版本号对不上、模块都还在（实测
    comfy-aimdo 0.5.5→0.5.6 装不上但 0.42.1 照常启动），那就保持版本不
    动、清掉标记，只提示手动重装 —— 免得用户莫名被降级，还每次启动都
    多等半分钟重试。
    """
    problems = _pin_problems(root)
    missing = [item for item in problems if "not installed" in item]
    if not missing and locked:
        # 只是文件被别的进程占着：不是版本问题，留着标记下次启动再试
        attempts = int(data.get("attempts") or 0) + 1
        if attempts < _MAX_INSTALL_ATTEMPTS:
            data["attempts"] = attempts
            _save_pending(data)
            _log_error(
                f"{message}. A file is still in use by another process; it "
                f"will retry on the next launch (attempt {attempts})."
            )
            _finish_log(f"failed · {message} · waiting for the file lock")
            return
    if not missing:
        if problems:
            _log_error(
                f"{message}. Installed versions differ from this version's "
                f"pins but the packages are present: {'; '.join(problems)}. "
                "Keeping the current version. Reinstall manually with: "
                f"{_manual_hint(root)}"
            )
        else:
            _log_error(
                f"{message}. All pinned packages are present, so the "
                "version is kept. Reinstall manually with: "
                f"{_manual_hint(root)}"
            )
        _clear_pending()
        _finish_log(f"failed · {message} · kept the current version")
        return

    attempts = int(data.get("attempts") or 0) + 1
    previous = str(data.get("previous") or "")
    if attempts < _MAX_INSTALL_ATTEMPTS or not previous:
        data["attempts"] = attempts
        _save_pending(data)
        _log_error(
            f"{message}. The pending marker stays; it will retry on next "
            f"launch (attempt {attempts})."
        )
        _finish_log(f"failed · {message}")
        return

    _log_error(
        f"{message}. Giving up after {attempts} attempts and rolling "
        f"ComfyUI back to {previous} so it can start."
    )
    if _rollback(root, previous):
        _clear_pending()
        _finish_log(f"rollback · {message} · back to {previous}")
        return
    _finish_log(f"failed · {message} · rollback failed")


def _log_error(message: str) -> None:
    """prestartup 阶段无日志框架可用（且在 torch 导入前运行），
    直接写 stderr 供用户在启动终端中查看。
    """
    _log(message, error=True)


def _start_log(tag: str, previous: str) -> None:
    """写一段分隔头，把这次启动的安装记录和以前的区分开。"""
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    _log("")
    _log(f"=== {stamp} · target {tag} · previous {previous or '?'} ===")


def _finish_log(result: str) -> None:
    """收尾行，面板/用户据此判断这次装成了没有。"""
    _log(f"result: {result}")


def main(root: Path | None = None) -> None:
    """
    检测待安装标记并执行依赖安装；装好并核对通过后才清理标记。

    `root` 可以显式指定 ComfyUI 代码根目录。这个参数很重要：本模块也会
    被「重启接力进程」调用，那是个还没有 import 任何 ComfyUI 模块的干净
    进程，拿不到 folder_paths，自动探测会算错路径。
    """
    data = _pending_data()
    if not data.get("pending"):
        # 每个启动都留一行：用户能确认钩子真的跑了（之前就因为“看不
        # 到任何动静”怀疑过依赖到底装没装）。
        _say("prestartup: no pending dependency install.")
        return

    root = Path(root) if root is not None else _comfyui_root()
    tag = data.get("tag") or "?"
    _start_log(tag, str(data.get("previous") or ""))

    if _pins_satisfied(root):
        # 一个包都不用改：不启动 uv、不碰 site-packages，最安全也最快
        _log(
            f"All pinned packages already match {tag}: "
            f"{_describe_pins(root)} - nothing to install."
        )
        _clear_pending()
        _finish_log(f"success (already satisfied: {_describe_pins(root)})")
        return

    # 先等重启前那个进程真正退出：它没退出时 aimdo.dll 之类的文件被锁着，
    # 覆盖必然失败（用户的日志里能看到旧进程的 pid 还在）。
    stuck = _clear_stale_siblings()
    if stuck:
        _log_error(
            "these ComfyUI processes are still running: "
            f"{'; '.join(stuck)}. Files they hold may block installation; "
            "close them and restart if the install below fails."
        )
    _log(f"Installing dependencies for {tag} before ComfyUI loads…")
    _log(f"command: {' '.join(_install_command(root))}")

    last_error = ""
    max_attempts = _INSTALL_TRIES
    attempt = 0
    while attempt < max_attempts:
        attempt += 1
        _log(f"attempt {attempt}/{max_attempts}")
        result = _safe_install(root, _install_command(root))
        if not result.ok:
            last_error = result.detail
            _log_error(f"Install attempt {attempt} failed: {last_error}")
            if result.file_locked:
                max_attempts = max(max_attempts, _LOCK_MAX_TRIES)
                locked = _locked_paths(result)
                holders = _other_python_processes()
                _log(
                    "a file is still in use (likely another python/ComfyUI "
                    "process): "
                    + (", ".join(str(p) for p in locked) or "unknown file")
                )
                if holders:
                    _log("other python processes: " + "; ".join(holders))
                if locked and _wait_until_free(locked, _LOCK_WAIT_S):
                    _log("the file was released - retrying right away")
                    continue
                if holders and attempt >= 2:
                    # 一直锁着 + 确实有别的 python 在跑：再等也没用
                    last_error += (
                        " · file still locked by another python process; "
                        "close it and restart"
                    )
                    break
            if result.broken_metadata:
                removed = _drop_broken_dist_info(root)
                if removed:
                    _log(
                        "removed broken package metadata: "
                        + ", ".join(removed)
                    )
                    continue
            pending = _problems_for_targeted_install(root)
            if pending:
                # 整批失败时其它包通常已经装上了，把缺的逐个补一遍
                remaining = _install_individually(root, pending)
                if not remaining and not _pin_problems(root):
                    _clear_pending()
                    _log(
                        f"Dependencies installed ({tag}): "
                        f"{_describe_pins(root)}"
                    )
                    _finish_log(f"success ({_describe_pins(root)})")
                    return
        else:
            problems = _pin_problems(root)
            if not problems:
                _clear_pending()
                _log(f"Dependencies installed ({tag}): {_describe_pins(root)}")
                _finish_log(f"success ({_describe_pins(root)})")
                return
            # 版本/包对不上：多半是上一次安装中途失败留下的半坏状态，
            # 把这些包强制重装一次再核对。
            last_error = "dependency check failed: " + "; ".join(problems)
            _log_error(last_error)
            repair = _safe_install(
                root, _reinstall_command(root, _problem_specs(problems))
            )
            if repair.broken_metadata:
                _drop_broken_dist_info(root)
            if repair.ok and not _pin_problems(root):
                _clear_pending()
                _log(
                    f"Dependencies repaired and installed ({tag}): "
                    f"{_describe_pins(root)}"
                )
                _finish_log(f"success ({_describe_pins(root)})")
                return
            if repair.detail:
                last_error = repair.detail
            if repair.file_locked:
                max_attempts = max(max_attempts, _LOCK_MAX_TRIES)
                locked = _locked_paths(repair)
                if locked:
                    _wait_until_free(locked, _LOCK_WAIT_S)

        if attempt < max_attempts:
            delay = _retry_delay(attempt)
            _log(f"retrying in {delay:.0f}s…")
            time.sleep(delay)

    _handle_failure(
        root,
        data,
        f"Install failed: {last_error}",
        locked=bool(last_error)
        and any(hint.lower() in last_error.lower() for hint in _LOCK_HINTS),
    )


def _should_autorun(name: str) -> bool:
    r"""
    判断现在是不是「ComfyUI 正在执行本文件」，是就立刻开工。

    ComfyUI 的 execute_prestartup_script 用 `spec_from_file_location` 把
    文件当模块导入，模块名就是去掉 .py 的完整路径（例如
    `E:\AI\custom_nodes\ComfyUI-Xz3r0-Nodes\prestartup_script`），所以
    带路径分隔符；正常 `import prestartup_script` 的模块名是纯标识符，
    这时不自动执行（测试就是这样导入的，不能让一次 import 就真的开始装
    依赖）。
    """
    if name == "__main__":
        return True
    return "/" in name or "\\" in name


if _should_autorun(__name__):
    main()
