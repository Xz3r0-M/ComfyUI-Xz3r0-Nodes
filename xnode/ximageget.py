"""
XImageGet 节点模块 (V3 API)
=========================

从 XDataHub media_ref 读取原图，从独立的 x_mask_ref 字段
承载自定义 X 遮罩编辑器写回的遮罩数据。
"""

from __future__ import annotations

import json
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
    XImageGet 从 XDataHub media_ref 读取图片，从独立的 x_mask_ref
    读取自定义 X 遮罩编辑器生成的遮罩。

    图像来源始终为 media_ref，遮罩来源始终为单独遮罩文件，
    两者完全隔离，避免 merged alpha 文件污染原图 alpha 语义。
    """

    IMAGE_LOAD_ERROR = "Failed to load image from XDataHub"
    MASK_LOAD_ERROR = "Failed to load mask from X Mask Editor output"

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="XImageGet",
            display_name="XImageGet",
            description=(
                "Load image from XDataHub with X Mask Editor support"
            ),
            category="♾️ Xz3r0/File-Processing",
            inputs=[
                io.String.Input(
                    "media_ref",
                    default="",
                    tooltip=("XDataHub media ref (empty means no output)"),
                    socketless=True,
                    extra_dict={"hidden": True},
                ),
                io.String.Input(
                    "x_mask_ref",
                    default="",
                    tooltip=(
                        "X Mask Editor output ref "
                        "(separate mask file, "
                        "annotated path format)"
                    ),
                    socketless=True,
                    extra_dict={"hidden": True},
                ),
                io.String.Input(
                    "x_paint_ref",
                    default="",
                    tooltip=(
                        "X Mask Editor paint layer ref "
                        "(separate RGBA paint file, "
                        "annotated path format)"
                    ),
                    socketless=True,
                    extra_dict={"hidden": True},
                ),
                io.String.Input(
                    "x_transform_state",
                    default="",
                    tooltip=(
                        "X Mask Editor transform state (rotation + flip)"
                    ),
                    socketless=True,
                    extra_dict={"hidden": True},
                ),
                io.Boolean.Input(
                    "output_placeholder",
                    default=False,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip=(
                        "Output a 1x1 black placeholder image "
                        "when no image is available"
                    ),
                ),
            ],
            outputs=[
                io.Image.Output(
                    "image",
                    display_name="image",
                    tooltip=("Latest image received from XDataHub"),
                ),
                io.Mask.Output(
                    "mask",
                    display_name="mask",
                    tooltip=(
                        "Mask from X Mask Editor "
                        "(separate grayscale mask file)"
                    ),
                ),
            ],
        )

    @classmethod
    def fingerprint_inputs(
        cls,
        media_ref: str = "",
        x_mask_ref: str = "",
        x_paint_ref: str = "",
        x_transform_state: str = "",
        output_placeholder: bool = False,
    ) -> int:
        if (
            media_ref
            or x_mask_ref
            or x_paint_ref
            or x_transform_state
            or output_placeholder
        ):
            return cls._fingerprint_refs(
                media_ref,
                x_mask_ref,
                x_paint_ref,
                x_transform_state,
                output_placeholder,
            )
        return 0

    @classmethod
    def execute(
        cls,
        media_ref: str = "",
        x_mask_ref: str = "",
        x_paint_ref: str = "",
        x_transform_state: str = "",
        output_placeholder: bool = False,
    ) -> io.NodeOutput:
        if not media_ref:
            return cls._build_empty_image_output(output_placeholder)
        image_path = cls._resolve_media_ref(media_ref)
        if image_path is None:
            LOGGER.warning("[XImageGet] invalid media ref")
            return cls._build_empty_image_output(output_placeholder)
        if not image_path.exists():
            LOGGER.warning("[XImageGet] image file missing")
            return cls._build_empty_image_output(output_placeholder)
        try:
            image = cls._load_image(image_path)
        except FileNotFoundError:
            LOGGER.warning("[XImageGet] image file missing")
            return cls._build_empty_image_output(output_placeholder)
        except Exception as exc:
            LOGGER.exception(
                "[XImageGet] image load failed: err=%s",
                type(exc).__name__,
            )
            raise ValueError(cls.IMAGE_LOAD_ERROR) from exc
        paint_path = cls._resolve_x_paint_ref(x_paint_ref)
        mask_path = cls._resolve_x_mask_ref(x_mask_ref)
        image = cls._apply_paint_layer(image, paint_path)
        try:
            mask = cls._load_mask(mask_path, image)
        except Exception as exc:
            LOGGER.exception(
                "[XImageGet] mask load failed: err=%s",
                type(exc).__name__,
            )
            raise ValueError(cls.MASK_LOAD_ERROR) from exc
        image, mask = cls._apply_transform_state(
            image,
            mask,
            x_transform_state,
        )
        image = cls._merge_mask_into_image(image, mask)
        return io.NodeOutput(image, mask)

    @staticmethod
    def _load_image(path: Path) -> torch.Tensor:
        """
        加载原图。

        若原图自带 alpha，则保留原 alpha；否则返回 RGB。
        遮罩合并只发生在节点输出张量中，不修改源文件本身。
        """
        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img)
            keep_alpha = "A" in img.getbands()
            img = img.convert("RGBA" if keep_alpha else "RGB")
            array = np.asarray(img).astype(np.float32) / 255.0
        return torch.from_numpy(array).unsqueeze(0)

    @staticmethod
    def _load_mask(
        mask_path: Path | None,
        image: torch.Tensor,
    ) -> torch.Tensor:
        """
        从独立遮罩文件加载遮罩张量。

        遮罩文件优先读取 alpha 通道：
        - 透明背景 + 不透明笔触：alpha=遮罩强度
        - 无可用 alpha 时回退到灰度值

        这允许前端使用透明底的黑/白可视笔触，同时保持遮罩
        语义稳定，不依赖具体可视颜色。

        灰度回退规则仍为：白色（255）= 完全遮罩（1.0），
        黑色（0）= 未遮罩（0.0）。
        当遮罩文件不存在时返回全零张量（无遮罩）。
        """
        height = int(image.shape[1])
        width = int(image.shape[2])
        if mask_path is None:
            return torch.zeros((height, width), dtype=torch.float32)
        if not mask_path.exists():
            LOGGER.warning("[XImageGet] mask file missing")
            return torch.zeros((height, width), dtype=torch.float32)
        with Image.open(mask_path) as img:
            img = ImageOps.exif_transpose(img)
            alpha = None
            if "A" in img.getbands():
                alpha = img.getchannel("A")
                if alpha.size != (width, height):
                    alpha = alpha.resize(
                        (width, height),
                        Image.Resampling.BILINEAR,
                    )
                alpha_extrema = alpha.getextrema()
                if alpha_extrema != (255, 255):
                    array = np.asarray(alpha).astype(np.float32) / 255.0
                    return torch.from_numpy(array)
            img = img.convert("L")
            if img.size != (width, height):
                img = img.resize(
                    (width, height),
                    Image.Resampling.BILINEAR,
                )
            array = np.asarray(img).astype(np.float32) / 255.0
        return torch.from_numpy(array)

    @staticmethod
    def _apply_paint_layer(
        image: torch.Tensor,
        paint_path: Path | None,
    ) -> torch.Tensor:
        """
        将颜色画笔层叠加到输出图像张量中。

        paint 层为独立 RGBA 文件，只影响节点输出数据，
        不会覆盖原始 media_ref 对应的源图文件。
        """
        if paint_path is None or not paint_path.exists():
            return image
        try:
            with Image.open(paint_path) as img:
                img = ImageOps.exif_transpose(img)
                img = img.convert("RGBA")
                height = int(image.shape[1])
                width = int(image.shape[2])
                if img.size != (width, height):
                    img = img.resize(
                        (width, height),
                        Image.Resampling.BILINEAR,
                    )
                array = np.asarray(img).astype(np.float32) / 255.0
        except Exception:
            LOGGER.warning("[XImageGet] paint layer load failed")
            return image

        paint = torch.from_numpy(array).unsqueeze(0)
        paint_rgb = paint[..., :3]
        paint_alpha = paint[..., 3:4]
        base_rgb = image[..., :3]
        composed_rgb = paint_rgb * paint_alpha + base_rgb * (1.0 - paint_alpha)
        if image.shape[-1] == 4:
            merged = image.clone()
            merged[..., :3] = composed_rgb
            return merged
        return composed_rgb

    @staticmethod
    def _merge_mask_into_image(
        image: torch.Tensor,
        mask: torch.Tensor,
    ) -> torch.Tensor:
        """
        在输出张量中将遮罩合并进 alpha。

        合并规则：
        - 无 alpha 原图：新增 alpha，并使用 1 - mask 作为透明度
        - 有 alpha 原图：alpha = min(original_alpha, 1 - mask)

        这只影响节点输出数据，不会改动磁盘上的原图文件。
        """
        if not isinstance(image, torch.Tensor):
            return image
        if not isinstance(mask, torch.Tensor):
            return image
        if image.ndim != 4 or mask.ndim != 2:
            return image

        alpha = (1.0 - mask).clamp(0.0, 1.0).unsqueeze(0).unsqueeze(-1)
        if image.shape[-1] == 4:
            merged = image.clone()
            merged_alpha = torch.minimum(merged[..., 3:4], alpha)
            merged[..., 3:4] = merged_alpha
            return merged
        return torch.cat([image, alpha], dim=-1)

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
        x_mask_ref: str,
        x_paint_ref: str,
        x_transform_state: str,
        output_placeholder: bool,
    ) -> int:
        import hashlib

        digest = hashlib.sha1(
            (
                f"{str(media_ref)}\n"
                f"{str(x_mask_ref)}\n"
                f"{str(x_paint_ref)}\n"
                f"{str(x_transform_state)}\n"
                f"{int(bool(output_placeholder))}"
            ).encode("utf-8", errors="ignore")
        ).hexdigest()
        return int(digest, 16)

    @staticmethod
    def _parse_transform_state(value: str) -> tuple[int, bool, bool]:
        raw = str(value or "").strip()
        if not raw:
            return 0, False, False
        try:
            parsed = json.loads(raw)
        except Exception:
            return 0, False, False
        rotation = int(parsed.get("rotation", 0)) % 4
        flip_x = bool(parsed.get("flipX", False))
        flip_y = bool(parsed.get("flipY", False))
        return rotation, flip_x, flip_y

    @classmethod
    def _apply_transform_state(
        cls,
        image: torch.Tensor,
        mask: torch.Tensor,
        transform_state: str,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        rotation, flip_x, flip_y = cls._parse_transform_state(transform_state)
        if rotation:
            image = torch.rot90(image, (4 - rotation) % 4, dims=(1, 2))
            mask = torch.rot90(mask, (4 - rotation) % 4, dims=(0, 1))
        if flip_x:
            image = torch.flip(image, dims=(2,))
            mask = torch.flip(mask, dims=(1,))
        if flip_y:
            image = torch.flip(image, dims=(1,))
            mask = torch.flip(mask, dims=(0,))
        return image, mask

    @staticmethod
    def _resolve_media_ref(media_ref: str) -> Path | None:
        resolved = resolve_media_ref(media_ref)
        if resolved.status != "ok":
            return None
        return resolved.resolved_path

    @staticmethod
    def _resolve_x_mask_ref(x_mask_ref: str) -> Path | None:
        """
        解析 X 遮罩编辑器写回的带注释路径。

        支持格式：filename.png [input]
        仅允许 type ∈ {input, output, temp}，防止路径穿越。
        """
        raw = str(x_mask_ref or "").strip()
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
    def _resolve_x_paint_ref(x_paint_ref: str) -> Path | None:
        raw = str(x_paint_ref or "").strip()
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
    def _parse_annotated_image_ref(
        value: str,
    ) -> dict[str, str] | None:
        """
        解析格式 "filename.png [type]" 或
        "subfolder/filename.png [type]"。

        返回 None 表示格式非法或路径可疑。
        """
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
