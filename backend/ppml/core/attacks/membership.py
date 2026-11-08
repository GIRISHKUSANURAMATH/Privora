"""Membership inference and model-leakage analysis.

Implemented attacks
-------------------
* **Loss threshold** (Yeom et al., 'Privacy Risk in Machine Learning', CSF 2018): predict
  "member" when the per-example loss is below a threshold.
* **Entropy threshold**: label-free variant using the entropy of the predicted distribution
  (Salem et al., 'ML-Leaks', NDSS 2019). A true-class confidence threshold is not reported
  separately because it ranks examples identically to the loss threshold.
* **Shadow models** (Shokri et al., 'Membership Inference Attacks Against ML Models', S&P 2017):
  train shadow models on attacker-held data from the same distribution, label their outputs
  in/out, and fit an attack classifier that is then applied to the target model.

Evaluation protocol: members are a random subset of the target's training set and
non-members an equally sized subset of held-out data (balanced prior, 50 % baseline).
Thresholds are chosen on a *calibration* half and reported on a disjoint *evaluation* half
to avoid optimistic bias. ROC-AUC and TPR at low FPR (Carlini et al., 'Membership Inference
Attacks From First Principles', S&P 2022) are computed on the evaluation half.

An *attack-implied ε* is also reported: ln((TPR_lo − δ) / FPR_hi) from Clopper–Pearson 95 %
intervals on the evaluation half. It is a **heuristic indicator only, not a valid DP audit**:
members and non-members come from a single training run, so the samples are not independent
trials of the mechanism that a statistically valid lower bound requires (that needs many
training runs, or one-run auditing with randomised canaries, Steinke et al. 2023). It also
depends on the specific attack: a weak attack can produce a small value for a non-private model.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
from scipy.stats import beta
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import roc_auc_score, roc_curve
from torch import nn

from ppml.core.ml.training import per_sample_loss, predict_proba


def _clopper_pearson(k: int, n: int, alpha: float = 0.05) -> tuple[float, float]:
    lo = 0.0 if k == 0 else float(beta.ppf(alpha / 2, k, n - k + 1))
    hi = 1.0 if k == n else float(beta.ppf(1 - alpha / 2, k + 1, n - k))
    return lo, hi


def _tpr_at_fpr(fpr: np.ndarray, tpr: np.ndarray, target: float) -> float:
    ok = fpr <= target
    return float(tpr[ok].max()) if ok.any() else 0.0


def _downsample_roc(fpr: np.ndarray, tpr: np.ndarray, k: int = 80) -> list[dict[str, float]]:
    if len(fpr) <= k:
        idx = np.arange(len(fpr))
    else:
        idx = np.unique(np.linspace(0, len(fpr) - 1, k).astype(int))
    return [{"fpr": float(fpr[i]), "tpr": float(tpr[i])} for i in idx]


def evaluate_scores(
    scores: np.ndarray, membership: np.ndarray, calib_mask: np.ndarray, delta: float = 1e-5
) -> dict[str, Any]:
    """Score → metrics. Higher score means 'more likely a member'."""
    cal_s, cal_m = scores[calib_mask], membership[calib_mask]
    ev_s, ev_m = scores[~calib_mask], membership[~calib_mask]
    # Threshold maximising balanced accuracy on the calibration half.
    cands = np.unique(np.quantile(cal_s, np.linspace(0, 1, 201)))
    best_t, best_acc = float(cands[0]), -1.0
    for t in cands:
        pred = cal_s >= t
        acc = 0.5 * (pred[cal_m == 1].mean() + (1 - pred[cal_m == 0]).mean())
        if acc > best_acc:
            best_acc, best_t = float(acc), float(t)
    pred = ev_s >= best_t
    tp = int((pred & (ev_m == 1)).sum())
    fp = int((pred & (ev_m == 0)).sum())
    fn = int((~pred & (ev_m == 1)).sum())
    tn = int((~pred & (ev_m == 0)).sum())
    pos, neg = tp + fn, fp + tn
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / pos if pos else 0.0
    fpr_pt = fp / neg if neg else 0.0
    auc = float(roc_auc_score(ev_m, ev_s)) if len(np.unique(ev_m)) == 2 else None
    fpr, tpr, _ = roc_curve(ev_m, ev_s)
    tpr_lo, _ = _clopper_pearson(tp, pos)
    _, fpr_hi = _clopper_pearson(fp, neg)
    eps_lb = 0.0
    if fpr_hi > 0 and tpr_lo - delta > fpr_hi:
        eps_lb = math.log((tpr_lo - delta) / fpr_hi)
    # Symmetric bound using the complementary (non-member) direction.
    tnr_lo, _ = _clopper_pearson(tn, neg)
    _, fnr_hi = _clopper_pearson(fn, pos)
    if fnr_hi > 0 and tnr_lo - delta > fnr_hi:
        eps_lb = max(eps_lb, math.log((tnr_lo - delta) / fnr_hi))
    return {
        "accuracy": (tp + tn) / max(1, pos + neg),
        "balanced_accuracy": 0.5 * (recall + (tn / neg if neg else 0.0)),
        "precision": precision,
        "recall": recall,
        "fpr": fpr_pt,
        "roc_auc": auc,
        "advantage": recall - fpr_pt,  # Yeom et al. membership advantage = TPR − FPR
        "tpr_at_1pct_fpr": _tpr_at_fpr(fpr, tpr, 0.01),
        "tpr_at_10pct_fpr": _tpr_at_fpr(fpr, tpr, 0.10),
        "threshold": best_t,
        "roc": _downsample_roc(fpr, tpr),
        "attack_implied_epsilon": eps_lb,
        "n_eval": int(pos + neg),
    }


def _features_for_attack(probs: np.ndarray, y: np.ndarray) -> np.ndarray:
    true_conf = probs[np.arange(len(y)), y]
    sorted_p = -np.sort(-probs, axis=1)
    loss = per_sample_loss(probs, y)
    ent = -(probs * np.log(np.clip(probs, 1e-12, 1))).sum(1)
    return np.column_stack([true_conf, loss, ent, sorted_p])


def membership_inference(
    target: nn.Module,
    X_member: np.ndarray,
    y_member: np.ndarray,
    X_nonmember: np.ndarray,
    y_nonmember: np.ndarray,
    shadow_trainer: Callable[[np.ndarray, np.ndarray, int], nn.Module] | None = None,
    X_shadow: np.ndarray | None = None,
    y_shadow: np.ndarray | None = None,
    n_shadow: int = 4,
    max_eval: int = 1000,
    seed: int = 0,
    delta: float = 1e-5,
) -> dict[str, Any]:
    """Run all attacks against ``target`` and return metrics plus distributions."""
    rng = np.random.default_rng(seed)
    m = min(len(y_member), len(y_nonmember), max_eval // 2)
    mi = rng.choice(len(y_member), m, replace=False)
    ni = rng.choice(len(y_nonmember), m, replace=False)
    X = np.vstack([X_member[mi], X_nonmember[ni]])
    y = np.concatenate([y_member[mi], y_nonmember[ni]])
    membership = np.concatenate([np.ones(m, int), np.zeros(m, int)])
    calib = np.zeros(2 * m, bool)
    calib[rng.permutation(2 * m)[:m]] = True

    probs = predict_proba(target, X)
    loss = per_sample_loss(probs, y)
    conf = probs[np.arange(len(y)), y]
    entropy = -(probs * np.log(np.clip(probs, 1e-12, 1))).sum(1)
    attacks: dict[str, Any] = {
        # Uses the true label. (A true-class confidence threshold would rank identically,
        # since loss = -log(confidence), so it is not reported separately.)
        "loss_threshold": evaluate_scores(-loss, membership, calib, delta),
        # Label-free: members tend to receive more confident (lower-entropy) predictions.
        "entropy_threshold": evaluate_scores(-entropy, membership, calib, delta),
    }

    if shadow_trainer is not None and X_shadow is not None and y_shadow is not None:
        feats, labels = [], []
        per = len(y_shadow) // (2 * n_shadow)
        if per >= 20:
            for s in range(n_shadow):
                idx = rng.permutation(len(y_shadow))
                tin, tout = idx[:per], idx[per : 2 * per]
                sm = shadow_trainer(X_shadow[tin], y_shadow[tin], seed + 101 + s)
                for part, lab in ((tin, 1), (tout, 0)):
                    p = predict_proba(sm, X_shadow[part])
                    feats.append(_features_for_attack(p, y_shadow[part]))
                    labels.append(np.full(len(part), lab))
            clf = GradientBoostingClassifier(random_state=seed, n_estimators=150, max_depth=3)
            clf.fit(np.vstack(feats), np.concatenate(labels))
            shadow_scores = clf.predict_proba(_features_for_attack(probs, y))[:, 1]
            attacks["shadow_model"] = evaluate_scores(shadow_scores, membership, calib, delta)
            attacks["shadow_model"]["n_shadow_models"] = n_shadow
            attacks["shadow_model"]["shadow_train_size"] = per

    bins = np.linspace(0, 1, 21)
    hist_in, _ = np.histogram(conf[membership == 1], bins=bins)
    hist_out, _ = np.histogram(conf[membership == 0], bins=bins)
    lbins = np.linspace(0, float(np.quantile(loss, 0.99)) + 1e-6, 21)
    lin, _ = np.histogram(np.clip(loss[membership == 1], 0, lbins[-1]), bins=lbins)
    lout, _ = np.histogram(np.clip(loss[membership == 0], 0, lbins[-1]), bins=lbins)
    best = max(attacks.values(), key=lambda a: a["roc_auc"] or 0)
    return {
        "attacks": attacks,
        "best_attack_auc": best["roc_auc"],
        "max_attack_implied_epsilon": max(a["attack_implied_epsilon"] for a in attacks.values()),
        "confidence_hist": {
            "bins": bins.tolist(),
            "members": hist_in.tolist(),
            "non_members": hist_out.tolist(),
        },
        "loss_hist": {"bins": lbins.tolist(), "members": lin.tolist(), "non_members": lout.tolist()},
        "mean_confidence": {
            "members": float(conf[membership == 1].mean()),
            "non_members": float(conf[membership == 0].mean()),
        },
        "mean_loss": {
            "members": float(loss[membership == 1].mean()),
            "non_members": float(loss[membership == 0].mean()),
        },
        "n_members": int(m),
        "n_non_members": int(m),
    }


def leakage_indicators(
    train_metrics: dict[str, Any], test_metrics: dict[str, Any], mia: dict[str, Any]
) -> dict[str, Any]:
    """Summarise leakage signals: generalisation gap, confidence gap, attack advantage."""
    gap = train_metrics["accuracy"] - test_metrics["accuracy"]
    loss_ratio = test_metrics["loss"] / max(1e-9, train_metrics["loss"])
    conf_gap = mia["mean_confidence"]["members"] - mia["mean_confidence"]["non_members"]
    adv = max(a["advantage"] for a in mia["attacks"].values())
    auc = mia["best_attack_auc"] or 0.5
    level = "high" if auc >= 0.65 else ("moderate" if auc >= 0.56 else "low")
    return {
        "generalization_gap": gap,
        "train_accuracy": train_metrics["accuracy"],
        "test_accuracy": test_metrics["accuracy"],
        "loss_ratio_test_over_train": loss_ratio,
        "confidence_gap": conf_gap,
        "max_membership_advantage": adv,
        "best_attack_auc": auc,
        "leakage_level": level,
    }


def attribute_inference(
    model: nn.Module,
    X: np.ndarray,
    y: np.ndarray,
    attr_cols: list[int],
    seed: int = 0,
    max_n: int = 600,
) -> dict[str, Any]:
    """Model-inversion style attribute inference (Fredrikson et al., CCS 2015).

    The adversary knows every feature except a one-hot encoded categorical attribute plus the
    true label, tries each candidate value, and picks the one that maximises the model's
    confidence in the true label. Accuracy above the majority-class baseline indicates the
    model leaks information about that attribute.
    """
    rng = np.random.default_rng(seed)
    if len(y) > max_n:
        idx = rng.choice(len(y), max_n, replace=False)
        X, y = X[idx], y[idx]
    truth = X[:, attr_cols].argmax(1)
    scores = np.zeros((len(y), len(attr_cols)))
    for j in range(len(attr_cols)):
        Xc = X.copy()
        Xc[:, attr_cols] = 0.0
        Xc[:, attr_cols[j]] = 1.0
        scores[:, j] = predict_proba(model, Xc)[np.arange(len(y)), y]
    guess = scores.argmax(1)
    acc = float((guess == truth).mean())
    baseline = float(np.max(np.bincount(truth, minlength=len(attr_cols)))) / len(truth)
    return {"accuracy": acc, "baseline": baseline, "advantage": acc - baseline, "n": len(y)}
