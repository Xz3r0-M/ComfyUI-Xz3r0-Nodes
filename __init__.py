"""
ComfyUI-Xz3r0-Nodes
"""

import importlib.metadata
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ================================
# 导入节点模块
# ================================

from .xnode.xaudiosave import NODE_CLASS_MAPPINGS as xaudiosave_CM, NODE_DISPLAY_NAME_MAPPINGS as xaudiosave_DNM
from .xnode.ximagesave import NODE_CLASS_MAPPINGS as ximagesave_CM, NODE_DISPLAY_NAME_MAPPINGS as ximagesave_DNM
from .xnode.xlatentload import NODE_CLASS_MAPPINGS as xlatentload_CM, NODE_DISPLAY_NAME_MAPPINGS as xlatentload_DNM
from .xnode.xlatentsave import NODE_CLASS_MAPPINGS as xlatentsave_CM, NODE_DISPLAY_NAME_MAPPINGS as xlatentsave_DNM
from .xnode.xmath import NODE_CLASS_MAPPINGS as xmath_CM, NODE_DISPLAY_NAME_MAPPINGS as xmath_DNM
from .xnode.xresolution import NODE_CLASS_MAPPINGS as xresolution_CM, NODE_DISPLAY_NAME_MAPPINGS as xresolution_DNM
from .xnode.xstringgroup import NODE_CLASS_MAPPINGS as xstringgroup_CM, NODE_DISPLAY_NAME_MAPPINGS as xstringgroup_DNM
from .xnode.xvideosave import NODE_CLASS_MAPPINGS as xvideosave_CM, NODE_DISPLAY_NAME_MAPPINGS as xvideosave_DNM

# ================================
# 自动合并所有节点映射
# ================================

def merge_node_mappings() -> Tuple[Dict, Dict]:
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

print(f"""
[Xz3r0-Nodes] =============♾️ComfyUI-Xz3r0-Nodes♾️=============""", flush=True)

def check_dependencies(plugin_dir: Optional[Path] = None) -> Tuple[List[str], List[str]]:
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
        print(f"[Xz3r0-Nodes] ⚠ requirements.txt file not found", flush=True)
        return [], []

    installed_packages = []
    missing_packages = []

    with open(requirements_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()

            if not line or line.startswith('#'):
                continue

            match = re.match(r'^([a-zA-Z0-9_.-]+)', line)
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

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

# ================================

installed_deps, missing_deps = check_dependencies()

if missing_deps:
    print(f"[Xz3r0-Nodes] ⚠ Missing dependencies ({len(missing_deps)}): {', '.join(missing_deps)}", flush=True)
    print(f"[Xz3r0-Nodes] 💡 Please run: pip install -r requirements.txt", flush=True)
else:
    print(f"[Xz3r0-Nodes] ✅ All dependencies installed", flush=True)

print(f"""[Xz3r0-Nodes] 🎨 Loaded nodes: {len(NODE_CLASS_MAPPINGS)}
[Xz3r0-Nodes] ==================================================
""", flush=True)
