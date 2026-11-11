"""Deterministic synthetic datasets for demonstrations and tests.

All personal data produced here is *fictional*:

* e-mail domains use ``example.com`` / ``example.org`` (reserved by RFC 2606),
* phone numbers use the ``555-01xx`` range reserved for fiction in the NANP,
* national IDs use an invented ``NID-`` format that matches no real scheme,
* names are drawn from a small generic list and combined at random.

The label is generated from a known logistic model of the non-identifying features, so
models can learn a real signal while the identifier columns carry no predictive value.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

FIRST = [
    "Aarav",
    "Maya",
    "Liam",
    "Sofia",
    "Noah",
    "Ananya",
    "Ethan",
    "Zara",
    "Lucas",
    "Isha",
    "Mateo",
    "Chloe",
    "Arjun",
    "Emma",
    "Kai",
    "Priya",
    "Leo",
    "Amara",
    "Omar",
    "Nina",
    "Ravi",
    "Hana",
    "Diego",
    "Lena",
    "Yusuf",
    "Mira",
    "Jonas",
    "Aisha",
    "Theo",
    "Kavya",
]
LAST = [
    "Sharma",
    "Garcia",
    "Chen",
    "Okafor",
    "Silva",
    "Novak",
    "Patel",
    "Kim",
    "Rossi",
    "Haddad",
    "Müller",
    "Iyer",
    "Nakamura",
    "Johansson",
    "Mensah",
    "Costa",
    "Reddy",
    "Dubois",
    "Khan",
    "Ivanova",
    "Lopez",
    "Nair",
    "Fischer",
    "Tanaka",
    "Adeyemi",
    "Moreau",
    "Rao",
    "Weber",
]
CITIES = ["Northbridge", "Lakeview", "Eastport", "Riverton", "Fairhaven", "Westfield", "Oakmont"]


@dataclass(frozen=True)
class SyntheticSpec:
    key: str
    title: str
    description: str
    target: str


SPECS: dict[str, SyntheticSpec] = {
    "patients": SyntheticSpec(
        key="patients",
        title="Synthetic Patient Risk",
        description=(
            "Fictional patient records with direct identifiers (name, e-mail, phone, national ID), "
            "quasi-identifiers (age, ZIP, gender, city) and a binary cardiovascular-risk label."
        ),
        target="high_risk",
    ),
    "credit": SyntheticSpec(
        key="credit",
        title="Synthetic Credit Default",
        description=(
            "Fictional loan applicants with contact details, income and credit features and a "
            "binary default label."
        ),
        target="default",
    ),
}


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def _contacts(rng: np.random.Generator, n: int) -> pd.DataFrame:
    first = rng.choice(FIRST, n)
    last = rng.choice(LAST, n)
    names = [f"{f} {lname}" for f, lname in zip(first, last, strict=True)]
    domains = rng.choice(["example.com", "example.org", "mail.example.com"], n)
    emails = [
        f"{f.lower()}.{lname.lower().replace('ü', 'u')}{i % 97}@{d}"
        for i, (f, lname, d) in enumerate(zip(first, last, domains, strict=True))
    ]
    phones = [f"+1-{rng.integers(200, 999)}-555-01{rng.integers(0, 100):02d}" for _ in range(n)]
    nids = [f"NID-{rng.integers(1000, 9999)}-{rng.integers(1000, 9999)}" for _ in range(n)]
    return pd.DataFrame({"full_name": names, "email": emails, "phone": phones, "national_id": nids})


def generate_patients(n: int = 4000, seed: int = 7) -> pd.DataFrame:
    """Generate the synthetic patient-risk dataset."""
    rng = np.random.default_rng(seed)
    df = _contacts(rng, n)
    age = rng.integers(18, 90, n)
    gender = rng.choice(["female", "male", "nonbinary"], n, p=[0.49, 0.49, 0.02])
    zip_code = rng.choice([f"{z:05d}" for z in rng.integers(10000, 99999, 60)], n)
    city = rng.choice(CITIES, n)
    bmi = np.clip(rng.normal(27, 5, n), 15, 50).round(1)
    systolic = np.clip(rng.normal(122 + 0.35 * (age - 45), 15, n), 85, 210).round(0)
    cholesterol = np.clip(rng.normal(195 + 0.5 * (age - 45), 35, n), 110, 340).round(0)
    smoker = rng.choice(["never", "former", "current"], n, p=[0.6, 0.25, 0.15])
    exercise = np.clip(rng.gamma(2.0, 1.6, n), 0, 20).round(1)
    glucose = np.clip(rng.normal(98 + 0.25 * (bmi - 27) * 3, 18, n), 60, 260).round(0)
    income = np.clip(rng.lognormal(10.9, 0.5, n), 9000, 400000).round(-2)
    smoke_w = np.select([smoker == "current", smoker == "former"], [1.1, 0.4], 0.0)
    logit = (
        -1.0
        + 0.045 * (age - 50)
        + 0.06 * (bmi - 27)
        + 0.025 * (systolic - 125)
        + 0.008 * (cholesterol - 200)
        + 0.015 * (glucose - 100)
        - 0.12 * (exercise - 3)
        + smoke_w
        + rng.normal(0, 0.8, n)
    )
    label = (rng.random(n) < _sigmoid(logit)).astype(int)
    df = df.assign(
        age=age,
        gender=gender,
        zip_code=zip_code,
        city=city,
        bmi=bmi,
        systolic_bp=systolic,
        cholesterol=cholesterol,
        glucose=glucose,
        smoker=smoker,
        exercise_hours=exercise,
        annual_income=income,
        high_risk=label,
    )
    # Inject a small amount of realistic messiness for the data-quality tooling.
    miss = rng.random(n) < 0.03
    df.loc[miss, "cholesterol"] = np.nan
    miss2 = rng.random(n) < 0.02
    df.loc[miss2, "exercise_hours"] = np.nan
    dup_idx = rng.choice(n, size=max(1, n // 200), replace=False)
    df = pd.concat([df, df.iloc[dup_idx]], ignore_index=True)
    return df


def generate_credit(n: int = 4000, seed: int = 11) -> pd.DataFrame:
    """Generate the synthetic credit-default dataset."""
    rng = np.random.default_rng(seed)
    df = _contacts(rng, n)
    age = rng.integers(21, 75, n)
    income = np.clip(rng.lognormal(10.8, 0.55, n), 8000, 500000).round(-2)
    loan = np.clip(income * rng.uniform(0.05, 0.9, n), 500, 300000).round(-2)
    credit_score = np.clip(rng.normal(680, 70, n), 300, 850).round(0)
    utilization = np.clip(rng.beta(2, 4, n), 0, 1).round(3)
    late = rng.poisson(0.6, n)
    employment = rng.choice(
        ["salaried", "self_employed", "unemployed", "student"], n, p=[0.62, 0.22, 0.08, 0.08]
    )
    ip = [f"192.0.2.{rng.integers(1, 255)}" for _ in range(n)]  # TEST-NET-1 (RFC 5737)
    emp_w = np.select([employment == "unemployed", employment == "student"], [1.0, 0.4], 0.0)
    logit = (
        -1.2
        - 0.012 * (credit_score - 680)
        + 2.2 * (utilization - 0.33)
        + 0.45 * late
        + 1.4 * (loan / income - 0.45)
        + emp_w
        - 0.01 * (age - 40)
        + rng.normal(0, 0.7, n)
    )
    label = (rng.random(n) < _sigmoid(logit)).astype(int)
    return df.assign(
        last_login_ip=ip,
        age=age,
        employment=employment,
        annual_income=income,
        loan_amount=loan,
        credit_score=credit_score,
        utilization=utilization,
        late_payments=late,
        default=label,
    )


GENERATORS = {"patients": generate_patients, "credit": generate_credit}


def generate(key: str, n: int = 4000, seed: int | None = None) -> pd.DataFrame:
    """Generate a synthetic dataset by key."""
    if key not in GENERATORS:
        raise ValueError(f"Unknown synthetic dataset '{key}'. Options: {sorted(GENERATORS)}")
    if not 200 <= n <= 100_000:
        raise ValueError("n must be between 200 and 100000")
    gen = GENERATORS[key]
    return gen(n) if seed is None else gen(n, seed)
