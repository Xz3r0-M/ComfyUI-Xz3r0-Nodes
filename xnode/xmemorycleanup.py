"""
内存清理节点模块
================

这个模块提供手动清理内存、节点占用和显存缓存的节点。
"""

import gc
from typing import Any

from comfy_api.latest import io

try:
    import comfy.model_management as comfy_model_management
except ImportError:
    comfy_model_management = None


class XMemoryCleanup(io.ComfyNode):
    """
    XMemoryCleanup 一体化清理节点

    提供三种可选清理动作，默认全部关闭，由用户手动勾选。
    使用 MatchType 透传输入与输出类型，确保类型一致。
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点输入输出与执行约束。"""
        passthrough_template = io.MatchType.Template("anything_passthrough")

        return io.Schema(
            node_id="XMemoryCleanup",
            display_name="XMemoryCleanup",
            description=(
                "Manual memory cleanup node with optional Python GC, "
                "model unload, and VRAM cache cleanup. "
                "Pass-through keeps input and output data types consistent."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            not_idempotent=True,
            is_output_node=True,
            inputs=[
                io.MatchType.Input(
                    "anything",
                    template=passthrough_template,
                    optional=True,
                    tooltip=(
                        "Optional pass-through input. Output type matches "
                        "the connected input type automatically."
                    ),
                ),
                io.Boolean.Input(
                    "cleanup_memory",
                    default=False,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip="Run Python garbage collection (gc.collect)",
                ),
                io.Boolean.Input(
                    "cleanup_node_usage",
                    default=False,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip=(
                        "Unload currently loaded models and run model "
                        "cleanup checks"
                    ),
                ),
                io.Boolean.Input(
                    "cleanup_vram",
                    default=False,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip=(
                        "Clear device cache via ComfyUI model management"
                    ),
                ),
            ],
            outputs=[
                io.MatchType.Output(
                    template=passthrough_template,
                    display_name="anything",
                    tooltip="Original input data passed through unchanged",
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        anything: Any = None,
        cleanup_memory: bool = False,
        cleanup_node_usage: bool = False,
        cleanup_vram: bool = False,
    ) -> io.NodeOutput:
        """
        按开关执行清理动作并透传输入。

        Args:
            anything: 任意输入数据（可选）
            cleanup_memory: 是否执行 Python 垃圾回收
            cleanup_node_usage: 是否卸载模型并清理节点占用
            cleanup_vram: 是否清理显存缓存

        Returns:
            io.NodeOutput: 透传数据
        """
        if not any([cleanup_memory, cleanup_node_usage, cleanup_vram]):
            return io.NodeOutput(anything)

        try:
            if cleanup_memory:
                cls._run_python_gc()

            if cleanup_node_usage:
                cls._run_node_cleanup()

            if cleanup_vram:
                cls._run_vram_cleanup()
        except Exception as exc:
            raise RuntimeError(
                "Failed to run selected cleanup actions"
            ) from exc

        return io.NodeOutput(anything)

    @classmethod
    def _run_python_gc(cls) -> None:
        """执行 Python 垃圾回收。"""
        gc.collect()

    @classmethod
    def _run_node_cleanup(cls) -> None:
        """执行模型卸载和节点占用清理。"""
        model_management = cls._get_model_management()
        model_management.unload_all_models()
        model_management.cleanup_models_gc()

    @classmethod
    def _run_vram_cleanup(cls) -> None:
        """执行显存缓存清理。"""
        model_management = cls._get_model_management()
        model_management.soft_empty_cache()

    @classmethod
    def _get_model_management(cls):
        """获取 ComfyUI model_management 模块。"""
        if comfy_model_management is None:
            raise RuntimeError("ComfyUI model management is unavailable")
        return comfy_model_management
