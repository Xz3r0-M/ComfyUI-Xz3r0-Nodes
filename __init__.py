"""
ComfyUI-Xz3r0-Nodes
"""

print(f"""
[Xz3r0-Nodes] =============♾️ComfyUI-Xz3r0-Nodes♾️=============""", flush=True)
# print("[Xz3r0-Nodes] Loading...", flush=True)  # Debug marker
import importlib
import importlib.metadata
import re
from pathlib import Path
from typing import Dict, List, Optional, Type, Any, Tuple


# ============================================================================
# 依赖包检查
# ============================================================================

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

    # Read and parse requirements.txt
    installed_packages = []
    missing_packages = []

    with open(requirements_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()

            # Skip empty lines and comments
            if not line or line.startswith('#'):
                continue

            # Parse package name (extract package name, ignore version requirements)
            # e.g.: torch>=2.0.0 -> torch
            #       numpy==1.24.0 -> numpy
            #       Pillow -> Pillow
            #       ffmpeg-python -> ffmpeg-python
            match = re.match(r'^([a-zA-Z0-9_.-]+)', line)
            if match:
                package_name = match.group(1)

                # Use importlib.metadata to directly check if pip package is installed
                # This method uses pip package name directly, no need to know module name
                # importlib.metadata.distribution() is case-insensitive
                try:
                    importlib.metadata.distribution(package_name)
                    installed_packages.append(package_name)
                except importlib.metadata.PackageNotFoundError:
                    missing_packages.append(package_name)

    return installed_packages, missing_packages


# ============================================================================
# 自动节点发现和导入
# ============================================================================

def discover_nodes(plugin_dir: Optional[Path] = None) -> List[Type[Any]]:
    """
    Automatically discover and import all nodes from xnode directory

    Args:
        plugin_dir: Plugin root directory, defaults to current file's directory

    Returns:
        List of discovered node classes
    """
    if plugin_dir is None:
        plugin_dir = Path(__file__).parent

    # Specify scan xnode directory
    xnode_dir = plugin_dir / "xnode"

    if not xnode_dir.exists():
        print(f"[Xz3r0-Nodes] ⚠ Warning: xnode directory does not exist")
        return []

    nodes = []

    # Scan all .py files in xnode directory
    for file_path in xnode_dir.glob("*.py"):
        # Skip special files
        if file_path.name.startswith("_"):
            continue

        # Calculate module path
        module_name = f"xnode.{file_path.stem}"

        try:
            module = importlib.import_module(f".{module_name}", package=__name__)

            # Find node classes in module
            for attr_name in dir(module):
                attr = getattr(module, attr_name)

                # Check if it's a node class
                if (isinstance(attr, type) and
                    hasattr(attr, 'INPUT_TYPES') and
                    hasattr(attr, 'RETURN_TYPES')):
                    nodes.append(attr)
                    # print(f"[Xz3r0-Nodes] ✓ Found node: {attr.__name__} ({attr.CATEGORY})", flush=True)

        except Exception as e:
            print(f"[Xz3r0-Nodes] ⚠ Failed to import module {module_name}: {e}", flush=True)

    return nodes


# Automatically discover all nodes
_all_nodes = discover_nodes()

# Build node mappings
NODE_CLASS_MAPPINGS: Dict[str, Type[Any]] = {}
NODE_DISPLAY_NAME_MAPPINGS: Dict[str, str] = {}

for node_class in _all_nodes:
    class_name = node_class.__name__

    # Add to class mapping
    NODE_CLASS_MAPPINGS[class_name] = node_class

    # Add display name (if available)
    display_name = getattr(node_class, 'DISPLAY_NAME', class_name)
    NODE_DISPLAY_NAME_MAPPINGS[class_name] = display_name


# ============================================================================
# Dependency Check
# ============================================================================

# print("[Xz3r0-Nodes] 📦 Checking dependencies...", flush=True)
installed_deps, missing_deps = check_dependencies()

if missing_deps:
    print(f"[Xz3r0-Nodes] ⚠ Missing dependencies ({len(missing_deps)}): {', '.join(missing_deps)}", flush=True)
    print(f"[Xz3r0-Nodes] 💡 Please run: pip install -r requirements.txt", flush=True)
else:
    print(f"[Xz3r0-Nodes] ✅ All dependencies installed", flush=True)


# print("[Xz3r0-Nodes] 🔍 Scanning node modules...", flush=True)

# ============================================================================
# Export List (Required by ComfyUI)
# ============================================================================

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']


# ============================================================================
# Plugin Loading Log Output
# ============================================================================

print(f"""[Xz3r0-Nodes] 🎨 Loaded nodes: {len(NODE_CLASS_MAPPINGS)}
[Xz3r0-Nodes] ==================================================
""", flush=True)
