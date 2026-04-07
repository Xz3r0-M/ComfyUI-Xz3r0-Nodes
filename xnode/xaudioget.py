"""
XAudioGet 节点模块 (V3 API)
=========================

从 XDataHub 接收不透明 media_ref 并输出音频。
"""

from __future__ import annotations

from pathlib import Path

import av
import torch
from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger, resolve_media_ref
except ImportError:
    from xz3r0_utils import get_logger, resolve_media_ref

LOGGER = get_logger(__name__)


class XAudioGet(io.ComfyNode):
    """
    XAudioGet 从 XDataHub media_ref 读取音频。
    """

    AUDIO_LOAD_ERROR = "Failed to load audio from XDataHub"

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="XAudioGet",
            display_name="XAudioGet",
            description="Load latest audio sent from XDataHub",
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
                io.Audio.Output(
                    "audio",
                    display_name="audio",
                    tooltip="Latest audio received from XDataHub",
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
            LOGGER.warning("[XAudioGet] invalid media ref")
            return io.NodeOutput(None)
        if not path.exists():
            LOGGER.warning("[XAudioGet] audio file missing")
            return io.NodeOutput(None)
        try:
            audio = cls._load_audio(path)
        except FileNotFoundError:
            LOGGER.warning("[XAudioGet] audio file missing")
            return io.NodeOutput(None)
        except Exception as exc:
            LOGGER.exception(
                "[XAudioGet] audio load failed: err=%s",
                type(exc).__name__,
            )
            raise ValueError(cls.AUDIO_LOAD_ERROR) from exc
        return io.NodeOutput(audio)

    @staticmethod
    def _load_audio(path: Path) -> dict[str, torch.Tensor | int]:
        with av.open(str(path)) as container:
            if not container.streams.audio:
                raise ValueError("No audio stream found in file.")

            stream = container.streams.audio[0]
            sample_rate = stream.codec_context.sample_rate
            channel_count = stream.channels

            frames = []
            for frame in container.decode(streams=stream):
                array = frame.to_ndarray()
                tensor = torch.from_numpy(array)
                if tensor.shape[0] != channel_count:
                    tensor = tensor.view(-1, channel_count).t()
                frames.append(XAudioGet._to_float32_pcm(tensor))

            if not frames:
                raise ValueError("No audio frames decoded.")

            waveform = torch.cat(frames, dim=1).unsqueeze(0)
            return {
                "waveform": waveform,
                "sample_rate": int(sample_rate),
            }

    @staticmethod
    def _to_float32_pcm(waveform: torch.Tensor) -> torch.Tensor:
        if waveform.dtype.is_floating_point:
            return waveform.to(dtype=torch.float32)
        if waveform.dtype == torch.int16:
            return waveform.to(dtype=torch.float32) / float(2**15)
        if waveform.dtype == torch.int32:
            return waveform.to(dtype=torch.float32) / float(2**31)
        raise ValueError(f"Unsupported wav dtype: {waveform.dtype}")

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
    return [XAudioGet]
