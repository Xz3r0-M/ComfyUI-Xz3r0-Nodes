"""
XControlPanel 启动早期钩子（prestartup）。

ComfyUI 在 import torch 等核心依赖之前执行本脚本（main.py 的
execute_prestartup_script），此时没有任何 C 扩展被进程占用，是完成
「待安装依赖」的唯一可靠时机（Windows 上运行中更新会被占用文件卡住）。

无待安装标记时立即返回，不影响启动速度。
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

_MARKER_FILE = (
    Path(__file__).resolve().parent
    / "XDataSaved"
    / "settings"
    / "xcontrolpanel_update_pending.json"
)
_INSTALL_TIMEOUT_S = 600.0


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


def _has_pip() -> bool:
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "--version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def _install_command(root: Path) -> list[str]:
    requirements = str(root / "requirements.txt")
    if not _has_pip():
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
    # 无 pip 也无 uv 时仍回退到 pip 命令（会失败，但让安装步骤可见）。
    return [sys.executable, "-m", "pip", "install", "-r", requirements]


def _pending_data() -> dict:
    if not _MARKER_FILE.exists():
        return {}
    try:
        return json.loads(_MARKER_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def main() -> None:
    """检测待安装标记并执行依赖安装；完成后清理标记。"""
    if not _pending_data().get("pending"):
        return

    root = _comfyui_root()
    try:
        subprocess.run(
            _install_command(root),
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=_INSTALL_TIMEOUT_S,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass

    try:
        _MARKER_FILE.unlink()
    except OSError:
        pass


if __name__ == "__main__":
    main()
