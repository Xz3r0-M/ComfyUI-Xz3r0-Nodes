"""
XImageGet 节点模块 (V3 API)
=========================

从 XDataHub 接收指定 /view 链接并输出。
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import numpy as np
import torch
from comfy_api.latest import io, ui
from PIL import Image, ImageOps

try:
    import folder_paths
except Exception:  # pragma: no cover - ComfyUI 运行时加载
    folder_paths = None

try:
    from ..xz3r0_utils import get_logger
except ImportError:
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)


class XImageGet(io.ComfyNode):
    """
    XImageGet 从 XDataHub /view 链接读取图片。
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
                    "view_url",
                    default="",
                    tooltip="XDataHub /view URL (empty means no output)",
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
    def fingerprint_inputs(cls, view_url: str = "") -> int:
        if view_url:
            return cls._fingerprint_view_url(view_url)
        return 0

    @classmethod
    def execute(cls, view_url: str = "") -> io.NodeOutput:
        if not view_url:
            return io.NodeOutput(None)
        path = cls._resolve_view_url(view_url)
        if path is None:
            LOGGER.warning("[XImageGet] invalid view url")
            return io.NodeOutput(None)
        if not path.exists():
            LOGGER.warning("[XImageGet] image file missing")
            return io.NodeOutput(None)
        try:
            image = cls._load_image(path)
        except FileNotFoundError as exc:
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
    def _fingerprint_view_url(view_url: str) -> int:
        import hashlib

        digest = hashlib.sha1(
            str(view_url).encode("utf-8", errors="ignore")
        ).hexdigest()
        return int(digest, 16)

    @staticmethod
    def _resolve_view_url(view_url: str) -> Path | None:
        raw = str(view_url or "").strip()
        if not raw:
            return None
        try:
            parsed = urlparse(raw)
        except Exception:
            parsed = None
        path = parsed.path if parsed else raw
        if path != "/view":
            return None
        query = parse_qs(parsed.query if parsed else "")
        filename = unquote(query.get("filename", [""])[0]).strip()
        if not filename:
            return None
        if filename[0] == "/" or ".." in filename:
            return None
        file_type = unquote(query.get("type", [""])[0]).strip().lower()
        if file_type not in {"input", "output", "temp"}:
            return None
        subfolder = unquote(query.get("subfolder", [""])[0]).strip()
        if folder_paths is None:
            return None
        if file_type == "input":
            root = folder_paths.get_input_directory()
        elif file_type == "output":
            root = folder_paths.get_output_directory()
        else:
            root = folder_paths.get_temp_directory()
        root_abs = os.path.abspath(root)
        candidate = root
        if subfolder:
            candidate = os.path.join(candidate, subfolder)
            try:
                if os.path.commonpath(
                    (os.path.abspath(candidate), root_abs)
                ) != root_abs:
                    return None
            except Exception:
                return None
        safe_name = os.path.basename(filename)
        file_path = os.path.join(candidate, safe_name)
        return Path(file_path)


def NODE_CLASS_MAPPINGS():
    return [XImageGet]
