"""SQLite persistence for dataset and experiment metadata (stdlib ``sqlite3``, parameterised SQL)."""

from __future__ import annotations

import json
import re
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS datasets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    description TEXT,
    original_filename TEXT,
    rows INTEGER NOT NULL,
    columns INTEGER NOT NULL,
    target_hint TEXT,
    parent_id TEXT,
    meta TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS experiments (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    message TEXT,
    dataset_id TEXT,
    config TEXT NOT NULL,
    results TEXT,
    live TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    duration_s REAL
);
CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    experiment_id TEXT NOT NULL,
    label TEXT NOT NULL,
    kind TEXT NOT NULL,
    metrics TEXT,
    privacy TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    experiment_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_exp_created ON experiments(created_at);
"""

# SQL identifiers (table/column names) are never user input: they are checked against
# TABLES/COLUMNS allow-lists below, which is why the f-string queries carry "nosec B608".
JSON_FIELDS = {"config", "results", "live", "meta", "metrics", "privacy"}
TABLES = frozenset({"datasets", "experiments", "models", "reports"})
ORDERS = frozenset({"created_at DESC", "created_at ASC"})
WHERES = frozenset({"", "experiment_id = ?", "type = ?", "status = ?"})


COLUMNS: dict[str, frozenset[str]] = {
    t: frozenset(re.findall(r"^\s+(\w+) (?:TEXT|INTEGER|REAL)", body, re.M))
    for t, body in re.findall(r"CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\);", SCHEMA, re.S)
}


def _check_columns(table: str, cols: list[str]) -> None:
    bad = [c for c in cols if c not in COLUMNS[table]]
    if bad:
        raise ValueError(f"Unknown column(s) for {table}: {bad}")


def _check(value: str, allowed: frozenset[str]) -> None:
    """Allow-list guard for the only SQL fragments that are not bound parameters."""
    if value not in allowed:
        raise ValueError(f"Disallowed SQL identifier: {value!r}")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Database:
    """Thread-safe thin wrapper around a SQLite file."""

    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        with self.conn() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def conn(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            c = sqlite3.connect(self.path, timeout=30)
            c.row_factory = sqlite3.Row
            try:
                yield c
                c.commit()
            finally:
                c.close()

    @staticmethod
    def _row(r: sqlite3.Row | None) -> dict[str, Any] | None:
        if r is None:
            return None
        d = dict(r)
        for k in JSON_FIELDS & d.keys():
            if d[k] is not None:
                d[k] = json.loads(d[k])
        return d

    def insert(self, table: str, data: dict[str, Any]) -> None:
        _check(table, TABLES)
        cols = list(data)
        _check_columns(table, cols)
        vals = [json.dumps(v) if k in JSON_FIELDS and v is not None else v for k, v in data.items()]
        sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})"  # noqa: S608  # nosec B608
        with self.conn() as c:
            c.execute(sql, vals)

    def update(self, table: str, row_id: str, data: dict[str, Any]) -> None:
        _check(table, TABLES)
        _check_columns(table, list(data))
        sets = ", ".join(f"{k} = ?" for k in data)
        vals = [json.dumps(v) if k in JSON_FIELDS and v is not None else v for k, v in data.items()]
        with self.conn() as c:
            c.execute(f"UPDATE {table} SET {sets} WHERE id = ?", [*vals, row_id])  # noqa: S608  # nosec B608

    def get(self, table: str, row_id: str) -> dict[str, Any] | None:
        _check(table, TABLES)
        with self.conn() as c:
            return self._row(c.execute(f"SELECT * FROM {table} WHERE id = ?", [row_id]).fetchone())  # noqa: S608  # nosec B608

    def list(
        self,
        table: str,
        where: str = "",
        params: list[Any] | None = None,
        order: str = "created_at DESC",
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        _check(table, TABLES)
        _check(order, ORDERS)
        _check(where, WHERES)
        sql = f"SELECT * FROM {table}"  # noqa: S608  # nosec B608
        if where:
            sql += f" WHERE {where}"
        sql += f" ORDER BY {order} LIMIT ?"
        with self.conn() as c:
            rows = c.execute(sql, [*(params or []), int(limit)]).fetchall()
        return [r for r in (self._row(x) for x in rows) if r is not None]

    def delete(self, table: str, row_id: str) -> None:
        _check(table, TABLES)
        with self.conn() as c:
            c.execute(f"DELETE FROM {table} WHERE id = ?", [row_id])  # noqa: S608  # nosec B608
