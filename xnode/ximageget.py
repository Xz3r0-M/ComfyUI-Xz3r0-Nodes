"""
XImageGet 节点模块 (V3 API)
=========================

从 XDataHub 接收不透明 media_ref 并输出图片与遮罩。
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
from comfy_api.latest import io
from PIL import Image, ImageOps

try:
    import folder_paths  # type: ignore
except Exception:  # pragma: no cover
    folder_paths = None

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
    MASK_LOAD_ERROR = "Failed to load mask from MaskEditor output"

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
                io.String.Input(
                    "mask_image_ref",
                    default="",
                    tooltip="MaskEditor output ref",
                    socketless=True,
                    extra_dict={"hidden": True},
                ),
                io.Boolean.Input(
                    "output_placeholder",
                    default=False,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip=(
                        "Output a 1x1 black placeholder image when no "
                        "image is available"
                    ),
                ),
            ],
            outputs=[
                io.Image.Output(
                    "image",
                    display_name="image",
                    tooltip="Latest image received from XDataHub",
                ),
                io.Mask.Output(
                    "mask",
                    display_name="mask",
                    tooltip="Mask extracted from MaskEditor output",
                ),
            ],
        )

    @classmethod
    def fingerprint_inputs(
        cls,
        media_ref: str = "",
        mask_image_ref: str = "",
        output_placeholder: bool = False,
    ) -> int:
        if media_ref or mask_image_ref or output_placeholder:
            return cls._fingerprint_refs(
                media_ref,
                mask_image_ref,
                output_placeholder,
            )
        return 0

    @classmethod
    def execute(
        cls,
        media_ref: str = "",
        mask_image_ref: str = "",
        output_placeholder: bool = False,
    ) -> io.NodeOutput:
        if not media_ref:
            return cls._build_empty_image_output(output_placeholder)
        mask_path = cls._resolve_mask_image_ref(mask_image_ref)
        image_path = cls._resolve_image_path(media_ref, mask_path)
        if image_path is None:
            LOGGER.warning("[XImageGet] invalid media ref")
            return cls._build_empty_image_output(output_placeholder)
        if not image_path.exists():
            LOGGER.warning("[XImageGet] image file missing")
            return cls._build_empty_image_output(output_placeholder)
        preserve_alpha = bool(
            mask_path is not None and image_path == mask_path
        )
        try:
            image = cls._load_image(image_path, preserve_alpha=preserve_alpha)
        except FileNotFoundError:
            LOGGER.warning("[XImageGet] image file missing")
            return cls._build_empty_image_output(output_placeholder)
        except Exception as exc:
            LOGGER.exception(
                "[XImageGet] image load failed: err=%s",
                type(exc).__name__,
            )
            raise ValueError(cls.IMAGE_LOAD_ERROR) from exc
        try:
            mask = cls._load_mask(mask_path, image)
        except Exception as exc:
            LOGGER.exception(
                "[XImageGet] mask load failed: err=%s",
                type(exc).__name__,
            )
            raise ValueError(cls.MASK_LOAD_ERROR) from exc
        return io.NodeOutput(image, mask)

    @staticmethod
    def _load_image(
        path: Path,
        preserve_alpha: bool = False,
    ) -> torch.Tensor:
        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img)
            if preserve_alpha:
                img = img.convert("RGBA")
            else:
                img = img.convert("RGB")
            array = np.asarray(img).astype(np.float32) / 255.0
        tensor = torch.from_numpy(array).unsqueeze(0)
        return tensor

    @staticmethod
    def _load_mask(
        mask_path: Path | None,
        image: torch.Tensor,
    ) -> torch.Tensor:
        height = int(image.shape[1])
        width = int(image.shape[2])
        if mask_path is None:
            return torch.zeros((height, width), dtype=torch.float32)
        if not mask_path.exists():
            LOGGER.warning("[XImageGet] mask file missing")
            return torch.zeros((height, width), dtype=torch.float32)
        with Image.open(mask_path) as img:
            img = ImageOps.exif_transpose(img)
            if "A" in img.getbands():
                alpha = img.getchannel("A")
            else:
                return torch.zeros((height, width), dtype=torch.float32)
            if alpha.size != (width, height):
                alpha = alpha.resize(
                    (width, height),
                    Image.Resampling.BILINEAR,
                )
            array = np.asarray(alpha).astype(np.float32) / 255.0
        return 1.0 - torch.from_numpy(array)

    @staticmethod
    def _build_placeholder_output() -> io.NodeOutput:
        image = torch.zeros((1, 1, 1, 3), dtype=torch.float32)
        mask = torch.zeros((1, 1), dtype=torch.float32)
        return io.NodeOutput(image, mask)

    @classmethod
    def _build_empty_image_output(
        cls,
        output_placeholder: bool,
    ) -> io.NodeOutput:
        if output_placeholder:
            return cls._build_placeholder_output()
        return io.NodeOutput(None, None)

    @staticmethod
    def _fingerprint_refs(
        media_ref: str,
        mask_image_ref: str,
        output_placeholder: bool,
    ) -> int:
        import hashlib

        digest = hashlib.sha1(
            (
                f"{str(media_ref)}\n"
                f"{str(mask_image_ref)}\n"
                f"{int(bool(output_placeholder))}"
            ).encode("utf-8", errors="ignore")
        ).hexdigest()
        return int(digest, 16)

    @staticmethod
    def _resolve_media_ref(media_ref: str) -> Path | None:
        resolved = resolve_media_ref(media_ref)
        if resolved.status != "ok":
            return None
        return resolved.resolved_path

    @classmethod
    def _resolve_image_path(
        cls,
        media_ref: str,
        mask_path: Path | None,
    ) -> Path | None:
        if mask_path is not None and mask_path.exists():
            return mask_path
        return cls._resolve_media_ref(media_ref)

    @staticmethod
    def _resolve_mask_image_ref(mask_image_ref: str) -> Path | None:
        raw = str(mask_image_ref or "").strip()
        if not raw:
            return None
        parsed = XImageGet._parse_annotated_image_ref(raw)
        if parsed is None:
            return None
        filename = parsed["filename"]
        root_name = parsed["type"]
        subfolder = parsed["subfolder"]
        root_dir = XImageGet._get_root_dir(root_name)
        if root_dir is None:
            return None
        root_dir_resolved = root_dir.resolve(strict=False)
        path = root_dir_resolved
        if subfolder:
            path = path / subfolder
        candidate = (path / filename).resolve(strict=False)
        if not candidate.is_relative_to(root_dir_resolved):
            return None
        return candidate

    @staticmethod
    def _parse_annotated_image_ref(value: str) -> dict[str, str] | None:
        raw = str(value or "").strip()
        if not raw.endswith("]") or "[" not in raw:
            return None
        base, suffix = raw.rsplit("[", 1)
        root_name = suffix[:-1].strip().lower()
        base = base.strip()
        if root_name not in {"input", "output", "temp"} or not base:
            return None
        normalized = base.replace("\\", "/")
        parts = [
            part.strip() for part in normalized.split("/") if part.strip()
        ]
        if not parts:
            return None
        if any(part in {".", ".."} for part in parts):
            return None
        filename = parts[-1]
        subfolder = "/".join(parts[:-1])
        if not filename:
            return None
        return {
            "filename": filename,
            "subfolder": subfolder,
            "type": root_name,
        }

    @staticmethod
    def _get_root_dir(root_name: str) -> Path | None:
        value = str(root_name or "").strip().lower()
        if not value:
            return None
        if folder_paths is not None:
            try:
                if value == "input":
                    return Path(folder_paths.get_input_directory())
                if value == "output":
                    return Path(folder_paths.get_output_directory())
                if value == "temp":
                    raw = folder_paths.get_temp_directory()
                    if raw:
                        return Path(raw)
            except Exception:
                return None
        return None


def NODE_CLASS_MAPPINGS():
    return [XImageGet]
