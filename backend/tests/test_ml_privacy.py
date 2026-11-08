"""Training, DP-SGD, accounting, federated learning, attacks and artifacts."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import torch

from ppml.core.attacks.membership import attribute_inference, evaluate_scores, membership_inference
from ppml.core.data.preprocessing import PreparedData, prepare
from ppml.core.federated.fedavg import FedConfig, partition, run_fedavg
from ppml.core.ml.artifacts import load_model, safe_artifact_dir, save_model
from ppml.core.ml.models import build_model
from ppml.core.ml.training import TrainConfig, evaluate, train_standard
from ppml.core.privacy.accounting import calculator, epsilon_for, noise_for_target
from ppml.core.privacy.dp import DPConfig, train_dp


@pytest.fixture(scope="module")
def data(patients: pd.DataFrame) -> PreparedData:
    return prepare(patients, "high_risk", seed=0)


def _model(p: PreparedData, hidden: tuple[int, ...] = (32,)) -> torch.nn.Module:
    torch.manual_seed(0)
    return build_model(p.encoder.n_features, len(p.encoder.classes), hidden)


# ------------------------------------------------------------------ conventional
def test_standard_training_learns(data: PreparedData) -> None:
    m, hist, secs = train_standard(
        _model(data),
        data.X_train,
        data.y_train,
        data.X_test,
        data.y_test,
        TrainConfig(epochs=8, batch_size=64, lr=3e-3),
    )
    met = evaluate(m, data.X_test, data.y_test)
    majority = max(np.bincount(data.y_test)) / len(data.y_test)
    assert met["accuracy"] > majority + 0.05
    assert 0.5 < met["roc_auc"] <= 1
    assert hist.train_loss[-1] < hist.train_loss[0]
    assert secs > 0 and len(hist.epoch) == 8


def test_training_is_reproducible(data: PreparedData) -> None:
    cfg = TrainConfig(epochs=2, seed=5)
    a = train_standard(_model(data), data.X_train, data.y_train, data.X_test, data.y_test, cfg)[0]
    b = train_standard(_model(data), data.X_train, data.y_train, data.X_test, data.y_test, cfg)[0]
    for pa, pb in zip(a.parameters(), b.parameters(), strict=True):
        assert torch.equal(pa, pb)


def test_training_can_be_cancelled(data: PreparedData) -> None:
    with pytest.raises(InterruptedError):
        train_standard(
            _model(data),
            data.X_train,
            data.y_train,
            data.X_test,
            data.y_test,
            TrainConfig(epochs=3),
            should_stop=lambda: True,
        )


# ------------------------------------------------------------------ accounting
def test_epsilon_monotonic() -> None:
    e1 = epsilon_for(1.0, 0.01, 100, 1e-5)
    e2 = epsilon_for(1.0, 0.01, 1000, 1e-5)
    e3 = epsilon_for(2.0, 0.01, 1000, 1e-5)
    assert 0 < e1 < e2  # composition: more steps, more privacy loss
    assert e3 < e2  # more noise, less privacy loss


def test_noise_search_hits_target() -> None:
    sigma = noise_for_target(2.0, 1e-5, 0.02, 500)
    eps = epsilon_for(sigma, 0.02, 500, 1e-5)
    assert eps <= 2.0 + 1e-6 and eps > 1.9


def test_prv_tighter_or_equal_rdp() -> None:
    rdp = epsilon_for(1.1, 0.01, 2000, 1e-5, "rdp")
    prv = epsilon_for(1.1, 0.01, 2000, 1e-5, "prv")
    assert prv <= rdp + 1e-6


def test_known_reference_value() -> None:
    """Regression pin for q=0.01, σ=1.1, 6000 steps, δ=1e-5 (MNIST-style DP-SGD setting).

    Opacus 1.6 RDP gives ε ≈ 4.25 and PRV ε ≈ 3.91 for these parameters (values recorded when the
    test was written). A large change means the accountant or its inputs changed.
    """
    assert epsilon_for(1.1, 0.01, 6000, 1e-5, "rdp") == pytest.approx(4.2466, abs=0.05)
    assert epsilon_for(1.1, 0.01, 6000, 1e-5, "prv") == pytest.approx(3.9100, abs=0.05)


@pytest.mark.parametrize(
    "bad", [{"noise_multiplier": 0}, {"sample_rate": 0}, {"sample_rate": 1.5}, {"steps": 0}, {"delta": 1}]
)
def test_accounting_validation(bad: dict[str, float]) -> None:
    args = {"noise_multiplier": 1.0, "sample_rate": 0.1, "steps": 10, "delta": 1e-5} | bad
    with pytest.raises(ValueError):
        epsilon_for(**args)  # type: ignore[arg-type]


def test_calculator_matches_training_sampling() -> None:
    c = calculator(n=1000, batch_size=64, epochs=3, delta=1e-5, noise_multiplier=1.0)
    assert c["steps"] == 3 * 16 and c["sample_rate"] == pytest.approx(1 / 16)
    assert not c["delta_ok"] or c["delta"] < 1e-3
    assert c["comparison"]["rdp"] == pytest.approx(c["epsilon"])
    assert len(c["curve"]) == 20 and c["curve"][-1]["epsilon"] == pytest.approx(c["epsilon"])


# ------------------------------------------------------------------ DP-SGD
def test_dp_training_respects_target(data: PreparedData) -> None:
    res = train_dp(
        _model(data),
        data.X_train,
        data.y_train,
        data.X_test,
        data.y_test,
        TrainConfig(epochs=3, batch_size=64, lr=3e-3),
        DPConfig(target_epsilon=2.0, delta=1e-5, max_grad_norm=1.0),
    )
    p = res.privacy
    assert 0 < p["epsilon"] <= 2.0 + 0.05
    assert p["noise_multiplier"] > 0 and p["sampling"].startswith("Poisson")
    assert p["steps"] == 3 * round(1 / p["sample_rate"])
    # The reported ε equals an independent recomputation from the same parameters.
    assert epsilon_for(p["noise_multiplier"], p["sample_rate"], p["steps"], 1e-5) == pytest.approx(
        p["epsilon"], rel=1e-6
    )
    assert res.history.epsilon == sorted(res.history.epsilon)
    assert len(p["clip_fraction_per_epoch"]) == 3


def test_dp_with_fixed_noise_and_utility(data: PreparedData) -> None:
    res = train_dp(
        _model(data),
        data.X_train,
        data.y_train,
        data.X_test,
        data.y_test,
        TrainConfig(epochs=4, batch_size=64, lr=3e-3),
        DPConfig(target_epsilon=None, noise_multiplier=0.8),
    )
    met = evaluate(res.model, data.X_test, data.y_test)
    assert met["accuracy"] > 0.5
    assert res.privacy["noise_multiplier"] == pytest.approx(0.8)


@pytest.mark.parametrize(
    "cfg",
    [
        DPConfig(target_epsilon=None, noise_multiplier=None),
        DPConfig(target_epsilon=1.0, noise_multiplier=1.0),
        DPConfig(target_epsilon=1.0, delta=0.5),
        DPConfig(target_epsilon=1.0, max_grad_norm=0),
    ],
)
def test_dp_config_validation(cfg: DPConfig) -> None:
    with pytest.raises(ValueError):
        cfg.validate(1000)


# ------------------------------------------------------------------ federated
def test_partitions() -> None:
    rng = np.random.default_rng(0)
    X = rng.normal(size=(600, 4)).astype(np.float32)
    y = rng.integers(0, 2, 600)
    iid = partition(X, y, 6, "iid", 0.5, rng)
    assert sum(c.n for c in iid) == 600 and len(iid) == 6
    non = partition(X, y, 6, "dirichlet", 0.3, np.random.default_rng(1))
    assert sum(c.n for c in non) == 600
    with pytest.raises(ValueError):
        partition(X[:20], y[:20], 6, "iid", 0.5, rng)


def test_fedavg_aggregation_is_weighted_mean(data: PreparedData) -> None:
    """With one local step of lr=0 the global model must not change."""
    m = _model(data)
    before = [p.clone() for p in m.parameters()]
    out = run_fedavg(
        m,
        data.X_train,
        data.y_train,
        data.X_test,
        data.y_test,
        FedConfig(num_clients=4, rounds=1, client_fraction=1.0, local_epochs=1, lr=0.0),
    )
    for a, b in zip(before, out["model"].parameters(), strict=True):
        assert torch.allclose(a, b, atol=1e-7)


def test_fedavg_improves_and_reports(data: PreparedData) -> None:
    out = run_fedavg(
        _model(data),
        data.X_train,
        data.y_train,
        data.X_test,
        data.y_test,
        FedConfig(num_clients=5, rounds=6, client_fraction=0.6, local_epochs=2, lr=0.1),
    )
    accs = [r["global_accuracy"] for r in out["rounds"]]
    assert accs[-1] >= accs[0] - 0.02
    assert out["final"]["accuracy"] > 0.6
    assert out["privacy"]["epsilon"] is None and "no formal" in out["privacy"]["guarantee"]
    assert out["communication"]["client_updates"] == 6 * 3
    assert len(out["clients"]) == 5
    assert all(len(r["participants"]) == 3 for r in out["rounds"])


def test_fedavg_client_dp_accounting(data: PreparedData) -> None:
    cfg = FedConfig(
        num_clients=10,
        rounds=4,
        client_fraction=0.5,
        local_epochs=1,
        lr=0.1,
        privacy="client_dp",
        noise_multiplier=1.2,
        clip_norm=0.5,
        delta=1e-5,
    )
    out = run_fedavg(_model(data), data.X_train, data.y_train, data.X_test, data.y_test, cfg)
    eps = [r["epsilon"] for r in out["rounds"]]
    assert eps == sorted(eps) and eps[-1] > 0
    assert eps[-1] == pytest.approx(epsilon_for(1.2, 0.5, 4, 1e-5))


def test_fedavg_local_dp_sgd(data: PreparedData) -> None:
    cfg = FedConfig(
        num_clients=3,
        rounds=2,
        client_fraction=1.0,
        local_epochs=1,
        lr=0.1,
        privacy="local_dp_sgd",
        noise_multiplier=1.0,
        delta=1e-4,
    )
    out = run_fedavg(_model(data), data.X_train, data.y_train, data.X_test, data.y_test, cfg)
    assert all(c["epsilon"] is not None and c["epsilon"] > 0 for c in out["clients"])
    assert out["privacy"]["epsilon"] == pytest.approx(max(c["epsilon"] for c in out["clients"]))


# ------------------------------------------------------------------ attacks
def test_evaluate_scores_perfect_and_random() -> None:
    rng = np.random.default_rng(0)
    mem = np.r_[np.ones(200, int), np.zeros(200, int)]
    calib = rng.random(400) < 0.5
    perfect = evaluate_scores(mem.astype(float) + rng.normal(0, 0.01, 400), mem, calib)
    assert perfect["roc_auc"] > 0.99 and perfect["accuracy"] > 0.98
    assert perfect["attack_implied_epsilon"] > 2
    rand = evaluate_scores(rng.random(400), mem, calib)
    assert 0.4 < rand["roc_auc"] < 0.6
    assert rand["attack_implied_epsilon"] < 0.5


def test_mia_detects_overfit_model(patients: pd.DataFrame) -> None:
    p = prepare(patients, "high_risk", test_size=0.5, seed=1, max_train_rows=200)
    m = _model(p, (128, 128))
    m, *_ = train_standard(
        m, p.X_train, p.y_train, p.X_test, p.y_test, TrainConfig(epochs=150, batch_size=32, lr=3e-3)
    )
    half = len(p.y_test) // 2

    def shadow(X: np.ndarray, y: np.ndarray, seed: int) -> torch.nn.Module:
        sm = _model(p, (128, 128))
        return train_standard(
            sm, X, y, X[:10], y[:10], TrainConfig(epochs=60, batch_size=32, lr=3e-3, seed=seed)
        )[0]

    res = membership_inference(
        m,
        p.X_train,
        p.y_train,
        p.X_test[:half],
        p.y_test[:half],
        shadow,
        p.X_test[half:],
        p.y_test[half:],
        n_shadow=2,
        seed=0,
    )
    assert res["best_attack_auc"] > 0.6
    assert set(res["attacks"]) == {"loss_threshold", "entropy_threshold", "shadow_model"}
    assert res["mean_loss"]["members"] < res["mean_loss"]["non_members"]
    cols = [
        i
        for i, n in enumerate(p.encoder.feature_names)
        if n.startswith("smoker=") and not n.endswith("__other__")
    ]
    ai = attribute_inference(m, p.X_train, p.y_train, cols)
    assert 0 <= ai["accuracy"] <= 1 and 0 < ai["baseline"] <= 1


# ------------------------------------------------------------------ artifacts
def test_save_and_reload_model(tmp_path: Path, data: PreparedData) -> None:
    m, *_ = train_standard(
        _model(data), data.X_train, data.y_train, data.X_test, data.y_test, TrainConfig(epochs=2)
    )
    save_model(tmp_path, "a" * 32, m, data.encoder, {"k": 1})
    m2, enc, meta = load_model(tmp_path, "a" * 32)
    assert meta == {"k": 1}
    assert (
        evaluate(m, data.X_test, data.y_test)["accuracy"]
        == evaluate(m2, data.X_test, data.y_test)["accuracy"]
    )
    assert enc.feature_names == data.encoder.feature_names


def test_dp_model_saves_without_wrapper_prefix(tmp_path: Path, data: PreparedData) -> None:
    res = train_dp(
        _model(data),
        data.X_train,
        data.y_train,
        data.X_test,
        data.y_test,
        TrainConfig(epochs=1),
        DPConfig(target_epsilon=5.0),
    )
    save_model(tmp_path, "b" * 32, res.model, data.encoder, {})
    m2, *_ = load_model(tmp_path, "b" * 32)
    assert evaluate(m2, data.X_test, data.y_test)["accuracy"] == pytest.approx(
        evaluate(res.model, data.X_test, data.y_test)["accuracy"]
    )


@pytest.mark.parametrize("bad", ["../etc", "ABC", "a/b", "", "a" * 70])
def test_artifact_ids_validated(tmp_path: Path, bad: str) -> None:
    with pytest.raises(ValueError):
        safe_artifact_dir(tmp_path, bad)


def test_reload_rejects_pickled_objects(tmp_path: Path, data: PreparedData) -> None:
    """weights_only=True refuses arbitrary pickled objects in the weights file."""
    m, *_ = train_standard(
        _model(data), data.X_train, data.y_train, data.X_test, data.y_test, TrainConfig(epochs=1)
    )
    d = save_model(tmp_path, "c" * 32, m, data.encoder, {})

    class Evil:
        def __reduce__(self):  # type: ignore[no-untyped-def]
            return (print, ("pwned",))

    torch.save({"x": Evil()}, d / "weights.pt")
    with pytest.raises(Exception):
        load_model(tmp_path, "c" * 32)
