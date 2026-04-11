"""
XVideoGet 节点模块 (V3 API)
=========================

从 XDataHub 接收不透明 media_ref 并输出视频。
"""

from __future__ import annotations

from pathlib import Path

from comfy_api.latest import InputImpl, io

try:
    from ..xz3r0_utils import get_logger, resolve_media_ref
except ImportError:
    from xz3r0_utils import get_logger, resolve_media_ref

LOGGER = get_logger(__name__)


class XVideoGet(io.ComfyNode):
    """
    XVideoGet 从 XDataHub media_ref 读取视频。
    """

    VIDEO_LOAD_ERROR = "Failed to load video from XDataHub"

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="XVideoGet",
            display_name="XVideoGet",
            description="Load latest video sent from XDataHub",
            category="♾️ Xz3r0/XDataHub",
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
                io.Video.Output(
                    "video",
                    display_name="video",
                    tooltip="Latest video received from XDataHub",
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
            LOGGER.warning("[XVideoGet] invalid media ref")
            return io.NodeOutput(None)
        if not path.exists():
            LOGGER.warning("[XVideoGet] video file missing")
            return io.NodeOutput(None)
        try:
            video = InputImpl.VideoFromFile(str(path))
        except FileNotFoundError:
            LOGGER.warning("[XVideoGet] video file missing")
            return io.NodeOutput(None)
        except Exception as exc:
            LOGGER.exception(
                "[XVideoGet] video load failed: err=%s",
                type(exc).__name__,
            )
            raise ValueError(cls.VIDEO_LOAD_ERROR) from exc
        return io.NodeOutput(video)

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
    return [XVideoGet]
