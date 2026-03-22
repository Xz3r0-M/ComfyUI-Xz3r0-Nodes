"""
XData 保存节点模块
=================

这个模块包含 xdata 数据保存节点。
"""

import json
import sqlite3
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


class XDataSave(io.ComfyNode):
    """
    XDataSave 数据保存节点

    接收 xdata 输入并保存到项目目录下 XDataSaved 文件夹。
    当前支持 seed 数据，后续可扩展更多 xdata 类型。
    """

    SAVE_TYPE_OPTIONS = ["custom", "seed"]
    MAX_RECORDS = 500
    MAX_HEADER_CHARS = 120
    MAX_RECORD_BYTES = 64 * 1024
    WRITE_DATA_ERROR = "Unable to write data file"
    INVALID_CUSTOM_FILENAME_ERROR = (
        "Custom filename is required when save_type is custom"
    )
    INVALID_XDATA_ERROR = "Invalid xdata input"
    HEADER_TOO_LONG_ERROR = "Header length exceeds 120 characters limit"
    RECORD_TOO_LARGE_ERROR = "Record size exceeds 64KB limit"
    RESERVED_DB_NAME_ERROR = "Custom filename conflicts with core db list"

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
            category="♾️ Xz3r0/File-Processing",
            is_output_node=True,
            inputs=[
                io.MultiType.Input(
                    "xdata_input",
                    types=[XDataSeedType],
                    optional=True,
                    tooltip=(
                        "Composite xdata input. Currently supports "
                        "xdata_seed and can be extended later."
                    ),
                ),
                io.Combo.Input(
                    "save_type",
                    options=cls.SAVE_TYPE_OPTIONS,
                    default="custom",
                    tooltip=(
                        "Save target type. custom requires a custom "
                        "filename. seed writes to seed_data.db."
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
                        "Fallback custom filename for save_type custom. "
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
        save_type: str = "custom",
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

        filename_base = cls._resolve_filename_base(
            save_type=save_type,
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

        record = cls._build_record(xdata_input, extra_header, save_type)
        cls._validate_record_size(record)

        data_file = data_dir / f"{filename_base}.db"
        record_count = cls._save_record_to_db(data_file, record)

        relative_path = Path("XDataSaved") / data_file.name
        status = f"Saved {record_count} records"
        return io.NodeOutput(status, relative_path.as_posix())

    @classmethod
    def _get_data_root(cls) -> Path:
        """返回数据保存根目录。"""
        project_root = Path(__file__).resolve().parent.parent
        return project_root / "XDataSaved"

    @classmethod
    def _resolve_filename_base(
        cls,
        save_type: str,
        custom_filename_input: str | None,
        custom_filename_text: str,
    ) -> str:
        """根据保存类型解析文件基名。"""
        if save_type == "seed":
            return "seed_data"
        if save_type != "custom":
            raise ValueError("Unsupported save_type")

        filename_input = (custom_filename_input or "").strip()
        filename_text = (custom_filename_text or "").strip()
        filename = filename_input if filename_input else filename_text
        if not filename:
            raise ValueError(cls.INVALID_CUSTOM_FILENAME_ERROR)

        safe_filename = sanitize_path_component(filename).strip(" .")
        if not safe_filename:
            raise ValueError(cls.INVALID_CUSTOM_FILENAME_ERROR)
        critical_names = {
            Path(name).stem.lower()
            for name in get_critical_db_names()
        }
        safe_stem = Path(safe_filename).stem.lower()
        if safe_stem in critical_names:
            raise ValueError(cls.RESERVED_DB_NAME_ERROR)
        return safe_filename

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
            source = str(xdata_input.get("source") or "unknown")
            if "payload" in xdata_input:
                payload: Any = xdata_input.get("payload")
            elif data_type == "seed" and "seed" in xdata_input:
                payload = {
                    "seed": xdata_input.get("seed"),
                    "digits": xdata_input.get("digits"),
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
            "data_type": data_type,
            "payload": safe_payload,
            "source": source,
        }

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
    ) -> int:
        """保存记录到 SQLite，并执行 500 条滚动保留。"""
        try:
            with sqlite3.connect(path) as conn:
                cls._init_schema(conn)
                cls._insert_record(conn, record)
                cls._trim_records(conn)
                return cls._count_records(conn)
        except sqlite3.Error as exc:
            raise RuntimeError(cls.WRITE_DATA_ERROR) from exc

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
        conn.commit()

    @classmethod
    def _init_schema(cls, conn: sqlite3.Connection) -> None:
        """初始化 SQLite 表结构。"""
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
        conn.commit()

    @classmethod
    def _insert_record(
        cls,
        conn: sqlite3.Connection,
        record: dict[str, Any],
    ) -> None:
        """插入单条记录。"""
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
        conn.commit()

    @classmethod
    def _count_records(
        cls,
        conn: sqlite3.Connection,
    ) -> int:
        """返回当前记录总数。"""
        row = conn.execute("SELECT COUNT(*) FROM records").fetchone()
        return int(row[0]) if row else 0
