"""
XDataHub 与节点之间的临时桥接缓存。

用于保存“最新发送”的图片信息，供节点读取。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from threading import Lock

try:
    from .logging_control import get_logger
except ImportError:
    from logging_control import get_logger

LOGGER = get_logger(__name__)


@dataclass(frozen=True)
class XDataHubImageSnapshot:
    media_ref: str
    path: Path
    title: str
    file_url: str
    revision: int


_LOCK = Lock()
_REVISION = 0
_LATEST_IMAGE: XDataHubImageSnapshot | None = None


def update_latest_image(
    media_ref: str,
    path: Path,
    title: str,
    file_url: str = "",
) -> int:
    """
    更新最新图片缓存。

    Returns:
        revision: 自增后的 revision
    """
    global _REVISION, _LATEST_IMAGE
    safe_title = str(title or "").strip()
    with _LOCK:
        _REVISION += 1
        _LATEST_IMAGE = XDataHubImageSnapshot(
            media_ref=str(media_ref or "").strip(),
            path=path,
            title=safe_title,
            file_url=str(file_url or ""),
            revision=_REVISION,
        )
        revision = _REVISION
    LOGGER.info(
        "[xdatahub_bridge] image updated: media_ref=%s, rev=%s",
        media_ref,
        revision,
    )
    return revision


def get_latest_image() -> XDataHubImageSnapshot | None:
    """
    获取最新图片快照。
    """
    with _LOCK:
        return _LATEST_IMAGE


def get_latest_revision() -> int:
    """
    获取当前最新 revision（无图片时为 0）。
    """
    with _LOCK:
        return _LATEST_IMAGE.revision if _LATEST_IMAGE else 0
