"""Safe loading, validation, profiling and export of tabular datasets."""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

ALLOWED_EXTENSIONS = {".csv", ".tsv", ".txt"}
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._ -]+")
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


class DatasetValidationError(ValueError):
    """Raised when an uploaded file fails validation."""


@dataclass(frozen=True)
class ValidationLimits:
    max_bytes: int
    max_rows: int
    max_columns: int


def sanitize_filename(name: str) -> str:
    """Return a display-safe base name (no directories, no control characters)."""
    base = re.split(r"[\\/]", name or "dataset.csv")[-1]
    base = _SAFE_NAME.sub("_", base).strip(" .") or "dataset.csv"
    return base[:120]


def _extension(name: str) -> str:
    m = re.search(r"(\.[A-Za-z0-9]+)$", name)
    return m.group(1).lower() if m else ""


def _dedupe_columns(cols: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    out: list[str] = []
    for raw in cols:
        c = re.sub(r"\s+", "_", str(raw).strip()) or "column"
        c = re.sub(r"[^\w.-]", "_", c)[:64]
        if c in seen:
            seen[c] += 1
            c = f"{c}_{seen[c]}"
        else:
            seen[c] = 0
        out.append(c)
    return out


def parse_tabular(content: bytes, filename: str, limits: ValidationLimits) -> pd.DataFrame:
    """Validate raw upload bytes and parse them into a DataFrame.

    Checks: extension allow-list, size limit, binary-content rejection, UTF-8 decoding,
    delimiter sniffing, row/column limits and non-empty content.
    """
    ext = _extension(filename)
    if ext not in ALLOWED_EXTENSIONS:
        raise DatasetValidationError(
            f"Unsupported file type '{ext or 'none'}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )
    if len(content) == 0:
        raise DatasetValidationError("The file is empty.")
    if len(content) > limits.max_bytes:
        raise DatasetValidationError(
            f"File is {len(content) / 1e6:.1f} MB; the limit is {limits.max_bytes / 1e6:.0f} MB."
        )
    if b"\x00" in content[:8192]:
        raise DatasetValidationError("The file appears to be binary, not delimited text.")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise DatasetValidationError("The file must be UTF-8 encoded text.") from exc

    sample = text[:16384]
    if ext == ".tsv":
        sep = "\t"
    else:
        try:
            sep = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
        except csv.Error:
            sep = ","
    try:
        df = pd.read_csv(
            io.StringIO(text),
            sep=sep,
            nrows=limits.max_rows + 1,
            low_memory=False,
            on_bad_lines="error",
            engine="c",
        )
    except (pd.errors.ParserError, pd.errors.EmptyDataError, ValueError) as exc:
        raise DatasetValidationError(f"Could not parse the file as delimited text: {exc}") from exc

    if df.shape[1] < 2:
        raise DatasetValidationError("A dataset needs at least two columns.")
    if df.shape[1] > limits.max_columns:
        raise DatasetValidationError(f"Too many columns ({df.shape[1]} > {limits.max_columns}).")
    if len(df) > limits.max_rows:
        raise DatasetValidationError(f"Too many rows (limit {limits.max_rows}).")
    if len(df) < 10:
        raise DatasetValidationError("A dataset needs at least 10 rows.")
    df.columns = _dedupe_columns([str(c) for c in df.columns])
    return df


def neutralize_formulas(df: pd.DataFrame) -> pd.DataFrame:
    """Prefix string cells that spreadsheet software would execute as formulas (CSV injection)."""
    out = df.copy()
    for col in out.columns:
        if out[col].dtype == object or pd.api.types.is_string_dtype(out[col]):
            out[col] = out[col].map(
                lambda v: "'" + v if isinstance(v, str) and v.startswith(_FORMULA_PREFIXES) else v
            )
    return out


def to_safe_csv(df: pd.DataFrame) -> bytes:
    """Serialise a DataFrame to CSV bytes with formula-injection protection."""
    return neutralize_formulas(df).to_csv(index=False).encode("utf-8")


def _json_safe(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, float | np.floating):
        return None if not np.isfinite(v) else float(v)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.bool_):
        return bool(v)
    if isinstance(v, pd.Timestamp):
        return v.isoformat()
    return v


def preview_records(df: pd.DataFrame, n: int = 25) -> list[dict[str, Any]]:
    return [{k: _json_safe(v) for k, v in row.items()} for row in df.head(n).to_dict("records")]


def column_kind(s: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(s):
        return "boolean"
    if pd.api.types.is_numeric_dtype(s):
        return "numeric"
    if pd.api.types.is_datetime64_any_dtype(s):
        return "datetime"
    return "categorical" if s.nunique(dropna=True) <= max(50, 0.05 * len(s)) else "text"


def profile(df: pd.DataFrame) -> dict[str, Any]:
    """Compute dataset- and column-level statistics plus a data-quality summary."""
    n = len(df)
    dup_rows = int(df.duplicated().sum())
    cols: list[dict[str, Any]] = []
    for c in df.columns:
        s = df[c]
        kind = column_kind(s)
        missing = int(s.isna().sum())
        info: dict[str, Any] = {
            "name": c,
            "dtype": str(s.dtype),
            "kind": kind,
            "missing": missing,
            "missing_pct": round(100 * missing / n, 2) if n else 0.0,
            "unique": int(s.nunique(dropna=True)),
            "unique_ratio": round(s.nunique(dropna=True) / max(1, n - missing), 4),
        }
        if kind == "numeric":
            d = s.dropna().astype(float)
            if len(d):
                q = d.quantile([0.25, 0.5, 0.75])
                counts, edges = np.histogram(d, bins=20)
                info.update(
                    mean=_json_safe(d.mean()),
                    std=_json_safe(d.std()),
                    min=_json_safe(d.min()),
                    max=_json_safe(d.max()),
                    q1=_json_safe(q.iloc[0]),
                    median=_json_safe(q.iloc[1]),
                    q3=_json_safe(q.iloc[2]),
                    histogram={"counts": counts.tolist(), "edges": [float(e) for e in edges]},
                )
        else:
            top = s.astype("string").value_counts(dropna=True).head(8)
            info["top_values"] = [{"value": str(k), "count": int(v)} for k, v in top.items()]
        cols.append(info)

    total_cells = n * df.shape[1]
    missing_cells = int(df.isna().sum().sum())
    completeness = 1 - missing_cells / total_cells if total_cells else 1.0
    uniqueness = 1 - dup_rows / n if n else 1.0
    constant_cols = [c["name"] for c in cols if c["unique"] <= 1]
    validity = 1 - len(constant_cols) / max(1, df.shape[1])
    quality = round(100 * (0.5 * completeness + 0.3 * uniqueness + 0.2 * validity), 1)
    issues: list[str] = []
    if missing_cells:
        issues.append(f"{missing_cells} missing cells across {sum(1 for c in cols if c['missing'])} columns")
    if dup_rows:
        issues.append(f"{dup_rows} exact duplicate rows")
    if constant_cols:
        issues.append(f"Constant columns: {', '.join(constant_cols)}")
    return {
        "rows": n,
        "columns": df.shape[1],
        "duplicate_rows": dup_rows,
        "missing_cells": missing_cells,
        "memory_kb": round(float(df.memory_usage(deep=True).sum()) / 1024, 1),
        "quality": {
            "score": quality,
            "completeness": round(100 * completeness, 2),
            "uniqueness": round(100 * uniqueness, 2),
            "validity": round(100 * validity, 2),
            "issues": issues,
        },
        "column_stats": cols,
    }
