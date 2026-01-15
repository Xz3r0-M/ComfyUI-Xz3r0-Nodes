"""
ComfyUI-Xz3r0-Nodes: 多功能自定义节点集合
"""

print("[Xz3r0-Nodes] 正在加载插件...", flush=True)  # 调试标记

import importlib
from pathlib import Path
from typing import Dict, List, Optional, Type, Any


# ============================================================================
# 自动节点发现和导入
# ============================================================================

def discover_nodes(plugin_dir: Optional[Path] = None) -> List[Type[Any]]:
    """
    自动发现并导入 xnode 目录中的所有节点

    Args:
        plugin_dir: 插件根目录，默认为当前文件所在目录

    Returns:
        发现的节点类列表
    """
    if plugin_dir is None:
        plugin_dir = Path(__file__).parent

    # 指定扫描 xnode 目录
    xnode_dir = plugin_dir / "xnode"

    if not xnode_dir.exists():
        print(f"  ⚠ 警告: xnode 目录不存在: {xnode_dir}")
        return []

    nodes = []

    # 扫描 xnode 目录中的所有 .py 文件
    for file_path in xnode_dir.glob("*.py"):
        # 跳过特殊文件
        if file_path.name.startswith("_"):
            continue

        # 计算模块路径
        module_name = f"xnode.{file_path.stem}"

        try:
            module = importlib.import_module(f".{module_name}", package=__name__)

            # 查找模块中的节点类
            for attr_name in dir(module):
                attr = getattr(module, attr_name)

                # 检查是否是节点类
                if (isinstance(attr, type) and
                    hasattr(attr, 'INPUT_TYPES') and
                    hasattr(attr, 'RETURN_TYPES')):
                    nodes.append(attr)
                    print(f"[Xz3r0-Nodes] ✓ 发现节点: {attr.__name__} ({attr.CATEGORY})", flush=True)

        except Exception as e:
            print(f"[Xz3r0-Nodes] ⚠ 导入模块 {module_name} 失败: {e}", flush=True)

    return nodes


# 自动发现所有节点
_all_nodes = discover_nodes()

# 构建节点映射
NODE_CLASS_MAPPINGS: Dict[str, Type[Any]] = {}
NODE_DISPLAY_NAME_MAPPINGS: Dict[str, str] = {}

for node_class in _all_nodes:
    class_name = node_class.__name__

    # 添加到类映射
    NODE_CLASS_MAPPINGS[class_name] = node_class

    # 添加显示名称（如果有）
    display_name = getattr(node_class, 'DISPLAY_NAME', class_name)
    NODE_DISPLAY_NAME_MAPPINGS[class_name] = display_name


# ============================================================================
# 导出列表（ComfyUI要求）
# ============================================================================

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']


# ============================================================================
# 插件信息
# ============================================================================

__version__ = "0.1.0"
__author__ = "Xz3r0"
__license__ = "待定"


# ============================================================================
# 插件加载时的日志输出
# ============================================================================

print(f"""
[Xz3r0-Nodes] ================================================
[Xz3r0-Nodes]  🎨 ComfyUI-Xz3r0-Nodes v{__version__}
[Xz3r0-Nodes]  多功能自定义节点集合
[Xz3r0-Nodes]  📦 已加载节点数: {len(NODE_CLASS_MAPPINGS)}
[Xz3r0-Nodes]  📝 作者: {__author__}
[Xz3r0-Nodes]  📄 许可证: {__license__}
[Xz3r0-Nodes] ================================================
""", flush=True)
