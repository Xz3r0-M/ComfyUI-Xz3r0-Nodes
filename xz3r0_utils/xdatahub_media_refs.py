"""
XDataHub 媒体不透明引用工具。
"""

from __future__ import annotations

import json
import os
import secrets
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path

try:
    from .logging_control import get_logger
except ImportError:
    from logging_control import get_logger

LOGGER = get_logger(__name__)

PUBLIC_REF_BYTES = 18
PUBLIC_REF_MIN_LEN = 16
PUBLIC_REF_MAX_LEN = (PUBLIC_REF_BYTES * 4 + 2) // 3
PUBLIC_REF_ALLOWED = set(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
)
CUSTOM_ROOT_PREFIX = "custom_"


@dataclass(frozen=True)
class ResolvedMediaRef:
    """
    共享媒体引用解析结果。
    """

    status: str
    media_ref: str
    public_ref: str
    title: str
    media_type: str
    rel_path: str
    resolved_path: Path | None


def media_index_db_path() -> Path:
    """
    返回 XDataHub 媒体索引数据库路径。
    """
    return (
        Path(__file__).resolve().parent.parent
        / "XDataSaved"
        / "media_index.db"
    )


def xdatahub_settings_path() -> Path:
    """
    返回 XDataHub 设置文件路径。
    """
    return (
        Path(__file__).resolve().parent.parent
        / "XDataSaved"
        / "xdatahub_settings.json"
    )


def _normalize_custom_root_values(value: object) -> list[str]:
    items = value if isinstance(value, list) else []
    output: list[str] = []
    seen: set[str] = set()
    for item in items:
        try:
            raw = str(item or "").strip()
            if not raw:
                continue
            candidate = Path(raw)
            abs_text = os.path.normpath(os.path.abspath(str(candidate)))
            real_text = os.path.normpath(os.path.realpath(str(candidate)))
            if os.path.normcase(abs_text) != os.path.normcase(real_text):
                continue
            resolved = Path(real_text)
            if not resolved.exists() or not resolved.is_dir():
                continue
            key = os.path.normcase(str(resolved))
            if key in seen:
                continue
            seen.add(key)
            output.append(str(resolved))
        except Exception:
            continue
    return output


def custom_media_roots() -> list[tuple[str, Path]]:
    """
    读取 XDataHub 自定义媒体根目录。
    """
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


def generate_public_ref() -> str:
    """
    生成稳定持久使用的不透明引用。
    """
    return secrets.token_urlsafe(PUBLIC_REF_BYTES).rstrip("=")


def normalize_public_ref(value: str | None) -> str:
    """
    标准化 public_ref，非法值返回空字符串。
    """
    raw = str(value or "").strip()
    if len(raw) < PUBLIC_REF_MIN_LEN:
        return ""
    if len(raw) > PUBLIC_REF_MAX_LEN:
        return ""
    if any(ch not in PUBLIC_REF_ALLOWED for ch in raw):
        return ""
    return raw


def normalize_media_ref(value: str | None) -> str:
    """
    当前 media_ref 与 public_ref 同格式，统一走同一标准化逻辑。
    """
    return normalize_public_ref(value)


def media_ref_to_file_url(media_ref: str | None) -> str:
    """
    由 media_ref 构造受控媒体流地址。
    """
    public_ref = normalize_media_ref(media_ref)
    if not public_ref:
        return ""
    return f"/xz3r0/xdatahub/media/file?ref={public_ref}"


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


def comfy_media_roots() -> list[tuple[str, Path]]:
    """
    读取当前 ComfyUI 的 input/output 根目录。
    """
    dirs: list[tuple[str, Path]] = []
    folder_paths = sys.modules.get("folder_paths")
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
    for name, path in dirs:
        try:
            normalized = normalize_path(path)
        except Exception:
            continue
        key = (name, str(normalized))
        if key in seen:
            continue
        seen.add(key)
        resolved.append((name, normalized))
    for name, path in custom_media_roots():
        try:
            normalized = normalize_path(path)
        except Exception:
            continue
        key = (name, str(normalized))
        if key in seen:
            continue
        seen.add(key)
        resolved.append((name, normalized))
    return resolved


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
    _names = (
        root_names
        if root_names is not None
        else {name for name, _ in comfy_media_roots()}
    )
    if root_name not in _names or not rel_value:
        return None, None
    parts = [part for part in rel_value.split("/") if part]
    if not parts:
        return None, None
    for part in parts:
        if part in {".", ".."}:
            return None, None
    return root_name, Path(rel_value)


def _build_media_candidates(
    row: sqlite3.Row,
    roots: dict[str, Path],
) -> list[tuple[str, Path]]:
    output: list[tuple[str, Path]] = []
    seen: set[str] = set()
    root_names = set(roots.keys())

    rel_root, rel_tail = parse_rel_root(str(row["rel_path"] or ""), root_names)
    if rel_root and rel_tail is not None and rel_root in roots:
        candidate = roots[rel_root] / rel_tail
        key = os.path.normcase(str(candidate))
        seen.add(key)
        output.append(("rel_path", candidate))

    legacy = Path(str(row["real_path"] or ""))
    legacy_key = os.path.normcase(str(legacy))
    if str(legacy).strip() and legacy_key not in seen:
        output.append(("real_path", legacy))
    return output


def _locate_media_row(
    row: sqlite3.Row,
    roots: list[tuple[str, Path]],
) -> tuple[str, Path | None]:
    root_map = dict(roots)
    blocked = False
    for source, candidate in _build_media_candidates(row, root_map):
        try:
            resolved = candidate.resolve(strict=True)
        except FileNotFoundError:
            continue
        except PermissionError:
            blocked = True
            continue
        except OSError:
            continue

        for _root_name, root_path in roots:
            if is_path_within_root(resolved, root_path):
                return "ok", resolved
        if source == "rel_path":
            for _root_name, root_path in roots:
                if is_path_within_root_lexical(candidate, root_path):
                    return "ok", resolved
        blocked = True

    if blocked:
        return "blocked", None
    return "not_found", None


def resolve_media_ref(
    media_ref: str | None,
    db_path: Path | None = None,
) -> ResolvedMediaRef:
    """
    通过 media_ref 解析媒体记录和真实路径。
    """
    normalized = normalize_media_ref(media_ref)
    if not normalized:
        return ResolvedMediaRef(
            status="invalid",
            media_ref="",
            public_ref="",
            title="",
            media_type="",
            rel_path="",
            resolved_path=None,
        )
    target_db = Path(db_path) if db_path else media_index_db_path()
    if not target_db.exists():
        return ResolvedMediaRef(
            status="not_found",
            media_ref=normalized,
            public_ref=normalized,
            title="",
            media_type="",
            rel_path="",
            resolved_path=None,
        )
    conn = sqlite3.connect(target_db)
    try:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT public_ref, real_path, rel_path, filename, media_type "
            "FROM media_index WHERE public_ref = ? AND valid = 1",
            (normalized,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return ResolvedMediaRef(
            status="not_found",
            media_ref=normalized,
            public_ref=normalized,
            title="",
            media_type="",
            rel_path="",
            resolved_path=None,
        )
    status, resolved_path = _locate_media_row(row, comfy_media_roots())
    if status == "blocked":
        LOGGER.info(
            "[xdatahub_media_refs] media blocked by root guard: ref=%s",
            normalized,
        )
    return ResolvedMediaRef(
        status=status,
        media_ref=normalized,
        public_ref=str(row["public_ref"] or ""),
        title=str(row["filename"] or ""),
        media_type=str(row["media_type"] or ""),
        rel_path=str(row["rel_path"] or ""),
        resolved_path=resolved_path,
    )
