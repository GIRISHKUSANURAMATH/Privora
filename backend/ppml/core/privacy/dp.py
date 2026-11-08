"""DP-SGD training with Opacus (Abadi et al., 'Deep Learning with Differential Privacy', CCS 2016).

Per step, Opacus:

1. samples a batch by Poisson sampling (each record independently with prob. ``q = B/N``),
2. computes per-sample gradients,
3. clips each per-sample gradient to L2 norm ``C = max_grad_norm``,
4. sums them and adds Gaussian noise ``N(0, (σ·C)² I)`` where ``σ = noise_multiplier``,
5. divides by the *expected* batch size and takes an optimizer step.

The accountant then reports ``(ε, δ)`` for example-level DP under add/remove adjacency.
This is **central** DP: a trusted curator holds the raw data; the released model is private.
"""

from __future__ import annotations

import time
import warnings
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np
import torch
from opacus import PrivacyEngine
from opacus.validators import ModuleValidator
from torch import nn
from torch.utils.data import DataLoader

from ppml.core.ml.training import (
    ProgressFn,
    TrainConfig,
    TrainHistory,
    evaluate,
    make_optimizer,
    noop_progress,
    set_seed,
    tensors,
)
from ppml.core.privacy.accounting import ACCOUNTANT_INFO, AccountantName


@dataclass
class DPConfig:
    target_epsilon: float | None = 3.0
    noise_multiplier: float | None = None
    delta: float = 1e-5
    max_grad_norm: float = 1.0
    accountant: AccountantName = "rdp"
    secure_mode: bool = False

    def validate(self, n: int) -> None:
        if (self.target_epsilon is None) == (self.noise_multiplier is None):
            raise ValueError("Set exactly one of target_epsilon or noise_multiplier")
        if self.target_epsilon is not None and not 0.01 <= self.target_epsilon <= 100:
            raise ValueError("target_epsilon must be in [0.01, 100]")
        if self.noise_multiplier is not None and not 0.05 <= self.noise_multiplier <= 50:
            raise ValueError("noise_multiplier must be in [0.05, 50]")
        if not 0 < self.delta < 1:
            raise ValueError("delta must be in (0, 1)")
        if self.delta >= 1.0 / n:
            raise ValueError(f"delta={self.delta:g} must be < 1/n = {1.0 / n:.2e} for a meaningful guarantee")
        if self.max_grad_norm <= 0:
            raise ValueError("max_grad_norm must be > 0")


@dataclass
class DPResult:
    model: nn.Module
    history: TrainHistory
    seconds: float
    privacy: dict[str, Any]


def train_dp(
    model: nn.Module,
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_test: np.ndarray,
    y_test: np.ndarray,
    cfg: TrainConfig,
    dp: DPConfig,
    device: torch.device | None = None,
    progress: ProgressFn = noop_progress,
    should_stop: Callable[[], bool] = lambda: False,
) -> DPResult:
    """Train ``model`` with DP-SGD and return the model, history and privacy report."""
    device = device or torch.device("cpu")
    n = len(X_train)
    dp.validate(n)
    set_seed(cfg.seed)
    errors = ModuleValidator.validate(model, strict=False)
    if errors:
        model = ModuleValidator.fix(model)
    model.to(device)
    model.train()
    gen = torch.Generator().manual_seed(cfg.seed)
    loader = DataLoader(tensors(X_train, y_train), batch_size=cfg.batch_size, shuffle=True, generator=gen)
    opt = make_optimizer(model, cfg)
    engine = PrivacyEngine(accountant=dp.accountant, secure_mode=dp.secure_mode)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        if dp.target_epsilon is not None:
            model, opt, loader = engine.make_private_with_epsilon(
                module=model,
                optimizer=opt,
                data_loader=loader,
                target_epsilon=dp.target_epsilon,
                target_delta=dp.delta,
                epochs=cfg.epochs,
                max_grad_norm=dp.max_grad_norm,
                poisson_sampling=True,
            )
        else:
            model, opt, loader = engine.make_private(
                module=model,
                optimizer=opt,
                data_loader=loader,
                noise_multiplier=dp.noise_multiplier,
                max_grad_norm=dp.max_grad_norm,
                poisson_sampling=True,
            )
    sigma = float(opt.noise_multiplier)  # type: ignore[attr-defined]
    sample_rate = 1.0 / len(loader)
    loss_fn = nn.CrossEntropyLoss()
    hist = TrainHistory()
    clip_fractions: list[float] = []
    t0 = time.perf_counter()
    for ep in range(1, cfg.epochs + 1):
        if should_stop():
            raise InterruptedError("cancelled")
        model.train()
        total, count = 0.0, 0
        clipped, seen = 0, 0
        for xb, yb in loader:
            if len(yb) == 0:  # Poisson sampling can yield empty batches
                continue
            xb, yb = xb.to(device), yb.to(device)
            opt.zero_grad()
            loss = loss_fn(model(xb), yb)
            loss.backward()
            # Fraction of per-sample gradients that the clip actually shrank (diagnostic only).
            norms = [
                p.grad_sample.reshape(len(yb), -1).norm(2, dim=1)  # type: ignore[attr-defined]
                for p in model.parameters()
                if getattr(p, "grad_sample", None) is not None
            ]
            if norms:
                per_sample = torch.stack(norms, dim=1).norm(2, dim=1)
                clipped += int((per_sample > dp.max_grad_norm).sum())
                seen += len(yb)
            opt.step()
            total += float(loss.item()) * len(yb)
            count += len(yb)
        eps = float(engine.get_epsilon(dp.delta))
        acc = evaluate(model, X_test, y_test, device)["accuracy"]
        clip_fractions.append(clipped / max(1, seen))
        hist.epoch.append(ep)
        hist.train_loss.append(total / max(1, count))
        hist.test_accuracy.append(acc)
        hist.epsilon.append(eps)
        progress(
            ep / cfg.epochs,
            f"epoch {ep}/{cfg.epochs} · ε={eps:.2f}",
            {"epoch": ep, "loss": hist.train_loss[-1], "accuracy": acc, "epsilon": eps},
        )
    seconds = time.perf_counter() - t0
    steps = sum(h[2] for h in engine.accountant.history) if hasattr(engine.accountant, "history") else None
    privacy = {
        "guarantee": "(ε, δ)-DP, example-level, add/remove adjacency, central model",
        "unit": "example",
        "epsilon": hist.epsilon[-1] if hist.epsilon else None,
        "target_epsilon": dp.target_epsilon,
        "delta": dp.delta,
        "noise_multiplier": sigma,
        "max_grad_norm": dp.max_grad_norm,
        "noise_std": sigma * dp.max_grad_norm,
        "sample_rate": sample_rate,
        "expected_batch_size": cfg.batch_size,
        "steps": steps,
        "epochs": cfg.epochs,
        "n_train": n,
        "sampling": "Poisson (DPDataLoader)",
        "accountant": dp.accountant,
        "accountant_info": ACCOUNTANT_INFO[dp.accountant],
        "secure_rng": dp.secure_mode,
        "clip_fraction_per_epoch": clip_fractions,
        "assumptions": [
            "Preprocessing statistics (means, std devs, category lists) are treated as public.",
            "Hyperparameter tuning across multiple runs is not accounted for.",
            "Each individual contributes exactly one row.",
            "Without secure_mode, noise uses a non-cryptographic PRNG (fine for research, "
            "not for deployment).",
        ],
    }
    return DPResult(model=model, history=hist, seconds=seconds, privacy=privacy)
