"""Feature encoding for tabular classification with JSON-serialisable state.

Numeric columns: median imputation + standardisation (clipped to ±5σ to bound inputs).
Categorical columns: top-K one-hot encoding with an ``__other__`` bucket.

Privacy note: the encoder statistics (medians, means, standard deviations, category lists)
are computed directly from the training data **without** differential privacy. The DP
guarantee reported by the DP engine covers the model parameters, conditional on these
preprocessing statistics being treated as public. See ``docs/PRIVACY_METHODOLOGY.md``.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from ppml.core.data.pii import scan


@dataclass
class TabularEncoder:
    target: str
    numeric: list[str] = field(default_factory=list)
    categorical: list[str] = field(default_factory=list)
    medians: dict[str, float] = field(default_factory=dict)
    means: dict[str, float] = field(default_factory=dict)
    stds: dict[str, float] = field(default_factory=dict)
    categories: dict[str, list[str]] = field(default_factory=dict)
    classes: list[str] = field(default_factory=list)
    max_categories: int = 20

    @property
    def feature_names(self) -> list[str]:
        names = list(self.numeric)
        for c in self.categorical:
            names += [f"{c}={v}" for v in self.categories[c]] + [f"{c}=__other__"]
        return names

    @property
    def n_features(self) -> int:
        return len(self.feature_names)

    def fit(self, df: pd.DataFrame, features: list[str]) -> TabularEncoder:
        y = df[self.target]
        self.classes = sorted(y.dropna().astype(str).unique().tolist())
        if len(self.classes) < 2:
            raise ValueError(f"Target '{self.target}' needs at least two classes.")
        if len(self.classes) > 20:
            raise ValueError(f"Target '{self.target}' has {len(self.classes)} classes; max is 20.")
        for c in features:
            s = df[c]
            if pd.api.types.is_numeric_dtype(s) and not pd.api.types.is_bool_dtype(s):
                self.numeric.append(c)
                med = float(s.median()) if s.notna().any() else 0.0
                filled = s.fillna(med).astype(float)
                self.medians[c] = med
                self.means[c] = float(filled.mean())
                self.stds[c] = float(filled.std()) or 1.0
            else:
                self.categorical.append(c)
                vc = s.astype("string").fillna("__missing__").value_counts()
                self.categories[c] = [str(v) for v in vc.index[: self.max_categories]]
        if not self.numeric and not self.categorical:
            raise ValueError("No usable feature columns.")
        return self

    def transform(self, df: pd.DataFrame) -> np.ndarray:
        parts: list[np.ndarray] = []
        for c in self.numeric:
            v = pd.to_numeric(df[c], errors="coerce").fillna(self.medians[c]).astype(float).to_numpy()
            parts.append(np.clip((v - self.means[c]) / self.stds[c], -5, 5)[:, None])
        for c in self.categorical:
            cats = self.categories[c]
            idx = {v: i for i, v in enumerate(cats)}
            vals = df[c].astype("string").fillna("__missing__")
            mat = np.zeros((len(df), len(cats) + 1), dtype=np.float32)
            pos = np.array([idx.get(str(v), len(cats)) for v in vals])
            mat[np.arange(len(df)), pos] = 1.0
            parts.append(mat)
        return np.hstack(parts).astype(np.float32)

    def transform_target(self, df: pd.DataFrame) -> np.ndarray:
        idx = {v: i for i, v in enumerate(self.classes)}
        y = df[self.target].astype(str).map(idx)
        if y.isna().any():
            raise ValueError("Target contains unseen or missing labels.")
        return y.to_numpy(dtype=np.int64)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> TabularEncoder:
        return cls(**d)


@dataclass
class PreparedData:
    encoder: TabularEncoder
    X_train: np.ndarray
    y_train: np.ndarray
    X_test: np.ndarray
    y_test: np.ndarray
    features_used: list[str]
    excluded: list[str]


def select_features(
    df: pd.DataFrame, target: str, exclude: list[str] | None = None, auto_exclude_pii: bool = True
) -> tuple[list[str], list[str]]:
    """Choose feature columns, excluding the target, user exclusions and direct identifiers."""
    if target not in df.columns:
        raise ValueError(f"Target column '{target}' not found.")
    excluded = set(exclude or [])
    if auto_exclude_pii:
        result = scan(df.drop(columns=[target]))
        excluded |= set(result["summary"]["direct_identifiers"])
    # High-cardinality free-text columns are not useful features.
    for c in df.columns:
        if c == target or c in excluded:
            continue
        s = df[c]
        if not pd.api.types.is_numeric_dtype(s) and s.nunique() > 200:
            excluded.add(c)
    features = [c for c in df.columns if c != target and c not in excluded]
    return features, sorted(excluded)


def prepare(
    df: pd.DataFrame,
    target: str,
    exclude: list[str] | None = None,
    test_size: float = 0.3,
    seed: int = 42,
    auto_exclude_pii: bool = True,
    max_train_rows: int | None = None,
) -> PreparedData:
    """Split, fit the encoder on the training split only, and encode both splits."""
    if target not in df.columns:
        raise ValueError(f"Target column '{target}' not found.")
    df = df.dropna(subset=[target]).reset_index(drop=True)
    features, excluded = select_features(df, target, exclude, auto_exclude_pii)
    rng = np.random.default_rng(seed)
    perm = rng.permutation(len(df))
    n_test = round(len(df) * test_size)
    test_idx, train_idx = perm[:n_test], perm[n_test:]
    if max_train_rows is not None:
        train_idx = train_idx[:max_train_rows]
    train, test = df.iloc[train_idx], df.iloc[test_idx]
    enc = TabularEncoder(target=target).fit(train, features)
    return PreparedData(
        encoder=enc,
        X_train=enc.transform(train),
        y_train=enc.transform_target(train),
        X_test=enc.transform(test),
        y_test=enc.transform_target(test),
        features_used=features,
        excluded=excluded,
    )
