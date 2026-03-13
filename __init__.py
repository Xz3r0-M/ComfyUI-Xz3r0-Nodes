"""
ComfyUI-Xz3r0-Nodes
===================

ComfyUI 自定义节点库，提供多种实用节点。
使用 V3 API 注册方式。
"""

import importlib
import importlib.metadata
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from comfy_api.latest import ComfyExtension, io
from typing_extensions import override

# ================================
# 导入 API 模块（必须先导入以注册路由）
# ================================
# 这个导入会触发 API 路由的注册
# 必须在导入节点模块之前完成
from .api import xworkflowsave_api

# ================================
# 不要移动
print(
    """
[Xz3r0-Nodes] ============= ComfyUI-Xz3r0-Nodes =============""",
    flush=True,
)
# ================================
# 节点导入规格
# ================================


@dataclass(frozen=True)
class NodeImportSpec:
    """
    节点导入规则，控制依赖与加载条件。
    """

    module_name: str
    class_name: str
    required_python_packages: tuple[str, ...] = ()
    requires_ffmpeg: bool = False


NODE_IMPORT_SPECS: tuple[NodeImportSpec, ...] = (
    NodeImportSpec("xanytostring", "XAnyToString"),
    NodeImportSpec("xdatetimestring", "XDateTimeString"),
    NodeImportSpec("xmath", "XMath"),
    NodeImportSpec("xresolution", "XResolution"),
    NodeImportSpec("xstringgroup", "XStringGroup"),
    NodeImportSpec(
        "xaudiosave",
        "XAudioSave",
        required_python_packages=("ffmpeg-python",),
        requires_ffmpeg=True,
    ),
    NodeImportSpec("ximageresize", "XImageResize"),
    NodeImportSpec("ximagesave", "XImageSave"),
    NodeImportSpec("xlatentload", "XLatentLoad"),
    NodeImportSpec("xlatentsave", "XLatentSave"),
    NodeImportSpec("xmarkdownsave", "XMarkdownSave"),
    NodeImportSpec(
        "xvideosave",
        "XVideoSave",
        required_python_packages=("ffmpeg-python",),
        requires_ffmpeg=True,
    ),
    NodeImportSpec("xworkflowsave", "XWorkflowSave"),
)

# ================================
# 依赖检查函数
# ================================


def check_dependencies(
    plugin_dir: Path | None = None,
) -> tuple[list[str], list[str]]:
    """
    检查项目依赖是否已安装

    Args:
        plugin_dir: 插件根目录，默认为当前文件所在目录

    Returns:
        (已安装包列表, 缺失包列表)
    """
    if plugin_dir is None:
        plugin_dir = Path(__file__).parent

    requirements_path = plugin_dir / "requirements.txt"

    if not requirements_path.exists():
        print("[Xz3r0-Nodes] [WARN] requirements.txt file not found",
              flush=True)
        return [], []

    installed_packages = []
    missing_packages = []

    try:
        with open(requirements_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()

                if not line or line.startswith("#"):
                    continue

                match = re.match(r"^([a-zA-Z0-9_.-]+)", line)
                if match:
                    package_name = match.group(1)

                    try:
                        importlib.metadata.distribution(package_name)
                        installed_packages.append(package_name)
                    except importlib.metadata.PackageNotFoundError:
                        missing_packages.append(package_name)
    except (OSError, UnicodeError):
        print(
            "[Xz3r0-Nodes] [WARN] Unable to read requirements.txt",
            flush=True,
        )
        return [], []

    return installed_packages, missing_packages


# ================================
# 系统环境检查
# ================================


def check_ffmpeg_available() -> bool:
    """
    检查系统 PATH 中是否可找到 ffmpeg 可执行文件。
    """
    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path:
        return True

    print(
        "[Xz3r0-Nodes] [WARN] FFmpeg executable not found in PATH. "
        "XAudioSave and XVideoSave will be disabled.",
        flush=True,
    )
    print(
        "[Xz3r0-Nodes] [HINT] Install FFmpeg and add it to system PATH.",
        flush=True,
    )
    return False


# ================================
# 节点加载
# ================================


def build_node_list(
    *,
    missing_packages: set[str] | None = None,
    ffmpeg_available: bool = True,
    node_specs: Sequence[NodeImportSpec] | None = None,
) -> tuple[list[type[io.ComfyNode]], list[str]]:
    """
    根据依赖状态构建可注册节点列表。
    """
    specs = node_specs or NODE_IMPORT_SPECS
    missing = missing_packages or set()
    loaded_nodes: list[type[io.ComfyNode]] = []
    skipped_nodes: list[str] = []

    for spec in specs:
        missing_for_node = sorted(
            set(spec.required_python_packages) & missing
        )
        if missing_for_node:
            print(
                f"[Xz3r0-Nodes] [WARN] Skip {spec.class_name}: "
                f"missing Python dependency "
                f"({', '.join(missing_for_node)})",
                flush=True,
            )
            skipped_nodes.append(spec.class_name)
            continue

        if spec.requires_ffmpeg and not ffmpeg_available:
            print(
                f"[Xz3r0-Nodes] [WARN] Skip {spec.class_name}: "
                "FFmpeg executable is not available",
                flush=True,
            )
            skipped_nodes.append(spec.class_name)
            continue

        try:
            module = importlib.import_module(
                f".xnode.{spec.module_name}",
                package=__package__,
            )
            node_class = getattr(module, spec.class_name)
        except (ImportError, AttributeError):
            print(
                f"[Xz3r0-Nodes] [WARN] Skip {spec.class_name}: "
                "node import failed",
                flush=True,
            )
            skipped_nodes.append(spec.class_name)
            continue

        if (
            not isinstance(node_class, type)
            or not issubclass(node_class, io.ComfyNode)
        ):
            print(
                f"[Xz3r0-Nodes] [WARN] Skip {spec.class_name}: "
                "invalid node type",
                flush=True,
            )
            skipped_nodes.append(spec.class_name)
            continue

        loaded_nodes.append(node_class)

    return loaded_nodes, skipped_nodes


_INSTALLED_DEPS, _MISSING_DEPS = check_dependencies()
_MISSING_DEP_SET = set(_MISSING_DEPS)
FFMPEG_AVAILABLE = check_ffmpeg_available()
ALL_NODES, SKIPPED_NODES = build_node_list(
    missing_packages=_MISSING_DEP_SET,
    ffmpeg_available=FFMPEG_AVAILABLE,
)

# ================================
# 前端扩展目录
# ================================

WEB_DIRECTORY = "./web"


# ================================
# V3 扩展类定义
# ================================


class Xz3r0NodesExtension(ComfyExtension):
    """
    Xz3r0-Nodes V3 扩展类

    使用 ComfyUI V3 API 注册所有节点。
    """

    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        """
        返回所有节点类列表

        Returns:
            节点类列表
        """
        return ALL_NODES

    @override
    async def on_load(self):
        """
        扩展加载时的初始化逻辑
        """

        # 检查依赖
        if _MISSING_DEPS:
            print(
                f"[Xz3r0-Nodes] [WARN] Missing dependencies "
                f"({len(_MISSING_DEPS)}): {', '.join(_MISSING_DEPS)}",
                flush=True,
            )
            print(
                "[Xz3r0-Nodes] [HINT] Please run: "
                "pip install -r requirements.txt",
                flush=True,
            )
        else:
            print("[Xz3r0-Nodes] [OK] All dependencies installed", flush=True)

        loaded_count = len(ALL_NODES)
        skipped_count = len(SKIPPED_NODES)
        print(
            f"""[Xz3r0-Nodes] [OK] Loaded nodes: {loaded_count}
[Xz3r0-Nodes] [WARN] Skipped nodes: {skipped_count}
[Xz3r0-Nodes] ==================================================
""",
            flush=True,
        )


# ================================
# V3 入口点函数
# ================================


async def comfy_entrypoint() -> Xz3r0NodesExtension:
    """
    ComfyUI V3 API 入口点函数

    Returns:
        Xz3r0NodesExtension 实例
    """
    return Xz3r0NodesExtension()
