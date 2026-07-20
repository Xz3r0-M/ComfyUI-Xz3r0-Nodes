"""
图像预览节点模块 (V3 API)
=======================

基于官方 PreviewImage 的可选输入图像预览节点。
无图像时独立执行并显示文字提示，有图像时预览并透传。
"""

from __future__ import annotations

from typing import Any

from comfy_api.latest import io, ui

try:
    from ..xz3r0_utils import get_logger
except ImportError:
    from xz3r0_utils import get_logger  # type: ignore[import]

LOGGER = get_logger(__name__)

_NO_IMAGE_MESSAGE = "No image information"


class XImagePreview(io.ComfyNode):
    """
    可选输入图像预览节点。

    功能：
        - 可选 IMAGE 输入，节点可独立执行
        - 有图像时使用官方 PreviewImage 预览并透传
        - 无图像 / None 时不报错，显示文字提示，透传 None
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点输入输出模式。"""
        return io.Schema(
            node_id="XImagePreview",
            display_name="XImagePreview",
            description=(
                "Preview an optional IMAGE input using the official "
                "PreviewImage UI. Runs independently when empty and "
                "passes the image through when present."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            is_output_node=True,
            search_aliases=[
                "preview",
                "preview image",
                "show image",
                "view image",
                "display image",
                "image viewer",
            ],
            inputs=[
                io.Image.Input(
                    "images",
                    optional=True,
                    tooltip=(
                        "Optional image input. Leave unconnected or "
                        "receive None to show a text notice instead of "
                        "previewing an image."
                    ),
                ),
            ],
            outputs=[
                io.Image.Output(
                    "IMAGE",
                    display_name="IMAGE",
                    tooltip=(
                        "Passthrough of the input image, or None when "
                        "no image is available"
                    ),
                ),
            ],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(cls, images: Any = None) -> io.NodeOutput:
        """
        预览可选图像并透传。

        Args:
            images: 可选图像张量；未连接或上游为 None 时为 None。

        Returns:
            NodeOutput: 透传图像（或 None）与对应 UI 预览/文字提示。
        """
        if images is None:
            LOGGER.debug("XImagePreview: no image, show text notice")
            return io.NodeOutput(
                None,
                ui=ui.PreviewText(_NO_IMAGE_MESSAGE),
            )

        LOGGER.debug("XImagePreview: preview image batch")
        return io.NodeOutput(
            images,
            ui=ui.PreviewImage(images, cls=cls),
        )
