"""Dataset loading, validation, profiling, PII detection and transforms."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from ppml.core.data.loader import (
    DatasetValidationError,
    ValidationLimits,
    neutralize_formulas,
    parse_tabular,
    profile,
    sanitize_filename,
    to_safe_csv,
)
from ppml.core.data.pii import detect_column, k_anonymity, scan
from ppml.core.data.preprocessing import TabularEncoder, prepare
from ppml.core.data.synthetic import generate, generate_credit, generate_patients
from ppml.core.data.transforms import ColumnRule, apply_rules, recommended_rules

LIMITS = ValidationLimits(max_bytes=1_000_000, max_rows=10_000, max_columns=50)


def _csv(rows: int = 20) -> bytes:
    lines = ["a,b,c"] + [f"{i},{i * 2},x{i}" for i in range(rows)]
    return "\n".join(lines).encode()


# ------------------------------------------------------------------ synthetic data
def test_synthetic_is_deterministic() -> None:
    a, b = generate_patients(300, seed=1), generate_patients(300, seed=1)
    pd.testing.assert_frame_equal(a, b)
    assert not a.equals(generate_patients(300, seed=2))


def test_synthetic_uses_reserved_fictional_ranges() -> None:
    df = generate_patients(400)
    assert df["email"].str.contains(r"@(?:mail\.)?example\.(?:com|org)$").all()
    assert df["phone"].str.contains(r"-555-01\d\d$").all()
    assert df["high_risk"].isin([0, 1]).all()
    assert 0.1 < df["high_risk"].mean() < 0.9
    credit = generate_credit(400)
    assert credit["last_login_ip"].str.startswith("192.0.2.").all()


def test_synthetic_rejects_bad_args() -> None:
    with pytest.raises(ValueError):
        generate("nope")
    with pytest.raises(ValueError):
        generate("patients", n=10)


# ------------------------------------------------------------------ loading and validation
def test_parse_valid_csv_and_semicolon() -> None:
    df = parse_tabular(_csv(), "data.csv", LIMITS)
    assert df.shape == (20, 3)
    semi = _csv().replace(b",", b";")
    assert parse_tabular(semi, "data.csv", LIMITS).shape == (20, 3)


@pytest.mark.parametrize(
    ("content", "name", "msg"),
    [
        (b"", "x.csv", "empty"),
        (b"a,b\n1,2\n", "x.exe", "Unsupported file type"),
        (b"\x00\x01\x02binary", "x.csv", "binary"),
        (b"a,b\n" + "é,1\n".encode("latin-1") * 20, "x.csv", "UTF-8"),
        (b"a\n" + b"1\n" * 20, "x.csv", "two columns"),
        (b"a,b\n1,2\n", "x.csv", "at least 10 rows"),
    ],
)
def test_parse_rejects_invalid(content: bytes, name: str, msg: str) -> None:
    with pytest.raises(DatasetValidationError, match=msg):
        parse_tabular(content, name, LIMITS)


def test_parse_enforces_limits() -> None:
    with pytest.raises(DatasetValidationError, match="limit"):
        parse_tabular(_csv(500), "x.csv", ValidationLimits(100, 10_000, 50))
    with pytest.raises(DatasetValidationError, match="Too many rows"):
        parse_tabular(_csv(500), "x.csv", ValidationLimits(10**6, 100, 50))
    with pytest.raises(DatasetValidationError, match="Too many columns"):
        parse_tabular(_csv(), "x.csv", ValidationLimits(10**6, 100, 2))


def test_duplicate_and_messy_headers_are_sanitized() -> None:
    raw = b"name,name, weird col!,\n" + b"a,b,c,d\n" * 12
    df = parse_tabular(raw, "x.csv", LIMITS)
    assert len(set(df.columns)) == 4


def test_sanitize_filename_strips_paths() -> None:
    assert sanitize_filename("../../etc/passwd") == "passwd"
    assert sanitize_filename("C:\\Users\\x\\evil<>.csv") == "evil_.csv"
    assert sanitize_filename("") == "dataset.csv"


def test_csv_injection_is_neutralised() -> None:
    df = pd.DataFrame({"a": ["=cmd|' /C calc'!A0", "+1", "safe", "@SUM(1)"], "b": [1, 2, 3, 4]})
    out = neutralize_formulas(df)
    assert out["a"].tolist() == ["'=cmd|' /C calc'!A0", "'+1", "safe", "'@SUM(1)"]
    assert b"'=cmd" in to_safe_csv(df)


def test_profile_reports_quality(patients: pd.DataFrame) -> None:
    p = profile(patients)
    assert p["rows"] == len(patients)
    assert p["duplicate_rows"] > 0
    assert p["missing_cells"] > 0
    chol = next(c for c in p["column_stats"] if c["name"] == "cholesterol")
    assert chol["kind"] == "numeric" and chol["missing"] > 0 and "histogram" in chol
    assert 0 < p["quality"]["score"] <= 100


# ------------------------------------------------------------------ PII
def test_pii_detects_direct_identifiers(patients: pd.DataFrame) -> None:
    res = scan(patients.drop(columns=["high_risk"]))
    direct = set(res["summary"]["direct_identifiers"])
    assert {"full_name", "email", "phone", "national_id"} <= direct
    assert "age" in res["summary"]["quasi_identifiers"]
    assert "zip_code" in res["summary"]["quasi_identifiers"]
    assert "bmi" not in direct
    assert res["summary"]["risk_level"] == "high"


def test_email_detected_by_content_alone() -> None:
    s = pd.Series([f"user{i}@example.com" for i in range(50)], name="col_x")
    f = detect_column(s)
    assert f.category == "direct_identifier" and "email" in f.pii_types


def test_credit_card_requires_luhn() -> None:
    valid = pd.Series(["4111 1111 1111 1111"] * 30, name="v")
    invalid = pd.Series(["4111 1111 1111 1112"] * 30, name="v")
    assert "credit_card" in detect_column(valid).pii_types
    assert "credit_card" not in detect_column(invalid).pii_types


def test_numeric_measurement_not_flagged() -> None:
    s = pd.Series(np.random.default_rng(0).normal(100, 10, 200), name="measurement")
    assert detect_column(s).category == "non_sensitive"


def test_k_anonymity() -> None:
    df = pd.DataFrame({"age": [30, 30, 30, 40, 40, 50], "zip": ["1", "1", "1", "2", "2", "3"]})
    k = k_anonymity(df, ["age", "zip"])
    assert k["k"] == 1 and k["unique_records"] == 1 and k["classes"] == 3


# ------------------------------------------------------------------ transforms
def test_transforms_apply_and_report(patients: pd.DataFrame) -> None:
    rules = [
        ColumnRule(column="email", action="mask"),
        ColumnRule(column="full_name", action="suppress"),
        ColumnRule(column="national_id", action="redact"),
        ColumnRule(column="phone", action="pseudonymize"),
        ColumnRule(column="zip_code", action="generalize", keep_chars=2),
        ColumnRule(column="age", action="generalize", bin_width=10),
    ]
    res = apply_rules(patients, rules, ["age", "zip_code", "gender"], pseudonym_key=b"k" * 32)
    out = res.data
    assert "full_name" not in out.columns
    assert out["email"].str.contains(r"^\w\*\*\*@").all()
    assert (out["national_id"] == "[REDACTED]").all()
    assert out["phone"].str.startswith("tok_").all()
    # Same input → same token with the same key (joins still work).
    again = apply_rules(patients, rules, pseudonym_key=b"k" * 32).data
    assert (again["phone"] == out["phone"]).all()
    assert out["zip_code"].str.match(r"^\d\d\*\*\*$").all()
    assert out["age"].str.match(r"^\d+-\d+$").all()
    rep = res.report
    assert rep["k_anonymity_after"]["k"] >= rep["k_anonymity_before"]["k"]
    assert rep["k_anonymity_after"]["unique_pct"] <= rep["k_anonymity_before"]["unique_pct"]
    assert len(rep["sample_before"]) == len(rep["sample_after"]) == 8


def test_local_dp_numeric_and_categorical(patients: pd.DataFrame) -> None:
    rules = [
        ColumnRule(column="bmi", action="local_dp", epsilon=1.0, lower=15, upper=50),
        ColumnRule(column="smoker", action="local_dp", epsilon=1.0),
    ]
    res = apply_rules(patients, rules, seed=1)
    meta = {a["column"]: a for a in res.report["applied"]}
    assert meta["bmi"]["mechanism"] == "laplace" and meta["bmi"]["sensitivity"] == 35
    assert meta["smoker"]["mechanism"] == "randomized_response"
    # p_truthful = e^ε / (e^ε + k − 1) for k = 3
    assert meta["smoker"]["p_truthful"] == pytest.approx(np.e / (np.e + 2), abs=1e-3)
    changed = (res.data["smoker"] != patients["smoker"]).mean()
    assert 0.3 < changed < 0.6  # ≈ 1 − 0.576
    assert res.data["smoker"].isin(["never", "former", "current"]).all()


def test_unknown_column_rejected(patients: pd.DataFrame) -> None:
    with pytest.raises(ValueError, match="Unknown columns"):
        apply_rules(patients, [ColumnRule(column="nope", action="mask")])


def test_recommended_rules(patients: pd.DataFrame) -> None:
    rules = recommended_rules(scan(patients))
    acts = {r.column: r.action for r in rules}
    assert acts["email"] == "mask" and acts["national_id"] == "suppress"


# ------------------------------------------------------------------ preprocessing
def test_prepare_excludes_pii_and_fits_on_train_only(patients: pd.DataFrame) -> None:
    p = prepare(patients, "high_risk", seed=0)
    assert not {"full_name", "email", "phone", "national_id"} & set(p.features_used)
    assert p.X_train.shape[1] == p.encoder.n_features
    assert np.isfinite(p.X_train).all() and np.isfinite(p.X_test).all()
    assert len(p.y_train) + len(p.y_test) == len(patients)
    enc = TabularEncoder.from_dict(p.encoder.to_dict())
    np.testing.assert_allclose(enc.transform(patients.iloc[:5]), p.encoder.transform(patients.iloc[:5]))


def test_prepare_bad_target(patients: pd.DataFrame) -> None:
    with pytest.raises(ValueError):
        prepare(patients, "missing_column")
    with pytest.raises(ValueError, match="two classes"):
        prepare(patients.assign(c=1), "c")


def test_masked_identifier_is_downgraded(patients: pd.DataFrame) -> None:
    masked = apply_rules(patients, [ColumnRule(column="email", action="mask")]).data
    f = detect_column(masked["email"])
    assert f.category == "quasi_identifier" and f.risk == "medium"
    assert any("masked" in e for e in f.evidence)
    # Unmasked e-mails are still direct identifiers.
    assert detect_column(patients["email"]).category == "direct_identifier"
