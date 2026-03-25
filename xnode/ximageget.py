"""
XImageGet 节点模块 (V3 API)
=========================

从 XDataHub 接收不透明 media_ref 并输出图片。
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
from comfy_api.latest import io
from PIL import Image, ImageOps

try:
    from ..xz3r0_utils import get_logger, resolve_media_ref
except ImportError:
    from xz3r0_utils import get_logger, resolve_media_ref

LOGGER = get_logger(__name__)


class XImageGet(io.ComfyNode):
    """
    XImageGet 从 XDataHub media_ref 读取图片。
    """

    IMAGE_LOAD_ERROR = "Failed to load image from XDataHub"

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="XImageGet",
            display_name="XImageGet",
            description="Load latest image sent from XDataHub",
            category="♾️ Xz3r0/File-Processing",
            inputs=[
                io.String.Input(
                    "media_ref",
                    default="",
                    tooltip="XDataHub media ref (empty means no output)",
                    socketless=True,
                    extra_dict={"hidden": True},
                ),
            ],
            outputs=[
                io.Image.Output(
                    "image",
                    display_name="image",
                    tooltip="Latest image received from XDataHub",
                ),
            ],
        )

    @classmethod
    def fingerprint_inputs(cls, media_ref: str = "") -> int:
        if media_ref:
            return cls._fingerprint_media_ref(media_ref)
        return 0

    @classmethod
    def execute(cls, media_ref: str = "") -> io.NodeOutput:
        if not media_ref:
            return io.NodeOutput(None)
        path = cls._resolve_media_ref(media_ref)
        if path is None:
            LOGGER.warning("[XImageGet] invalid media ref")
            return io.NodeOutput(None)
        if not path.exists():
            LOGGER.warning("[XImageGet] image file missing")
            return io.NodeOutput(None)
        try:
            image = cls._load_image(path)
        except FileNotFoundError:
            LOGGER.warning("[XImageGet] image file missing")
            return io.NodeOutput(None)
        except Exception as exc:
            LOGGER.exception(
                "[XImageGet] image load failed: err=%s",
                type(exc).__name__,
            )
            raise ValueError(cls.IMAGE_LOAD_ERROR) from exc
        return io.NodeOutput(image)

    @staticmethod
    def _load_image(path: Path) -> torch.Tensor:
        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGB")
            array = np.asarray(img).astype(np.float32) / 255.0
        tensor = torch.from_numpy(array).unsqueeze(0)
        return tensor

    @staticmethod
    def _fingerprint_media_ref(media_ref: str) -> int:
        import hashlib

        digest = hashlib.sha1(
            str(media_ref).encode("utf-8", errors="ignore")
        ).hexdigest()
        return int(digest, 16)

    @staticmethod
    def _resolve_media_ref(media_ref: str) -> Path | None:
        resolved = resolve_media_ref(media_ref)
        if resolved.status != "ok":
            return None
        return resolved.resolved_path


def NODE_CLASS_MAPPINGS():
    return [XImageGet]
