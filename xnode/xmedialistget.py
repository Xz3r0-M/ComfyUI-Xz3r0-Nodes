"""
XMediaListGet 节点模块 (V3 API)
==============================

从 XDataHub 读取一批同类型媒体文件，输出成 ComfyUI 列表数据。

节点面板按「图片 / 视频 / 音频」分类管理条目，执行时只加载当前分类
里启用的条目，并保持面板顺序。禁用的条目不参与输出（后续自动补位），
空分类输出 [None] 让下游照常运行一次并拿到空值。
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from comfy_api.latest import InputImpl, io

try:
    from ..xz3r0_utils import get_logger, resolve_media_ref
except ImportError:  # pragma: no cover - 包外脚本运行
    from xz3r0_utils import get_logger, resolve_media_ref

try:
    from .xaudioget import XAudioGet
    from .ximageget import XImageGet
except ImportError:  # pragma: no cover - 包外脚本运行
    from xaudioget import XAudioGet
    from ximageget import XImageGet

LOGGER = get_logger(__name__)

MEDIA_TYPES = ("image", "video", "audio")
MAX_ENABLED_PER_SECTION = 50


class XMediaListGet(io.ComfyNode):
    """
    XMediaListGet 按分类从 XDataHub 读取一批媒体文件并输出列表。

    面板里的三类条目独立保存，切换分类只改变「显示哪一类」和
    「输出哪一类」，其他分类的数据不会丢。
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="XMediaListGet",
            display_name="XMediaListGet",
            description=(
                "Load a batch of one media type from XDataHub and output "
                "them as a list. Switch the category to pick images, "
                "videos, or audio; disabled items are skipped, so "
                "downstream nodes run once per enabled file."
            ),
            category="♾️ Xz3r0/XDataHub",
            search_aliases=[
                "Image List Loader",
                "Video List Loader",
                "Audio List Loader",
                "Batch Loader",
            ],
            inputs=[
                io.Combo.Input(
                    "media_type",
                    options=list(MEDIA_TYPES),
                    default="image",
                    tooltip=(
                        "Which category this node outputs. Only enabled "
                        "items in this category are loaded; the other "
                        "two categories are left untouched."
                    ),
                ),
                io.String.Input(
                    "media_items",
                    default="",
                    tooltip=(
                        "XDataHub media list state (managed by the node panel)"
                    ),
                    socketless=True,
                    extra_dict={"hidden": True},
                ),
                io.Boolean.Input(
                    "type_warning",
                    default=True,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip=(
                        "Enabled: glow downstream links whose type does "
                        "not match the current category. Disabled: hide "
                        "the warning effect."
                    ),
                ),
                io.Boolean.Input(
                    "output_images",
                    default=True,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip=(
                        "Enabled: load images and output the image list. "
                        "Disabled: skip loading images entirely."
                    ),
                ),
                io.Boolean.Input(
                    "output_videos",
                    default=True,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip=(
                        "Enabled: load videos and output the video list. "
                        "Disabled: skip loading videos entirely."
                    ),
                ),
                io.Boolean.Input(
                    "output_audios",
                    default=True,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip=(
                        "Enabled: load audio and output the audio list. "
                        "Disabled: skip loading audio entirely."
                    ),
                ),
            ],
            outputs=[
                io.Image.Output(
                    "images",
                    is_output_list=True,
                    display_name="images",
                    tooltip=(
                        "Enabled images in panel order. When there are "
                        "no images, one empty value (None) is output so "
                        "downstream still runs."
                    ),
                ),
                io.Mask.Output(
                    "masks",
                    is_output_list=True,
                    display_name="masks",
                    tooltip=(
                        "Mask list matching the images one-to-one. "
                        "Images without an edited mask output an "
                        "all-zero mask."
                    ),
                ),
                io.Int.Output(
                    "image_count",
                    display_name="image_count",
                    tooltip=(
                        "How many images this node outputs. Connect to "
                        "XListPull's count to size its split ports."
                    ),
                ),
                io.Video.Output(
                    "videos",
                    is_output_list=True,
                    display_name="videos",
                    tooltip=(
                        "Enabled videos in panel order. When there are "
                        "no videos, one empty value (None) is output."
                    ),
                ),
                io.Int.Output(
                    "video_count",
                    display_name="video_count",
                    tooltip="How many videos this node outputs.",
                ),
                io.Audio.Output(
                    "audios",
                    is_output_list=True,
                    display_name="audios",
                    tooltip=(
                        "Enabled audio files in panel order. When there "
                        "is none, one empty value (None) is output."
                    ),
                ),
                io.Int.Output(
                    "audio_count",
                    display_name="audio_count",
                    tooltip="How many audio files this node outputs.",
                ),
            ],
        )

    @classmethod
    def fingerprint_inputs(
        cls,
        media_type: str = "",
        media_items: str = "",
        type_warning: bool = True,
        output_images: bool = True,
        output_videos: bool = True,
        output_audios: bool = True,
    ) -> int:
        digest_source = (
            f"{media_type}|{media_items}|"
            f"{int(bool(output_images))}|"
            f"{int(bool(output_videos))}|"
            f"{int(bool(output_audios))}"
        )
        digest = hashlib.sha1(
            digest_source.encode("utf-8", errors="ignore")
        ).hexdigest()
        return int(digest, 16)

    @classmethod
    def execute(
        cls,
        media_type: str = "image",
        media_items: str = "",
        type_warning: bool = True,
        output_images: bool = True,
        output_videos: bool = True,
        output_audios: bool = True,
    ) -> io.NodeOutput:
        # media_type 只用于面板显示；三个输出开关决定加载哪些类型。
        images, masks = (
            cls._load_section(media_items, "image")
            if output_images
            else ([], [])
        )
        videos, _ = (
            cls._load_section(media_items, "video")
            if output_videos
            else ([], [])
        )
        audios, _ = (
            cls._load_section(media_items, "audio")
            if output_audios
            else ([], [])
        )
        return io.NodeOutput(
            images or [None],
            masks or [None],
            len(images),
            videos or [None],
            len(videos),
            audios or [None],
            len(audios),
        )

    @classmethod
    def _load_section(
        cls,
        raw: str,
        category: str,
    ) -> tuple[list[Any], list[Any]]:
        loaded: list[Any] = []
        masks: list[Any] = []
        for entry in cls._parse_items(raw, category):
            if entry.get("enabled", True) is False:
                continue
            path = cls._resolve_path(entry["ref"])
            if path is None:
                LOGGER.warning(
                    "[XMediaListGet] skipped unresolved %s item",
                    category,
                )
                continue
            try:
                if category == "image":
                    image, mask = cls._load_image_entry(path, entry)
                    loaded.append(image)
                    masks.append(mask)
                else:
                    loaded.append(cls._load_item(category, path))
            except Exception as exc:
                LOGGER.warning(
                    "[XMediaListGet] skipped unreadable %s item: err=%s",
                    category,
                    type(exc).__name__,
                )
        return loaded, masks

    @staticmethod
    def _normalize_category(value: str) -> str:
        category = str(value or "").strip().lower()
        if category in MEDIA_TYPES:
            return category
        return "image"

    @classmethod
    def _parse_items(
        cls,
        raw: str,
        category: str,
    ) -> list[dict[str, Any]]:
        text = str(raw or "").strip()
        if not text:
            return []
        try:
            payload = json.loads(text)
        except Exception:
            LOGGER.warning("[XMediaListGet] invalid media items JSON")
            return []
        if not isinstance(payload, dict):
            return []
        section = payload.get(category)
        if not isinstance(section, list):
            return []
        normalized: list[dict[str, Any]] = []
        for entry in section:
            if isinstance(entry, str):
                entry = {"ref": entry}
            if not isinstance(entry, dict):
                continue
            ref = str(entry.get("ref") or "").strip()
            if not ref:
                continue
            normalized.append(
                {
                    "ref": ref,
                    "enabled": entry.get("enabled", True) is not False,
                    "mask_ref": str(entry.get("mask_ref") or ""),
                    "paint_ref": str(entry.get("paint_ref") or ""),
                    "transform_state": str(entry.get("transform_state") or ""),
                }
            )
        return normalized[:MAX_ENABLED_PER_SECTION]

    @staticmethod
    def _resolve_path(ref: str) -> Path | None:
        resolved = resolve_media_ref(ref)
        if resolved.status != "ok" or resolved.resolved_path is None:
            return None
        if not resolved.resolved_path.exists():
            return None
        return resolved.resolved_path

    @staticmethod
    def _load_item(category: str, path: Path) -> Any:
        if category == "video":
            return InputImpl.VideoFromFile(str(path))
        if category == "audio":
            return XAudioGet._load_audio(path)
        return XImageGet._load_image(path)

    @classmethod
    def _load_image_entry(
        cls,
        path: Path,
        entry: dict[str, Any],
    ) -> tuple[Any, Any]:
        image = XImageGet._load_image(path)
        paint_path = XImageGet._resolve_x_paint_ref(
            str(entry.get("paint_ref") or "")
        )
        mask_path = XImageGet._resolve_x_mask_ref(
            str(entry.get("mask_ref") or "")
        )
        image = XImageGet._apply_paint_layer(image, paint_path)
        mask = XImageGet._load_mask(mask_path, image)
        image, mask = XImageGet._apply_transform_state(
            image,
            mask,
            str(entry.get("transform_state") or ""),
        )
        return image, mask


def NODE_CLASS_MAPPINGS():
    return [XMediaListGet]
