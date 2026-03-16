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
        passthrough_template = io.MatchType.Template("passthrough")

        return io.Schema(
            node_id="XMemoryCleanup",
            display_name="XMemoryCleanup",
            description=(
                "Manual memory cleanup node with optional Python GC, "
                "model unload, and VRAM cache cleanup. "
                "Pass-through uses MatchType to keep input and output "
                "types consistent."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            not_idempotent=True,
            inputs=[
                io.MatchType.Input(
                    "passthrough",
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
                    tooltip="Run Python garbage collection (gc.collect)",
                ),
                io.Boolean.Input(
                    "cleanup_node_usage",
                    default=False,
                    tooltip=(
                        "Unload currently loaded models and run model "
                        "cleanup checks"
                    ),
                ),
                io.Boolean.Input(
                    "cleanup_vram",
                    default=False,
                    tooltip=(
                        "Clear device cache via ComfyUI model management"
                    ),
                ),
            ],
            outputs=[
                io.MatchType.Output(
                    template=passthrough_template,
                    display_name="passthrough",
                ),
                io.String.Output(
                    "status",
                    tooltip=(
                        "Cleanup summary text for selected actions"
                    ),
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        passthrough: Any = None,
        cleanup_memory: bool = False,
        cleanup_node_usage: bool = False,
        cleanup_vram: bool = False,
    ) -> io.NodeOutput:
        """
        按开关执行清理动作并透传输入。

        Args:
            passthrough: 任意输入数据（可选）
            cleanup_memory: 是否执行 Python 垃圾回收
            cleanup_node_usage: 是否卸载模型并清理节点占用
            cleanup_vram: 是否清理显存缓存

        Returns:
            io.NodeOutput: 透传数据和清理状态文本
        """
        enabled_actions = []

        if cleanup_memory:
            enabled_actions.append("memory")

        if cleanup_node_usage:
            enabled_actions.append("node_usage")

        if cleanup_vram:
            enabled_actions.append("vram")

        if not enabled_actions:
            return io.NodeOutput(passthrough, "No cleanup action selected")

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

        status = "Cleanup completed: " + ", ".join(enabled_actions)
        return io.NodeOutput(passthrough, status)

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
