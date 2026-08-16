"""
图像预览节点模块 (V3 API)
=======================

基于官方 PreviewImage / PreviewMask 的可选输入图像/遮罩预览节点。
无输入时独立执行并显示文字提示，有输入时预览并透传。
"""

from __future__ import annotations

from typing import Any

from comfy_api.latest import io, ui

try:
    from ..xz3r0_utils import get_logger
except ImportError:
    from xz3r0_utils import get_logger  # type: ignore[import]

LOGGER = get_logger(__name__)

_NO_IMAGE_MESSAGE = "No image or mask information"


class XImagePreview(io.ComfyNode):
    """
    可选输入图像/遮罩预览节点。

    功能：
        - 可选 IMAGE/MASK 输入，节点可独立执行
        - 有图像时使用官方 PreviewImage 预览并透传
        - 有遮罩时使用官方 PreviewMask 预览并透传
        - 无输入 / None 时不报错，显示文字提示，透传 None
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点输入输出模式。"""
        passthrough_template = io.MatchType.Template(
            "image_or_mask_passthrough",
            allowed_types=[io.Image, io.Mask],
        )

        return io.Schema(
            node_id="XImagePreview",
            display_name="XImagePreview",
            description=(
                "Preview an optional IMAGE or MASK input using the "
                "official PreviewImage / PreviewMask UI. Runs "
                "independently when empty and passes the value "
                "through when present."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            is_output_node=True,
            search_aliases=[
                "preview",
                "preview image",
                "preview mask",
                "show image",
                "view image",
                "display image",
                "image viewer",
                "mask viewer",
            ],
            inputs=[
                io.MatchType.Input(
                    "images",
                    template=passthrough_template,
                    optional=True,
                    tooltip=(
                        "Optional image or mask input. Leave "
                        "unconnected or receive None to show a text "
                        "notice instead of previewing."
                    ),
                ),
            ],
            outputs=[
                io.MatchType.Output(
                    template=passthrough_template,
                    display_name="image_or_mask",
                    tooltip=(
                        "Passthrough of the input image or mask, or "
                        "None when no input is available"
                    ),
                ),
            ],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(cls, images: Any = None) -> io.NodeOutput:
        """
        预览可选图像/遮罩并透传。

        Args:
            images: 可选图像或遮罩张量；未连接或上游为 None 时为 None。

        Returns:
            NodeOutput: 透传输入（或 None）与对应 UI 预览/文字提示。
        """
        if images is None:
            LOGGER.debug("XImagePreview: no input, show text notice")
            return io.NodeOutput(
                None,
                ui=ui.PreviewText(_NO_IMAGE_MESSAGE),
            )

        if cls._is_mask_tensor(images):
            LOGGER.debug("XImagePreview: preview mask batch")
            return io.NodeOutput(
                images,
                ui=ui.PreviewMask(images, cls=cls),
            )

        LOGGER.debug("XImagePreview: preview image batch")
        return io.NodeOutput(
            images,
            ui=ui.PreviewImage(images, cls=cls),
        )

    @staticmethod
    def _is_mask_tensor(tensor: Any) -> bool:
        """
        判断输入是否为 MASK 张量。

        约定与 XImageSave 一致：
        - 4D → IMAGE (B, H, W, C)
        - 3D / 2D → MASK (B, H, W) / (H, W)
        """
        if not hasattr(tensor, "dim"):
            return False
        return tensor.dim() in (2, 3)
