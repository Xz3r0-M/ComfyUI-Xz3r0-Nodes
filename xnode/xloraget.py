"""
XLoraGet 节点模块 (V3 API)
=========================

从 XDataHub Lora 卡片接收 LoRA 列表并按顺序加载。
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import comfy.sd
import comfy.utils
from comfy_api.latest import io

try:
    import folder_paths  # type: ignore
except Exception:  # pragma: no cover
    folder_paths = None

try:
    from ..xz3r0_utils import get_logger
except ImportError:
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)

DEFAULT_STRENGTH = 1.0
LORA_TRIGGER_DB_NAME = "loras_data.db"


class XLoraGet(io.ComfyNode):
    """
    XLoraGet 按列表顺序将 LoRA 应用到 MODEL/CLIP。
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="XLoraGet",
            display_name="XLoraGet",
            description="Load ordered LoRA list from XDataHub",
            category="♾️ Xz3r0/File-Processing",
            inputs=[
                io.Model.Input(
                    "model",
                    tooltip="Base model to apply LoRAs",
                ),
                io.Clip.Input(
                    "clip",
                    optional=True,
                    tooltip="Optional CLIP input",
                ),
                io.String.Input(
                    "lora_stack",
                    default="[]",
                    tooltip="Serialized LoRA stack from frontend",
                    socketless=True,
                    extra_dict={"hidden": True},
                ),
            ],
            outputs=[
                io.Model.Output(
                    "model",
                    display_name="model",
                    tooltip="Model with ordered LoRAs applied",
                ),
                io.Clip.Output(
                    "clip",
                    display_name="clip",
                    tooltip="Clip with ordered LoRAs applied",
                ),
                io.String.Output(
                    "trigger_words",
                    display_name="trigger_words",
                    tooltip="Enabled trigger words from active LoRAs",
                ),
                io.String.Output(
                    "lora_info",
                    display_name="lora_info",
                    tooltip="Applied LoRA order and strength summary",
                ),
            ],
        )

    @classmethod
    def fingerprint_inputs(
        cls,
        model: Any = None,
        clip: Any = None,
        lora_stack: str = "[]",
    ) -> int:
        if model is None and clip is None and not lora_stack.strip():
            return 0
        digest_source = f"{bool(model)}|{bool(clip)}|{lora_stack}"
        import hashlib

        digest = hashlib.sha1(
            digest_source.encode("utf-8", errors="ignore")
        ).hexdigest()
        return int(digest, 16)

    @classmethod
    def execute(
        cls,
        model: Any,
        clip: Any = None,
        lora_stack: str = "[]",
    ) -> io.NodeOutput:
        entries = cls._parse_lora_stack(lora_stack)
        if not entries:
            return io.NodeOutput(model, clip, "", "")
        current_model = model
        current_clip = clip
        applied_lines: list[str] = []
        enabled_trigger_words: list[str] = []
        for entry in entries:
            if not entry["active"]:
                continue
            lora_name = cls._normalize_lora_name(entry.get("lora_name") or "")
            if not lora_name:
                lora_name = cls._resolve_lora_name_from_ref(
                    entry.get("lora_ref")
                )
            if not lora_name:
                LOGGER.warning("[XLoraGet] skip unresolved lora ref")
                continue
            strength_model = entry["strength_model"]
            strength_clip = entry["strength_clip"]
            if current_clip is None:
                strength_clip = 0.0
            if strength_model == 0 and strength_clip == 0:
                continue
            lora = cls._load_lora(lora_name)
            if lora is None:
                LOGGER.warning(
                    "[XLoraGet] skip missing lora: %s",
                    lora_name,
                )
                continue
            current_model, current_clip = comfy.sd.load_lora_for_models(
                current_model,
                current_clip,
                lora,
                strength_model,
                strength_clip,
            )
            applied_lines.append(
                cls._format_lora_info_line(
                    lora_name=lora_name,
                    strength_model=strength_model,
                    strength_clip=strength_clip,
                )
            )
            enabled_trigger_words.extend(
                cls._collect_enabled_trigger_words(entry.get("trigger_words"))
            )
        return io.NodeOutput(
            current_model,
            current_clip,
            ", ".join(enabled_trigger_words),
            "\n".join(applied_lines),
        )

    @classmethod
    def _parse_lora_stack(cls, value: str) -> list[dict[str, Any]]:
        raw = str(value or "").strip()
        if not raw:
            return []
        try:
            payload = json.loads(raw)
        except Exception:
            LOGGER.warning("[XLoraGet] invalid lora_stack json")
            return []
        if not isinstance(payload, list):
            return []
        entries: list[dict[str, Any]] = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            lora_ref = str(item.get("lora_ref") or "").strip()
            lora_name = cls._normalize_lora_name(
                item.get("lora_name") or item.get("path") or ""
            )
            if not lora_name and not lora_ref:
                continue
            active = bool(item.get("active", True))
            strength_model = cls._to_float(
                item.get("strength_model"),
                DEFAULT_STRENGTH,
            )
            separated_clip = bool(item.get("separate_clip_strength"))
            if separated_clip:
                strength_clip = cls._to_float(
                    item.get("strength_clip"),
                    strength_model,
                )
            else:
                strength_clip = strength_model
            entries.append(
                {
                    "active": active,
                    "lora_ref": lora_ref,
                    "lora_name": lora_name,
                    "strength_model": strength_model,
                    "strength_clip": strength_clip,
                    "trigger_words": cls._normalize_trigger_words(
                        item.get("trigger_words")
                    ),
                }
            )
        return entries

    @classmethod
    def _normalize_trigger_words(
        cls,
        value: Any,
    ) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            return []
        items: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in value:
            normalized = cls._normalize_trigger_word_item(item)
            if normalized is None:
                continue
            key = str(normalized["text"]).casefold()
            if key in seen:
                continue
            seen.add(key)
            items.append(normalized)
        return items

    @staticmethod
    def _normalize_trigger_word_item(
        value: Any,
    ) -> dict[str, Any] | None:
        if isinstance(value, dict):
            raw_text = value.get("text")
            enabled = bool(value.get("enabled", True))
        else:
            raw_text = value
            enabled = True
        text = " ".join(str(raw_text or "").strip().split())
        if not text:
            return None
        return {
            "text": text,
            "enabled": enabled,
        }

    @classmethod
    def _collect_enabled_trigger_words(
        cls,
        value: Any,
    ) -> list[str]:
        words = cls._normalize_trigger_words(value)
        return [
            str(item["text"]) for item in words if item.get("enabled", True)
        ]

    @staticmethod
    def _format_lora_info_line(
        lora_name: str,
        strength_model: float,
        strength_clip: float,
    ) -> str:
        name = Path(lora_name).name or lora_name
        return (
            f"{name} | model={strength_model:.4f} | clip={strength_clip:.4f}"
        )

    @staticmethod
    def _normalize_lora_name(value: Any) -> str:
        text = str(value or "").strip().replace("\\", "/")
        text = text.lstrip("/")
        if text.lower().startswith("loras/"):
            text = text[6:]
        parts = [part for part in text.split("/") if part]
        safe_parts = [part for part in parts if part not in {".", ".."}]
        return "/".join(safe_parts)

    @staticmethod
    def _to_float(value: Any, fallback: float) -> float:
        try:
            return float(value)
        except Exception:
            return float(fallback)

    @staticmethod
    def _parse_bool(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        text = str(value or "").strip().lower()
        if text in {"1", "true", "yes", "on"}:
            return True
        if text in {"0", "false", "no", "off"}:
            return False
        return False

    @staticmethod
    def _data_root() -> Path:
        return Path(__file__).resolve().parent.parent / "XDataSaved"

    @classmethod
    def _lora_root_dir(cls) -> Path | None:
        candidates: list[Path] = []
        if folder_paths is not None:
            try:
                for raw in folder_paths.get_folder_paths("loras"):
                    if raw:
                        candidates.append(Path(raw))
            except Exception:
                pass
            models_dir = getattr(folder_paths, "models_dir", None)
            if models_dir:
                candidates.extend(
                    [
                        Path(models_dir) / "loras",
                        Path(models_dir) / "Loras",
                    ]
                )
        for path in candidates:
            try:
                resolved = path.resolve()
            except Exception:
                resolved = path
            if resolved.exists():
                return resolved
        return candidates[0] if candidates else None

    @classmethod
    def _resolve_lora_trigger_db_path(cls) -> Path:
        data_db = cls._data_root() / LORA_TRIGGER_DB_NAME
        try:
            settings_path = cls._data_root() / "xdatahub_settings.json"
            payload = json.loads(settings_path.read_text(encoding="utf-8"))
        except Exception:
            payload = {}

        use_lora_root = cls._parse_bool(payload.get("store_lora_db_in_loras"))
        if use_lora_root:
            lora_root = cls._lora_root_dir()
            if lora_root is not None:
                return lora_root / LORA_TRIGGER_DB_NAME
        return data_db

    @classmethod
    def _resolve_lora_name_from_ref(cls, value: Any) -> str:
        lora_ref = str(value or "").strip()
        if not lora_ref:
            return ""
        db_path = cls._resolve_lora_trigger_db_path()
        if not db_path.exists():
            return ""
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        try:
            row = conn.execute(
                "SELECT rel_path FROM lora_items WHERE public_ref = ?",
                (lora_ref,),
            ).fetchone()
            if row is None:
                return ""
            return cls._normalize_lora_name(str(row["rel_path"] or ""))
        except Exception:
            return ""
        finally:
            conn.close()

    @classmethod
    def _load_lora(cls, lora_name: str) -> Any | None:
        if folder_paths is None:
            LOGGER.warning("[XLoraGet] folder_paths unavailable")
            return None
        try:
            lora_path = folder_paths.get_full_path_or_raise(
                "loras",
                lora_name,
            )
        except Exception:
            return None
        try:
            return comfy.utils.load_torch_file(
                lora_path,
                safe_load=True,
            )
        except Exception as exc:
            LOGGER.warning(
                "[XLoraGet] lora load failed: name=%s err=%s",
                lora_name,
                type(exc).__name__,
            )
            return None


def NODE_CLASS_MAPPINGS():
    return [XLoraGet]
