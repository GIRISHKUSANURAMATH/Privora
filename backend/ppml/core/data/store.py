"""Dataset storage. Files are named by server-generated UUIDs; user filenames are display-only."""

from __future__ import annotations

import os
import re
import tempfile
import uuid
from pathlib import Path
from typing import Any

import pandas as pd

from ppml.db import Database, now

_ID = re.compile(r"^[a-f0-9]{32}$")


class DatasetStore:
    def __init__(self, root: Path, db: Database) -> None:
        self.root = root
        self.db = db
        root.mkdir(parents=True, exist_ok=True)

    def _path(self, dataset_id: str) -> Path:
        if not _ID.match(dataset_id):
            raise ValueError("Invalid dataset id")
        p = (self.root / f"{dataset_id}.csv").resolve()
        if p.parent != self.root.resolve():
            raise ValueError("Path traversal detected")
        return p

    def save(
        self,
        df: pd.DataFrame,
        name: str,
        source: str,
        description: str = "",
        original_filename: str | None = None,
        target_hint: str | None = None,
        parent_id: str | None = None,
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        dataset_id = uuid.uuid4().hex
        path = self._path(dataset_id)
        # Atomic write: temp file in the same directory, then rename.
        fd, tmp = tempfile.mkstemp(dir=self.root, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
                df.to_csv(fh, index=False)
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        rec = {
            "id": dataset_id,
            "name": name[:120],
            "source": source,
            "description": description,
            "original_filename": original_filename,
            "rows": len(df),
            "columns": int(df.shape[1]),
            "target_hint": target_hint,
            "parent_id": parent_id,
            "meta": meta or {},
            "created_at": now(),
        }
        self.db.insert("datasets", rec)
        return rec

    def load(self, dataset_id: str) -> pd.DataFrame:
        path = self._path(dataset_id)
        if not path.exists():
            raise FileNotFoundError("Dataset not found")
        return pd.read_csv(path, low_memory=False)

    def get(self, dataset_id: str) -> dict[str, Any] | None:
        if not _ID.match(dataset_id):
            return None
        return self.db.get("datasets", dataset_id)

    def list(self) -> list[dict[str, Any]]:
        return self.db.list("datasets")

    def delete(self, dataset_id: str) -> None:
        path = self._path(dataset_id)
        if path.exists():
            path.unlink()
        self.db.delete("datasets", dataset_id)
