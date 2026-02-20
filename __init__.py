"""
ComfyUI-Xz3r0-Nodes
"""  # noqa: N999

import importlib.metadata
import re
from pathlib import Path

# ================================
# 导入节点模块
# ================================
from .xnode.xaudiosave import NODE_CLASS_MAPPINGS as XAUDIOSAVE_CM
from .xnode.xaudiosave import NODE_DISPLAY_NAME_MAPPINGS as XAUDIOSAVE_DNM
from .xnode.ximagesave import NODE_CLASS_MAPPINGS as XIMAGESAVE_CM
from .xnode.ximagesave import NODE_DISPLAY_NAME_MAPPINGS as XIMAGESAVE_DNM
from .xnode.xlatentload import NODE_CLASS_MAPPINGS as XLATENTLOAD_CM
from .xnode.xlatentload import NODE_DISPLAY_NAME_MAPPINGS as XLATENTLOAD_DNM
from .xnode.xlatentsave import NODE_CLASS_MAPPINGS as XLATENTSAVE_CM
from .xnode.xlatentsave import NODE_DISPLAY_NAME_MAPPINGS as XLATENTSAVE_DNM
from .xnode.xmath import NODE_CLASS_MAPPINGS as XMATH_CM
from .xnode.xmath import NODE_DISPLAY_NAME_MAPPINGS as XMATH_DNM
from .xnode.xresolution import NODE_CLASS_MAPPINGS as XRESOLUTION_CM
from .xnode.xresolution import NODE_DISPLAY_NAME_MAPPINGS as XRESOLUTION_DNM
from .xnode.xstringgroup import NODE_CLASS_MAPPINGS as XSTRINGGROUP_CM
from .xnode.xstringgroup import NODE_DISPLAY_NAME_MAPPINGS as XSTRINGGROUP_DNM
from .xnode.xvideosave import NODE_CLASS_MAPPINGS as XVIDEOSAVE_CM
from .xnode.xvideosave import NODE_DISPLAY_NAME_MAPPINGS as XVIDEOSAVE_DNM

# ================================
# 自动合并所有节点映射
# ================================


def merge_node_mappings() -> tuple[dict, dict]:
    """
    自动收集并合并所有节点映射

    Returns:
        (NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS)
    """
    node_class_mappings = {}
    node_display_name_mappings = {}

    for name, value in list(globals().items()):
        if name.endswith("_CM"):
            node_class_mappings.update(value)
        elif name.endswith("_DNM"):
            node_display_name_mappings.update(value)

    return node_class_mappings, node_display_name_mappings


NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS = merge_node_mappings()

# ================================
# 检测依赖
# ================================

print(
    """
[Xz3r0-Nodes] =============♾️ComfyUI-Xz3r0-Nodes♾️=============""",
    flush=True,
)


def check_dependencies(
    plugin_dir: Path | None = None,
) -> tuple[list[str], list[str]]:
    """
    Check if project dependencies are installed

    Args:
        plugin_dir: Plugin root directory, defaults to current file's directory

    Returns:
        (installed_packages_list, missing_packages_list)
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
# 映射给ComfyUI
# ================================


__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]

WEB_DIRECTORY = "./web"

# ================================

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

print(
    f"""[Xz3r0-Nodes] 🎨 Loaded nodes: {len(NODE_CLASS_MAPPINGS)}
[Xz3r0-Nodes] ==================================================
""",
    flush=True,
)
