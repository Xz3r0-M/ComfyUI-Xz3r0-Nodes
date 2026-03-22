"""
核心数据库注册表工具。
"""

from __future__ import annotations

import json
from pathlib import Path


def _registry_path() -> Path:
    return Path(__file__).resolve().parent / "core_db_list.json"


def get_critical_db_names() -> set[str]:
    path = _registry_path()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"media_index.db", "seed_data.db"}

    values = payload.get("critical_databases")
    if not isinstance(values, list):
        return {"media_index.db", "seed_data.db"}

    names: set[str] = set()
    for item in values:
        text = str(item or "").strip()
        if not text:
            continue
        name = Path(text).name
        if name != text:
            continue
        if not name.lower().endswith(".db"):
            continue
        names.add(name)

    if not names:
        return {"media_index.db", "seed_data.db"}
    return names

