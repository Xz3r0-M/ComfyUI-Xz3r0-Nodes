"""
XData 保存节点模块
=================

这个模块包含 xdata 数据保存节点。
"""

import json
import sqlite3
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from comfy_api.latest import io

try:
    from ..xz3r0_utils import (
        get_critical_db_names,
        get_logger,
        sanitize_path_component,
    )
except ImportError:
    # 兼容直接执行测试脚本时从仓库根目录导入 xnode 的场景。
    from xz3r0_utils import (
        get_critical_db_names,
        get_logger,
        sanitize_path_component,
    )

LOGGER = get_logger(__name__)
XDataSeedType = io.Custom("xdata_seed")
XDataStringType = io.Custom("xdata_string")


class XDataSave(io.ComfyNode):
    """
    XDataSave 数据保存节点

    接收 xdata 输入并保存到项目目录下 XDataSaved 文件夹。
    当前支持 seed 数据，后续可扩展更多 xdata 类型。
    """

    SAVE_TYPE_OPTIONS = ["Custom", "Seed", "String"]
    MAX_RECORDS = 500
    MAX_DB_STEM_CHARS = 64
    MAX_HEADER_CHARS = 120
    MAX_RECORD_BYTES = 64 * 1024
    WRITE_DATA_ERROR = "Unable to write data file"
    INVALID_CUSTOM_FILENAME_ERROR = (
        "Custom filename is required when save_type is Custom"
    )
    INVALID_XDATA_ERROR = "Invalid xdata input"
    EMPTY_PRIMARY_CONTENT_SKIP_MSG = "Save skipped: xdata input is empty"
    HEADER_TOO_LONG_ERROR = "Header length exceeds 120 characters limit"
    RECORD_TOO_LARGE_ERROR = "Record size exceeds 64KB limit"
    DB_NAME_TOO_LONG_ERROR = "Custom filename exceeds 64 characters limit"
    RESERVED_DB_NAME_ERROR = "Custom filename conflicts with core db list"
    SQLITE_CONNECT_TIMEOUT_SECONDS = 5.0
    SQLITE_BUSY_TIMEOUT_MS = 5000
    SQLITE_LOCK_RETRY_COUNT = 2
    SQLITE_LOCK_RETRY_DELAY_SECONDS = 0.05
    DB_LOCKED_ERROR = "Database is locked for write"
    _PATH_LOCKS: dict[str, threading.Lock] = {}
    _PATH_LOCKS_GUARD = threading.Lock()

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点输入输出模式。"""
        return io.Schema(
            node_id="XDataSave",
            display_name="XDataSave",
            description=(
                "Save xdata payload to SQLite DB files in the project "
                "XDataSaved folder with append-and-rotate behavior "
                "(500 records max, header <=120 chars, 64KB per record)"
            ),
            category="♾️ Xz3r0/XDataHub",
            is_output_node=True,
            inputs=[
                io.MultiType.Input(
                    "xdata_input",
                    types=[XDataSeedType, XDataStringType],
                    tooltip=(
                        "Composite xdata input. Currently supports "
                        "xdata_seed and xdata_string."
                    ),
                ),
                io.Combo.Input(
                    "save_type",
                    options=cls.SAVE_TYPE_OPTIONS,
                    default="Custom",
                    tooltip=(
                        "Save target type. Custom requires a custom "
                        "filename. Seed writes to seed_data.db. "
                        "String writes to string_data.db."
                    ),
                ),
                io.String.Input(
                    "custom_filename_input",
                    optional=True,
                    force_input=True,
                    tooltip=(
                        "Optional custom filename input. Takes priority "
                        "over custom_filename_text."
                    ),
                ),
                io.String.Input(
                    "custom_filename_text",
                    default="",
                    tooltip=(
                        "Fallback custom filename for save_type Custom. "
                        "Leave empty to force explicit configuration."
                    ),
                ),
                io.String.Input(
                    "extra_header_input",
                    optional=True,
                    force_input=True,
                    tooltip=(
                        "Optional extra header input. Takes priority over "
                        "extra_header_text."
                    ),
                ),
                io.String.Input(
                    "extra_header_text",
                    default="",
                    tooltip=(
                        "Fallback extra header text. Single record size "
                        "must not exceed 64KB. Header length must not "
                        "exceed 120 characters."
                    ),
                ),
                io.Boolean.Input(
                    "enable_save",
                    default=True,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip=(
                        "Enable or disable writing records to disk. "
                        "When disabled, no file is written."
                    ),
                ),
            ],
            outputs=[
                io.String.Output(
                    "save_status",
                    tooltip="Save status message",
                ),
                io.String.Output(
                    "save_path",
                    tooltip=(
                        "Saved path relative to project root. Empty when "
                        "save is disabled."
                    ),
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        xdata_input: Any = None,
        save_type: str = "Custom",
        custom_filename_input: str | None = None,
        custom_filename_text: str = "",
        extra_header_input: str | None = None,
        extra_header_text: str = "",
        enable_save: bool = True,
    ) -> io.NodeOutput:
        """执行 xdata 保存。"""
        if not enable_save:
            return io.NodeOutput("Save skipped: enable_save is disabled", "")

        if xdata_input is None:
            raise ValueError(cls.INVALID_XDATA_ERROR)
        normalized_save_type = cls._normalize_save_type(save_type)
        if not cls._has_primary_content(xdata_input, normalized_save_type):
            return io.NodeOutput(cls.EMPTY_PRIMARY_CONTENT_SKIP_MSG, "")

        filename_base = cls._resolve_filename_base(
            save_type=normalized_save_type,
            custom_filename_input=custom_filename_input,
            custom_filename_text=custom_filename_text,
        )
        extra_header = cls._resolve_extra_header(
            extra_header_input,
            extra_header_text,
        )
        cls._validate_extra_header(extra_header)

        data_dir = cls._get_data_root()
        try:
            data_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise RuntimeError(cls.WRITE_DATA_ERROR) from exc

        record = cls._build_record(
            xdata_input=xdata_input,
            extra_header=extra_header,
            save_type=normalized_save_type,
        )
        cls._validate_record_size(record)

        data_file = data_dir / f"{filename_base}.db"
        record_count = cls._save_record_to_db(
            data_file,
            record,
            normalized_save_type,
        )

        relative_path = Path("XDataSaved") / "database" / data_file.name
        status = f"Saved {record_count} records"
        return io.NodeOutput(status, relative_path.as_posix())

    @classmethod
    def _get_data_root(cls) -> Path:
        """返回数据保存根目录。"""
        project_root = Path(__file__).resolve().parent.parent
        return project_root / "XDataSaved" / "database"

    @classmethod
    def _resolve_filename_base(
        cls,
        save_type: str,
        custom_filename_input: str | None,
        custom_filename_text: str,
    ) -> str:
        """根据保存类型解析文件基名。"""
        if save_type == "Seed":
            return "seed_data"
        if save_type == "String":
            return "string_data"
        if save_type != "Custom":
            raise ValueError("Unsupported save_type")

        filename_input = (custom_filename_input or "").strip()
        filename_text = (custom_filename_text or "").strip()
        filename = filename_input if filename_input else filename_text
        if not filename:
            raise ValueError(cls.INVALID_CUSTOM_FILENAME_ERROR)

        safe_filename = sanitize_path_component(filename).strip(" .")
        if not safe_filename:
            raise ValueError(cls.INVALID_CUSTOM_FILENAME_ERROR)
        safe_stem = cls._normalize_db_stem(safe_filename)
        if len(safe_stem) > cls.MAX_DB_STEM_CHARS:
            raise ValueError(cls.DB_NAME_TOO_LONG_ERROR)
        critical_names = {
            Path(name).stem.lower() for name in get_critical_db_names()
        }
        if safe_stem.lower() in critical_names:
            raise ValueError(cls.RESERVED_DB_NAME_ERROR)
        return safe_stem

    @classmethod
    def _normalize_db_stem(cls, filename: str) -> str:
        """归一化自定义数据库名为纯 stem（去除扩展与重复 .db 尾缀）。"""
        stem = Path(filename).stem.strip(" .")
        while stem.lower().endswith(".db"):
            stem = stem[:-3].strip(" .")
        if not stem:
            raise ValueError(cls.INVALID_CUSTOM_FILENAME_ERROR)
        return stem

    @classmethod
    def _resolve_extra_header(
        cls,
        extra_header_input: str | None,
        extra_header_text: str,
    ) -> str:
        """解析额外头部信息（端口优先）。"""
        if extra_header_input is not None:
            return extra_header_input
        return extra_header_text

    @classmethod
    def _build_record(
        cls,
        xdata_input: Any,
        extra_header: str,
        save_type: str,
    ) -> dict[str, Any]:
        """构造单条结构化记录。"""
        saved_at = datetime.now().astimezone().isoformat(timespec="seconds")

        if isinstance(xdata_input, dict):
            data_type = str(xdata_input.get("data_type") or save_type)
            data_type_normalized = data_type.lower()
            source = str(xdata_input.get("source") or "unknown")
            if "payload" in xdata_input:
                payload: Any = xdata_input.get("payload")
            elif data_type_normalized == "seed" and "seed" in xdata_input:
                payload = {
                    "seed": xdata_input.get("seed"),
                    "digits": xdata_input.get("digits"),
                }
            elif data_type_normalized == "string" and "text" in xdata_input:
                payload = {
                    "text": xdata_input.get("text"),
                }
            else:
                payload = dict(xdata_input)
        else:
            data_type = save_type
            source = "unknown"
            payload = xdata_input

        safe_payload = cls._to_jsonable(payload)
        return {
            "saved_at": saved_at,
            "extra_header": str(extra_header),
            "data_type": data_type_normalized
            if isinstance(xdata_input, dict)
            else str(data_type).lower(),
            "payload": safe_payload,
            "source": source,
        }

    @classmethod
    def _has_primary_content(cls, xdata_input: Any, save_type: str) -> bool:
        """检测主要内容是否存在（不依赖 extra_header）。"""
        if isinstance(xdata_input, dict):
            if "payload" in xdata_input:
                return cls._is_meaningful_value(xdata_input.get("payload"))

            data_type = str(xdata_input.get("data_type") or save_type).lower()
            if data_type == "seed":
                return cls._is_meaningful_value(xdata_input.get("seed"))
            if data_type == "string":
                return cls._is_meaningful_value(xdata_input.get("text"))

            metadata_keys = {"data_type", "source", "saved_at"}
            content_payload = {
                key: value
                for key, value in xdata_input.items()
                if key not in metadata_keys
            }
            return cls._is_meaningful_value(content_payload)

        return cls._is_meaningful_value(xdata_input)

    @classmethod
    def _is_meaningful_value(cls, value: Any) -> bool:
        """递归判断值是否为“有意义的主要内容”."""
        if value is None:
            return False
        if isinstance(value, str):
            return bool(value.strip())
        if isinstance(value, (int, float, bool)):
            return True
        if isinstance(value, dict):
            if not value:
                return False
            return any(cls._is_meaningful_value(v) for v in value.values())
        if isinstance(value, (list, tuple, set)):
            if not value:
                return False
            return any(cls._is_meaningful_value(item) for item in value)
        return bool(str(value).strip())

    @classmethod
    def _normalize_save_type(cls, save_type: str) -> str:
        """校验并规范保存类型（严格新值，不兼容旧小写）。"""
        value = str(save_type or "").strip()
        if value not in cls.SAVE_TYPE_OPTIONS:
            raise ValueError("Unsupported save_type")
        return value

    @classmethod
    def _to_jsonable(cls, payload: Any) -> Any:
        """把数据转换为可 JSON 序列化对象。"""
        try:
            json.dumps(payload, ensure_ascii=False)
            return payload
        except (TypeError, ValueError):
            return str(payload)

    @classmethod
    def _validate_record_size(cls, record: dict[str, Any]) -> None:
        """校验单条记录字节大小。"""
        encoded = json.dumps(record, ensure_ascii=False).encode("utf-8")
        if len(encoded) > cls.MAX_RECORD_BYTES:
            raise ValueError(cls.RECORD_TOO_LARGE_ERROR)

    @classmethod
    def _validate_extra_header(cls, extra_header: str) -> None:
        """校验额外头部长度。"""
        if len(str(extra_header)) > cls.MAX_HEADER_CHARS:
            raise ValueError(cls.HEADER_TOO_LONG_ERROR)

    @classmethod
    def _save_record_to_db(
        cls,
        path: Path,
        record: dict[str, Any],
        save_type: str,
    ) -> int:
        """保存记录到 SQLite，并执行 500 条滚动保留。"""
        lock = cls._get_path_lock(path)
        try:
            with lock:
                for attempt in range(cls.SQLITE_LOCK_RETRY_COUNT + 1):
                    try:
                        conn = sqlite3.connect(
                            path,
                            timeout=cls.SQLITE_CONNECT_TIMEOUT_SECONDS,
                        )
                        try:
                            cls._configure_connection(conn)
                            cls._init_schema(conn)
                            cls._insert_record(conn, record)
                            cls._trim_records(conn)
                            count = cls._count_records(conn)
                            conn.commit()
                            return count
                        finally:
                            conn.close()
                    except sqlite3.OperationalError as exc:
                        if not cls._is_db_locked_error(exc):
                            raise
                        if attempt >= cls.SQLITE_LOCK_RETRY_COUNT:
                            raise
                        time.sleep(cls.SQLITE_LOCK_RETRY_DELAY_SECONDS)
        except sqlite3.OperationalError as exc:
            if cls._is_db_locked_error(exc):
                LOGGER.error(
                    "XDataSave db locked: db=%s save_type=%s err=%s",
                    path.name,
                    save_type,
                    exc.__class__.__name__,
                )
                raise RuntimeError(
                    f"{cls.DB_LOCKED_ERROR}: {path.name}"
                ) from exc
            LOGGER.error(
                "XDataSave sqlite operational error: db=%s save_type=%s "
                "err=%s",
                path.name,
                save_type,
                exc.__class__.__name__,
            )
            raise RuntimeError(cls.WRITE_DATA_ERROR) from exc
        except sqlite3.Error as exc:
            LOGGER.error(
                "XDataSave sqlite error: db=%s save_type=%s err=%s",
                path.name,
                save_type,
                exc.__class__.__name__,
            )
            raise RuntimeError(cls.WRITE_DATA_ERROR) from exc

    @classmethod
    def _is_db_locked_error(cls, exc: sqlite3.OperationalError) -> bool:
        """判断是否为 SQLite 写锁冲突。"""
        return "database is locked" in str(exc).lower()

    @classmethod
    def _get_path_lock(cls, path: Path) -> threading.Lock:
        """返回按数据库路径维度的互斥锁。"""
        lock_key = str(path.resolve())
        with cls._PATH_LOCKS_GUARD:
            lock = cls._PATH_LOCKS.get(lock_key)
            if lock is None:
                lock = threading.Lock()
                cls._PATH_LOCKS[lock_key] = lock
            return lock

    @classmethod
    def _configure_connection(cls, conn: sqlite3.Connection) -> None:
        """配置 SQLite 会话参数。"""
        conn.execute(f"PRAGMA busy_timeout={cls.SQLITE_BUSY_TIMEOUT_MS}")
        conn.execute("PRAGMA journal_mode=WAL")

    @classmethod
    def _trim_records(
        cls,
        conn: sqlite3.Connection,
    ) -> None:
        """按记录 id 保留最新 MAX_RECORDS 条。"""
        cursor = conn.execute("SELECT COUNT(*) FROM records")
        count_row = cursor.fetchone()
        total = int(count_row[0]) if count_row else 0
        overflow = total - cls.MAX_RECORDS
        if overflow <= 0:
            return

        conn.execute(
            (
                "DELETE FROM records WHERE id IN ("
                "SELECT id FROM records ORDER BY id ASC LIMIT ?"
                ")"
            ),
            (overflow,),
        )

    @classmethod
    def _init_schema(cls, conn: sqlite3.Connection) -> None:
        """初始化 SQLite 表结构，由外层统一提交事务。"""
        conn.execute(
            "CREATE TABLE IF NOT EXISTS records ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "saved_at TEXT NOT NULL,"
            "extra_header TEXT NOT NULL,"
            "data_type TEXT NOT NULL,"
            "payload_json TEXT NOT NULL,"
            "source TEXT NOT NULL"
            ")"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_records_saved_at "
            "ON records(saved_at)"
        )

    @classmethod
    def _insert_record(
        cls,
        conn: sqlite3.Connection,
        record: dict[str, Any],
    ) -> None:
        """插入单条记录，由外层统一提交事务。"""
        payload_json = json.dumps(record["payload"], ensure_ascii=False)
        conn.execute(
            (
                "INSERT INTO records (saved_at, extra_header, data_type, "
                "payload_json, source) VALUES (?, ?, ?, ?, ?)"
            ),
            (
                str(record["saved_at"]),
                str(record["extra_header"]),
                str(record["data_type"]),
                payload_json,
                str(record["source"]),
            ),
        )

    @classmethod
    def _count_records(
        cls,
        conn: sqlite3.Connection,
    ) -> int:
        """返回当前记录总数。"""
        row = conn.execute("SELECT COUNT(*) FROM records").fetchone()
        return int(row[0]) if row else 0
