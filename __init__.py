"""
ComfyUI-Xz3r0-Nodes
===================

ComfyUI 自定义节点库，提供多种实用节点。
使用 V3 API 注册方式。
"""  # noqa: N999

import importlib.metadata  # noqa: I001
import re
from pathlib import Path

from comfy_api.latest import ComfyExtension, io
from typing_extensions import override

# ================================
# 导入 API 模块（必须先导入以注册路由）
# ================================
# 这个导入会触发 API 路由的注册
# 必须在导入节点模块之前完成
from .api import xworkflowsave_api

# ================================
# 导入所有节点类
# ================================
from .xnode.xanytostring import XAnyToString
from .xnode.xdatetimestring import XDateTimeString
from .xnode.xmath import XMath
from .xnode.xresolution import XResolution
from .xnode.xstringgroup import XStringGroup
from .xnode.xaudiosave import XAudioSave
from .xnode.ximageresize import XImageResize
from .xnode.ximagesave import XImageSave
from .xnode.xlatentload import XLatentLoad
from .xnode.xlatentsave import XLatentSave
from .xnode.xmarkdownsave import XMarkdownSave
from .xnode.xvideosave import XVideoSave
from .xnode.xworkflowsave import XWorkflowSave

# ================================
# 不要移动
print(
    """
[Xz3r0-Nodes] =============♾️ComfyUI-Xz3r0-Nodes♾️=============""",
    flush=True,
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
        print("[Xz3r0-Nodes] ⚠ requirements.txt file not found", flush=True)
        return [], []

    installed_packages = []
    missing_packages = []

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

    return installed_packages, missing_packages


# ================================
# 节点列表
# ================================

ALL_NODES: list = [
    XAnyToString,
    XDateTimeString,
    XMath,
    XResolution,
    XStringGroup,
    XAudioSave,
    XImageResize,
    XImageSave,
    XLatentLoad,
    XLatentSave,
    XMarkdownSave,
    XVideoSave,
    XWorkflowSave,
]

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
        return ALL_NODES  # type: ignore[return-value]

    @override
    async def on_load(self):
        """
        扩展加载时的初始化逻辑
        """

        # 检查依赖
        installed_deps, missing_deps = check_dependencies()

        if missing_deps:
            print(
                f"[Xz3r0-Nodes] ⚠ Missing dependencies "
                f"({len(missing_deps)}): {', '.join(missing_deps)}",
                flush=True,
            )
            print(
                "[Xz3r0-Nodes] 💡 Please run: pip install -r requirements.txt",
                flush=True,
            )
        else:
            print("[Xz3r0-Nodes] ✅ All dependencies installed", flush=True)

        loaded_count = len(ALL_NODES)
        print(
            f"""[Xz3r0-Nodes] 🎨 Loaded nodes: {loaded_count}
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
