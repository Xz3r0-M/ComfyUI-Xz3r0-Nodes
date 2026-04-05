"""
XDataHub 统一数据浏览 API。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import mimetypes
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time
from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import server
from aiohttp import web
from PIL import Image, UnidentifiedImageError

try:
    import folder_paths  # type: ignore
except Exception:  # pragma: no cover
    folder_paths = None

try:
    from ..xz3r0_utils import (
        ensure_unique_filename,
        generate_public_ref,
        get_critical_db_names,
        get_logger,
        media_ref_to_file_url,
        normalize_media_ref,
        resolve_media_ref,
        sanitize_path_component,
    )
    from ..xz3r0_utils.xdatahub_bridge import (
        get_latest_image,
        update_latest_image,
    )
except ImportError:
    from xz3r0_utils import (
        ensure_unique_filename,
        generate_public_ref,
        get_critical_db_names,
        get_logger,
        media_ref_to_file_url,
        normalize_media_ref,
        resolve_media_ref,
        sanitize_path_component,
    )
    from xz3r0_utils.xdatahub_bridge import (
        get_latest_image,
        update_latest_image,
    )

LOGGER = get_logger(__name__)

SQLITE_BUSY_TIMEOUT_MS = 1000
RETRY_COUNT = 2
RETRY_DELAY_S = 0.05
LOCK_COOLDOWN_S = 0.35
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200
VALIDATION_BATCH_SIZE = 30
FILE_WRITE_RETRY = 3
FILE_WRITE_RETRY_DELAY_S = 0.05
MEDIA_SORT_BY_VALUES = {"mtime", "name", "size"}
MEDIA_SORT_ORDER_VALUES = {"asc", "desc"}
MEDIA_CARD_SIZE_PRESET_VALUES = {"compact", "standard", "large"}
THEME_MODE_VALUES = {"dark", "light"}
UI_LOCALE_VALUES = {"zh", "en"}
MEDIA_STREAM_CHUNK_SIZE = 256 * 1024
IMAGE_VALIDATE_CACHE_MAX = 512
IMAGE_VALIDATE_CACHE_TTL_S = 30.0
IMAGE_VALIDATE_CACHE: dict[tuple[str, int, int], dict[str, Any]] = {}
IMAGE_VALIDATE_LOCK = threading.Lock()
FAVORITES_DB_NAME = "user_favorites.db"
LORA_TRIGGER_DB_NAME = "loras_data.db"
LORA_DB_CONFLICT_ACTION_REPLACE = "replace"
LORA_DB_CONFLICT_ACTION_USE_EXISTING = "use_existing"
LORA_DB_CONFLICT_ACTION_VALUES = {
    LORA_DB_CONFLICT_ACTION_REPLACE,
    LORA_DB_CONFLICT_ACTION_USE_EXISTING,
}
MEDIA_INDEX_DB_NAME = "media_index.db"
CUSTOM_ROOT_PREFIX = "custom_"
CUSTOM_VIRTUAL_ROOT = "custom"
MAX_TRIGGER_WORDS = 256
MAX_TRIGGER_WORD_LEN = 200
MAX_TRIGGER_WORD_NOTE_LEN = 300
MAX_LORA_NOTE_LEN = 1000
PROJECT_ROOT = Path(__file__).resolve().parent.parent
XDATAHUB_ROOT_NAME = "XDataSaved"
XDATAHUB_SETTINGS_ROOT = PROJECT_ROOT / XDATAHUB_ROOT_NAME / "settings"

MEDIA_TYPE_EXT = {
    "image": {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"},
    "video": {".mp4", ".webm", ".mov", ".mkv", ".avi"},
    "audio": {".wav", ".mp3", ".flac", ".ogg", ".m4a"},
}
LORA_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
LORA_ROOT_NAME = "loras"
LORA_FILE_EXT = {
    ".bin",
    ".ckpt",
    ".pkl",
    ".pt",
    ".pt2",
    ".pth",
    ".safetensors",
    ".sft",
}
if folder_paths is not None:
    try:
        supported_exts = getattr(folder_paths, "supported_pt_extensions", ())
        normalized_exts = {
            str(ext).strip().lower()
            for ext in supported_exts
            if str(ext).strip().startswith(".")
        }
        if normalized_exts:
            LORA_FILE_EXT = normalized_exts
    except Exception:
        pass

ERROR_TEXT = {
    "file_not_found": "File not found or moved",
    "permission_denied": "Permission denied",
    "file_corrupted": "File corrupted or unreadable",
    "quota_exceeded": "Limit exceeded, request rejected",
    "invalid_payload": "Invalid payload",
    "resource_busy": "Resource is busy, read-only mode only",
    "internal_error": "System busy, please retry later",
    "unsupported_media_type": "Unsupported media type",
    "lora_db_conflict": "Target Lora database already exists",
}


class LoraDbConflictError(RuntimeError):
    def __init__(self, current_db_path: Path, target_db_path: Path):
        super().__init__("lora db conflict")
        self.current_db_path = current_db_path
        self.target_db_path = target_db_path

    def to_payload(self) -> dict[str, Any]:
        return {
            "status": "error",
            "code": "lora_db_conflict",
            "message_key": "xdatahub.api.error.lora_db_conflict",
            "message": ERROR_TEXT["lora_db_conflict"],
            "file_name": LORA_TRIGGER_DB_NAME,
            "current_location": "xdatahub_database",
            "target_location": "models_loras",
        }


def _infer_media_content_type(path: Path, media_type: str | None) -> str:
    guessed, _ = mimetypes.guess_type(str(path))
    if guessed:
        return guessed
    fallback = {
        "image": "image/*",
        "video": "video/*",
        "audio": "audio/*",
    }
    return fallback.get(
        str(media_type or "").lower(),
        "application/octet-stream",
    )


def _is_client_disconnect_error(exc: BaseException) -> bool:
    return isinstance(
        exc,
        (
            ConnectionError,
            ConnectionResetError,
            ConnectionAbortedError,
            BrokenPipeError,
            asyncio.CancelledError,
        ),
    )


def _parse_range_header(
    range_value: str,
    file_size: int,
) -> tuple[int, int] | None:
    raw = str(range_value or "").strip().lower()
    if not raw.startswith("bytes="):
        return None
    spec = raw[len("bytes=") :].split(",", 1)[0].strip()
    if "-" not in spec:
        return None
    start_text, end_text = spec.split("-", 1)
    if not start_text and not end_text:
        return None
    try:
        if not start_text:
            suffix_len = int(end_text)
            if suffix_len <= 0:
                return None
            start = max(0, file_size - suffix_len)
            end = file_size - 1
        else:
            start = int(start_text)
            end = int(end_text) if end_text else file_size - 1
    except Exception:
        return None
    if start < 0 or end < start or start >= file_size:
        return None
    end = min(end, file_size - 1)
    return (start, end)


async def _stream_media_file_response(
    request: web.Request,
    path: Path,
    media_type: str | None,
) -> web.StreamResponse:
    stat = path.stat()
    file_size = int(stat.st_size)
    content_type = _infer_media_content_type(path, media_type)
    range_value = request.headers.get("Range")
    span = _parse_range_header(range_value, file_size) if range_value else None

    if range_value and span is None:
        return web.Response(
            status=416,
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    if span is None:
        start = 0
        end = file_size - 1
        status = 200
    else:
        start, end = span
        status = 206

    content_length = max(0, end - start + 1)
    resp = web.StreamResponse(status=status)
    resp.headers["Content-Type"] = content_type
    resp.headers["Accept-Ranges"] = "bytes"
    resp.headers["Content-Length"] = str(content_length)
    if status == 206:
        resp.headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

    await resp.prepare(request)
    if request.method == "HEAD" or content_length <= 0:
        await resp.write_eof()
        return resp

    with path.open("rb") as handle:
        handle.seek(start)
        remaining = content_length
        while remaining > 0:
            chunk = handle.read(min(MEDIA_STREAM_CHUNK_SIZE, remaining))
            if not chunk:
                break
            try:
                await resp.write(chunk)
            except Exception as exc:
                if _is_client_disconnect_error(exc):
                    return resp
                raise
            remaining -= len(chunk)

    try:
        await resp.write_eof()
    except Exception as exc:
        if _is_client_disconnect_error(exc):
            return resp
        raise
    return resp


def resolve_locale_from_request(request: web.Request | None) -> str:
    if request is None:
        return "en"
    query_locale = normalize_locale_code(request.query.get("locale"))
    if query_locale in {"zh", "en"}:
        return query_locale
    header = str(request.headers.get("Accept-Language") or "")
    if header:
        preferred = normalize_locale_code(header.split(",", 1)[0])
        if preferred in {"zh", "en"}:
            return preferred
    return "en"


def error_message(code: str, locale: str) -> str:
    _ = locale
    return ERROR_TEXT.get(code) or code


def json_error(
    code_or_request: str | web.Request,
    code: str | None = None,
    status: int = 400,
) -> web.Response:
    if code is None:
        request = None
        err_code = str(code_or_request)
    else:
        request = (
            code_or_request
            if isinstance(code_or_request, web.Request)
            else None
        )
        err_code = str(code)
    locale = resolve_locale_from_request(request)
    message = error_message(err_code, locale)
    return web.json_response(
        {
            "status": "error",
            "code": err_code,
            "message_key": f"xdatahub.api.error.{err_code}",
            "message": message,
        },
        status=status,
    )


def parse_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(value)
        return parsed if parsed > 0 else fallback
    except Exception:
        return fallback


def parse_iso(value: str | None) -> float | None:
    if not value:
        return None
    try:
        raw = value.strip()
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return None


def _image_validate_cache_key(path: Path) -> tuple[str, int, int] | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    return (str(path), int(stat.st_mtime_ns), int(stat.st_size))


def _get_image_validation_cached(
    path: Path,
) -> tuple[bool, str | None] | None:
    key = _image_validate_cache_key(path)
    if key is None:
        return None
    now = time.time()
    with IMAGE_VALIDATE_LOCK:
        entry = IMAGE_VALIDATE_CACHE.get(key)
        if not entry:
            return None
        if now - float(entry.get("ts", 0)) > IMAGE_VALIDATE_CACHE_TTL_S:
            IMAGE_VALIDATE_CACHE.pop(key, None)
            return None
        return bool(entry.get("ok")), entry.get("code")


def _set_image_validation_cache(
    path: Path,
    ok: bool,
    code: str | None,
) -> None:
    key = _image_validate_cache_key(path)
    if key is None:
        return
    now = time.time()
    with IMAGE_VALIDATE_LOCK:
        IMAGE_VALIDATE_CACHE[key] = {
            "ok": ok,
            "code": code,
            "ts": now,
        }
        if len(IMAGE_VALIDATE_CACHE) <= IMAGE_VALIDATE_CACHE_MAX:
            return
        oldest_key = min(
            IMAGE_VALIDATE_CACHE,
            key=lambda k: float(IMAGE_VALIDATE_CACHE[k].get("ts", 0)),
        )
        IMAGE_VALIDATE_CACHE.pop(oldest_key, None)


def _validate_image_with_pillow(path: Path) -> tuple[bool, str | None]:
    try:
        with Image.open(path) as img:
            img.verify()
        return True, None
    except UnidentifiedImageError:
        return False, "unsupported_media_type"
    except Exception:
        return False, "file_corrupted"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def xdatahub_root() -> Path:
    root = PROJECT_ROOT / XDATAHUB_ROOT_NAME
    root.mkdir(parents=True, exist_ok=True)
    return root


def data_root() -> Path:
    root = xdatahub_root() / "database"
    root.mkdir(parents=True, exist_ok=True)
    return root


def settings_root() -> Path:
    root = XDATAHUB_SETTINGS_ROOT
    root.mkdir(parents=True, exist_ok=True)
    return root


def favorites_db_path() -> Path:
    return data_root() / FAVORITES_DB_NAME


def locales_root() -> Path:
    return Path(__file__).resolve().parent.parent / "locales"


def normalize_locale_code(value: str | None) -> str:
    raw = str(value or "en").strip().lower().replace("_", "-")
    base = raw.split("-", 1)[0]
    return base or "en"


def read_xdatahub_ui_locale(locale: str | None) -> tuple[str, dict[str, Any]]:
    base = normalize_locale_code(locale)
    locale_dir = locales_root()
    candidates = [base]
    if "en" not in candidates:
        candidates.append("en")

    for code in candidates:
        path = locale_dir / code / "xdatahub_ui.json"
        try:
            if not path.exists():
                continue
            payload = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                return code, payload
        except Exception as exc:
            LOGGER.warning(
                "[xdatahub] ui locale read failed: locale=%s, path=%s, err=%s",
                code,
                path,
                exc,
            )
            continue
    return "en", {}


def comfy_dirs() -> list[tuple[str, Path]]:
    dirs: list[tuple[str, Path]] = []
    if folder_paths is not None:
        for name in ("output", "input"):
            try:
                raw = folder_paths.get_directory_by_type(name)
            except Exception:
                raw = None
            if raw:
                dirs.append((name, Path(raw)))
        try:
            dirs.append(("output", Path(folder_paths.get_output_directory())))
        except Exception:
            pass
        try:
            dirs.append(("input", Path(folder_paths.get_input_directory())))
        except Exception:
            pass
    if not dirs:
        env_pairs = (
            ("output", "COMFY_OUTPUT_DIR"),
            ("input", "COMFY_INPUT_DIR"),
        )
        for name, env_name in env_pairs:
            value = os.getenv(env_name)
            if value:
                dirs.append((name, Path(value)))
    for name, path in custom_media_dirs():
        dirs.append((name, path))
    resolved: list[tuple[str, Path]] = []
    seen: set[tuple[str, str]] = set()
    for name, p in dirs:
        try:
            normalized = normalize_path(p)
            key = (name, str(normalized))
            if key in seen:
                continue
            seen.add(key)
            resolved.append((name, normalized))
        except Exception:
            continue
    return resolved


def _normalize_custom_root_values(value: Any) -> list[str]:
    raw_items: list[str] = []
    if isinstance(value, str):
        raw_items = [
            line.strip()
            for line in value.replace("\r", "\n").split("\n")
            if line.strip()
        ]
    elif isinstance(value, list):
        raw_items = [
            str(item or "").strip()
            for item in value
            if str(item or "").strip()
        ]
    normalized_items: list[str] = []
    seen: set[str] = set()
    for raw in raw_items:
        try:
            candidate = Path(raw)
            abs_text = os.path.normpath(os.path.abspath(str(candidate)))
            real_text = os.path.normpath(os.path.realpath(str(candidate)))
            # 严格模式：路径存在且绝对路径必须等于 realpath，拒绝软链接/目录联接。
            if os.path.normcase(abs_text) != os.path.normcase(real_text):
                continue
            resolved = Path(real_text)
            if not resolved.exists() or not resolved.is_dir():
                continue
            key = os.path.normcase(str(resolved))
            if key in seen:
                continue
            seen.add(key)
            display_path = resolved
            try:
                parent = resolved.parent
                with os.scandir(parent) as entries:
                    for entry in entries:
                        if (
                            entry.is_dir(follow_symlinks=False)
                            and entry.name.lower() == resolved.name.lower()
                        ):
                            display_path = parent / entry.name
                            break
            except Exception:
                pass
            normalized_items.append(str(display_path))
        except Exception:
            continue
    return normalized_items


def custom_media_dirs() -> list[tuple[str, Path]]:
    path = xdatahub_settings_path()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        payload = {}
    values = _normalize_custom_root_values(payload.get("media_custom_roots"))
    output: list[tuple[str, Path]] = []
    for index, value in enumerate(values, start=1):
        output.append((f"{CUSTOM_ROOT_PREFIX}{index}", Path(value)))
    return output


def custom_media_root_titles() -> dict[str, str]:
    titles: dict[str, str] = {}
    for name, path in custom_media_dirs():
        label = path.name.strip() or str(path)
        titles[name] = label
    return titles


def media_root_names() -> set[str]:
    return {name for name, _ in comfy_dirs()}


def media_type_for(path: Path) -> str | None:
    suffix = path.suffix.lower()
    for media_type, exts in MEDIA_TYPE_EXT.items():
        if suffix in exts:
            return media_type
    return None


def normalize_path(path: Path | str) -> Path:
    raw = str(path)
    value = os.path.abspath(raw)
    value = os.path.realpath(value)
    value = os.path.normcase(value)
    value = os.path.normpath(value)
    return Path(value)


def is_path_within_root(path: Path, root: Path) -> bool:
    try:
        candidate = str(normalize_path(path))
        normalized_root = str(normalize_path(root))
        common = os.path.commonpath([candidate, normalized_root])
        return common == normalized_root
    except Exception:
        return False


def is_path_within_root_lexical(path: Path, root: Path) -> bool:
    try:
        candidate = os.path.normcase(
            os.path.normpath(os.path.abspath(str(path)))
        )
        normalized_root = os.path.normcase(
            os.path.normpath(os.path.abspath(str(root)))
        )
        common = os.path.commonpath([candidate, normalized_root])
        return common == normalized_root
    except Exception:
        return False


def parse_rel_root(
    rel_path: str,
    root_names: set[str] | None = None,
) -> tuple[str | None, Path | None]:
    value = rel_path.strip().replace("\\", "/")
    if "/" not in value:
        return None, None
    root_name, rel_value = value.split("/", 1)
    root_name = root_name.strip().lower()
    rel_value = rel_value.strip().lstrip("/")
    _names = root_names if root_names is not None else media_root_names()
    if root_name not in _names or not rel_value:
        return None, None
    parts = [part for part in rel_value.split("/") if part]
    if not parts:
        return None, None
    for part in parts:
        if part in {".", ".."}:
            return None, None
    return root_name, Path(rel_value)


def normalize_dir_query(value: str | None) -> str:
    if not value:
        return ""
    raw = value.strip().replace("\\", "/").strip("/")
    if not raw:
        return ""
    parts = [part.strip() for part in raw.split("/") if part.strip()]
    if not parts:
        return ""
    root_name = parts[0].lower()
    active_roots = media_root_names()
    custom_roots = {
        name for name in active_roots if name.startswith(CUSTOM_ROOT_PREFIX)
    }
    if root_name == CUSTOM_VIRTUAL_ROOT:
        if len(parts) == 1:
            return CUSTOM_VIRTUAL_ROOT
        custom_root_name = parts[1].strip().lower()
        if custom_root_name not in custom_roots:
            return CUSTOM_VIRTUAL_ROOT
        safe_parts = [CUSTOM_VIRTUAL_ROOT, custom_root_name]
        for part in parts[2:]:
            if part in {".", ".."}:
                return ""
            safe_parts.append(part)
        return "/".join(safe_parts)
    if root_name not in active_roots:
        return ""
    safe_parts: list[str] = []
    for part in parts:
        if part in {".", ".."}:
            return ""
        safe_parts.append(part)
    return "/".join(safe_parts)


def normalize_lora_rel_path(value: str | None) -> str:
    raw = str(value or "").strip().replace("\\", "/").strip("/")
    if not raw:
        return ""
    parts = [part.strip() for part in raw.split("/") if part.strip()]
    if not parts:
        return ""
    if parts[0].lower() == LORA_ROOT_NAME:
        parts = parts[1:]
    safe_parts: list[str] = []
    for part in parts:
        if part in {".", ".."}:
            return ""
        safe_parts.append(part)
    return "/".join(safe_parts)


def normalize_lora_dir_query(value: str | None) -> str:
    rel_path = normalize_lora_rel_path(value)
    return f"{LORA_ROOT_NAME}/{rel_path}" if rel_path else LORA_ROOT_NAME


def lora_root_dir() -> Path | None:
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
    normalized_candidates: list[Path] = []
    seen: set[str] = set()
    for path in candidates:
        try:
            normalized = normalize_path(path)
        except Exception:
            continue
        key = str(normalized)
        if key in seen:
            continue
        seen.add(key)
        normalized_candidates.append(normalized)
    for path in normalized_candidates:
        if path.exists():
            return path
    return normalized_candidates[0] if normalized_candidates else None


def resolve_lora_dir(rel_dir: str | None) -> tuple[Path | None, Path | None]:
    root = lora_root_dir()
    if root is None:
        return None, None
    subdir = normalize_lora_rel_path(rel_dir)
    target = root / subdir if subdir else root
    if not is_path_within_root_lexical(target, root):
        return root, None
    # 返回原始大小写的路径，而不是通过 normalize_path 转换为小写
    # 只验证路径有效性即可
    try:
        # 尝试检查路径是否真实存在，但保留原始大小写
        if target.exists():
            return root, target
    except Exception:
        pass
    return root, target


def lora_thumb_url(lora_ref: str) -> str:
    return "/xz3r0/xdatahub/loras/thumb?ref=" + quote(lora_ref, safe="")


def find_lora_thumbnail(path: Path) -> Path | None:
    stem = path.stem
    parent = path.parent
    for ext in LORA_IMAGE_EXT:
        candidate = parent / f"{stem}{ext}"
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def _split_trigger_words_text(value: Any) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    parts = [
        item.strip() for item in re.split(r"[\n,;/|]+", text) if item.strip()
    ]
    return parts


def _extract_trigger_words_from_metadata(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    candidates: list[Any] = []
    if "trainedWords" in payload:
        candidates.append(payload.get("trainedWords"))
    if isinstance(payload.get("meta"), dict):
        meta_dict = payload.get("meta")
        if "trainedWords" in meta_dict:
            candidates.append(meta_dict.get("trainedWords"))
    if isinstance(payload.get("civitai"), dict):
        civitai_dict = payload.get("civitai")
        if "trainedWords" in civitai_dict:
            candidates.append(civitai_dict.get("trainedWords"))
        if isinstance(civitai_dict.get("model"), dict):
            model_dict = civitai_dict.get("model")
            if "trainedWords" in model_dict:
                candidates.append(model_dict.get("trainedWords"))
    flattened: list[str] = []
    for value in candidates:
        if isinstance(value, str):
            flattened.extend(_split_trigger_words_text(value))
            continue
        if isinstance(value, list):
            for item in value:
                if isinstance(item, str):
                    flattened.extend(_split_trigger_words_text(item))
                elif isinstance(item, dict):
                    if "text" in item:
                        flattened.extend(
                            _split_trigger_words_text(item.get("text"))
                        )
                    elif "name" in item:
                        flattened.extend(
                            _split_trigger_words_text(item.get("name"))
                        )
            continue
        if isinstance(value, dict):
            flattened.extend(_split_trigger_words_text(value.get("text")))
    return normalize_trigger_words(flattened)


def _resolve_lora_metadata_file(lora_path: Path) -> Path | None:
    candidates = [
        lora_path.with_suffix(".metadata.json"),
        lora_path.with_suffix(".json"),
        lora_path.parent / "metadata.json",
    ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def read_lora_trigger_words_from_metadata(rel_path: str) -> dict[str, Any]:
    normalized_rel = normalize_lora_rel_path(rel_path)
    if not normalized_rel:
        return {
            "found": False,
            "trigger_words": [],
            "message": "invalid path",
            "source": "",
        }
    root = lora_root_dir()
    if root is None:
        return {
            "found": False,
            "trigger_words": [],
            "message": "lora root not found",
            "source": "",
        }
    lora_path = normalize_path(root / normalized_rel)
    if not is_path_within_root(lora_path, root):
        return {
            "found": False,
            "trigger_words": [],
            "message": "invalid path",
            "source": "",
        }
    if not lora_path.exists() or not lora_path.is_file():
        return {
            "found": False,
            "trigger_words": [],
            "message": "lora file not found",
            "source": "",
        }
    metadata_path = _resolve_lora_metadata_file(lora_path)
    if metadata_path is None:
        return {
            "found": False,
            "trigger_words": [],
            "message": "metadata.json not found",
            "source": "",
        }
    try:
        raw_text = metadata_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raw_text = metadata_path.read_text(encoding="utf-8-sig")
    except Exception:
        return {
            "found": False,
            "trigger_words": [],
            "message": "failed to read metadata.json",
            "source": metadata_path.name,
        }
    try:
        payload = json.loads(raw_text)
    except Exception:
        return {
            "found": False,
            "trigger_words": [],
            "message": "metadata.json is not valid json",
            "source": metadata_path.name,
        }
    trigger_words = _extract_trigger_words_from_metadata(payload)
    if not trigger_words:
        return {
            "found": False,
            "trigger_words": [],
            "message": "no trigger words in metadata.json",
            "source": metadata_path.name,
        }
    return {
        "found": True,
        "trigger_words": trigger_words,
        "message": "ok",
        "source": metadata_path.name,
    }


def _lora_item_payload(
    root: Path,
    path: Path,
    include_datetime: bool = True,
    include_size: bool = True,
) -> dict[str, Any]:
    stat = path.stat()
    rel_path = path.relative_to(root).as_posix()
    thumb_path = find_lora_thumbnail(path)
    saved_at = ""
    if include_datetime:
        saved_at = datetime.fromtimestamp(
            float(stat.st_mtime),
            tz=timezone.utc,
        ).isoformat(timespec="seconds")
    extra: dict[str, Any] = {
        "entry_type": "lora",
        "media_type": "lora",
        "rel_path": rel_path,
        "file_ext": path.suffix.lower(),
    }
    if include_datetime:
        extra["mtime"] = float(stat.st_mtime)
    if include_size:
        extra["size"] = int(stat.st_size)
    if thumb_path is not None:
        # 旧目录扫描函数不再向前端暴露真实路径，thumb_url 由数据库列表生成。
        extra["thumb_url"] = ""
    return {
        "id": f"lora:{rel_path}",
        "kind": "lora",
        "title": path.name,
        "saved_at": saved_at,
        "path": f"{LORA_ROOT_NAME}/{rel_path}",
        "previewable": False,
        "extra": extra,
    }


def list_lora_directory(
    directory: str,
    page: int,
    page_size: int,
    keyword: str = "",
    include_datetime: bool = True,
    include_size: bool = True,
    sort_by: str = "mtime",
    sort_order: str = "desc",
) -> dict[str, Any]:
    # 委托给 LORA_STORE 从数据库查询（替代实时文件系统扫描）
    return LORA_STORE.list(
        directory=directory,
        page=page,
        page_size=page_size,
        keyword=keyword,
        sort_by=sort_by,
        sort_order=sort_order,
    )


def split_rel_path(
    value: str,
    root_names: set[str] | None = None,
) -> list[str] | None:
    normalized = value.strip().replace("\\", "/").strip("/")
    if not normalized:
        return None
    parts = [part for part in normalized.split("/") if part]
    if len(parts) < 2:
        return None
    _names = root_names if root_names is not None else media_root_names()
    if parts[0] not in _names:
        return None
    return parts


def map_folder_item(
    child_path: str,
    title: str,
    mtime: float | None = None,
) -> dict[str, Any]:
    extra = {
        "entry_type": "folder",
        "child_path": child_path,
    }
    if mtime is not None:
        extra["mtime"] = float(mtime)
    return {
        "id": f"folder:{child_path}",
        "kind": "folder",
        "title": title,
        "saved_at": "",
        "path": child_path,
        "previewable": False,
        "extra": extra,
    }


def sort_folder_items(
    items: list[dict[str, Any]],
    sort_by: str = "mtime",
    sort_order: str = "desc",
) -> list[dict[str, Any]]:
    safe_sort_by = sort_by if sort_by in MEDIA_SORT_BY_VALUES else "mtime"
    safe_sort_order = (
        sort_order if sort_order in MEDIA_SORT_ORDER_VALUES else "desc"
    )
    ordered = list(items)

    def _name_key(item: dict[str, Any]) -> tuple[str, str]:
        return (
            str(item.get("title") or "").lower(),
            str(item.get("path") or "").lower(),
        )

    if safe_sort_by == "name":
        ordered.sort(
            key=_name_key,
            reverse=safe_sort_order == "desc",
        )
        return ordered

    def _mtime_value(item: dict[str, Any]) -> float:
        extra = item.get("extra")
        if isinstance(extra, dict):
            try:
                return float(extra.get("mtime") or 0)
            except Exception:
                return 0.0
        return 0.0

    if safe_sort_order == "desc":
        ordered.sort(
            key=lambda item: (
                -_mtime_value(item),
                *_name_key(item),
            )
        )
    else:
        ordered.sort(
            key=lambda item: (
                _mtime_value(item),
                *_name_key(item),
            )
        )
    return ordered


def build_directory_items(
    rows: list[sqlite3.Row],
    directory: str,
    include_datetime: bool = True,
    include_size: bool = True,
    include_resolution: bool = True,
    sort_by: str = "mtime",
    sort_order: str = "desc",
) -> list[dict[str, Any]]:
    if directory == CUSTOM_VIRTUAL_ROOT:
        custom_titles = custom_media_root_titles()
        items = [
            map_folder_item(
                f"{CUSTOM_VIRTUAL_ROOT}/{name}",
                custom_titles.get(name, name),
            )
            for name in sorted(custom_titles.keys())
        ]
        return items
    custom_scope = False
    if directory.startswith(f"{CUSTOM_VIRTUAL_ROOT}/"):
        custom_scope = True
        custom_parts = [part for part in directory.split("/") if part]
        if len(custom_parts) < 2:
            return []
        dir_parts = custom_parts[1:]
    else:
        dir_parts = directory.split("/") if directory else []
    _root_names = media_root_names()
    standard_root_order = [
        root_name
        for root_name in ("input", "output")
        if root_name in _root_names
    ]
    folder_children: dict[str, str] = {}
    folder_mtimes: dict[str, float] = {}
    file_rows: list[sqlite3.Row] = []
    for row in rows:
        rel_parts = split_rel_path(str(row["rel_path"] or ""), _root_names)
        if rel_parts is None:
            continue
        if dir_parts:
            if len(rel_parts) <= len(dir_parts):
                continue
            if rel_parts[: len(dir_parts)] != dir_parts:
                continue
            remain = rel_parts[len(dir_parts) :]
        else:
            remain = rel_parts
        if len(remain) == 1:
            file_rows.append(row)
            continue
        child_internal_path = "/".join(rel_parts[: len(dir_parts) + 1])
        child_path = (
            f"{CUSTOM_VIRTUAL_ROOT}/{child_internal_path}"
            if custom_scope
            else child_internal_path
        )
        folder_children[remain[0]] = child_path
        try:
            row_mtime = float(row["mtime"] or 0)
        except Exception:
            row_mtime = 0.0
        current_folder_mtime = folder_mtimes.get(remain[0])
        if current_folder_mtime is None or row_mtime > current_folder_mtime:
            folder_mtimes[remain[0]] = row_mtime

    if not dir_parts and not custom_scope:
        for root_name in standard_root_order:
            folder_children.setdefault(root_name, root_name)

    custom_titles = custom_media_root_titles()
    safe_sort_by = sort_by if sort_by in MEDIA_SORT_BY_VALUES else "mtime"
    safe_sort_order = (
        sort_order if sort_order in MEDIA_SORT_ORDER_VALUES else "desc"
    )
    reverse = safe_sort_order == "desc"
    folder_items = sort_folder_items(
        [
            map_folder_item(
                path,
                custom_titles.get(title, title),
                mtime=folder_mtimes.get(title),
            )
            for title, path in folder_children.items()
        ],
        sort_by=safe_sort_by,
        sort_order=safe_sort_order,
    )

    def _file_sort_name(row: sqlite3.Row) -> tuple[str, str]:
        filename = str(row["filename"] or "").lower()
        rel_path = str(row["rel_path"] or "").lower()
        return (filename, rel_path)

    if safe_sort_by == "name":
        file_rows.sort(
            key=_file_sort_name,
            reverse=reverse,
        )
    elif safe_sort_by == "size":
        file_rows.sort(
            key=lambda row: (
                int(row["size"]),
                *_file_sort_name(row),
            ),
            reverse=reverse,
        )
    else:
        file_rows.sort(
            key=lambda row: (
                float(row["mtime"]),
                *_file_sort_name(row),
            ),
            reverse=reverse,
        )
    file_items = [
        map_media_item(
            row,
            include_datetime=include_datetime,
            include_size=include_size,
            include_resolution=include_resolution,
        )
        for row in file_rows
    ]
    return [*folder_items, *file_items]


def build_media_candidates(
    row: sqlite3.Row,
    roots: dict[str, Path],
) -> list[tuple[str, Path]]:
    output: list[tuple[str, Path]] = []
    seen: set[str] = set()
    _root_names = set(roots.keys())

    rel_root, rel_tail = parse_rel_root(
        str(row["rel_path"] or ""), _root_names
    )
    if rel_root and rel_tail is not None and rel_root in roots:
        candidate = roots[rel_root] / rel_tail
        key = os.path.normcase(str(candidate))
        seen.add(key)
        output.append(("rel_path", candidate))

    if "real_path" in row.keys():
        legacy = Path(str(row["real_path"]))
    else:
        legacy = Path(str(row["path"]))
    legacy_key = os.path.normcase(str(legacy))
    if legacy_key not in seen:
        output.append(("legacy_path", legacy))
    return output


def locate_media_entry(
    row: sqlite3.Row,
    roots: list[tuple[str, Path]],
) -> dict[str, Any]:
    root_map = dict(roots)
    blocked = False
    blocked_count = 0
    for source, candidate in build_media_candidates(row, root_map):
        try:
            resolved = candidate.resolve(strict=True)
        except FileNotFoundError:
            continue
        except PermissionError:
            blocked = True
            blocked_count += 1
            continue
        except OSError:
            continue

        for root_name, root_path in roots:
            if is_path_within_root(resolved, root_path):
                return {
                    "status": "ok",
                    "source": source,
                    "path": resolved,
                    "root_name": root_name,
                    "root_path": root_path,
                    "allowed_by": "real_path",
                }
        if source == "rel_path":
            for root_name, root_path in roots:
                if is_path_within_root_lexical(candidate, root_path):
                    return {
                        "status": "ok",
                        "source": source,
                        "path": resolved,
                        "root_name": root_name,
                        "root_path": root_path,
                        "allowed_by": "entry_path",
                    }
        blocked = True
        blocked_count += 1

    if blocked:
        return {"status": "blocked", "blocked_count": blocked_count}
    return {"status": "not_found"}


class LockManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state = "IDLE"
        self._cooldown_until = 0.0
        self._interrupt_requested = False
        self._interrupt_request_at: float | None = None
        self._last_event = "init"
        self._was_executing = False

    def _queue_counts(self) -> tuple[int, int]:
        prompt_queue = getattr(
            server.PromptServer.instance,
            "prompt_queue",
            None,
        )
        if prompt_queue is None:
            return 0, 0
        try:
            running, queued = prompt_queue.get_current_queue_volatile()
        except Exception:
            return 0, 0
        return len(running), len(queued)

    def mark_prompt_submitted(self) -> None:
        with self._lock:
            self._last_event = "prompt_submitted"

    def mark_interrupt_requested(self) -> None:
        with self._lock:
            self._interrupt_requested = True
            self._interrupt_request_at = time.time()
            self._last_event = "interrupt_requested"

    def mark_event(self, event: str) -> None:
        normalized = str(event or "").strip().lower() or "unknown"
        with self._lock:
            self._last_event = normalized
            if normalized in {"execution_start", "execution_cached"}:
                self._interrupt_requested = False
                self._interrupt_request_at = None

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            now = time.monotonic()
            running_count, queued_count = self._queue_counts()
            queue_remaining = running_count + queued_count
            is_executing = queue_remaining > 0

            if is_executing:
                self._cooldown_until = 0.0
                self._was_executing = True
                if self._interrupt_requested:
                    self._state = "STOPPING"
                elif running_count > 0:
                    self._state = "RUNNING"
                else:
                    self._state = "QUEUED"
            else:
                if self._was_executing and self._cooldown_until <= 0.0:
                    self._cooldown_until = now + LOCK_COOLDOWN_S
                if self._cooldown_until > now:
                    self._state = "COOLDOWN"
                else:
                    self._state = "IDLE"
                    self._cooldown_until = 0.0
                    self._was_executing = False
                self._interrupt_requested = False
                self._interrupt_request_at = None

            remain_ms = 0
            if self._state == "COOLDOWN":
                remain_ms = max(0, int((self._cooldown_until - now) * 1000))
            return {
                "state": self._state,
                "readonly": is_executing,
                "cooldown_ms": remain_ms,
                "is_executing": is_executing,
                "queue_remaining": queue_remaining,
                "queue_running": running_count,
                "queue_pending": queued_count,
                "interrupt_requested": self._interrupt_requested,
                "interrupt_request_at": (
                    int(self._interrupt_request_at * 1000)
                    if self._interrupt_request_at is not None
                    else None
                ),
                "last_event": self._last_event,
            }


LOCK = LockManager()
USER_CRITICAL_FILE_LOCK = threading.RLock()
XDATAHUB_SETTINGS_FILE_LOCK = threading.RLock()


class MediaStore:
    def __init__(self) -> None:
        self.db_path = data_root() / "media_index.db"
        self.thumb_root = xdatahub_root() / "thumb_cache"
        self.thumb_root.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self, create: bool = False) -> sqlite3.Connection:
        if not create and not self.db_path.exists():
            raise FileNotFoundError(
                f"media_index.db not found: {self.db_path}"
            )
        conn = sqlite3.connect(
            self.db_path,
            timeout=SQLITE_BUSY_TIMEOUT_MS / 1000,
        )
        conn.row_factory = sqlite3.Row
        conn.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")
        return conn

    @contextmanager
    def _conn(
        self, create: bool = False
    ) -> Generator[sqlite3.Connection, None, None]:
        conn = self._connect(create=create)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _create_media_index_table(
        self,
        conn: sqlite3.Connection,
        table_name: str = "media_index",
    ) -> None:
        conn.execute(
            f"CREATE TABLE IF NOT EXISTS {table_name} ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "public_ref TEXT NOT NULL UNIQUE,"
            "real_path TEXT NOT NULL,"
            "rel_path TEXT NOT NULL UNIQUE,"
            "filename TEXT NOT NULL,"
            "media_type TEXT NOT NULL,"
            "mtime REAL NOT NULL,"
            "size INTEGER NOT NULL,"
            "valid INTEGER NOT NULL DEFAULT 1,"
            "created_at TEXT NOT NULL,"
            "updated_at TEXT NOT NULL)"
        )

    @staticmethod
    def _coerce_public_ref(
        value: Any,
        reserved: set[str],
    ) -> str:
        normalized = normalize_media_ref(str(value or ""))
        if normalized and normalized not in reserved:
            reserved.add(normalized)
            return normalized
        while True:
            generated = generate_public_ref()
            normalized = normalize_media_ref(generated)
            if normalized and normalized not in reserved:
                reserved.add(normalized)
                return normalized

    @staticmethod
    def _row_public_ref_map(
        conn: sqlite3.Connection,
        media_type: str | None = None,
    ) -> dict[str, str]:
        params: list[Any] = []
        where = ""
        if media_type:
            where = " WHERE media_type = ?"
            params.append(media_type)
        rows = conn.execute(
            "SELECT rel_path, public_ref FROM media_index" + where,
            params,
        ).fetchall()
        return {
            str(row["rel_path"] or ""): str(row["public_ref"] or "")
            for row in rows
            if str(row["rel_path"] or "").strip()
        }

    @staticmethod
    def _all_public_refs(conn: sqlite3.Connection) -> set[str]:
        rows = conn.execute("SELECT public_ref FROM media_index").fetchall()
        return {
            ref
            for ref in (
                normalize_media_ref(str(row["public_ref"] or ""))
                for row in rows
            )
            if ref
        }

    def _upsert_index_entry(
        self,
        conn: sqlite3.Connection,
        entry: dict[str, Any],
        public_ref: str,
        now: str,
    ) -> None:
        conn.execute(
            (
                "INSERT INTO media_index "
                "(public_ref, real_path, rel_path, filename, media_type, "
                "mtime, size, valid, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?) "
                "ON CONFLICT(rel_path) DO UPDATE SET "
                "real_path=excluded.real_path, "
                "filename=excluded.filename, "
                "media_type=excluded.media_type, "
                "mtime=excluded.mtime, "
                "size=excluded.size, valid=1, "
                "updated_at=excluded.updated_at"
            ),
            (
                public_ref,
                entry["path"],
                entry["rel_path"],
                entry["filename"],
                entry["media_type"],
                entry["mtime"],
                entry["size"],
                now,
                now,
            ),
        )

    def upsert_media_file(
        self,
        path: Path,
        media_type: str | None = None,
    ) -> dict[str, Any] | None:
        try:
            resolved = path.resolve(strict=True)
            stat = resolved.stat()
        except OSError:
            return None
        detected_type = media_type or media_type_for(resolved)
        if detected_type not in MEDIA_TYPE_EXT:
            return None
        root_name = ""
        root_dir: Path | None = None
        for candidate_name, candidate_root in comfy_dirs():
            if is_path_within_root(resolved, candidate_root):
                root_name = candidate_name
                root_dir = candidate_root
                break
        if not root_name or root_dir is None:
            return None
        entry = {
            "path": str(resolved),
            "rel_path": rel_media_path(resolved, root_name, root_dir),
            "filename": resolved.name,
            "media_type": detected_type,
            "mtime": float(stat.st_mtime),
            "size": int(stat.st_size),
        }
        with self._conn(create=True) as conn:
            existing_row = conn.execute(
                "SELECT public_ref FROM media_index WHERE rel_path = ?",
                (entry["rel_path"],),
            ).fetchone()
            existing_ref = (
                str(existing_row["public_ref"] or "")
                if existing_row is not None
                else ""
            )
            reserved = self._all_public_refs(conn)
            normalized_existing = normalize_media_ref(existing_ref)
            if normalized_existing in reserved:
                reserved.remove(normalized_existing)
            public_ref = self._coerce_public_ref(existing_ref, reserved)
            now = utc_now_iso()
            self._upsert_index_entry(conn, entry, public_ref, now)
            conn.commit()
            row = conn.execute(
                "SELECT id, public_ref, real_path, rel_path, filename, "
                "media_type, mtime, size "
                "FROM media_index WHERE rel_path = ?",
                (entry["rel_path"],),
            ).fetchone()
        if row is None:
            return None
        return map_media_item(row)

    def _init_schema(self) -> None:
        with self._conn(create=True) as conn:
            self._create_media_index_table(conn)
            columns = {
                str(row["name"])
                for row in conn.execute(
                    "PRAGMA table_info(media_index)"
                ).fetchall()
            }
            needs_migrate = (
                "public_ref" not in columns
                or "real_path" not in columns
                or "path" in columns
            )
            if needs_migrate:
                rows = conn.execute("SELECT * FROM media_index").fetchall()
                self._create_media_index_table(conn, "media_index_new")
                reserved_refs: set[str] = set()
                for row in rows:
                    public_ref = self._coerce_public_ref(
                        (
                            row["public_ref"]
                            if "public_ref" in row.keys()
                            else ""
                        ),
                        reserved_refs,
                    )
                    real_path = (
                        str(row["real_path"])
                        if "real_path" in row.keys()
                        else str(row["path"])
                    )
                    conn.execute(
                        "INSERT OR REPLACE INTO media_index_new "
                        "(id, public_ref, real_path, rel_path, filename, "
                        "media_type, mtime, size, valid, created_at, "
                        "updated_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            int(row["id"]),
                            public_ref,
                            real_path,
                            str(row["rel_path"]),
                            str(row["filename"]),
                            str(row["media_type"]),
                            float(row["mtime"]),
                            int(row["size"]),
                            int(row["valid"]),
                            str(row["created_at"]),
                            str(row["updated_at"]),
                        ),
                    )
                conn.execute("DROP TABLE media_index")
                conn.execute(
                    "ALTER TABLE media_index_new RENAME TO media_index"
                )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_media_type_mtime "
                "ON media_index(media_type, mtime DESC)"
            )
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS "
                "idx_media_rel_path_unique ON media_index(rel_path)"
            )
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS "
                "idx_media_public_ref_unique ON media_index(public_ref)"
            )
            conn.commit()

    def _retry_read(self, callback):
        last_exc = None
        for _ in range(RETRY_COUNT + 1):
            try:
                with self._conn() as conn:
                    return callback(conn)
            except sqlite3.OperationalError as exc:
                last_exc = exc
                if "locked" not in str(exc).lower():
                    raise
                time.sleep(RETRY_DELAY_S)
        if last_exc:
            raise last_exc
        raise RuntimeError("read failed")

    def list(
        self,
        media_type: str,
        page: int,
        page_size: int,
        directory: str,
        keyword: str,
        start_ts: float | None,
        end_ts: float | None,
        flat_view: bool,
        validate_page: bool,
        include_datetime: bool = True,
        include_size: bool = True,
        include_resolution: bool = True,
        sort_by: str = "mtime",
        sort_order: str = "desc",
    ) -> dict[str, Any]:
        if not self.db_path.exists():
            return {
                "items": [],
                "page": 1,
                "page_size": page_size,
                "total": 0,
                "total_pages": 1,
                "directory": directory,
            }
        safe_sort_by = sort_by if sort_by in MEDIA_SORT_BY_VALUES else "mtime"
        safe_sort_order = (
            sort_order if sort_order in MEDIA_SORT_ORDER_VALUES else "desc"
        )
        sql_field_map = {
            "mtime": "mtime",
            "name": "filename",
            "size": "size",
        }
        sql_order = "ASC" if safe_sort_order == "asc" else "DESC"
        sql_field = sql_field_map[safe_sort_by]
        order_clause = (
            f"ORDER BY {sql_field} {sql_order}, filename ASC, rel_path ASC"
        )

        def _query(conn: sqlite3.Connection) -> dict[str, Any]:
            cond = ["media_type = ?", "valid = 1"]
            params: list[Any] = [media_type]
            if keyword:
                cond.append("LOWER(filename) LIKE ?")
                params.append(f"%{keyword.lower()}%")
            if start_ts is not None:
                cond.append("mtime >= ?")
                params.append(start_ts)
            if end_ts is not None:
                cond.append("mtime <= ?")
                params.append(end_ts)
            where = " AND ".join(cond)
            if flat_view:
                total = int(
                    conn.execute(
                        f"SELECT COUNT(*) FROM media_index WHERE {where}",
                        params,
                    ).fetchone()[0]
                )
                total_pages = max(1, (total + page_size - 1) // page_size)
                safe_page = min(max(1, page), total_pages)
                offset = (safe_page - 1) * page_size
                rows = conn.execute(
                    (
                        "SELECT id, public_ref, real_path, rel_path, "
                        "filename, media_type, "
                        "mtime, size "
                        f"FROM media_index WHERE {where} "
                        f"{order_clause} LIMIT ? OFFSET ?"
                    ),
                    [*params, page_size, offset],
                ).fetchall()
                if validate_page:
                    self._validate(conn, rows)
                    rows = conn.execute(
                        (
                            "SELECT id, public_ref, real_path, rel_path, "
                            "filename, media_type, "
                            "mtime, size FROM media_index "
                            f"WHERE {where} {order_clause} "
                            "LIMIT ? OFFSET ?"
                        ),
                        [*params, page_size, offset],
                    ).fetchall()
                return {
                    "items": [
                        map_media_item(
                            row,
                            include_datetime=include_datetime,
                            include_size=include_size,
                            include_resolution=include_resolution,
                        )
                        for row in rows
                    ],
                    "page": safe_page,
                    "page_size": page_size,
                    "total": total,
                    "total_pages": total_pages,
                    "directory": "",
                }

            rows = conn.execute(
                (
                    "SELECT id, public_ref, real_path, rel_path, "
                    "filename, media_type, "
                    "mtime, size "
                    f"FROM media_index WHERE {where} "
                    f"{order_clause}"
                ),
                params,
            ).fetchall()
            if validate_page:
                self._validate(conn, rows)
                rows = conn.execute(
                    (
                        "SELECT id, public_ref, real_path, rel_path, "
                        "filename, media_type, "
                        "mtime, size FROM media_index "
                        f"WHERE {where} {order_clause}"
                    ),
                    params,
                ).fetchall()
            all_items = build_directory_items(
                rows,
                directory,
                include_datetime=include_datetime,
                include_size=include_size,
                include_resolution=include_resolution,
                sort_by=safe_sort_by,
                sort_order=safe_sort_order,
            )
            total = len(all_items)
            total_pages = max(1, (total + page_size - 1) // page_size)
            safe_page = min(max(1, page), total_pages)
            offset = (safe_page - 1) * page_size
            return {
                "items": all_items[offset : offset + page_size],
                "page": safe_page,
                "page_size": page_size,
                "total": total,
                "total_pages": total_pages,
                "directory": directory,
            }

        return self._retry_read(_query)

    def _validate(
        self,
        conn: sqlite3.Connection,
        rows: list[sqlite3.Row],
    ) -> None:
        changed = False
        roots = comfy_dirs()
        for row in rows[:VALIDATION_BATCH_SIZE]:
            resolved = self.resolve_runtime_path(conn, row, roots)
            if resolved is None:
                conn.execute(
                    "UPDATE media_index "
                    "SET valid = 0, updated_at = ? WHERE id = ?",
                    (utc_now_iso(), int(row["id"])),
                )
                changed = True
                continue
            try:
                stat = resolved.stat()
            except FileNotFoundError:
                conn.execute(
                    "UPDATE media_index "
                    "SET valid = 0, updated_at = ? WHERE id = ?",
                    (utc_now_iso(), int(row["id"])),
                )
                changed = True
                continue
            if abs(float(row["mtime"]) - float(stat.st_mtime)) > 1e-6 or int(
                row["size"]
            ) != int(stat.st_size):
                conn.execute(
                    "UPDATE media_index SET mtime = ?, size = ?, valid = 1, "
                    "updated_at = ? WHERE id = ?",
                    (
                        float(stat.st_mtime),
                        int(stat.st_size),
                        utc_now_iso(),
                        int(row["id"]),
                    ),
                )
                changed = True
        if changed:
            conn.commit()

    def resolve_runtime_path(
        self,
        conn: sqlite3.Connection,
        row: sqlite3.Row,
        roots: list[tuple[str, Path]] | None = None,
    ) -> Path | None:
        active_roots = roots if roots is not None else comfy_dirs()
        located = locate_media_entry(row, active_roots)
        if located["status"] != "ok":
            if located["status"] == "blocked":
                LOGGER.info(
                    "[xdatahub] media blocked by root guard: id=%s, "
                    "candidates=%s",
                    int(row["id"]),
                    located.get("blocked_count", 0),
                )
            return None
        resolved = Path(located["path"])
        row_keys = set(row.keys())
        current_real_path = (
            str(row["real_path"] or "").strip()
            if "real_path" in row_keys
            else ""
        )
        current_filename = (
            str(row["filename"] or "").strip()
            if "filename" in row_keys
            else ""
        )
        need_repair = (
            not current_real_path
            or Path(current_real_path) != resolved
            or (current_filename and current_filename != resolved.name)
        )
        if not need_repair:
            return resolved
        self._repair_row_path(
            conn=conn,
            row_id=int(row["id"]),
            resolved=resolved,
            root_name=str(located["root_name"]),
            root_path=Path(located["root_path"]),
            source=str(located["source"]),
        )
        return resolved

    def _repair_row_path(
        self,
        conn: sqlite3.Connection,
        row_id: int,
        resolved: Path,
        root_name: str,
        root_path: Path,
        source: str,
    ) -> None:
        now = utc_now_iso()
        try:
            conn.execute(
                "UPDATE media_index SET real_path = ?, "
                "filename = ?, valid = 1, updated_at = ? WHERE id = ?",
                (
                    str(resolved),
                    resolved.name,
                    now,
                    row_id,
                ),
            )
            conn.commit()
            if source != "legacy_path":
                LOGGER.debug(
                    "[xdatahub] media path repaired: id=%s, source=%s",
                    row_id,
                    source,
                )
        except sqlite3.Error as exc:
            LOGGER.warning(
                "[xdatahub] media path repair skipped: id=%s, err=%s",
                row_id,
                type(exc).__name__,
            )

    def refresh(self, media_type: str | None) -> dict[str, int]:
        inserted = 0
        updated = 0
        deleted = 0
        if not self.db_path.exists():
            self._init_schema()
        with self._conn() as conn:
            where = ""
            params: list[Any] = []
            if media_type:
                where = " WHERE media_type = ?"
                params.append(media_type)
            existing_rows = conn.execute(
                "SELECT id, rel_path, public_ref, real_path, filename, "
                "media_type, mtime, size FROM media_index" + where,
                params,
            ).fetchall()
            existing_map = {
                str(row["rel_path"] or ""): {
                    "id": int(row["id"]),
                    "public_ref": str(row["public_ref"] or ""),
                }
                for row in existing_rows
                if str(row["rel_path"] or "").strip()
            }
            invalidated_at = utc_now_iso()
            if media_type:
                conn.execute(
                    "UPDATE media_index SET valid = 0, updated_at = ? "
                    "WHERE media_type = ?",
                    (invalidated_at, media_type),
                )
            else:
                conn.execute(
                    "UPDATE media_index SET valid = 0, updated_at = ?",
                    (invalidated_at,),
                )
            reserved_refs = self._all_public_refs(conn)
            for entry in scan_media(media_type):
                now = utc_now_iso()
                rel_path = str(entry["rel_path"])
                existing_ref = str(
                    (existing_map.get(rel_path) or {}).get("public_ref") or ""
                )
                normalized_existing = normalize_media_ref(existing_ref)
                if normalized_existing in reserved_refs:
                    reserved_refs.remove(normalized_existing)
                public_ref = self._coerce_public_ref(
                    existing_ref,
                    reserved_refs,
                )
                self._upsert_index_entry(conn, entry, public_ref, now)
                if rel_path in existing_map:
                    updated += 1
                else:
                    inserted += 1
            stale_where = ""
            stale_params: list[Any] = []
            if media_type:
                stale_where = " AND media_type = ?"
                stale_params.append(media_type)
            stale_rows = conn.execute(
                "SELECT id, real_path, rel_path, filename, media_type, "
                "mtime, size FROM media_index WHERE valid = 0" + stale_where,
                stale_params,
            ).fetchall()
            if stale_rows:
                roots = comfy_dirs()
                for row in stale_rows:
                    if self.resolve_runtime_path(conn, row, roots) is not None:
                        continue
                    deleted += int(
                        conn.execute(
                            "DELETE FROM media_index WHERE id = ?",
                            (int(row["id"]),),
                        ).rowcount
                    )
            conn.commit()
        return {
            "inserted": inserted,
            "updated": updated,
            "deleted": deleted,
        }

    def cleanup_invalid(self, media_type: str | None) -> dict[str, int]:
        if not self.db_path.exists():
            return {"checked": 0, "marked_invalid": 0, "deleted": 0}
        checked = 0
        marked = 0
        with self._conn() as conn:
            params: list[Any] = []
            where = ""
            if media_type:
                where = "WHERE media_type = ?"
                params.append(media_type)
            roots = comfy_dirs()
            rows = conn.execute(
                (
                    "SELECT id, real_path, rel_path, filename, media_type, "
                    f"mtime, size FROM media_index {where}"
                ),
                params,
            ).fetchall()
            for row in rows:
                checked += 1
                if self.resolve_runtime_path(conn, row, roots) is None:
                    conn.execute(
                        "UPDATE media_index "
                        "SET valid = 0, updated_at = ? WHERE id = ?",
                        (utc_now_iso(), int(row["id"])),
                    )
                    marked += 1
            if media_type:
                deleted = int(
                    conn.execute(
                        "DELETE FROM media_index "
                        "WHERE valid = 0 AND media_type = ?",
                        (media_type,),
                    ).rowcount
                )
            else:
                deleted = int(
                    conn.execute(
                        "DELETE FROM media_index WHERE valid = 0"
                    ).rowcount
                )
            conn.commit()
        return {
            "checked": checked,
            "marked_invalid": marked,
            "deleted": deleted,
        }

    def rebuild(self, media_type: str) -> dict[str, int]:
        preserved_refs: dict[str, str] = {}
        if not self.db_path.exists():
            self._init_schema()
        with self._conn() as conn:
            preserved_refs = self._row_public_ref_map(conn, media_type)
            deleted = int(
                conn.execute(
                    "DELETE FROM media_index WHERE media_type = ?",
                    (media_type,),
                ).rowcount
            )
            conn.commit()
        with self._conn() as conn:
            existing_map = self._row_public_ref_map(conn, None)
            reserved_refs = self._all_public_refs(conn)
            inserted = 0
            updated = 0
            for entry in scan_media(media_type):
                now = utc_now_iso()
                rel_path = str(entry["rel_path"])
                public_ref = self._coerce_public_ref(
                    preserved_refs.get(
                        rel_path,
                        existing_map.get(rel_path, ""),
                    ),
                    reserved_refs,
                )
                self._upsert_index_entry(conn, entry, public_ref, now)
                if rel_path in existing_map:
                    updated += 1
                else:
                    inserted += 1
            conn.commit()
        refreshed = {"inserted": inserted, "updated": updated}
        return {"deleted": deleted, **refreshed}

    def clear(self, media_type: str | None = None) -> int:
        if not self.db_path.exists():
            return 0
        with self._conn() as conn:
            if media_type:
                deleted = int(
                    conn.execute(
                        "DELETE FROM media_index WHERE media_type = ?",
                        (media_type,),
                    ).rowcount
                )
            else:
                deleted = int(conn.execute("DELETE FROM media_index").rowcount)
            conn.commit()
        return deleted

    def repair_public_ref_path(
        self,
        public_ref: str,
        resolved: Path,
    ) -> None:
        normalized = normalize_media_ref(public_ref)
        if not normalized:
            return
        try:
            with self._conn() as conn:
                conn.execute(
                    "UPDATE media_index SET real_path = ?, filename = ?, "
                    "valid = 1, updated_at = ? WHERE public_ref = ?",
                    (
                        str(resolved),
                        resolved.name,
                        utc_now_iso(),
                        normalized,
                    ),
                )
                conn.commit()
        except sqlite3.Error as exc:
            LOGGER.warning(
                "[xdatahub] media path repair by ref skipped: ref=%s, err=%s",
                normalized,
                type(exc).__name__,
            )

    def clear_thumbs(self, media_type: str | None) -> int:
        target = (
            self.thumb_root / media_type if media_type else self.thumb_root
        )
        return clear_tree(target)


class LoraStore:
    """LORA 数据库管理器，基于 loras_data.db 的 lora_items 表"""

    def __init__(self) -> None:
        pass

    def _get_root(self) -> Path | None:
        """获取 LORA 根目录"""
        return lora_root_dir()

    def scan_lora_files(self) -> dict[str, int]:
        """扫描所有 LORA 根目录中的文件并插入数据库"""
        root = self._get_root()
        if root is None:
            LOGGER.warning("[xdatahub-lora] no lora root directory found")
            return {"scanned": 0, "added": 0, "updated": 0}

        scanned = 0
        added = 0
        updated = 0
        conn = connect_lora_trigger_db(create=True)
        try:
            ensure_lora_trigger_schema(conn)
            reserved_refs = _all_lora_public_refs(conn)
            # 先将现有记录标记为无效，扫描到的文件会被重新置为 valid=1。
            conn.execute("UPDATE lora_items SET valid = 0")
            for path in iter_media_files(root):
                if path.suffix.lower() not in LORA_FILE_EXT:
                    continue
                scanned += 1
                try:
                    stat = path.stat()
                    rel_path_str = path.relative_to(root).as_posix()
                    real_path_str = str(path.resolve(strict=True))
                    filename_str = path.name
                    mtime_float = float(stat.st_mtime)
                    size_int = int(stat.st_size)

                    # 检查是否已存在
                    existing = conn.execute(
                        "SELECT lora_key FROM lora_items WHERE rel_path = ?",
                        (rel_path_str,),
                    ).fetchone()

                    if existing:
                        # 更新现有记录
                        conn.execute(
                            "UPDATE lora_items SET "
                            "real_path=?, filename=?, mtime=?, size=?, "
                            "valid=1, updated_at=? "
                            "WHERE rel_path=?",
                            (
                                real_path_str,
                                filename_str,
                                mtime_float,
                                size_int,
                                datetime.now(timezone.utc).isoformat(
                                    timespec="seconds"
                                ),
                                rel_path_str,
                            ),
                        )
                        updated += 1
                    else:
                        # 插入新记录
                        now_iso = datetime.now(timezone.utc).isoformat(
                            timespec="seconds"
                        )
                        public_ref = _coerce_lora_public_ref(
                            "",
                            reserved_refs,
                        )
                        conn.execute(
                            "INSERT INTO lora_items ("
                            "lora_key, public_ref, rel_path, title, "
                            "real_path, "
                            "filename, mtime, size, valid, "
                            "trigger_words_json, "
                            "strength_model, strength_clip, "
                            "source, created_at, updated_at) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, '[]', "
                            "1.0, 1.0, 'user', ?, ?)",
                            (
                                rel_path_str,
                                public_ref,
                                rel_path_str,
                                filename_str,
                                real_path_str,
                                filename_str,
                                mtime_float,
                                size_int,
                                now_iso,
                                now_iso,
                            ),
                        )
                        added += 1
                except OSError as e:
                    LOGGER.warning(
                        "[xdatahub-lora] scan file error: %s, path=%s",
                        type(e).__name__,
                        path.name,
                    )
                    continue
            conn.commit()
        finally:
            conn.close()

        LOGGER.info(
            "[xdatahub-lora] scan complete: scanned=%d, added=%d, updated=%d",
            scanned,
            added,
            updated,
        )
        return {"scanned": scanned, "added": added, "updated": updated}

    def upsert_lora_file(self, path: Path, rel_path: str) -> dict[str, Any]:
        """插入或更新单个 LORA 文件"""
        try:
            stat = path.stat()
            real_path_str = str(path.resolve(strict=True))
            filename_str = path.name
            mtime_float = float(stat.st_mtime)
            size_int = int(stat.st_size)

            conn = connect_lora_trigger_db(create=True)
            try:
                ensure_lora_trigger_schema(conn)
                now_iso = datetime.now(timezone.utc).isoformat(
                    timespec="seconds"
                )
                public_ref = _lora_public_ref_for_rel_path(conn, rel_path)
                conn.execute(
                    "INSERT INTO lora_items ("
                    "lora_key, public_ref, rel_path, title, real_path, "
                    "filename, mtime, size, valid, "
                    "trigger_words_json, "
                    "strength_model, strength_clip, "
                    "source, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, '[]', "
                    "1.0, 1.0, 'user', ?, ?) "
                    "ON CONFLICT(rel_path) DO UPDATE SET "
                    "real_path=excluded.real_path, "
                    "filename=excluded.filename, "
                    "mtime=excluded.mtime, "
                    "size=excluded.size, "
                    "valid=1, "
                    "updated_at=excluded.updated_at",
                    (
                        rel_path,
                        public_ref,
                        rel_path,
                        filename_str,
                        real_path_str,
                        filename_str,
                        mtime_float,
                        size_int,
                        now_iso,
                        now_iso,
                    ),
                )
                conn.commit()
            finally:
                conn.close()

            return {
                "rel_path": rel_path,
                "filename": filename_str,
                "mtime": mtime_float,
                "size": size_int,
            }
        except OSError as e:
            LOGGER.error(
                "[xdatahub-lora] upsert error: %s, path=%s",
                type(e).__name__,
                str(path),
            )
            raise

    def list(
        self,
        directory: str = "",
        page: int = 1,
        page_size: int = 20,
        keyword: str = "",
        sort_by: str = "mtime",
        sort_order: str = "desc",
    ) -> dict[str, Any]:
        """从数据库查询 LORA 列表（替代 list_lora_directory）"""
        root = self._get_root()
        if root is None:
            return {
                "items": [],
                "page": 1,
                "page_size": page_size,
                "total": 0,
                "total_pages": 1,
            }

        # 解析目录路径
        subdir_prefix = normalize_lora_rel_path(directory)
        if subdir_prefix:
            subdir_prefix = subdir_prefix + "/"

        keyword_normalized = keyword.strip().casefold()
        db_path = lora_trigger_db_path()
        if not db_path.exists():
            return {
                "items": [],
                "page": 1,
                "page_size": page_size,
                "total": 0,
                "total_pages": 1,
            }
        conn = connect_lora_trigger_db()
        try:
            ensure_lora_trigger_schema(conn)

            # 统计总数（只计算有效文件）
            query_count = (
                "SELECT COUNT(DISTINCT SUBSTR(rel_path, 1, "
                "INSTR(SUBSTR(rel_path, LENGTH(?)+1), '/')-1)) as dir, "
                "COUNT(CASE WHEN INSTR(SUBSTR(rel_path, LENGTH(?)+1), "
                "'/')=0 THEN 1 END) as file "
                "FROM lora_items WHERE valid=1"
            )
            params_count = [subdir_prefix, subdir_prefix]
            if subdir_prefix:
                query_count += " AND rel_path LIKE ?"
                params_count.append(subdir_prefix + "%")
            if keyword_normalized:
                query_count += (
                    " AND (LOWER(filename) LIKE ? OR LOWER(rel_path) LIKE ?)"
                )
                kw = f"%{keyword_normalized}%"
                params_count.extend([kw, kw])

            # 获取项目列表
            folder_items: list[dict[str, Any]] = []
            file_items: list[dict[str, Any]] = []
            safe_sort_by = (
                sort_by if sort_by in MEDIA_SORT_BY_VALUES else "mtime"
            )
            safe_sort_order = (
                sort_order if sort_order in MEDIA_SORT_ORDER_VALUES else "desc"
            )

            # 查询该目录级别的子目录
            query_dirs = (
                "SELECT DISTINCT "
                "SUBSTR(SUBSTR(rel_path, LENGTH(?)+1), 1, "
                "INSTR(SUBSTR(rel_path, LENGTH(?)+1), '/')-1) as dir, "
                "MAX(mtime) as latest_mtime "
                "FROM lora_items WHERE valid=1"
            )
            params_dirs = [subdir_prefix, subdir_prefix]
            if subdir_prefix:
                query_dirs += " AND rel_path LIKE ?"
                params_dirs.append(subdir_prefix + "%")
            query_dirs += " AND INSTR(SUBSTR(rel_path, LENGTH(?)+1), "
            query_dirs += "'/')>0 GROUP BY dir ORDER BY dir"
            params_dirs.append(subdir_prefix)

            for row in conn.execute(query_dirs, params_dirs):
                dir_name = str(row[0] or "")
                if keyword_normalized and (
                    keyword_normalized not in dir_name.casefold()
                ):
                    continue
                rel_path = (
                    subdir_prefix + dir_name if subdir_prefix else dir_name
                )
                folder_items.append(
                    map_folder_item(
                        f"{LORA_ROOT_NAME}/{rel_path}",
                        dir_name,
                        mtime=float(row[1] or 0),
                    )
                )
            folder_items = sort_folder_items(
                folder_items,
                sort_by=safe_sort_by,
                sort_order=safe_sort_order,
            )

            # 查询该目录级别的 LORA 文件
            query_files = (
                "SELECT public_ref, rel_path, filename, mtime, size, "
                "trigger_words_json, lora_note, strength_model, strength_clip "
                "FROM lora_items WHERE valid=1"
            )
            params_files = []
            if subdir_prefix:
                query_files += " AND rel_path LIKE ?"
                params_files.append(subdir_prefix + "%")
            query_files += " AND INSTR(SUBSTR(rel_path, LENGTH(?)+1), '/')=0"
            params_files.append(subdir_prefix)
            if keyword_normalized:
                query_files += (
                    " AND (LOWER(filename) LIKE ? OR LOWER(rel_path) LIKE ?)"
                )
                kw = f"%{keyword_normalized}%"
                params_files.extend([kw, kw])

            # 排序
            sort_col = "mtime" if safe_sort_by == "mtime" else "filename"
            if safe_sort_by == "size":
                sort_col = "size"
            order = "DESC" if safe_sort_order == "desc" else "ASC"
            query_files += f" ORDER BY {sort_col} {order}, filename"

            for row in conn.execute(query_files, params_files):
                public_ref = str(row[0] or "")
                rel_path = str(row[1] or "")
                filename = str(row[2] or "")
                mtime = float(row[3] or 0)
                size = int(row[4] or 0)
                trigger_words_json = str(row[5] or "[]")
                lora_note = str(row[6] or "")
                strength_model = row[7]
                strength_clip = row[8]
                file_items.append(
                    _lora_item_payload_from_db(
                        root,
                        public_ref,
                        rel_path,
                        filename,
                        mtime,
                        size,
                        trigger_words_json,
                        lora_note,
                        strength_model,
                        strength_clip,
                    )
                )

            items = folder_items + file_items
            total = len(items)
            safe_page_size = max(1, min(page_size, MAX_PAGE_SIZE))
            total_pages = max(
                1, (total + safe_page_size - 1) // safe_page_size
            )

            start_idx = (page - 1) * safe_page_size
            end_idx = start_idx + safe_page_size
            paginated_items = items[start_idx:end_idx]

            return {
                "items": paginated_items,
                "page": page,
                "page_size": safe_page_size,
                "total": total,
                "total_pages": total_pages,
            }
        finally:
            conn.close()

    def cleanup_invalid(self) -> int:
        """清理标记为 invalid（已删除）的文件记录"""
        if not lora_trigger_db_path().exists():
            return 0
        conn = connect_lora_trigger_db()
        try:
            ensure_lora_trigger_schema(conn)
            result = conn.execute("DELETE FROM lora_items WHERE valid=0")
            conn.commit()
            count = result.rowcount
            LOGGER.info(
                "[xdatahub-lora] cleanup: deleted %d invalid records", count
            )
            return count
        finally:
            conn.close()

    def rebuild(self) -> dict[str, int]:
        """清空并重建 LORA 索引"""
        conn = connect_lora_trigger_db(create=True)
        try:
            ensure_lora_trigger_schema(conn)
            conn.execute("DELETE FROM lora_items")
            conn.commit()
            LOGGER.info("[xdatahub-lora] rebuild: cleared all records")
        finally:
            conn.close()

        # 重新扫描
        result = self.scan_lora_files()
        return result


def _lora_item_payload_from_db(
    root: Path | None,
    public_ref: str,
    rel_path: str,
    filename: str,
    mtime: float,
    size: int,
    trigger_words_json: str = "[]",
    lora_note: str = "",
    strength_model: Any = None,
    strength_clip: Any = None,
) -> dict[str, Any]:
    """从数据库记录构建 LORA 项目的载体"""
    saved_at = ""
    if mtime:
        saved_at = datetime.fromtimestamp(
            float(mtime),
            tz=timezone.utc,
        ).isoformat(timespec="seconds")
    extra: dict[str, Any] = {
        "entry_type": "lora",
        "media_type": "lora",
        "media_ref": normalize_lora_public_ref(public_ref),
        "file_ext": Path(rel_path).suffix.lower(),
        "has_thumbnail": False,
    }
    if mtime:
        extra["mtime"] = float(mtime)
    if size:
        extra["size"] = int(size)
    trigger_words = _parse_lora_trigger_words_json(
        str(trigger_words_json or "[]")
    )
    if trigger_words:
        extra["trigger_words"] = trigger_words
    safe_lora_note = str(lora_note or "").strip()
    if safe_lora_note:
        extra["lora_note"] = safe_lora_note
    normalized_model_strength = normalize_lora_strength(strength_model, 1.0)
    normalized_clip_strength = normalize_lora_strength(strength_clip, 1.0)
    extra["strength_model"] = normalized_model_strength
    extra["strength_clip"] = normalized_clip_strength
    if root is not None:
        try:
            lora_path = root / rel_path
            thumb_path = find_lora_thumbnail(lora_path)
            if thumb_path is not None:
                extra["has_thumbnail"] = True
                extra["thumb_url"] = lora_thumb_url(public_ref)
        except Exception:
            pass
    return {
        "id": f"lora:{public_ref}",
        "kind": "lora",
        "title": filename,
        "saved_at": saved_at,
        "path": f"{LORA_ROOT_NAME}/{public_ref}",
        "previewable": False,
        "extra": extra,
    }


STORE = MediaStore()
LORA_STORE = LoraStore()


def media_ref_payload(
    media_ref: str,
    title: str,
    media_type: str,
) -> dict[str, Any]:
    normalized = normalize_media_ref(media_ref)
    return {
        "media_ref": normalized,
        "public_ref": normalized,
        "title": str(title or ""),
        "media_type": str(media_type or ""),
        "file_url": media_ref_to_file_url(normalized),
    }


def media_ref_error_response(
    request: web.Request,
    resolved,
) -> web.Response:
    if resolved.status == "blocked":
        return json_error(request, "permission_denied", 403)
    if resolved.status == "invalid":
        return json_error(request, "invalid_payload", 400)
    return json_error(request, "file_not_found", 404)


def scan_media(media_type: str | None) -> list[dict[str, Any]]:
    selected = {media_type} if media_type else set(MEDIA_TYPE_EXT)
    output: list[dict[str, Any]] = []
    for root_name, root_dir in comfy_dirs():
        if not root_dir.exists():
            continue
        for path in iter_media_files(root_dir):
            detected = media_type_for(path)
            if detected is None or detected not in selected:
                continue
            try:
                stat = path.stat()
                resolved = path.resolve(strict=True)
            except OSError:
                continue
            output.append(
                {
                    "path": str(resolved),
                    "rel_path": rel_media_path(
                        path,
                        root_name,
                        root_dir,
                    ),
                    "filename": path.name,
                    "media_type": detected,
                    "mtime": float(stat.st_mtime),
                    "size": int(stat.st_size),
                }
            )
    return output


def iter_media_files(root_dir: Path):
    stack: list[Path] = [root_dir]
    while stack:
        current_dir = stack.pop()
        try:
            with os.scandir(current_dir) as entries:
                child_entries = list(entries)
        except (FileNotFoundError, PermissionError, OSError):
            continue
        for entry in child_entries:
            path = Path(entry.path)
            try:
                if entry.is_symlink():
                    continue
                if entry.is_dir(follow_symlinks=False):
                    stack.append(path)
                    continue
                if entry.is_file(follow_symlinks=False):
                    yield path
            except (FileNotFoundError, PermissionError, OSError):
                continue


def rel_media_path(path: Path, root_name: str, root_dir: Path) -> str:
    try:
        return f"{root_name}/{path.relative_to(root_dir).as_posix()}"
    except Exception:
        return path.name


def map_media_item(
    row: sqlite3.Row,
    include_datetime: bool = True,
    include_size: bool = True,
    include_resolution: bool = True,
) -> dict[str, Any]:
    saved_at = ""
    if include_datetime:
        saved_at = datetime.fromtimestamp(
            float(row["mtime"]),
            tz=timezone.utc,
        ).isoformat(timespec="seconds")
    media_type = str(row["media_type"])
    media_ref = normalize_media_ref(str(row["public_ref"] or ""))
    extra: dict[str, Any] = {
        "media_type": media_type,
        "media_ref": media_ref,
        "file_url": media_ref_to_file_url(media_ref),
    }
    if include_size:
        extra["size"] = int(row["size"])
    if include_datetime:
        extra["mtime"] = float(row["mtime"])
    if include_resolution:
        real_path = (
            str(row["real_path"])
            if "real_path" in row.keys()
            else str(row["path"])
        )
        extra["file_sig"] = hashlib.sha1(
            f"{real_path}|{row['mtime']}|{row['size']}".encode()
        ).hexdigest()
    return {
        "id": f"media:{media_ref}",
        "kind": media_type,
        "title": str(row["filename"]),
        "saved_at": saved_at,
        "path": "",
        "previewable": True,
        "extra": extra,
    }


def list_record_db_files() -> list[Path]:
    return list_all_db_files()


def lora_trigger_db_path() -> Path:
    settings = read_xdatahub_settings()
    use_lora_root = parse_bool(settings.get("store_lora_db_in_loras"))
    if use_lora_root:
        root = lora_root_dir()
        if root is not None:
            return root / LORA_TRIGGER_DB_NAME
    return data_root() / LORA_TRIGGER_DB_NAME


def _sqlite_sidecar_paths(db_path: Path) -> list[Path]:
    return [
        Path(f"{db_path}-wal"),
        Path(f"{db_path}-shm"),
    ]


def migrate_lora_trigger_db_location(
    current_settings: dict[str, Any],
    merged_settings: dict[str, Any],
    conflict_action: str | None = None,
) -> None:
    current_use_lora_root = parse_bool(
        current_settings.get("store_lora_db_in_loras")
    )
    merged_use_lora_root = parse_bool(
        merged_settings.get("store_lora_db_in_loras")
    )
    if current_use_lora_root == merged_use_lora_root:
        return

    if current_use_lora_root:
        current_root = lora_root_dir()
        current_db_path = (
            current_root / LORA_TRIGGER_DB_NAME
            if current_root is not None
            else data_root() / LORA_TRIGGER_DB_NAME
        )
    else:
        current_db_path = data_root() / LORA_TRIGGER_DB_NAME

    if merged_use_lora_root:
        target_root = lora_root_dir()
        if target_root is None:
            raise RuntimeError("lora root dir not found")
        target_db_path = target_root / LORA_TRIGGER_DB_NAME
    else:
        target_db_path = data_root() / LORA_TRIGGER_DB_NAME

    if str(normalize_path(current_db_path)) == str(
        normalize_path(target_db_path)
    ):
        return

    if (
        not current_use_lora_root
        and merged_use_lora_root
        and current_db_path.exists()
        and target_db_path.exists()
    ):
        if conflict_action == LORA_DB_CONFLICT_ACTION_USE_EXISTING:
            return
        if conflict_action != LORA_DB_CONFLICT_ACTION_REPLACE:
            raise LoraDbConflictError(current_db_path, target_db_path)

    entries: list[tuple[Path, Path]] = [
        (current_db_path, target_db_path),
    ]
    current_sidecars = _sqlite_sidecar_paths(current_db_path)
    target_sidecars = _sqlite_sidecar_paths(target_db_path)
    for idx, src in enumerate(current_sidecars):
        entries.append((src, target_sidecars[idx]))

    target_db_path.parent.mkdir(parents=True, exist_ok=True)
    for src, dst in entries:
        if not src.exists():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        os.replace(str(src), str(dst))


def connect_lora_trigger_db(
    path: Path | None = None,
    create: bool = False,
) -> sqlite3.Connection:
    db_path = path or lora_trigger_db_path()
    if not create and not db_path.exists():
        raise FileNotFoundError(f"loras_data.db not found: {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def normalize_lora_public_ref(value: Any) -> str:
    return normalize_media_ref(str(value or ""))


def _coerce_lora_public_ref(value: Any, reserved: set[str]) -> str:
    normalized = normalize_lora_public_ref(value)
    if normalized and normalized not in reserved:
        reserved.add(normalized)
        return normalized
    while True:
        generated = normalize_media_ref(generate_public_ref())
        if generated and generated not in reserved:
            reserved.add(generated)
            return generated


def _all_lora_public_refs(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT public_ref FROM lora_items").fetchall()
    return {
        ref
        for ref in (
            normalize_lora_public_ref(str(row["public_ref"] or ""))
            for row in rows
        )
        if ref
    }


def _lora_public_ref_for_rel_path(
    conn: sqlite3.Connection,
    rel_path: str,
) -> str:
    row = conn.execute(
        "SELECT public_ref FROM lora_items WHERE rel_path = ?",
        (rel_path,),
    ).fetchone()
    current_ref = ""
    if row is not None:
        current_ref = str(row["public_ref"] or "")
    reserved = _all_lora_public_refs(conn)
    normalized_current = normalize_lora_public_ref(current_ref)
    if normalized_current in reserved:
        reserved.remove(normalized_current)
    public_ref = _coerce_lora_public_ref(current_ref, reserved)
    if row is not None and public_ref != current_ref:
        conn.execute(
            "UPDATE lora_items SET public_ref = ? WHERE rel_path = ?",
            (public_ref, rel_path),
        )
    return public_ref


def lora_rel_path_from_ref(lora_ref: str) -> str | None:
    safe_ref = normalize_lora_public_ref(lora_ref)
    if not safe_ref or not lora_trigger_db_path().exists():
        return None
    conn = connect_lora_trigger_db()
    try:
        ensure_lora_trigger_schema(conn)
        row = conn.execute(
            "SELECT rel_path FROM lora_items WHERE public_ref = ?",
            (safe_ref,),
        ).fetchone()
        if row is None:
            return None
        return normalize_lora_rel_path(str(row["rel_path"] or ""))
    finally:
        conn.close()


def ensure_lora_trigger_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS lora_items ("
        "lora_key TEXT PRIMARY KEY,"
        "public_ref TEXT NOT NULL UNIQUE,"
        "rel_path TEXT NOT NULL UNIQUE,"
        "title TEXT NOT NULL,"
        "sha256 TEXT NOT NULL DEFAULT '',"
        "mtime REAL NOT NULL DEFAULT 0,"
        "trigger_words_json TEXT NOT NULL DEFAULT '[]',"
        "strength_model REAL NOT NULL DEFAULT 1.0,"
        "strength_clip REAL NOT NULL DEFAULT 1.0,"
        "lora_note TEXT NOT NULL DEFAULT '',"
        "trigger_words_ver INTEGER NOT NULL DEFAULT 1,"
        "source TEXT NOT NULL DEFAULT 'user',"
        "created_at TEXT NOT NULL,"
        "updated_at TEXT NOT NULL"
        ")"
    )
    existing_columns = {
        str(row[1]).strip().lower()
        for row in conn.execute("PRAGMA table_info(lora_items)").fetchall()
    }
    if "strength_model" not in existing_columns:
        conn.execute(
            "ALTER TABLE lora_items ADD COLUMN "
            "strength_model REAL NOT NULL DEFAULT 1.0"
        )
    if "strength_clip" not in existing_columns:
        conn.execute(
            "ALTER TABLE lora_items ADD COLUMN "
            "strength_clip REAL NOT NULL DEFAULT 1.0"
        )
    if "lora_note" not in existing_columns:
        conn.execute(
            "ALTER TABLE lora_items ADD COLUMN "
            "lora_note TEXT NOT NULL DEFAULT ''"
        )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_lora_items_updated_at "
        "ON lora_items(updated_at)"
    )
    if "real_path" not in existing_columns:
        conn.execute("ALTER TABLE lora_items ADD COLUMN real_path TEXT")
    if "filename" not in existing_columns:
        conn.execute("ALTER TABLE lora_items ADD COLUMN filename TEXT")
    if "size" not in existing_columns:
        conn.execute(
            "ALTER TABLE lora_items ADD COLUMN size INTEGER DEFAULT 0"
        )
    if "valid" not in existing_columns:
        conn.execute(
            "ALTER TABLE lora_items ADD COLUMN valid INTEGER DEFAULT 1"
        )
    if "public_ref" not in existing_columns:
        conn.execute("ALTER TABLE lora_items ADD COLUMN public_ref TEXT")

    # 为历史行补齐 public_ref，避免暴露真实路径。
    rows = conn.execute(
        "SELECT rel_path, public_ref FROM lora_items"
    ).fetchall()
    reserved: set[str] = set()
    updates: list[tuple[str, str]] = []
    for row in rows:
        rel_path = normalize_lora_rel_path(str(row["rel_path"] or ""))
        if not rel_path:
            continue
        normalized = normalize_lora_public_ref(str(row["public_ref"] or ""))
        if normalized and normalized not in reserved:
            reserved.add(normalized)
            continue
        updates.append((rel_path, ""))
    for rel_path, _ in updates:
        new_ref = _coerce_lora_public_ref("", reserved)
        conn.execute(
            "UPDATE lora_items SET public_ref = ? WHERE rel_path = ?",
            (new_ref, rel_path),
        )

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_lora_items_public_ref "
        "ON lora_items(public_ref)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_lora_items_valid ON lora_items(valid)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_lora_items_rel_path "
        "ON lora_items(rel_path)"
    )
    conn.commit()


def ensure_lora_trigger_db_file() -> None:
    conn = connect_lora_trigger_db(create=True)
    try:
        ensure_lora_trigger_schema(conn)
    finally:
        conn.close()


def normalize_trigger_word_item(
    value: Any,
    default_order: int,
) -> dict[str, Any] | None:
    if isinstance(value, dict):
        raw_text = value.get("text")
    else:
        raw_text = value
    text = " ".join(str(raw_text or "").strip().split())
    if not text:
        return None
    text = text[:MAX_TRIGGER_WORD_LEN]
    note = ""
    lang = ""
    enabled = True
    weight = 1.0
    order = default_order
    if isinstance(value, dict):
        note = str(value.get("note") or "").strip()
        note = note[:MAX_TRIGGER_WORD_NOTE_LEN]
        lang = str(value.get("lang") or "").strip()[:24]
        enabled = parse_bool(value.get("enabled", True))
        try:
            parsed_weight = float(value.get("weight", 1))
            if parsed_weight == parsed_weight:
                weight = parsed_weight
        except Exception:
            weight = 1.0
        try:
            parsed_order = int(value.get("order", default_order))
            order = parsed_order if parsed_order >= 0 else default_order
        except Exception:
            order = default_order
    return {
        "text": text,
        "weight": weight,
        "enabled": enabled,
        "order": order,
        "lang": lang,
        "note": note,
    }


def normalize_trigger_words(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for idx, item in enumerate(value):
        normalized = normalize_trigger_word_item(item, idx)
        if not normalized:
            continue
        key = str(normalized["text"]).strip().casefold()
        if not key or key in seen:
            continue
        seen.add(key)
        items.append(normalized)
        if len(items) >= MAX_TRIGGER_WORDS:
            break
    return items


def normalize_lora_strength(value: Any, default: float = 1.0) -> float:
    try:
        parsed = float(value)
    except Exception:
        return default
    if not math.isfinite(parsed):
        return default
    return parsed


def _parse_lora_trigger_words_json(raw: str) -> list[dict[str, Any]]:
    try:
        payload = json.loads(raw)
    except Exception:
        return []
    return normalize_trigger_words(payload)


def read_lora_trigger_record(rel_path: str) -> dict[str, Any] | None:
    if not lora_trigger_db_path().exists():
        return None
    conn = connect_lora_trigger_db()
    try:
        ensure_lora_trigger_schema(conn)
        row = conn.execute(
            "SELECT public_ref, rel_path, title, sha256, mtime, "
            "trigger_words_json, "
            "strength_model, strength_clip, lora_note, "
            "trigger_words_ver, source, "
            "created_at, updated_at "
            "FROM lora_items WHERE rel_path = ?",
            (rel_path,),
        ).fetchone()
        if row is None:
            return None
        return {
            "media_ref": normalize_lora_public_ref(
                str(row["public_ref"] or "")
            ),
            "rel_path": str(row["rel_path"]),
            "title": str(row["title"]),
            "sha256": str(row["sha256"] or ""),
            "mtime": float(row["mtime"] or 0),
            "trigger_words": _parse_lora_trigger_words_json(
                str(row["trigger_words_json"] or "[]")
            ),
            "strength_model": normalize_lora_strength(
                row["strength_model"],
                1.0,
            ),
            "strength_clip": normalize_lora_strength(
                row["strength_clip"],
                1.0,
            ),
            "lora_note": str(row["lora_note"] or ""),
            "trigger_words_ver": int(row["trigger_words_ver"] or 1),
            "source": str(row["source"] or "user"),
            "created_at": str(row["created_at"] or ""),
            "updated_at": str(row["updated_at"] or ""),
        }
    finally:
        conn.close()


def save_lora_trigger_words(
    rel_path: str,
    trigger_words: Any,
    title: str,
    sha256: str,
    mtime: float,
    strength_model: Any = 1.0,
    strength_clip: Any = 1.0,
    lora_note: Any = "",
) -> dict[str, Any]:
    words = normalize_trigger_words(trigger_words)
    now_iso = utc_now_iso()
    safe_title = str(title or Path(rel_path).name).strip()
    safe_title = safe_title or Path(rel_path).name
    safe_sha = str(sha256 or "").strip()
    safe_mtime = float(mtime) if isinstance(mtime, (int, float)) else 0.0
    safe_strength_model = normalize_lora_strength(strength_model, 1.0)
    safe_strength_clip = normalize_lora_strength(strength_clip, 1.0)
    safe_lora_note = str(lora_note or "").strip()[:MAX_LORA_NOTE_LEN]
    payload_json = json.dumps(
        words,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    conn = connect_lora_trigger_db(create=True)
    try:
        ensure_lora_trigger_schema(conn)
        public_ref = _lora_public_ref_for_rel_path(conn, rel_path)
        conn.execute(
            "INSERT INTO lora_items ("
            "lora_key, public_ref, rel_path, title, sha256, mtime, "
            "trigger_words_json, strength_model, strength_clip, lora_note, "
            "trigger_words_ver, source, "
            "created_at, updated_at"
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'user', ?, ?) "
            "ON CONFLICT(rel_path) DO UPDATE SET "
            "title=excluded.title, "
            "sha256=excluded.sha256, "
            "mtime=excluded.mtime, "
            "trigger_words_json=excluded.trigger_words_json, "
            "strength_model=excluded.strength_model, "
            "strength_clip=excluded.strength_clip, "
            "lora_note=excluded.lora_note, "
            "trigger_words_ver=lora_items.trigger_words_ver + 1, "
            "source='user', "
            "updated_at=excluded.updated_at",
            (
                rel_path,
                public_ref,
                rel_path,
                safe_title,
                safe_sha,
                safe_mtime,
                payload_json,
                safe_strength_model,
                safe_strength_clip,
                safe_lora_note,
                now_iso,
                now_iso,
            ),
        )
        conn.commit()
    finally:
        conn.close()
    saved = read_lora_trigger_record(rel_path)
    if saved is None:
        raise RuntimeError("save lora trigger words failed")
    return saved


def lora_items_count(path: Path) -> int:
    try:
        conn = sqlite3.connect(path)
        try:
            row = conn.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name='lora_items'"
            ).fetchone()
            if row is None:
                return 0
            result = conn.execute("SELECT COUNT(1) FROM lora_items").fetchone()
            return int(result[0] or 0) if result else 0
        finally:
            conn.close()
    except sqlite3.Error:
        return 0


def media_index_count(path: Path) -> int:
    try:
        conn = sqlite3.connect(path)
        try:
            row = conn.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name='media_index'"
            ).fetchone()
            if row is None:
                return 0
            result = conn.execute(
                "SELECT COUNT(1) FROM media_index"
            ).fetchone()
            return int(result[0] or 0) if result else 0
        finally:
            conn.close()
    except sqlite3.Error:
        return 0


def favorites_count(path: Path) -> int:
    try:
        conn = sqlite3.connect(path)
        try:
            row = conn.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name='favorites'"
            ).fetchone()
            if row is None:
                return 0
            result = conn.execute("SELECT COUNT(1) FROM favorites").fetchone()
            return int(result[0] or 0) if result else 0
        finally:
            conn.close()
    except sqlite3.Error:
        return 0


def list_all_db_files() -> list[Path]:
    files: dict[str, Path] = {}
    for path in data_root().glob("*.db"):
        if not path.is_file():
            continue
        try:
            key = str(normalize_path(path))
        except Exception:
            key = str(path)
        files[key] = path

    lora_db_path = lora_trigger_db_path()
    if lora_db_path.exists() and lora_db_path.is_file():
        try:
            key = str(normalize_path(lora_db_path))
        except Exception:
            key = str(lora_db_path)
        files[key] = lora_db_path
    return list(files.values())


def parse_name_list(value: Any) -> list[str]:
    if isinstance(value, str):
        raw = [part.strip() for part in value.split(",")]
        return [item for item in raw if item]
    if isinstance(value, list):
        output: list[str] = []
        for item in value:
            text = str(item or "").strip()
            if text:
                output.append(text)
        return output
    return []


def parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    return text in {"1", "true", "yes", "y", "on"}


def parse_yes(value: Any) -> bool:
    return str(value or "").strip().upper() == "YES"


def default_xdatahub_settings() -> dict[str, Any]:
    return {
        "show_media_title": True,
        "show_media_chip_resolution": True,
        "show_media_chip_datetime": True,
        "show_media_chip_size": True,
        "video_preview_autoplay": False,
        "video_preview_muted": True,
        "video_preview_loop": False,
        "audio_preview_autoplay": False,
        "audio_preview_muted": False,
        "audio_preview_loop": False,
        "media_sort_by": "mtime",
        "media_sort_order": "desc",
        "media_card_size_preset": "standard",
        "node_send_close_after_send": True,
        "store_lora_db_in_loras": False,
        "media_custom_roots": [],
        "theme_mode": "dark",
        "disable_interaction_while_running": True,
    }


def xdatahub_settings_path() -> Path:
    return settings_root() / "xdatahub_settings.json"


def _parse_media_chip_patch(value: Any) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    if not isinstance(value, dict):
        return patch
    if "show_media_card_info" in value:
        # 兼容旧配置：一个开关控制全部标签。
        flag = parse_bool(value.get("show_media_card_info"))
        patch["show_media_chip_resolution"] = flag
        patch["show_media_chip_datetime"] = flag
        patch["show_media_chip_size"] = flag
    for key in (
        "show_media_title",
        "show_media_chip_resolution",
        "show_media_chip_datetime",
        "show_media_chip_size",
    ):
        if key in value:
            patch[key] = parse_bool(value.get(key))
    if "media_preview_autoplay" in value:
        shared_autoplay = parse_bool(value.get("media_preview_autoplay"))
        patch["video_preview_autoplay"] = shared_autoplay
        patch["audio_preview_autoplay"] = shared_autoplay
    if "media_preview_muted" in value:
        shared_muted = parse_bool(value.get("media_preview_muted"))
        patch["video_preview_muted"] = shared_muted
        patch["audio_preview_muted"] = shared_muted
    if "media_preview_loop" in value:
        shared_loop = parse_bool(value.get("media_preview_loop"))
        patch["video_preview_loop"] = shared_loop
        patch["audio_preview_loop"] = shared_loop
    for key in (
        "video_preview_autoplay",
        "video_preview_muted",
        "video_preview_loop",
        "audio_preview_autoplay",
        "audio_preview_muted",
        "audio_preview_loop",
    ):
        if key in value:
            patch[key] = parse_bool(value.get(key))
    if "media_sort_by" in value:
        sort_by = str(value.get("media_sort_by") or "").strip().lower()
        if sort_by in MEDIA_SORT_BY_VALUES:
            patch["media_sort_by"] = sort_by
    if "media_sort_order" in value:
        sort_order = str(value.get("media_sort_order") or "").strip().lower()
        if sort_order in MEDIA_SORT_ORDER_VALUES:
            patch["media_sort_order"] = sort_order
    if "media_card_size_preset" in value:
        preset = str(value.get("media_card_size_preset") or "").strip().lower()
        if preset in MEDIA_CARD_SIZE_PRESET_VALUES:
            patch["media_card_size_preset"] = preset
    if "node_send_close_after_send" in value:
        patch["node_send_close_after_send"] = parse_bool(
            value.get("node_send_close_after_send")
        )
    if "store_lora_db_in_loras" in value:
        patch["store_lora_db_in_loras"] = parse_bool(
            value.get("store_lora_db_in_loras")
        )
    if "media_custom_roots" in value:
        patch["media_custom_roots"] = _normalize_custom_root_values(
            value.get("media_custom_roots")
        )
    if "theme_mode" in value:
        theme_mode = str(value.get("theme_mode") or "").strip().lower()
        if theme_mode in THEME_MODE_VALUES:
            patch["theme_mode"] = theme_mode
    if "disable_interaction_while_running" in value:
        patch["disable_interaction_while_running"] = parse_bool(
            value.get("disable_interaction_while_running")
        )
    if "ui_locale" in value:
        raw_locale = str(value.get("ui_locale") or "").strip()
        if raw_locale:
            locale = normalize_locale_code(raw_locale)
            if locale in UI_LOCALE_VALUES:
                patch["ui_locale"] = locale
    return patch


def _parse_lora_db_conflict_action(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    action = str(value.get("lora_db_conflict_action") or "").strip()
    normalized = action.lower()
    if normalized in LORA_DB_CONFLICT_ACTION_VALUES:
        return normalized
    return None


def normalize_xdatahub_settings(value: Any) -> dict[str, Any]:
    base = default_xdatahub_settings()
    base.update(_parse_media_chip_patch(value))
    return base


def read_xdatahub_settings() -> dict[str, Any]:
    path = xdatahub_settings_path()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        payload = {}
    normalized = normalize_xdatahub_settings(payload)
    if normalized != payload:
        try:
            write_xdatahub_settings(normalized)
        except OSError as exc:
            LOGGER.warning(
                "[xdatahub] settings sync write skipped: %s",
                type(exc).__name__,
            )
    return normalized


def write_xdatahub_settings(settings: dict[str, Any]) -> None:
    path = xdatahub_settings_path()
    normalized = normalize_xdatahub_settings(settings)
    text = json.dumps(normalized, ensure_ascii=False, indent=2) + "\n"
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with XDATAHUB_SETTINGS_FILE_LOCK:
        last_error: OSError | None = None
        for _ in range(FILE_WRITE_RETRY):
            try:
                tmp_path.write_text(text, encoding="utf-8")
                os.replace(str(tmp_path), str(path))
                return
            except OSError as exc:
                last_error = exc
                time.sleep(FILE_WRITE_RETRY_DELAY_S)
        if last_error is not None:
            raise last_error


def update_xdatahub_settings(payload: Any) -> dict[str, Any]:
    with XDATAHUB_SETTINGS_FILE_LOCK:
        current = read_xdatahub_settings()
        incoming = _parse_media_chip_patch(payload)
        conflict_action = _parse_lora_db_conflict_action(payload)
        merged = {
            **current,
            **incoming,
        }
        migrate_lora_trigger_db_location(
            current,
            merged,
            conflict_action=conflict_action,
        )
        write_xdatahub_settings(merged)
        return merged


def safe_db_name(value: str) -> str:
    name = Path(value).name
    if name != value:
        return ""
    if not name.lower().endswith(".db"):
        return ""
    if "/" in name or "\\" in name:
        return ""
    return name


def user_critical_registry_path() -> Path:
    return settings_root() / "user_critical_db_list.json"


def list_db_name_set() -> set[str]:
    return {path.name for path in list_all_db_files()}


def read_user_critical_db_names(sync: bool = True) -> set[str]:
    path = user_critical_registry_path()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        payload = {}
    values = payload.get("critical_databases")
    names: set[str] = set()
    if isinstance(values, list):
        for item in values:
            safe = safe_db_name(str(item or ""))
            if safe:
                names.add(safe)
    if not sync:
        return names
    existing = list_db_name_set()
    filtered = {name for name in names if name in existing}
    if filtered != names:
        try:
            write_user_critical_db_names(filtered)
        except OSError as exc:
            LOGGER.warning(
                "[xdatahub] user critical registry sync write skipped: %s",
                type(exc).__name__,
            )
    return filtered


def write_user_critical_db_names(names: set[str]) -> None:
    path = user_critical_registry_path()
    items = sorted(
        {safe_db_name(name) for name in names if safe_db_name(name)},
        key=str.lower,
    )
    payload = {"critical_databases": items}
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with USER_CRITICAL_FILE_LOCK:
        last_error: OSError | None = None
        for _ in range(FILE_WRITE_RETRY):
            try:
                tmp_path.write_text(text, encoding="utf-8")
                os.replace(str(tmp_path), str(path))
                return
            except OSError as exc:
                last_error = exc
                time.sleep(FILE_WRITE_RETRY_DELAY_S)
        if last_error is not None:
            raise last_error


def set_user_critical_mark(name: str, marked: bool) -> dict[str, Any]:
    safe = safe_db_name(name)
    if not safe:
        raise ValueError("invalid name")
    with USER_CRITICAL_FILE_LOCK:
        existing = list_db_name_set()
        if safe not in existing:
            raise ValueError("unknown name")
        user_set = read_user_critical_db_names(sync=False)
        user_set = {name for name in user_set if name in existing}
        if marked:
            user_set.add(safe)
        else:
            user_set.discard(safe)
        write_user_critical_db_names(user_set)
    builtin = set(get_critical_db_names())
    effective = builtin | user_set
    return {
        "name": safe,
        "marked": safe in user_set,
        "is_critical_builtin": safe in builtin,
        "is_critical_effective": safe in effective,
    }


def effective_critical_set() -> set[str]:
    names = set(get_critical_db_names())
    names.update(read_user_critical_db_names(sync=True))
    return names


def db_record_count(path: Path) -> int:
    try:
        conn = sqlite3.connect(path)
        try:
            if not has_records_table(conn):
                return 0
            row = conn.execute("SELECT COUNT(1) FROM records").fetchone()
            return int(row[0] or 0) if row else 0
        finally:
            conn.close()
    except sqlite3.Error:
        return 0


def db_file_item(
    path: Path,
    critical_set: set[str],
    builtin_set: set[str],
    user_set: set[str],
) -> dict[str, Any]:
    is_builtin = path.name in builtin_set
    is_effective = path.name in critical_set
    stat = path.stat()
    if path.name == LORA_TRIGGER_DB_NAME:
        record_count = lora_items_count(path)
    elif path.name == MEDIA_INDEX_DB_NAME:
        record_count = media_index_count(path)
    elif path.name == FAVORITES_DB_NAME:
        record_count = favorites_count(path)
    else:
        record_count = db_record_count(path)
    mtime_iso = datetime.fromtimestamp(
        stat.st_mtime,
        tz=timezone.utc,
    ).isoformat(timespec="seconds")
    purpose = "Other DB"
    if path.name == FAVORITES_DB_NAME:
        purpose = "Favorites DB"
    elif path.name == LORA_TRIGGER_DB_NAME:
        purpose = "Lora DB"
    elif path.name == "seed_data.db":
        purpose = "Seed Values DB"
    elif path.name == "media_index.db":
        purpose = "Media Index DB"
    elif record_count > 0:
        purpose = "Records DB"
    return {
        "name": path.name,
        "size": int(stat.st_size),
        "mtime": mtime_iso,
        "record_count": record_count,
        "purpose": purpose,
        "is_critical_builtin": is_builtin,
        "is_critical_user": path.name in user_set,
        "is_critical_effective": is_effective,
    }


def list_db_files() -> dict[str, Any]:
    if lora_trigger_db_path().exists():
        try:
            ensure_lora_trigger_db_file()
        except sqlite3.Error as exc:
            LOGGER.warning(
                "[xdatahub] ensure lora trigger db failed: %s",
                type(exc).__name__,
            )
    builtin_set = set(get_critical_db_names())
    user_set = read_user_critical_db_names(sync=True)
    critical_set = builtin_set | user_set
    items = [
        db_file_item(path, critical_set, builtin_set, user_set)
        for path in sorted(
            list_all_db_files(),
            key=lambda item: item.name.lower(),
        )
    ]
    return {
        "items": items,
        "total": len(items),
    }


def delete_db_files(payload: dict[str, Any]) -> dict[str, Any]:
    raw_targets = parse_name_list(payload.get("targets"))
    targets = []
    for item in raw_targets:
        safe = safe_db_name(item)
        if safe:
            targets.append(safe)
    targets = sorted(set(targets), key=str.lower)
    if not targets:
        raise ValueError("empty targets")

    critical_set = effective_critical_set()
    unlock_critical = parse_bool(payload.get("unlock_critical"))
    confirm_yes = parse_yes(payload.get("confirm_yes"))

    if not confirm_yes:
        raise ValueError("missing confirm_yes")

    all_files = {path.name: path for path in list_all_db_files()}
    missing = [name for name in targets if name not in all_files]
    if missing:
        raise ValueError("unknown targets")

    critical_targets = [name for name in targets if name in critical_set]
    if critical_targets and not unlock_critical:
        raise PermissionError("critical locked")

    deleted: list[str] = []
    failed: list[str] = []
    for name in targets:
        path = all_files[name]
        try:
            path.unlink(missing_ok=False)
            deleted.append(name)
        except OSError:
            failed.append(name)

    return {
        "deleted_count": len(deleted),
        "failed_count": len(failed),
        "deleted": deleted,
        "failed": failed,
        "critical_deleted_count": len(
            [name for name in deleted if name in critical_set]
        ),
    }


def has_records_table(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='records'"
    ).fetchone()
    return row is not None


def parse_saved_at(value: str) -> float:
    ts = parse_iso(value)
    if ts is not None:
        return ts
    try:
        return float(value)
    except Exception:
        return 0.0


def connect_favorites_db(
    create: bool = False,
) -> sqlite3.Connection:
    path = favorites_db_path()
    if not create and not path.exists():
        raise FileNotFoundError(f"user_favorites.db not found: {path}")
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def ensure_favorites_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS favorites ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "created_at TEXT NOT NULL,"
        "source_record_key TEXT NOT NULL,"
        "extra_header TEXT NOT NULL,"
        "data_type TEXT NOT NULL,"
        "source TEXT NOT NULL,"
        "payload_json TEXT NOT NULL,"
        "content_hash TEXT NOT NULL UNIQUE"
        ")"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_favorites_created_at "
        "ON favorites(created_at)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_favorites_source_record_key "
        "ON favorites(source_record_key)"
    )
    conn.commit()


def normalize_favorite_payload(payload: Any) -> tuple[Any, str]:
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return json.loads(canonical), canonical


def favorite_content_hash(
    payload_text: str,
    extra_header: str,
    data_type: str,
    source: str,
) -> str:
    del extra_header
    del data_type
    del source
    return hashlib.sha1(payload_text.encode("utf-8")).hexdigest()


def map_favorite_item(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"favorite:{row['id']}",
        "kind": "favorite",
        "title": row["extra_header"] or row["data_type"],
        "saved_at": row["created_at"],
        "path": f"XDataSaved/database/{FAVORITES_DB_NAME}",
        "previewable": True,
        "extra": {
            "favorite_id": row["id"],
            "record_id": row["id"],
            "db_name": FAVORITES_DB_NAME,
            "data_type": row["data_type"],
            "extra_header": row["extra_header"],
            "source": row["source"],
            "payload": row["payload"],
            "source_record_key": row["source_record_key"],
            "is_favorite": True,
        },
    }


def list_favorites(
    page: int,
    page_size: int,
    extra_header: str,
    start_ts: float | None,
    end_ts: float | None,
    sort_order: str = "desc",
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    header_kw = extra_header.strip().lower()
    if not favorites_db_path().exists():
        return {
            "items": [],
            "page": 1,
            "page_size": page_size,
            "total": 0,
            "total_pages": 1,
            "facets": {
                "db_names": [],
                "data_types": [],
                "sources": [],
            },
        }
    conn = connect_favorites_db()
    try:
        ensure_favorites_schema(conn)
        for row in conn.execute(
            "SELECT id, created_at, source_record_key, extra_header, "
            "data_type, source, payload_json FROM favorites"
        ).fetchall():
            created_at = str(row["created_at"])
            header = str(row["extra_header"])
            if header_kw and header_kw not in header.lower():
                continue
            ts = parse_saved_at(created_at)
            if start_ts is not None and ts < start_ts:
                continue
            if end_ts is not None and ts > end_ts:
                continue
            try:
                payload = json.loads(str(row["payload_json"]))
            except Exception:
                payload = str(row["payload_json"])
            rows.append(
                {
                    "id": int(row["id"]),
                    "created_at": created_at,
                    "created_at_ts": ts,
                    "source_record_key": str(row["source_record_key"]),
                    "extra_header": header,
                    "data_type": str(row["data_type"]),
                    "source": str(row["source"]),
                    "payload": payload,
                }
            )
    finally:
        conn.close()
    safe_sort_order = (
        sort_order if sort_order in MEDIA_SORT_ORDER_VALUES else "desc"
    )
    rows.sort(
        key=lambda item: (item["created_at_ts"], item["id"]),
        reverse=safe_sort_order == "desc",
    )
    total = len(rows)
    total_pages = max(1, (total + page_size - 1) // page_size)
    safe_page = min(max(1, page), total_pages)
    offset = (safe_page - 1) * page_size
    items = [
        map_favorite_item(row) for row in rows[offset : offset + page_size]
    ]
    return {
        "items": items,
        "page": safe_page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "facets": {
            "db_names": [],
            "data_types": [],
            "sources": [],
        },
    }


def save_favorite(payload: dict[str, Any]) -> dict[str, Any]:
    record_id = parse_int(payload.get("record_id"), 0)
    db_name = safe_db_name(str(payload.get("db_name") or ""))
    extra_header = str(payload.get("extra_header") or "")
    data_type = str(payload.get("data_type") or "")
    source = str(payload.get("source") or "")
    raw_payload = payload.get("payload")
    if record_id <= 0 or not db_name:
        raise ValueError("invalid favorite source")
    normalized_payload, payload_text = normalize_favorite_payload(raw_payload)
    created_at = utc_now_iso()
    source_record_key = f"{db_name}:{record_id}"
    content_hash = favorite_content_hash(
        payload_text,
        extra_header,
        data_type,
        source,
    )
    conn = connect_favorites_db(create=True)
    try:
        ensure_favorites_schema(conn)
        existing = conn.execute(
            "SELECT id FROM favorites WHERE content_hash = ?",
            (content_hash,),
        ).fetchone()
        if existing is not None:
            return {
                "created": False,
                "duplicate": True,
                "favorite_id": int(existing["id"]),
            }
        conn.execute(
            "INSERT INTO favorites ("
            "created_at, source_record_key, extra_header, data_type, "
            "source, payload_json, content_hash"
            ") VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                created_at,
                source_record_key,
                extra_header,
                data_type,
                source,
                payload_text,
                content_hash,
            ),
        )
        row = conn.execute(
            "SELECT id FROM favorites WHERE content_hash = ?",
            (content_hash,),
        ).fetchone()
        conn.commit()
    finally:
        conn.close()
    return {
        "created": True,
        "duplicate": False,
        "favorite_id": int(row["id"]) if row is not None else 0,
        "item": map_favorite_item(
            {
                "id": int(row["id"]) if row is not None else 0,
                "created_at": created_at,
                "source_record_key": source_record_key,
                "extra_header": extra_header,
                "data_type": data_type,
                "source": source,
                "payload": normalized_payload,
            }
        ),
    }


def delete_favorites(payload: dict[str, Any]) -> dict[str, int]:
    ids_raw = payload.get("ids")
    if not isinstance(ids_raw, list):
        raise ValueError("missing ids")
    ids: list[int] = []
    for item in ids_raw:
        value = parse_int(item, 0)
        if value > 0:
            ids.append(value)
    ids = list(dict.fromkeys(ids))
    if not ids:
        raise ValueError("missing ids")
    placeholders = ",".join("?" for _ in ids)
    if not favorites_db_path().exists():
        return {"deleted": 0}
    conn = connect_favorites_db()
    try:
        ensure_favorites_schema(conn)
        cursor = conn.execute(
            f"DELETE FROM favorites WHERE id IN ({placeholders})",
            ids,
        )
        deleted = int(cursor.rowcount or 0)
        conn.commit()
    finally:
        conn.close()
    return {"deleted": deleted}


def list_records(
    page: int,
    page_size: int,
    extra_header: str,
    data_type: str,
    source: str,
    db_name: str,
    start_ts: float | None,
    end_ts: float | None,
    sort_order: str = "desc",
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    header_kw = extra_header.strip().lower()
    data_type_names = {item.lower() for item in parse_name_list(data_type)}
    source_names = {item.lower() for item in parse_name_list(source)}
    db_name_names = {item.lower() for item in parse_name_list(db_name)}
    facet_db_names: set[str] = set()
    facet_data_types: set[str] = set()
    facet_sources: set[str] = set()
    for db_path in list_record_db_files():
        facet_db_names.add(db_path.name)
        if db_name_names and db_path.name.lower() not in db_name_names:
            continue
        try:
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
        except sqlite3.Error:
            continue
        try:
            if not has_records_table(conn):
                continue
            for row in conn.execute(
                "SELECT id, saved_at, extra_header, data_type, "
                "payload_json, source "
                "FROM records"
            ).fetchall():
                saved_at = str(row["saved_at"])
                record_type = str(row["data_type"])
                record_header = str(row["extra_header"])
                record_source = str(row["source"])
                if record_type:
                    facet_data_types.add(record_type)
                if record_source:
                    facet_sources.add(record_source)
                if header_kw and header_kw not in record_header.lower():
                    continue
                if (
                    data_type_names
                    and record_type.lower() not in data_type_names
                ):
                    continue
                if source_names and record_source.lower() not in source_names:
                    continue
                ts = parse_saved_at(saved_at)
                if start_ts is not None and ts < start_ts:
                    continue
                if end_ts is not None and ts > end_ts:
                    continue
                try:
                    payload = json.loads(str(row["payload_json"]))
                except Exception:
                    payload = str(row["payload_json"])
                rows.append(
                    {
                        "db_name": db_path.name,
                        "id": int(row["id"]),
                        "saved_at": saved_at,
                        "saved_at_ts": ts,
                        "extra_header": record_header,
                        "data_type": record_type,
                        "source": record_source,
                        "payload": payload,
                    }
                )
        finally:
            conn.close()
    safe_sort_order = (
        sort_order if sort_order in MEDIA_SORT_ORDER_VALUES else "desc"
    )
    rows.sort(
        key=lambda item: (item["saved_at_ts"], item["id"]),
        reverse=safe_sort_order == "desc",
    )
    total = len(rows)
    total_pages = max(1, (total + page_size - 1) // page_size)
    safe_page = min(max(1, page), total_pages)
    offset = (safe_page - 1) * page_size
    items = [map_record_item(row) for row in rows[offset : offset + page_size]]
    return {
        "items": items,
        "page": safe_page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "facets": {
            "db_names": sorted(facet_db_names, key=lambda x: x.lower()),
            "data_types": sorted(facet_data_types, key=lambda x: x.lower()),
            "sources": sorted(facet_sources, key=lambda x: x.lower()),
        },
    }


def map_record_item(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"record:{row['db_name']}:{row['id']}",
        "kind": "record",
        "title": row["extra_header"] or row["data_type"],
        "saved_at": row["saved_at"],
        "path": f"XDataSaved/database/{row['db_name']}",
        "previewable": True,
        "extra": {
            "record_id": row["id"],
            "db_name": row["db_name"],
            "data_type": row["data_type"],
            "extra_header": row["extra_header"],
            "source": row["source"],
            "payload": row["payload"],
        },
    }


def cleanup_records(payload: dict[str, Any]) -> dict[str, int]:
    mode = str(payload.get("mode") or "all")
    data_type = str(payload.get("data_type") or "")
    db_name = safe_db_name(str(payload.get("db_name") or ""))
    start_ts = parse_iso(str(payload.get("start") or ""))
    end_ts = parse_iso(str(payload.get("end") or ""))
    deleted_total = 0
    touched = 0
    for db_path in list_record_db_files():
        if db_name and db_path.name.lower() != db_name.lower():
            continue
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        try:
            if db_path.name == LORA_TRIGGER_DB_NAME:
                if mode == "all":
                    ensure_lora_trigger_schema(conn)
                    cursor = conn.execute("DELETE FROM lora_items")
                    deleted = int(cursor.rowcount or 0)
                    deleted_total += deleted
                    if deleted:
                        touched += 1
                    conn.commit()
                continue
            if db_path.name == MEDIA_INDEX_DB_NAME:
                if mode == "all":
                    row = conn.execute(
                        "SELECT name FROM sqlite_master "
                        "WHERE type='table' AND name='media_index'"
                    ).fetchone()
                    if row is not None:
                        cursor = conn.execute("DELETE FROM media_index")
                        deleted = int(cursor.rowcount or 0)
                        deleted_total += deleted
                        if deleted:
                            touched += 1
                        conn.commit()
                continue
            if db_path.name == FAVORITES_DB_NAME:
                if mode == "all":
                    row = conn.execute(
                        "SELECT name FROM sqlite_master "
                        "WHERE type='table' AND name='favorites'"
                    ).fetchone()
                    if row is not None:
                        cursor = conn.execute("DELETE FROM favorites")
                        deleted = int(cursor.rowcount or 0)
                        deleted_total += deleted
                        if deleted:
                            touched += 1
                        conn.commit()
                continue
            if not has_records_table(conn):
                continue
            if mode == "all":
                cursor = conn.execute("DELETE FROM records")
            elif mode == "type":
                if not data_type:
                    raise ValueError("missing data_type")
                cursor = conn.execute(
                    "DELETE FROM records WHERE data_type = ?",
                    (data_type,),
                )
            elif mode == "time":
                cond = []
                params: list[Any] = []
                if start_ts is not None:
                    cond.append("saved_at >= ?")
                    params.append(datetime.fromtimestamp(start_ts).isoformat())
                if end_ts is not None:
                    cond.append("saved_at <= ?")
                    params.append(datetime.fromtimestamp(end_ts).isoformat())
                if not cond:
                    raise ValueError("missing time range")
                cursor = conn.execute(
                    f"DELETE FROM records WHERE {' AND '.join(cond)}",
                    params,
                )
            else:
                raise ValueError("invalid mode")
            deleted = int(cursor.rowcount or 0)
            deleted_total += deleted
            if deleted:
                touched += 1
            conn.commit()
        finally:
            conn.close()
    return {"deleted": deleted_total, "touched": touched}


def clear_tree(root: Path) -> int:
    if not root.exists():
        return 0
    deleted = 0
    for path in sorted(root.rglob("*"), reverse=True):
        try:
            if path.is_file() or path.is_symlink():
                path.unlink(missing_ok=True)
                deleted += 1
            elif path.is_dir():
                path.rmdir()
        except OSError:
            continue
    return deleted


def lock_payload() -> dict[str, Any]:
    return LOCK.snapshot()


def write_guard() -> web.Response | None:
    if LOCK.snapshot()["readonly"]:
        return json_error("resource_busy", status=409)
    return None


def list_payload(data: dict[str, Any]) -> dict[str, Any]:
    return {**data, "freshness": "latest", "lock_state": lock_payload()}


def register_lock_listener() -> None:
    if getattr(register_lock_listener, "_patched", False):
        return

    original = server.PromptServer.instance.send_sync

    def patched(event: str, data: Any, sid: str = None) -> None:
        original(event, data, sid)
        if event in {
            "status",
            "progress",
            "execution_start",
            "execution_cached",
            "executing",
            "execution_success",
            "execution_error",
            "execution_interrupted",
        }:
            LOCK.mark_event(event)

    server.PromptServer.instance.send_sync = patched
    register_lock_listener._patched = True


@server.PromptServer.instance.routes.get("/xz3r0/xdatahub/lock/status")
async def api_lock_status(request: web.Request) -> web.Response:
    return web.json_response({"status": "success", **lock_payload()})


@server.PromptServer.instance.routes.post(
    "/xz3r0/xdatahub/lock/prompt-submitted"
)
async def api_lock_candidate(request: web.Request) -> web.Response:
    LOCK.mark_prompt_submitted()
    return web.json_response({"status": "success", **lock_payload()})


@server.PromptServer.instance.routes.post(
    "/xz3r0/xdatahub/lock/interrupt-requested"
)
async def api_lock_interrupt_requested(request: web.Request) -> web.Response:
    LOCK.mark_interrupt_requested()
    return web.json_response({"status": "success", **lock_payload()})


@server.PromptServer.instance.routes.get("/xz3r0/xdatahub/settings")
async def api_settings(request: web.Request) -> web.Response:
    try:
        settings = read_xdatahub_settings()
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] settings read failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)
    return web.json_response({"status": "success", "settings": settings})


@server.PromptServer.instance.routes.get("/xz3r0/xdatahub/i18n/ui")
async def api_i18n_ui(request: web.Request) -> web.Response:
    try:
        locale = str(request.query.get("locale") or "en")
        resolved_locale, payload = read_xdatahub_ui_locale(locale)
        return web.json_response(
            {
                "status": "success",
                "locale": resolved_locale,
                "dict": payload,
            }
        )
    except Exception as exc:
        LOGGER.warning("[xdatahub] ui locale api failed: %s", exc)
        return web.json_response(
            {"status": "success", "locale": "en", "dict": {}}
        )


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/settings")
async def api_settings_update(request: web.Request) -> web.Response:
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        return json_error("quota_exceeded", status=400)
    try:
        settings = update_xdatahub_settings(payload)
    except LoraDbConflictError as exc:
        return web.json_response(exc.to_payload(), status=409)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] settings write failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)
    return web.json_response({"status": "success", "settings": settings})


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/open-db-folder")
async def api_open_db_folder(request: web.Request) -> web.Response:
    """用系统文件管理器打开数据库存放目录。"""
    if sys.platform == "win32":
        cmd = ["explorer", str(data_root().resolve())]
    elif sys.platform == "darwin":
        cmd = ["open", str(data_root().resolve())]
    elif sys.platform.startswith("linux"):
        cmd = ["xdg-open", str(data_root().resolve())]
    else:
        return web.json_response({"status": "unsupported"})
    try:
        subprocess.Popen(cmd)
    except Exception as exc:
        LOGGER.warning("[xdatahub] open-db-folder failed: %s", exc)
        return json_error("internal_error", status=500)
    return web.json_response({"status": "success"})


@server.PromptServer.instance.routes.get("/xz3r0/xdatahub/records")
async def api_records(request: web.Request) -> web.Response:
    q = request.query
    sort_order = str(q.get("sort_order") or "desc").strip().lower()
    if sort_order not in MEDIA_SORT_ORDER_VALUES:
        sort_order = "desc"
    try:
        data = list_records(
            page=parse_int(q.get("page"), 1),
            page_size=min(
                parse_int(q.get("page_size"), DEFAULT_PAGE_SIZE),
                MAX_PAGE_SIZE,
            ),
            extra_header=str(q.get("extra_header") or "").strip(),
            data_type=str(q.get("data_type") or "").strip(),
            source=str(q.get("source") or "").strip(),
            db_name=str(q.get("db_name") or "").strip(),
            start_ts=parse_iso(str(q.get("start") or "")),
            end_ts=parse_iso(str(q.get("end") or "")),
            sort_order=sort_order,
        )
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] records list failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)
    return web.json_response({"status": "success", **list_payload(data)})


@server.PromptServer.instance.routes.get("/xz3r0/xdatahub/favorites")
async def api_favorites(request: web.Request) -> web.Response:
    q = request.query
    sort_order = str(q.get("sort_order") or "desc").strip().lower()
    if sort_order not in MEDIA_SORT_ORDER_VALUES:
        sort_order = "desc"
    try:
        data = list_favorites(
            page=parse_int(q.get("page"), 1),
            page_size=min(
                parse_int(q.get("page_size"), DEFAULT_PAGE_SIZE),
                MAX_PAGE_SIZE,
            ),
            extra_header=str(q.get("extra_header") or "").strip(),
            start_ts=parse_iso(str(q.get("start") or "")),
            end_ts=parse_iso(str(q.get("end") or "")),
            sort_order=sort_order,
        )
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] favorites list failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)
    return web.json_response({"status": "success", **list_payload(data)})


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/favorites")
async def api_favorites_create(request: web.Request) -> web.Response:
    denied = write_guard()
    if denied:
        return denied
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        return json_error("invalid_payload", status=400)
    try:
        result = save_favorite(payload)
    except ValueError:
        return json_error("invalid_payload", status=400)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] favorite save failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)
    return web.json_response({"status": "success", **result})


# ============================================================================
# 模块初始化：LORA 数据库索引扫描
# ============================================================================


def _init_lora_index() -> None:
    """在模块加载时初始化 LORA 数据库索引"""
    try:
        ensure_lora_trigger_db_file()
        LOGGER.info("[xdatahub-lora] schema initialized")
        result = LORA_STORE.scan_lora_files()
        LOGGER.info(
            "[xdatahub-lora] initialization complete: %s",
            result,
        )
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub-lora] init failed: %s",
            type(exc).__name__,
        )


_init_lora_index()


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/favorites/delete")
async def api_favorites_delete(request: web.Request) -> web.Response:
    denied = write_guard()
    if denied:
        return denied
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        return json_error("invalid_payload", status=400)
    try:
        result = delete_favorites(payload)
    except ValueError:
        return json_error("invalid_payload", status=400)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] favorites delete failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)
    return web.json_response({"status": "success", **result})


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/records/cleanup")
async def api_records_cleanup(request: web.Request) -> web.Response:
    denied = write_guard()
    if denied:
        return denied
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        return json_error("quota_exceeded", status=400)
    try:
        result = cleanup_records(payload)
    except ValueError:
        return json_error("quota_exceeded", status=400)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] records cleanup failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)
    return web.json_response({"status": "success", **result})


@server.PromptServer.instance.routes.get("/xz3r0/xdatahub/records/db-files")
async def api_record_db_files(request: web.Request) -> web.Response:
    try:
        payload = list_db_files()
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] db files list failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)
    return web.json_response({"status": "success", **list_payload(payload)})


@server.PromptServer.instance.routes.post(
    "/xz3r0/xdatahub/records/db-files/critical-mark"
)
async def api_record_db_files_critical_mark(
    request: web.Request,
) -> web.Response:
    denied = write_guard()
    if denied:
        return denied
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        return json_error("quota_exceeded", status=400)
    try:
        result = set_user_critical_mark(
            name=str(payload.get("name") or ""),
            marked=parse_bool(payload.get("marked")),
        )
    except ValueError:
        return json_error("quota_exceeded", status=400)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] db files critical mark failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)
    return web.json_response({"status": "success", **result})


@server.PromptServer.instance.routes.post(
    "/xz3r0/xdatahub/records/db-files/delete"
)
async def api_record_db_files_delete(request: web.Request) -> web.Response:
    denied = write_guard()
    if denied:
        return denied
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        return json_error("quota_exceeded", status=400)

    try:
        result = delete_db_files(payload)
    except PermissionError:
        return json_error("permission_denied", status=403)
    except ValueError:
        return json_error("quota_exceeded", status=400)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] db files delete failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)

    return web.json_response({"status": "success", **result})


@server.PromptServer.instance.routes.get("/xz3r0/xdatahub/media")
async def api_media(request: web.Request) -> web.Response:
    q = request.query
    media_type = str(q.get("media_type") or "image").strip().lower()
    if media_type not in MEDIA_TYPE_EXT:
        return json_error("quota_exceeded", status=400)
    validate_page = str(q.get("validate_page") or "0").strip() in {
        "1",
        "true",
        "True",
    }
    flat_view = str(q.get("flat") or "0").strip() in {
        "1",
        "true",
        "True",
    }
    include_datetime = str(q.get("include_datetime") or "1").strip() in {
        "1",
        "true",
        "True",
    }
    include_size = str(q.get("include_size") or "1").strip() in {
        "1",
        "true",
        "True",
    }
    include_resolution = str(q.get("include_resolution") or "1").strip() in {
        "1",
        "true",
        "True",
    }
    sort_by = str(q.get("sort_by") or "mtime").strip().lower()
    if sort_by not in MEDIA_SORT_BY_VALUES:
        sort_by = "mtime"
    sort_order = str(q.get("sort_order") or "desc").strip().lower()
    if sort_order not in MEDIA_SORT_ORDER_VALUES:
        sort_order = "desc"
    directory = normalize_dir_query(str(q.get("dir") or ""))
    try:
        data = STORE.list(
            media_type=media_type,
            page=parse_int(q.get("page"), 1),
            page_size=min(
                parse_int(q.get("page_size"), DEFAULT_PAGE_SIZE),
                MAX_PAGE_SIZE,
            ),
            directory=directory,
            keyword=str(q.get("keyword") or "").strip(),
            start_ts=parse_iso(str(q.get("start") or "")),
            end_ts=parse_iso(str(q.get("end") or "")),
            flat_view=flat_view,
            validate_page=validate_page,
            include_datetime=include_datetime,
            include_size=include_size,
            include_resolution=include_resolution,
            sort_by=sort_by,
            sort_order=sort_order,
        )
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] media list failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)
    return web.json_response({"status": "success", **list_payload(data)})


@server.PromptServer.instance.routes.get("/xz3r0/xdatahub/loras")
async def api_loras(request: web.Request) -> web.Response:
    q = request.query
    include_datetime = str(q.get("include_datetime") or "1").strip() in {
        "1",
        "true",
        "True",
    }
    include_size = str(q.get("include_size") or "1").strip() in {
        "1",
        "true",
        "True",
    }
    sort_by = str(q.get("sort_by") or "mtime").strip().lower()
    if sort_by not in MEDIA_SORT_BY_VALUES:
        sort_by = "mtime"
    sort_order = str(q.get("sort_order") or "desc").strip().lower()
    if sort_order not in MEDIA_SORT_ORDER_VALUES:
        sort_order = "desc"
    directory = normalize_lora_dir_query(str(q.get("dir") or ""))
    try:
        data = list_lora_directory(
            directory=directory,
            page=parse_int(q.get("page"), 1),
            page_size=parse_int(q.get("page_size"), DEFAULT_PAGE_SIZE),
            keyword=str(q.get("keyword") or "").strip(),
            include_datetime=include_datetime,
            include_size=include_size,
            sort_by=sort_by,
            sort_order=sort_order,
        )
    except PermissionError:
        return json_error("permission_denied", status=403)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] lora list failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)
    return web.json_response({"status": "success", **list_payload(data)})


def _build_lora_trigger_item(
    lora_ref: str,
    rel_path: str,
    payload: dict[str, Any] | None,
) -> dict[str, Any]:
    title = Path(rel_path).name
    if payload is not None:
        title = str(payload.get("title") or title)
    return {
        "media_ref": normalize_lora_public_ref(lora_ref),
        "title": title,
        "sha256": str((payload or {}).get("sha256") or ""),
        "mtime": float((payload or {}).get("mtime") or 0),
        "trigger_words": list((payload or {}).get("trigger_words") or []),
        "strength_model": normalize_lora_strength(
            (payload or {}).get("strength_model"),
            1.0,
        ),
        "strength_clip": normalize_lora_strength(
            (payload or {}).get("strength_clip"),
            1.0,
        ),
        "lora_note": str((payload or {}).get("lora_note") or ""),
        "trigger_words_ver": int(
            (payload or {}).get("trigger_words_ver") or 1
        ),
        "source": str((payload or {}).get("source") or "user"),
        "created_at": str((payload or {}).get("created_at") or ""),
        "updated_at": str((payload or {}).get("updated_at") or ""),
        "exists": payload is not None,
    }


@server.PromptServer.instance.routes.get("/xz3r0/xdatahub/loras/trigger-words")
async def api_lora_trigger_words_get(request: web.Request) -> web.Response:
    lora_ref = normalize_lora_public_ref(str(request.query.get("ref") or ""))
    if not lora_ref:
        return json_error(request, "invalid_payload", 400)
    rel_path = lora_rel_path_from_ref(lora_ref)
    if not rel_path:
        return json_error(request, "file_not_found", 404)
    try:
        item = read_lora_trigger_record(rel_path)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] lora trigger words read failed: %s",
            type(exc).__name__,
        )
        return json_error(request, "internal_error", 500)
    return web.json_response(
        {
            "status": "success",
            "item": _build_lora_trigger_item(lora_ref, rel_path, item),
        }
    )


@server.PromptServer.instance.routes.post(
    "/xz3r0/xdatahub/loras/trigger-words"
)
async def api_lora_trigger_words_save(request: web.Request) -> web.Response:
    denied = write_guard()
    if denied:
        return denied
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        return json_error(request, "invalid_payload", 400)
    lora_ref = normalize_lora_public_ref(str(payload.get("ref") or ""))
    if not lora_ref:
        return json_error(request, "invalid_payload", 400)
    rel_path = lora_rel_path_from_ref(lora_ref)
    if not rel_path:
        return json_error(request, "file_not_found", 404)
    title = str(payload.get("title") or Path(rel_path).name).strip()
    sha256 = str(payload.get("sha256") or "").strip()
    strength_model = payload.get("strength_model")
    strength_clip = payload.get("strength_clip")
    lora_note = payload.get("lora_note")
    try:
        mtime = float(payload.get("mtime") or 0)
    except Exception:
        mtime = 0.0
    try:
        saved = save_lora_trigger_words(
            rel_path=rel_path,
            trigger_words=payload.get("trigger_words"),
            title=title,
            sha256=sha256,
            mtime=mtime,
            strength_model=strength_model,
            strength_clip=strength_clip,
            lora_note=lora_note,
        )
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] lora trigger words save failed: %s",
            type(exc).__name__,
        )
        return json_error(request, "internal_error", 500)
    return web.json_response(
        {
            "status": "success",
            "item": _build_lora_trigger_item(lora_ref, rel_path, saved),
        }
    )


@server.PromptServer.instance.routes.get(
    "/xz3r0/xdatahub/loras/trigger-words/from-metadata"
)
async def api_lora_trigger_words_from_metadata(
    request: web.Request,
) -> web.Response:
    lora_ref = normalize_lora_public_ref(str(request.query.get("ref") or ""))
    if not lora_ref:
        return json_error(request, "invalid_payload", 400)
    rel_path = lora_rel_path_from_ref(lora_ref)
    if not rel_path:
        return json_error(request, "file_not_found", 404)
    try:
        result = read_lora_trigger_words_from_metadata(rel_path)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] lora metadata trigger words read failed: %s",
            type(exc).__name__,
        )
        return json_error(request, "internal_error", 500)
    return web.json_response(
        {
            "status": "success",
            "media_ref": lora_ref,
            "found": bool(result.get("found")),
            "source": str(result.get("source") or ""),
            "message": str(result.get("message") or ""),
            "trigger_words": list(result.get("trigger_words") or []),
        }
    )


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/media/refresh")
async def api_media_refresh(request: web.Request) -> web.Response:
    denied = write_guard()
    if denied:
        return denied
    media_type = None
    try:
        payload = await request.json()
        value = str(payload.get("media_type") or "").strip().lower()
        media_type = value if value else None
    except Exception:
        media_type = None
    if media_type and media_type not in MEDIA_TYPE_EXT:
        return json_error("quota_exceeded", status=400)
    try:
        result = STORE.refresh(media_type)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] media refresh failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)
    return web.json_response({"status": "success", **result})


@server.PromptServer.instance.routes.post(
    "/xz3r0/xdatahub/media/cleanup-invalid"
)
async def api_media_cleanup_invalid(request: web.Request) -> web.Response:
    denied = write_guard()
    if denied:
        return denied
    media_type = None
    try:
        payload = await request.json()
        value = str(payload.get("media_type") or "").strip().lower()
        media_type = value if value else None
    except Exception:
        media_type = None
    if media_type and media_type not in MEDIA_TYPE_EXT:
        return json_error("quota_exceeded", status=400)
    try:
        result = STORE.cleanup_invalid(media_type)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] media cleanup invalid failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)
    return web.json_response({"status": "success", **result})


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/media/rebuild")
async def api_media_rebuild(request: web.Request) -> web.Response:
    denied = write_guard()
    if denied:
        return denied
    try:
        payload = await request.json()
        media_type = str(payload.get("media_type") or "").strip().lower()
    except Exception:
        media_type = ""
    if media_type not in MEDIA_TYPE_EXT:
        return json_error("quota_exceeded", status=400)
    try:
        result = STORE.rebuild(media_type)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] media rebuild failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)
    return web.json_response({"status": "success", **result})


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/media/clear")
async def api_media_clear(request: web.Request) -> web.Response:
    denied = write_guard()
    if denied:
        return denied
    media_type = None
    try:
        payload = await request.json()
        value = str(payload.get("media_type") or "").strip().lower()
        media_type = value if value else None
    except Exception:
        media_type = None
    if media_type and media_type not in MEDIA_TYPE_EXT:
        return json_error("quota_exceeded", status=400)
    try:
        deleted = STORE.clear(media_type)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] media clear failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)
    return web.json_response({"status": "success", "deleted": deleted})


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/thumbs/clear")
async def api_thumbs_clear(request: web.Request) -> web.Response:
    denied = write_guard()
    if denied:
        return denied
    media_type = None
    try:
        payload = await request.json()
        value = str(payload.get("media_type") or "").strip().lower()
        media_type = value if value else None
    except Exception:
        media_type = None
    if media_type and media_type not in MEDIA_TYPE_EXT:
        return json_error("quota_exceeded", status=400)
    try:
        deleted = STORE.clear_thumbs(media_type)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] thumbs clear failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)
    return web.json_response({"status": "success", "deleted": deleted})


@server.PromptServer.instance.routes.get("/xz3r0/xdatahub/media/file")
async def api_media_file(request: web.Request) -> web.Response:
    media_ref = normalize_media_ref(str(request.query.get("ref") or ""))
    resolved = resolve_media_ref(media_ref, db_path=STORE.db_path)
    if resolved.status != "ok" or resolved.resolved_path is None:
        return media_ref_error_response(request, resolved)
    STORE.repair_public_ref_path(resolved.media_ref, resolved.resolved_path)

    try:
        return await _stream_media_file_response(
            request=request,
            path=resolved.resolved_path,
            media_type=resolved.media_type,
        )
    except PermissionError:
        return json_error("permission_denied", status=403)
    except FileNotFoundError:
        return json_error("file_not_found", status=404)
    except Exception as exc:
        if _is_client_disconnect_error(exc):
            LOGGER.info(
                "[xdatahub] media stream client disconnected: ref=%s, err=%s",
                media_ref,
                type(exc).__name__,
            )
            return web.Response(status=204)
        LOGGER.exception(
            "[xdatahub] media file stream failed: ref=%s, err=%s",
            media_ref,
            type(exc).__name__,
        )
        return json_error("internal_error", status=500)


@server.PromptServer.instance.routes.get("/xz3r0/xdatahub/loras/thumb")
async def api_lora_thumb(request: web.Request) -> web.Response:
    lora_ref = normalize_lora_public_ref(str(request.query.get("ref") or ""))
    if not lora_ref:
        return json_error(request, "invalid_payload", 400)
    rel_path = lora_rel_path_from_ref(lora_ref)
    if not rel_path:
        return json_error(request, "file_not_found", 404)
    root, _ = resolve_lora_dir("")
    if root is None:
        return json_error(request, "file_not_found", 404)
    lora_path = normalize_path(root / rel_path)
    if not is_path_within_root(lora_path, root):
        return json_error(request, "permission_denied", 403)
    thumb_path = find_lora_thumbnail(lora_path)
    if thumb_path is None:
        return json_error(request, "file_not_found", 404)
    target = normalize_path(thumb_path)
    if not is_path_within_root(target, root):
        return json_error(request, "permission_denied", 403)
    if target.suffix.lower() not in LORA_IMAGE_EXT:
        return json_error(request, "unsupported_media_type", 415)
    if not target.exists() or not target.is_file():
        return json_error(request, "file_not_found", 404)
    try:
        return await _stream_media_file_response(
            request=request,
            path=target,
            media_type="image",
        )
    except PermissionError:
        return json_error(request, "permission_denied", 403)
    except FileNotFoundError:
        return json_error(request, "file_not_found", 404)
    except Exception as exc:
        if _is_client_disconnect_error(exc):
            return web.Response(status=204)
        LOGGER.exception(
            "[xdatahub] lora thumb stream failed: err=%s",
            type(exc).__name__,
        )
        return json_error(request, "internal_error", 500)


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/loras/rebuild")
async def api_lora_rebuild(request: web.Request) -> web.Response:
    """重建 LORA 数据库索引"""
    denied = write_guard()
    if denied:
        return denied
    try:
        result = LORA_STORE.rebuild()
        LOGGER.info(
            "[xdatahub-lora] rebuild requested: %s",
            result,
        )
        return web.json_response(
            {
                "status": "success",
                "message": "LORA index rebuilt",
                "result": result,
            }
        )
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub-lora] rebuild failed: %s",
            type(exc).__name__,
        )
        return json_error(request, "internal_error", 500)


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/loras/refresh")
async def api_lora_refresh(request: web.Request) -> web.Response:
    """刷新 LORA 数据库索引，不清空触发词信息"""
    denied = write_guard()
    if denied:
        return denied
    try:
        result = LORA_STORE.scan_lora_files()
        return web.json_response({"status": "success", **result})
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub-lora] refresh failed: %s",
            type(exc).__name__,
        )
        return json_error(request, "internal_error", 500)


@server.PromptServer.instance.routes.post(
    "/xz3r0/xdatahub/loras/cleanup-invalid"
)
async def api_lora_cleanup_invalid(request: web.Request) -> web.Response:
    """清理已经失效的 LORA 记录"""
    denied = write_guard()
    if denied:
        return denied
    try:
        deleted = LORA_STORE.cleanup_invalid()
        return web.json_response({"status": "success", "deleted": deleted})
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub-lora] cleanup invalid failed: %s",
            type(exc).__name__,
        )
        return json_error(request, "internal_error", 500)


@server.PromptServer.instance.routes.get("/xz3r0/xdatahub/media/meta")
async def api_media_meta(request: web.Request) -> web.Response:
    media_ref = normalize_media_ref(str(request.query.get("ref") or ""))
    resolved = resolve_media_ref(media_ref, db_path=STORE.db_path)
    if resolved.status != "ok":
        return media_ref_error_response(request, resolved)
    if resolved.resolved_path is not None:
        STORE.repair_public_ref_path(
            resolved.media_ref,
            resolved.resolved_path,
        )
    return web.json_response(
        {
            "status": "success",
            **media_ref_payload(
                media_ref=resolved.media_ref,
                title=resolved.title,
                media_type=resolved.media_type,
            ),
        }
    )


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/media/send")
async def api_media_send(request: web.Request) -> web.Response:
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    media_ref = normalize_media_ref(str(payload.get("media_ref") or ""))
    resolved = resolve_media_ref(media_ref, db_path=STORE.db_path)
    if resolved.status != "ok" or resolved.resolved_path is None:
        return media_ref_error_response(request, resolved)
    STORE.repair_public_ref_path(resolved.media_ref, resolved.resolved_path)
    if resolved.media_type.lower() != "image":
        return json_error(request, "unsupported_media_type", 400)
    try:
        update_latest_image(
            media_ref=resolved.media_ref,
            path=resolved.resolved_path,
            title=resolved.title,
            file_url=media_ref_to_file_url(resolved.media_ref),
        )
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] media send cache failed: %s",
            type(exc).__name__,
        )
        return json_error(request, "internal_error", 500)
    return web.json_response(
        {
            "status": "success",
            **media_ref_payload(
                media_ref=resolved.media_ref,
                title=resolved.title,
                media_type=resolved.media_type,
            ),
        }
    )


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/media/upload")
async def api_media_upload(request: web.Request) -> web.Response:
    denied = write_guard()
    if denied:
        return denied
    try:
        reader = await request.multipart()
    except Exception:
        reader = None
    if reader is None:
        return json_error(request, "invalid_payload", 400)
    field = await reader.next()
    if field is None or field.name != "file":
        return json_error(request, "invalid_payload", 400)
    filename = str(field.filename or "").strip()
    content_type = str(field.headers.get("Content-Type") or "").lower()
    ext = Path(filename).suffix.lower()
    if (
        not content_type.startswith("image/")
        and ext not in MEDIA_TYPE_EXT["image"]
    ):
        return json_error(request, "unsupported_media_type", 400)

    if ext not in MEDIA_TYPE_EXT["image"]:
        ext_map = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
            "image/bmp": ".bmp",
            "image/gif": ".gif",
        }
        ext = ext_map.get(content_type, ".png")

    safe_stem = sanitize_path_component(Path(filename).stem) or "xdatahub"
    if folder_paths is not None:
        target_dir = (
            Path(folder_paths.get_input_directory()) / "xdatahub_uploads"
        )
    else:
        target_dir = xdatahub_root() / "xdatahub_uploads"
    target_dir.mkdir(parents=True, exist_ok=True)

    try:
        final_name = ensure_unique_filename(
            target_dir,
            safe_stem,
            ext,
        )
    except Exception:
        return json_error(request, "internal_error", 500)
    target_path = target_dir / final_name

    try:
        with target_path.open("wb") as handle:
            while True:
                chunk = await field.read_chunk()
                if not chunk:
                    break
                handle.write(chunk)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] media upload failed: %s",
            type(exc).__name__,
        )
        try:
            target_path.unlink(missing_ok=True)
        except OSError:
            pass
        return json_error(request, "internal_error", 500)

    media_item = STORE.upsert_media_file(target_path, media_type="image")
    if media_item is None:
        return json_error(request, "internal_error", 500)
    extra = media_item.get("extra") or {}
    media_ref = normalize_media_ref(str(extra.get("media_ref") or ""))
    file_url = str(extra.get("file_url") or "")

    try:
        update_latest_image(
            media_ref=media_ref,
            path=target_path,
            title=final_name,
            file_url=file_url,
        )
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] media upload cache failed: %s",
            type(exc).__name__,
        )
        return json_error(request, "internal_error", 500)

    return web.json_response(
        {
            "status": "success",
            **media_ref_payload(
                media_ref=media_ref,
                title=final_name,
                media_type="image",
            ),
        }
    )


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/media/validate")
async def api_media_validate(request: web.Request) -> web.Response:
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    media_ref = normalize_media_ref(str(payload.get("media_ref") or ""))
    resolved = resolve_media_ref(media_ref, db_path=STORE.db_path)
    if resolved.status != "ok" or resolved.resolved_path is None:
        return media_ref_error_response(request, resolved)
    STORE.repair_public_ref_path(resolved.media_ref, resolved.resolved_path)
    if resolved.media_type.lower() != "image":
        return json_error(request, "unsupported_media_type", 400)

    cached = _get_image_validation_cached(resolved.resolved_path)
    if cached is not None:
        ok, code = cached
        if ok:
            return web.json_response(
                {
                    "status": "success",
                    "valid": True,
                    **media_ref_payload(
                        media_ref=resolved.media_ref,
                        title=resolved.title,
                        media_type=resolved.media_type,
                    ),
                }
            )
        return json_error(
            request,
            code or "file_corrupted",
            415 if code == "unsupported_media_type" else 400,
        )

    ok, code = _validate_image_with_pillow(resolved.resolved_path)
    _set_image_validation_cache(resolved.resolved_path, ok, code)
    if ok:
        return web.json_response(
            {
                "status": "success",
                "valid": True,
                **media_ref_payload(
                    media_ref=resolved.media_ref,
                    title=resolved.title,
                    media_type=resolved.media_type,
                ),
            }
        )
    return json_error(
        request,
        code or "file_corrupted",
        415 if code == "unsupported_media_type" else 400,
    )


@server.PromptServer.instance.routes.get("/xz3r0/xdatahub/media/latest")
async def api_media_latest(request: web.Request) -> web.Response:
    snapshot = get_latest_image()
    if snapshot is None:
        return web.json_response(
            {
                "status": "success",
                **media_ref_payload(
                    media_ref="",
                    title="",
                    media_type="image",
                ),
            }
        )
    return web.json_response(
        {
            "status": "success",
            **media_ref_payload(
                media_ref=str(snapshot.media_ref or ""),
                title=str(snapshot.title or ""),
                media_type="image",
            ),
        }
    )


register_lock_listener()
