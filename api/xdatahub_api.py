"""
XDataHub 统一数据浏览 API。
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import sqlite3
import threading
import time
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlparse

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
        get_critical_db_names,
        get_logger,
        sanitize_path_component,
    )
    from ..xz3r0_utils.xdatahub_bridge import (
        get_latest_image,
        update_latest_image,
    )
except ImportError:
    from xz3r0_utils import (
        ensure_unique_filename,
        get_critical_db_names,
        get_logger,
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
LOCK_COOLDOWN_S = 1.5
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

MEDIA_TYPE_EXT = {
    "image": {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"},
    "video": {".mp4", ".webm", ".mov", ".mkv", ".avi"},
    "audio": {".wav", ".mp3", ".flac", ".ogg", ".m4a"},
}

ERROR_TEXT = {
    "file_not_found": "File not found or moved",
    "permission_denied": "Permission denied",
    "file_corrupted": "File corrupted or unreadable",
    "quota_exceeded": "Limit exceeded, request rejected",
    "invalid_payload": "Invalid payload",
    "resource_busy": "Resource is busy, read-only mode only",
    "internal_error": "System busy, please retry later",
    "unsupported_media_type": "Unsupported media type",
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
    return fallback.get(str(media_type or "").lower(), "application/octet-stream")


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
    spec = raw[len("bytes="):].split(",", 1)[0].strip()
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
    span = (
        _parse_range_header(range_value, file_size)
        if range_value
        else None
    )

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
        request = code_or_request if isinstance(code_or_request, web.Request) else None
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


def _resolve_view_file_url(
    file_url: str,
) -> tuple[Path, str, str] | None:
    raw = str(file_url or "").strip()
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
            if os.path.commonpath((os.path.abspath(candidate), root_abs)) != root_abs:
                return None
        except Exception:
            return None
    safe_name = os.path.basename(filename)
    file_path = os.path.join(candidate, safe_name)
    return Path(file_path), safe_name, subfolder


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


def data_root() -> Path:
    root = Path(__file__).resolve().parent.parent / "XDataSaved"
    root.mkdir(parents=True, exist_ok=True)
    return root


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


def parse_rel_root(rel_path: str) -> tuple[str | None, Path | None]:
    value = rel_path.strip().replace("\\", "/")
    if "/" not in value:
        return None, None
    root_name, rel_value = value.split("/", 1)
    root_name = root_name.strip().lower()
    rel_value = rel_value.strip().lstrip("/")
    if root_name not in {"input", "output"} or not rel_value:
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
    if parts[0] not in {"input", "output"}:
        return ""
    safe_parts: list[str] = []
    for part in parts:
        if part in {".", ".."}:
            return ""
        safe_parts.append(part)
    return "/".join(safe_parts)


def split_rel_path(value: str) -> list[str] | None:
    normalized = value.strip().replace("\\", "/").strip("/")
    if not normalized:
        return None
    parts = [part for part in normalized.split("/") if part]
    if len(parts) < 2:
        return None
    if parts[0] not in {"input", "output"}:
        return None
    return parts


def map_folder_item(child_path: str, title: str) -> dict[str, Any]:
    return {
        "id": f"folder:{child_path}",
        "kind": "folder",
        "title": title,
        "saved_at": "",
        "path": child_path,
        "previewable": False,
        "extra": {
            "entry_type": "folder",
            "child_path": child_path,
        },
    }


def build_directory_items(
    rows: list[sqlite3.Row],
    directory: str,
    include_datetime: bool = True,
    include_size: bool = True,
    include_resolution: bool = True,
    sort_by: str = "mtime",
    sort_order: str = "desc",
) -> list[dict[str, Any]]:
    dir_parts = directory.split("/") if directory else []
    folder_children: dict[str, str] = {}
    file_rows: list[sqlite3.Row] = []
    for row in rows:
        rel_parts = split_rel_path(str(row["rel_path"] or ""))
        if rel_parts is None:
            continue
        if dir_parts:
            if len(rel_parts) <= len(dir_parts):
                continue
            if rel_parts[:len(dir_parts)] != dir_parts:
                continue
            remain = rel_parts[len(dir_parts):]
        else:
            remain = rel_parts
        if len(remain) == 1:
            file_rows.append(row)
            continue
        child_path = "/".join(rel_parts[:len(dir_parts) + 1])
        folder_children[remain[0]] = child_path

    folder_items = [
        map_folder_item(path, title)
        for title, path in sorted(
            folder_children.items(),
            key=lambda item: item[0].lower(),
        )
    ]
    safe_sort_by = (
        sort_by if sort_by in MEDIA_SORT_BY_VALUES else "mtime"
    )
    safe_sort_order = (
        sort_order if sort_order in MEDIA_SORT_ORDER_VALUES else "desc"
    )
    reverse = safe_sort_order == "desc"

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

    rel_root, rel_tail = parse_rel_root(str(row["rel_path"] or ""))
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
        self._candidate_until = 0.0

    def mark_running(self) -> None:
        with self._lock:
            self._state = "RUNNING"
            self._cooldown_until = 0.0

    def mark_candidate(self) -> None:
        with self._lock:
            now = time.monotonic()
            self._candidate_until = max(self._candidate_until, now + 2.0)
            if self._state == "IDLE":
                self._state = "RUNNING"

    def mark_finish(self) -> None:
        with self._lock:
            self._state = "COOLDOWN"
            self._cooldown_until = time.monotonic() + LOCK_COOLDOWN_S

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            now = time.monotonic()
            if self._state == "COOLDOWN" and now >= self._cooldown_until:
                self._state = "IDLE"
            if self._state == "RUNNING" and now > self._candidate_until > 0:
                self._state = "IDLE"
                self._candidate_until = 0.0
            remain_ms = 0
            if self._state == "COOLDOWN":
                remain_ms = max(0, int((self._cooldown_until - now) * 1000))
            return {
                "state": self._state,
                "readonly": self._state in {"RUNNING", "COOLDOWN"},
                "cooldown_ms": remain_ms,
            }


LOCK = LockManager()
USER_CRITICAL_FILE_LOCK = threading.RLock()
XDATAHUB_SETTINGS_FILE_LOCK = threading.RLock()


class MediaStore:
    def __init__(self) -> None:
        self.db_path = data_root() / "media_index.db"
        self.thumb_root = data_root() / "thumb_cache"
        self.thumb_root.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(
            self.db_path,
            timeout=SQLITE_BUSY_TIMEOUT_MS / 1000,
        )
        conn.row_factory = sqlite3.Row
        conn.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS media_index ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT,"
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
            columns = {
                str(row["name"])
                for row in conn.execute(
                    "PRAGMA table_info(media_index)"
                ).fetchall()
            }
            needs_migrate = (
                "real_path" not in columns
                or "path" in columns
            )
            if needs_migrate:
                conn.execute(
                    "CREATE TABLE IF NOT EXISTS media_index_new ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT,"
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
                if "path" in columns:
                    conn.execute(
                        "INSERT OR REPLACE INTO media_index_new "
                        "(id, real_path, rel_path, filename, media_type, "
                        "mtime, size, valid, created_at, updated_at) "
                        "SELECT id, path, rel_path, filename, media_type, "
                        "mtime, size, valid, created_at, updated_at "
                        "FROM media_index"
                    )
                else:
                    conn.execute(
                        "INSERT OR REPLACE INTO media_index_new "
                        "(id, real_path, rel_path, filename, media_type, "
                        "mtime, size, valid, created_at, updated_at) "
                        "SELECT id, real_path, rel_path, "
                        "filename, media_type, "
                        "mtime, size, valid, created_at, updated_at "
                        "FROM media_index"
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
            conn.commit()

    def _retry_read(self, callback):
        last_exc = None
        for _ in range(RETRY_COUNT + 1):
            try:
                with self._connect() as conn:
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
        safe_sort_by = (
            sort_by if sort_by in MEDIA_SORT_BY_VALUES else "mtime"
        )
        safe_sort_order = (
            sort_order if sort_order in MEDIA_SORT_ORDER_VALUES else "desc"
        )
        sql_field_map = {
            "mtime": "mtime",
            "name": "filename",
            "size": "size",
        }
        sql_order = (
            "ASC" if safe_sort_order == "asc" else "DESC"
        )
        sql_field = sql_field_map[safe_sort_by]
        order_clause = (
            f"ORDER BY {sql_field} {sql_order}, "
            "filename ASC, rel_path ASC"
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
                        "SELECT id, real_path, rel_path, "
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
                            "SELECT id, real_path, rel_path, "
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
                    "SELECT id, real_path, rel_path, filename, media_type, "
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
                        "SELECT id, real_path, rel_path, "
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
                "items": all_items[offset:offset + page_size],
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
            if (
                abs(float(row["mtime"]) - float(stat.st_mtime)) > 1e-6
                or int(row["size"]) != int(stat.st_size)
            ):
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
        with self._connect() as conn:
            for entry in scan_media(media_type):
                now = utc_now_iso()
                conn.execute(
                    (
                        "INSERT INTO media_index "
                        "(real_path, rel_path, filename, media_type, "
                        "mtime, size, "
                        "valid, created_at, updated_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?) "
                        "ON CONFLICT(rel_path) DO UPDATE SET "
                        "real_path=excluded.real_path, "
                        "filename=excluded.filename, "
                        "media_type=excluded.media_type, "
                        "mtime=excluded.mtime, "
                        "size=excluded.size, valid=1, "
                        "updated_at=excluded.updated_at"
                    ),
                    (
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
                if conn.total_changes:
                    updated += 1
            conn.commit()
        inserted = max(0, updated)
        return {"inserted": inserted, "updated": 0}

    def cleanup_invalid(self, media_type: str | None) -> dict[str, int]:
        checked = 0
        marked = 0
        with self._connect() as conn:
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
        with self._connect() as conn:
            deleted = int(
                conn.execute(
                    "DELETE FROM media_index WHERE media_type = ?",
                    (media_type,),
                ).rowcount
            )
            conn.commit()
        refreshed = self.refresh(media_type)
        return {"deleted": deleted, **refreshed}

    def clear(self) -> int:
        with self._connect() as conn:
            deleted = int(conn.execute("DELETE FROM media_index").rowcount)
            conn.commit()
        return deleted

    def clear_thumbs(self, media_type: str | None) -> int:
        target = (
            self.thumb_root / media_type
            if media_type
            else self.thumb_root
        )
        return clear_tree(target)


STORE = MediaStore()


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
    stack: list[tuple[Path, set[str]]] = [(root_dir, set())]
    while stack:
        current_dir, ancestors = stack.pop()
        try:
            current_real = str(normalize_path(current_dir))
        except Exception:
            continue
        if current_real in ancestors:
            LOGGER.warning(
                "[xdatahub] media scan link cycle skipped: dir=%s",
                current_dir.name,
            )
            continue
        next_ancestors = set(ancestors)
        next_ancestors.add(current_real)
        try:
            with os.scandir(current_dir) as entries:
                child_entries = list(entries)
        except (FileNotFoundError, PermissionError, OSError):
            continue
        for entry in child_entries:
            path = Path(entry.path)
            try:
                if entry.is_dir(follow_symlinks=True):
                    stack.append((path, next_ancestors))
                    continue
                if entry.is_file(follow_symlinks=True):
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
    extra: dict[str, Any] = {
        "media_type": media_type,
        "file_url": f"/xz3r0/xdatahub/media/file?id={int(row['id'])}",
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
        "id": f"media:{int(row['id'])}",
        "kind": media_type,
        "title": str(row["filename"]),
        "saved_at": saved_at,
        "path": str(row["rel_path"]),
        "previewable": True,
        "extra": extra,
    }


def list_record_db_files() -> list[Path]:
    return [
        p
        for p in data_root().glob("*.db")
        if p.is_file() and p.name != "media_index.db"
    ]


def list_all_db_files() -> list[Path]:
    return [
        p
        for p in data_root().glob("*.db")
        if p.is_file()
    ]


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
        "show_media_chip_type": True,
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
        "theme_mode": "dark",
    }


def xdatahub_settings_path() -> Path:
    return data_root() / "xdatahub_settings.json"


def _parse_media_chip_patch(value: Any) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    if not isinstance(value, dict):
        return patch
    if "show_media_card_info" in value:
        # 兼容旧配置：一个开关控制全部标签。
        flag = parse_bool(value.get("show_media_card_info"))
        patch["show_media_chip_type"] = flag
        patch["show_media_chip_resolution"] = flag
        patch["show_media_chip_datetime"] = flag
        patch["show_media_chip_size"] = flag
    for key in (
        "show_media_chip_type",
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
        sort_order = str(
            value.get("media_sort_order") or ""
        ).strip().lower()
        if sort_order in MEDIA_SORT_ORDER_VALUES:
            patch["media_sort_order"] = sort_order
    if "media_card_size_preset" in value:
        preset = str(
            value.get("media_card_size_preset") or ""
        ).strip().lower()
        if preset in MEDIA_CARD_SIZE_PRESET_VALUES:
            patch["media_card_size_preset"] = preset
    if "theme_mode" in value:
        theme_mode = str(value.get("theme_mode") or "").strip().lower()
        if theme_mode in THEME_MODE_VALUES:
            patch["theme_mode"] = theme_mode
    if "ui_locale" in value:
        raw_locale = str(value.get("ui_locale") or "").strip()
        if raw_locale:
            locale = normalize_locale_code(raw_locale)
            if locale in UI_LOCALE_VALUES:
                patch["ui_locale"] = locale
    return patch


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
        merged = {
            **current,
            **incoming,
        }
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
    return data_root() / "user_critical_db_list.json"


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
            row = conn.execute(
                "SELECT COUNT(1) FROM records"
            ).fetchone()
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
    record_count = db_record_count(path)
    mtime_iso = datetime.fromtimestamp(
        stat.st_mtime,
        tz=timezone.utc,
    ).isoformat(timespec="seconds")
    purpose = "Other DB"
    if path.name == "media_index.db":
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
    confirm_yes_critical = parse_yes(payload.get("confirm_yes_critical"))

    if not confirm_yes:
        raise ValueError("missing confirm_yes")

    all_files = {path.name: path for path in list_all_db_files()}
    missing = [name for name in targets if name not in all_files]
    if missing:
        raise ValueError("unknown targets")

    critical_targets = [
        name for name in targets
        if name in critical_set
    ]
    if critical_targets and not unlock_critical:
        raise PermissionError("critical locked")
    if critical_targets and not confirm_yes_critical:
        raise ValueError("missing confirm_yes_critical")

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
    source_kw = source.strip().lower()
    db_name_kw = db_name.strip().lower()
    facet_db_names: set[str] = set()
    facet_data_types: set[str] = set()
    facet_sources: set[str] = set()
    for db_path in list_record_db_files():
        facet_db_names.add(db_path.name)
        if db_name_kw and db_name_kw not in db_path.name.lower():
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
                if data_type and data_type != record_type:
                    continue
                if source_kw and source_kw not in record_source.lower():
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
    items = [map_record_item(row) for row in rows[offset:offset + page_size]]
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
        "path": f"XDataSaved/{row['db_name']}",
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
        try:
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
        return json_error("resource_busy", 409)
    return None


def list_payload(data: dict[str, Any]) -> dict[str, Any]:
    return {**data, "freshness": "latest", "lock_state": lock_payload()}


def register_lock_listener() -> None:
    if getattr(register_lock_listener, "_patched", False):
        return

    original = server.PromptServer.instance.send_sync

    def patched(event: str, data: Any, sid: str = None) -> None:
        original(event, data, sid)
        if event in {"execution_start", "execution_cached", "executing"}:
            LOCK.mark_running()
        elif event in {
            "execution_success",
            "execution_error",
            "execution_interrupted",
        }:
            LOCK.mark_finish()

    server.PromptServer.instance.send_sync = patched
    register_lock_listener._patched = True


@server.PromptServer.instance.routes.get("/xz3r0/xdatahub/lock/status")
async def api_lock_status(request: web.Request) -> web.Response:
    return web.json_response({"status": "success", **lock_payload()})


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/lock/prompt-submitted")
async def api_lock_candidate(request: web.Request) -> web.Response:
    LOCK.mark_candidate()
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
        return json_error("internal_error", 500)
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
        return json_error("quota_exceeded", 400)
    try:
        settings = update_xdatahub_settings(payload)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] settings write failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", 500)
    return web.json_response({"status": "success", "settings": settings})


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
        return json_error("internal_error", 500)
    return web.json_response({"status": "success", **list_payload(data)})


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/records/cleanup")
async def api_records_cleanup(request: web.Request) -> web.Response:
    denied = write_guard()
    if denied:
        return denied
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        return json_error("quota_exceeded", 400)
    try:
        result = cleanup_records(payload)
    except ValueError:
        return json_error("quota_exceeded", 400)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] records cleanup failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", 500)
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
        return json_error("internal_error", 500)
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
        return json_error("quota_exceeded", 400)
    try:
        result = set_user_critical_mark(
            name=str(payload.get("name") or ""),
            marked=parse_bool(payload.get("marked")),
        )
    except ValueError:
        return json_error("quota_exceeded", 400)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] db files critical mark failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", 500)
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
        return json_error("quota_exceeded", 400)

    try:
        result = delete_db_files(payload)
    except PermissionError:
        return json_error("permission_denied", 403)
    except ValueError:
        return json_error("quota_exceeded", 400)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] db files delete failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", 500)

    return web.json_response({"status": "success", **result})


@server.PromptServer.instance.routes.get("/xz3r0/xdatahub/media")
async def api_media(request: web.Request) -> web.Response:
    q = request.query
    media_type = str(q.get("media_type") or "image").strip().lower()
    if media_type not in MEDIA_TYPE_EXT:
        return json_error("quota_exceeded", 400)
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
    include_resolution = str(
        q.get("include_resolution") or "1"
    ).strip() in {
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
        return json_error("internal_error", 500)
    return web.json_response({"status": "success", **list_payload(data)})


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
        return json_error("quota_exceeded", 400)
    try:
        result = STORE.refresh(media_type)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] media refresh failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", 500)
    return web.json_response({"status": "success", **result})


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/media/cleanup-invalid")
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
        return json_error("quota_exceeded", 400)
    try:
        result = STORE.cleanup_invalid(media_type)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] media cleanup invalid failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", 500)
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
        return json_error("quota_exceeded", 400)
    try:
        result = STORE.rebuild(media_type)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] media rebuild failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", 500)
    return web.json_response({"status": "success", **result})


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/media/clear")
async def api_media_clear(request: web.Request) -> web.Response:
    denied = write_guard()
    if denied:
        return denied
    try:
        deleted = STORE.clear()
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] media clear failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", 500)
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
        return json_error("quota_exceeded", 400)
    try:
        deleted = STORE.clear_thumbs(media_type)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] thumbs clear failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", 500)
    return web.json_response({"status": "success", "deleted": deleted})


@server.PromptServer.instance.routes.get("/xz3r0/xdatahub/media/file")
async def api_media_file(request: web.Request) -> web.Response:
    try:
        file_id = int(str(request.query.get("id") or ""))
    except Exception:
        return json_error("file_not_found", 404)

    def _read(conn: sqlite3.Connection):
        return conn.execute(
            "SELECT id, real_path, rel_path, media_type "
            "FROM media_index WHERE id = ? AND valid = 1",
            (file_id,),
        ).fetchone()

    try:
        row = STORE._retry_read(_read)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] media file read failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", 500)
    if row is None:
        return json_error("file_not_found", 404)

    try:
        with STORE._connect() as conn:
            resolved = STORE.resolve_runtime_path(conn, row)
    except sqlite3.Error as exc:
        LOGGER.exception(
            "[xdatahub] media path resolve failed: %s",
            type(exc).__name__,
        )
        return json_error("internal_error", 500)

    if resolved is None:
        roots = comfy_dirs()
        located = locate_media_entry(row, roots)
        LOGGER.info(
            "[xdatahub] media file denied: id=%s, reason=%s",
            file_id,
            located.get("status"),
        )
        if located.get("status") == "blocked":
            return json_error("permission_denied", 403)
        return json_error("file_not_found", 404)

    try:
        return await _stream_media_file_response(
            request=request,
            path=resolved,
            media_type=str(row["media_type"] or ""),
        )
    except PermissionError:
        return json_error("permission_denied", 403)
    except FileNotFoundError:
        return json_error("file_not_found", 404)
    except Exception as exc:
        if _is_client_disconnect_error(exc):
            LOGGER.info(
                "[xdatahub] media stream client disconnected: id=%s, err=%s",
                file_id,
                type(exc).__name__,
            )
            return web.Response(status=204)
        LOGGER.exception(
            "[xdatahub] media file stream failed: id=%s, err=%s",
            file_id,
            type(exc).__name__,
        )
        return json_error("internal_error", 500)


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/media/send")
async def api_media_send(request: web.Request) -> web.Response:
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    try:
        media_id = int(str(payload.get("media_id") or ""))
    except Exception:
        return json_error(request, "file_not_found", 404)

    def _read(conn: sqlite3.Connection):
        return conn.execute(
            "SELECT id, real_path, rel_path, filename, media_type "
            "FROM media_index WHERE id = ? AND valid = 1",
            (media_id,),
        ).fetchone()

    try:
        row = STORE._retry_read(_read)
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] media send read failed: %s",
            type(exc).__name__,
        )
        return json_error(request, "internal_error", 500)
    if row is None:
        return json_error(request, "file_not_found", 404)

    media_type = str(row["media_type"] or "").lower()
    if media_type != "image":
        return json_error(request, "unsupported_media_type", 400)

    try:
        with STORE._connect() as conn:
            resolved = STORE.resolve_runtime_path(conn, row)
    except sqlite3.Error as exc:
        LOGGER.exception(
            "[xdatahub] media send resolve failed: %s",
            type(exc).__name__,
        )
        return json_error(request, "internal_error", 500)

    if resolved is None:
        roots = comfy_dirs()
        located = locate_media_entry(row, roots)
        LOGGER.info(
            "[xdatahub] media send denied: id=%s, reason=%s",
            media_id,
            located.get("status"),
        )
        if located.get("status") == "blocked":
            return json_error(request, "permission_denied", 403)
        return json_error(request, "file_not_found", 404)

    file_url = f"/xz3r0/xdatahub/media/file?id={media_id}"

    try:
        update_latest_image(
            media_id=media_id,
            path=Path(resolved),
            title=str(row["filename"] or ""),
            file_url=file_url,
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
            "media_id": media_id,
            "title": str(row["filename"] or ""),
            "file_url": file_url,
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
    content_type = str(
        field.headers.get("Content-Type") or ""
    ).lower()
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

    safe_stem = (
        sanitize_path_component(Path(filename).stem)
        or "xdatahub"
    )
    if folder_paths is not None:
        input_root = Path(
            folder_paths.get_input_directory()
        )
        subfolder = "xdatahub_uploads"
        target_dir = input_root / subfolder
    else:
        input_root = data_root()
        subfolder = ""
        target_dir = input_root / "xdatahub_uploads"
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

    if subfolder:
        file_url = (
            f"/view?filename={quote(final_name)}"
            f"&type=input&subfolder={quote(subfolder)}"
        )
    else:
        file_url = ""

    try:
        update_latest_image(
            media_id=0,
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
            "media_id": 0,
            "title": final_name,
            "file_url": file_url,
        }
    )


@server.PromptServer.instance.routes.post("/xz3r0/xdatahub/media/send-view")
async def api_media_send_view(request: web.Request) -> web.Response:
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    file_url = str(payload.get("file_url") or "").strip()
    result = _resolve_view_file_url(file_url)
    if result is None:
        return json_error(request, "invalid_payload", 400)
    resolved, filename, _subfolder = result
    if not resolved.exists():
        return json_error(request, "file_not_found", 404)

    try:
        update_latest_image(
            media_id=0,
            path=resolved,
            title=filename,
            file_url=file_url,
        )
    except Exception as exc:
        LOGGER.exception(
            "[xdatahub] media send-view cache failed: %s",
            type(exc).__name__,
        )
        return json_error(request, "internal_error", 500)

    return web.json_response(
        {
            "status": "success",
            "media_id": 0,
            "title": filename,
            "file_url": file_url,
        }
    )


@server.PromptServer.instance.routes.post(
    "/xz3r0/xdatahub/media/validate-view"
)
async def api_media_validate_view(request: web.Request) -> web.Response:
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    file_url = str(payload.get("file_url") or "").strip()
    result = _resolve_view_file_url(file_url)
    if result is None:
        return json_error(request, "invalid_payload", 400)
    resolved, filename, _subfolder = result
    if not resolved.exists():
        return json_error(request, "file_not_found", 404)

    cached = _get_image_validation_cached(resolved)
    if cached is not None:
        ok, code = cached
        if ok:
            return web.json_response(
                {
                    "status": "success",
                    "valid": True,
                    "title": filename,
                    "file_url": file_url,
                }
            )
        return json_error(
            request,
            code or "file_corrupted",
            415 if code == "unsupported_media_type" else 400,
        )

    ok, code = _validate_image_with_pillow(resolved)
    _set_image_validation_cache(resolved, ok, code)
    if ok:
        return web.json_response(
            {
                "status": "success",
                "valid": True,
                "title": filename,
                "file_url": file_url,
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
                "media_id": None,
                "title": "",
                "file_url": "",
            }
        )
    media_id = int(snapshot.media_id)
    file_url = str(snapshot.file_url or "")
    if not file_url and media_id > 0:
        file_url = f"/xz3r0/xdatahub/media/file?id={media_id}"
    return web.json_response(
        {
            "status": "success",
            "media_id": media_id,
            "title": str(snapshot.title or ""),
            "file_url": file_url,
        }
    )


register_lock_listener()
