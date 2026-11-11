"""Privacy-preserving column transformations.

Supported actions:

=================  ==========================================================================
``keep``           unchanged
``suppress``       column removed (data minimisation)
``redact``         every value replaced by ``[REDACTED]``
``mask``           partial masking that keeps format hints (``a***@example.com``, ``***-0142``)
``pseudonymize``   keyed HMAC-SHA256 token; consistent within one run, unlinkable without key
``generalize``     numeric binning, or prefix truncation for strings (e.g. ZIP ``94110`` → ``941**``)
``local_dp``       *local* differential privacy per value: bounded Laplace mechanism for numbers,
                   k-ary randomized response for categories (epsilon per attribute per record)
=================  ==========================================================================

Pseudonymised data is still personal data under most legal frameworks: whoever holds the key
can re-link it. Masking, redaction and generalisation reduce exposure but do not provide a
formal privacy guarantee; only ``local_dp`` does, and only for the transformed column.
"""

from __future__ import annotations

import hashlib
import hmac
import math
import secrets
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

from ppml.core.data.pii import k_anonymity

Action = Literal["keep", "suppress", "redact", "mask", "pseudonymize", "generalize", "local_dp"]


class ColumnRule(BaseModel):
    column: str
    action: Action = "keep"
    bin_width: float | None = Field(default=None, gt=0)
    keep_chars: int = Field(default=3, ge=0, le=20)
    epsilon: float = Field(default=1.0, gt=0, le=20)
    lower: float | None = None
    upper: float | None = None


@dataclass
class TransformResult:
    data: pd.DataFrame
    report: dict[str, Any]


def _mask_value(v: Any) -> Any:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return v
    s = str(v)
    if "@" in s:
        local, _, domain = s.partition("@")
        return f"{local[:1]}***@{domain}"
    digits = sum(c.isdigit() for c in s)
    if digits >= 6:
        tail = s[-4:]
        return "*" * max(3, len(s) - 4) + tail
    if len(s) <= 2:
        return "*" * len(s)
    return s[0] + "*" * (len(s) - 2) + s[-1]


def _pseudonym(key: bytes, v: Any) -> Any:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return v
    digest = hmac.new(key, str(v).encode("utf-8"), hashlib.sha256).hexdigest()
    return f"tok_{digest[:16]}"


def _generalize(s: pd.Series, rule: ColumnRule) -> pd.Series:
    if pd.api.types.is_numeric_dtype(s):
        width = rule.bin_width or _auto_width(s)
        lo = np.floor(s / width) * width
        hi = lo + width

        def fmt(a: float, b: float) -> str | float:
            if np.isnan(a):
                return np.nan
            return f"{a:g}-{b:g}"

        return pd.Series([fmt(a, b) for a, b in zip(lo, hi, strict=True)], index=s.index)
    k = rule.keep_chars

    def trunc(v: Any) -> Any:
        if pd.isna(v):
            return v
        t = str(v)
        return t[:k] + "*" * max(0, len(t) - k)

    return s.map(trunc)


def _auto_width(s: pd.Series) -> float:
    d = s.dropna()
    if d.empty:
        return 1.0
    span = float(d.max() - d.min()) or 1.0
    raw = span / 8
    mag = 10 ** math.floor(math.log10(raw)) if raw > 0 else 1
    return float(max(1.0, round(raw / mag) * mag))


def _local_dp(s: pd.Series, rule: ColumnRule, rng: np.random.Generator) -> tuple[pd.Series, dict[str, Any]]:
    eps = rule.epsilon
    if pd.api.types.is_numeric_dtype(s):
        d = s.astype(float)
        lower = rule.lower if rule.lower is not None else float(np.nanmin(d))
        upper = rule.upper if rule.upper is not None else float(np.nanmax(d))
        if upper <= lower:
            upper = lower + 1.0
        sensitivity = upper - lower
        clipped = d.clip(lower, upper)
        noise = rng.laplace(0.0, sensitivity / eps, len(d))
        out = clipped + noise
        out[d.isna()] = np.nan
        meta = {
            "mechanism": "laplace",
            "epsilon": eps,
            "sensitivity": sensitivity,
            "bounds": [lower, upper],
            "note": (
                "Bounds taken from the data itself are not private; supply public bounds "
                "for a strict guarantee."
            )
            if rule.lower is None or rule.upper is None
            else "",
        }
        return out.round(4), meta
    cats = sorted(s.dropna().astype(str).unique().tolist())
    k = len(cats)
    if k < 2:
        return s, {"mechanism": "randomized_response", "epsilon": eps, "categories": k}
    p_keep = math.exp(eps) / (math.exp(eps) + k - 1)
    vals = s.astype("string")
    keep = rng.random(len(s)) < p_keep
    out_list: list[Any] = []
    for v, kp in zip(vals, keep, strict=True):
        if pd.isna(v):
            out_list.append(None)
        elif kp:
            out_list.append(str(v))
        else:
            others = [c for c in cats if c != v]
            out_list.append(others[int(rng.integers(0, len(others)))])
    meta = {
        "mechanism": "randomized_response",
        "epsilon": eps,
        "categories": k,
        "p_truthful": round(p_keep, 4),
    }
    return pd.Series(out_list, index=s.index, dtype="object"), meta


def apply_rules(
    df: pd.DataFrame,
    rules: list[ColumnRule],
    quasi_identifiers: list[str] | None = None,
    seed: int = 0,
    pseudonym_key: bytes | None = None,
) -> TransformResult:
    """Apply column rules and return the transformed frame plus a before/after report."""
    rng = np.random.default_rng(seed)
    key = pseudonym_key or secrets.token_bytes(32)
    out = df.copy()
    applied: list[dict[str, Any]] = []
    by_col = {r.column: r for r in rules}
    unknown = [c for c in by_col if c not in df.columns]
    if unknown:
        raise ValueError(f"Unknown columns in rules: {unknown}")

    for col, rule in by_col.items():
        before = df[col]
        meta: dict[str, Any] = {}
        if rule.action == "keep":
            continue
        if rule.action == "suppress":
            out = out.drop(columns=[col])
            applied.append({"column": col, "action": "suppress", "changed_pct": 100.0})
            continue
        if rule.action == "redact":
            new = before.where(before.isna(), "[REDACTED]")
        elif rule.action == "mask":
            new = before.map(_mask_value)
        elif rule.action == "pseudonymize":
            new = before.map(lambda v: _pseudonym(key, v))
            meta["note"] = "HMAC-SHA256 with an ephemeral key; the key is not stored."
        elif rule.action == "generalize":
            new = _generalize(before, rule)
        elif rule.action == "local_dp":
            new, meta = _local_dp(before, rule, rng)
        else:  # pragma: no cover - guarded by pydantic Literal
            raise ValueError(rule.action)
        changed = new.astype("string").fillna("<NA>") != before.astype("string").fillna("<NA>")
        out[col] = new
        applied.append(
            {
                "column": col,
                "action": rule.action,
                "changed_pct": round(100 * float(changed.mean()), 2),
                **meta,
            }
        )

    qi = quasi_identifiers or []
    k_before = k_anonymity(df, qi)
    k_after = k_anonymity(out, [c for c in qi if c in out.columns])
    sample_idx = df.index[: min(8, len(df))]
    report = {
        "applied": applied,
        "columns_before": list(df.columns),
        "columns_after": list(out.columns),
        "k_anonymity_before": k_before,
        "k_anonymity_after": k_after,
        "sample_before": df.loc[sample_idx]
        .astype(object)
        .where(df.loc[sample_idx].notna(), None)
        .to_dict("records"),
        "sample_after": out.loc[sample_idx]
        .astype(object)
        .where(out.loc[sample_idx].notna(), None)
        .to_dict("records"),
    }
    return TransformResult(data=out, report=report)


def recommended_rules(scan_result: dict[str, Any]) -> list[ColumnRule]:
    """Turn a PII scan into a default rule set (suppress/mask identifiers, generalise QIs)."""
    rules: list[ColumnRule] = []
    for f in scan_result["findings"]:
        action = f["recommended_action"]
        if action == "keep":
            continue
        rules.append(ColumnRule(column=f["column"], action=action))
    return rules
