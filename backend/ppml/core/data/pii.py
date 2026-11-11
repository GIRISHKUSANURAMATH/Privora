"""Heuristic PII detection and re-identification risk analysis.

Detection combines two signals per column:

1. **Header heuristics** – column names matched against identifier vocabularies.
2. **Content heuristics** – the share of sampled values matching typed regular expressions
   (with Luhn validation for card numbers).

Columns are classified as ``direct_identifier`` (identifies a person on its own),
``quasi_identifier`` (identifies a person in combination, e.g. age + ZIP + gender),
``sensitive_attribute`` (health, financial, etc.) or ``non_sensitive``.

This is a *heuristic* screen. It produces false positives and false negatives and is not a
substitute for a manual privacy review. Removing detected identifiers does **not** make a
dataset anonymous; see :func:`k_anonymity`.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

import pandas as pd

PATTERNS: dict[str, re.Pattern[str]] = {
    "email": re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"),
    "phone": re.compile(r"^\+?\d{0,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}$"),
    "credit_card": re.compile(r"^(?:\d[ -]?){13,19}$"),
    "ipv4": re.compile(r"^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$"),
    "national_id": re.compile(r"^(?:\d{3}-\d{2}-\d{4}|[A-Z]{2,4}-\d{3,5}-\d{3,5}|\d{4}\s?\d{4}\s?\d{4})$"),
    "date": re.compile(r"^\d{4}-\d{2}-\d{2}$|^\d{1,2}/\d{1,2}/\d{2,4}$"),
    "postal_code": re.compile(r"^\d{5}(?:-\d{4})?$|^\d{6}$|^[A-Z]\d[A-Z] ?\d[A-Z]\d$"),
    "url": re.compile(r"^https?://\S+$"),
}

HEADER_HINTS: dict[str, tuple[str, ...]] = {
    "name": ("name", "first_name", "last_name", "surname", "full_name", "patient", "customer"),
    "email": ("email", "e-mail", "mail"),
    "phone": ("phone", "mobile", "cell", "telephone", "contact_no"),
    "national_id": (
        "ssn",
        "social_security",
        "national_id",
        "nid",
        "aadhaar",
        "passport",
        "license",
        "tax_id",
        "pan",
    ),
    "address": ("address", "street", "addr"),
    "ipv4": ("ip", "ip_address", "last_login_ip"),
    "credit_card": ("card", "credit_card", "cc_number", "iban", "account_number"),
    "date_of_birth": ("dob", "birth", "date_of_birth"),
}
QUASI_HINTS = (
    "age",
    "zip",
    "postal",
    "postcode",
    "gender",
    "sex",
    "city",
    "state",
    "country",
    "race",
    "ethnicity",
    "occupation",
    "employment",
    "marital",
    "birth_year",
)
SENSITIVE_HINTS = (
    "diagnosis",
    "disease",
    "health",
    "bmi",
    "cholesterol",
    "glucose",
    "bp",
    "blood",
    "smok",
    "income",
    "salary",
    "credit",
    "debt",
    "religion",
    "medical",
    "hiv",
    "pregnan",
    "default",
    "risk",
    "loan",
)

DIRECT_TYPES = {"email", "phone", "credit_card", "national_id", "name", "address", "ipv4", "url"}


def _luhn_ok(s: str) -> bool:
    digits = [int(c) for c in s if c.isdigit()]
    if not 13 <= len(digits) <= 19:
        return False
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _looks_like_person_name(values: list[str]) -> float:
    pat = re.compile(r"^[A-ZÀ-Ý][a-zà-ÿ'’-]+(?: [A-ZÀ-Ý][a-zà-ÿ'’-]+){1,2}$")
    return sum(1 for v in values if pat.match(v)) / max(1, len(values))


@dataclass
class ColumnFinding:
    column: str
    category: str  # direct_identifier | quasi_identifier | sensitive_attribute | non_sensitive
    pii_types: list[str] = field(default_factory=list)
    confidence: float = 0.0
    match_rate: float = 0.0
    unique_ratio: float = 0.0
    evidence: list[str] = field(default_factory=list)
    recommended_action: str = "keep"
    risk: str = "low"  # low | medium | high


def _header_types(col: str) -> list[str]:
    lc = col.lower()
    tokens = set(re.split(r"[^a-z0-9]+", lc))
    found = []
    for t, hints in HEADER_HINTS.items():
        if any(h in tokens or (len(h) > 3 and h in lc) for h in hints):
            found.append(t)
    return found


def detect_column(series: pd.Series, sample_size: int = 500) -> ColumnFinding:
    """Classify a single column."""
    col = str(series.name)
    lc = col.lower()
    nonnull = series.dropna()
    n_nonnull = len(nonnull)
    unique_ratio = float(nonnull.nunique() / n_nonnull) if n_nonnull else 0.0
    sample = nonnull.sample(min(sample_size, n_nonnull), random_state=0) if n_nonnull else nonnull
    values = [str(v).strip() for v in sample]

    finding = ColumnFinding(column=col, category="non_sensitive", unique_ratio=round(unique_ratio, 4))
    header = _header_types(col)
    for t in header:
        finding.evidence.append(f"column name suggests '{t}'")

    content_hits: dict[str, float] = {}
    is_numeric = pd.api.types.is_numeric_dtype(series)
    if values:
        for t, pat in PATTERNS.items():
            if is_numeric and t not in ("postal_code",):
                continue
            hits = [v for v in values if pat.match(v)]
            if t == "credit_card":
                hits = [v for v in hits if _luhn_ok(v)]
            if t == "phone":
                hits = [v for v in hits if sum(c.isdigit() for c in v) >= 9]
            rate = len(hits) / len(values)
            if rate >= 0.6:
                content_hits[t] = rate
        if not is_numeric:
            name_rate = _looks_like_person_name(values)
            if name_rate >= 0.6 and unique_ratio > 0.2:
                content_hits["name"] = name_rate

    # Postal codes stored as integers are ambiguous; only trust them with a header hint.
    if "postal_code" in content_hits and not any(h in lc for h in ("zip", "postal", "postcode")):
        content_hits.pop("postal_code")
    if "date" in content_hits and not any(h in lc for h in ("birth", "dob")):
        content_hits.pop("date")
        finding.evidence.append("contains dates")
    elif "date" in content_hits:
        content_hits["date_of_birth"] = content_hits.pop("date")

    for t, r in content_hits.items():
        finding.evidence.append(f"{r:.0%} of sampled values match '{t}' pattern")

    types = sorted(set(header) | set(content_hits))
    direct = [t for t in types if t in DIRECT_TYPES or t == "date_of_birth"]
    finding.match_rate = round(max(content_hits.values(), default=0.0), 4)

    protected = (
        sum(1 for v in values if "***" in v or v.startswith("tok_") or v == "[REDACTED]") / len(values)
        if values
        else 0.0
    )
    if direct and not content_hits and protected >= 0.6:
        finding.category = "quasi_identifier"
        finding.pii_types = direct
        finding.confidence = 0.6
        finding.risk = "medium"
        finding.recommended_action = "keep"
        finding.evidence.append(
            f"{protected:.0%} of values look masked, pseudonymised or redacted; "
            "residual fragments may still help link records"
        )
    elif direct:
        finding.category = "direct_identifier"
        finding.pii_types = direct
        both = bool(set(header) & set(content_hits))
        finding.confidence = round(0.95 if both else (0.8 if content_hits else 0.6), 2)
        finding.risk = "high"
        finding.recommended_action = "mask" if any(t in ("email", "phone") for t in direct) else "suppress"
    elif any(h in lc for h in QUASI_HINTS) or "postal_code" in content_hits:
        finding.category = "quasi_identifier"
        finding.pii_types = ["postal_code"] if "postal_code" in content_hits or "zip" in lc else []
        finding.confidence = 0.7
        finding.risk = "medium"
        finding.recommended_action = "generalize"
        finding.evidence.append("may re-identify individuals when combined with other columns")
    elif any(h in lc for h in SENSITIVE_HINTS):
        finding.category = "sensitive_attribute"
        finding.confidence = 0.6
        finding.risk = "medium"
        finding.recommended_action = "keep"
        finding.evidence.append("column name suggests a sensitive attribute")
    elif not is_numeric and unique_ratio > 0.9 and n_nonnull > 20:
        finding.category = "direct_identifier"
        finding.pii_types = ["unique_identifier"]
        finding.confidence = 0.5
        finding.risk = "high"
        finding.recommended_action = "pseudonymize"
        finding.evidence.append(f"{unique_ratio:.0%} of values are unique (possible record key)")
    return finding


def k_anonymity(df: pd.DataFrame, quasi_identifiers: list[str]) -> dict[str, Any]:
    """Compute k-anonymity statistics over a set of quasi-identifiers.

    ``k`` is the size of the smallest equivalence class. Records in classes of size 1 are
    unique on the quasi-identifiers and therefore at high re-identification risk.
    """
    qi = [c for c in quasi_identifiers if c in df.columns]
    if not qi:
        return {
            "quasi_identifiers": [],
            "k": None,
            "unique_records": 0,
            "unique_pct": 0.0,
            "classes": 0,
            "class_size_distribution": [],
        }
    sizes = df.groupby(qi, dropna=False).size()
    per_record = df.groupby(qi, dropna=False)[qi[0]].transform("size")
    unique = int((per_record == 1).sum())
    buckets = [(1, 1), (2, 4), (5, 9), (10, 49), (50, None)]
    dist = []
    for lo, hi in buckets:
        mask = (per_record >= lo) if hi is None else ((per_record >= lo) & (per_record <= hi))
        dist.append(
            {
                "bucket": f"{lo}+" if hi is None else (f"{lo}" if lo == hi else f"{lo}-{hi}"),
                "records": int(mask.sum()),
            }
        )
    return {
        "quasi_identifiers": qi,
        "k": int(sizes.min()),
        "classes": len(sizes),
        "unique_records": unique,
        "unique_pct": round(100 * unique / len(df), 2),
        "class_size_distribution": dist,
    }


def scan(df: pd.DataFrame) -> dict[str, Any]:
    """Scan all columns and summarise dataset-level privacy risk."""
    findings = [detect_column(df[c]) for c in df.columns]
    direct = [f.column for f in findings if f.category == "direct_identifier"]
    quasi = [f.column for f in findings if f.category == "quasi_identifier"]
    sensitive = [f.column for f in findings if f.category == "sensitive_attribute"]
    kanon = k_anonymity(df, quasi)
    # Risk score in [0, 100]: direct identifiers dominate, then re-identifiability via QIs.
    score = min(100.0, (60.0 if direct else 0.0) + 0.4 * kanon["unique_pct"] + (5.0 if sensitive else 0.0))
    level = "high" if score >= 60 else ("medium" if score >= 25 else "low")
    return {
        "findings": [asdict(f) for f in findings],
        "summary": {
            "direct_identifiers": direct,
            "quasi_identifiers": quasi,
            "sensitive_attributes": sensitive,
            "risk_score": round(score, 1),
            "risk_level": level,
        },
        "k_anonymity": kanon,
        "disclaimer": (
            "Heuristic detection. Results can contain false positives and false negatives. "
            "Removing or masking direct identifiers does not by itself make data anonymous."
        ),
    }
