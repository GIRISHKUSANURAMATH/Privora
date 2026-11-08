"""Non-private training loop, evaluation and reproducibility helpers."""

from __future__ import annotations

import random
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import torch
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

ProgressFn = Callable[[float, str, dict[str, Any] | None], None]


def noop_progress(_p: float, _m: str, _d: dict[str, Any] | None = None) -> None:
    return None


def set_seed(seed: int) -> None:
    """Seed Python, NumPy and PyTorch RNGs for reproducible (non-cryptographic) runs."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


@dataclass
class TrainConfig:
    epochs: int = 20
    batch_size: int = 64
    lr: float = 1e-3
    optimizer: str = "adam"
    weight_decay: float = 0.0
    seed: int = 42


@dataclass
class TrainHistory:
    epoch: list[int] = field(default_factory=list)
    train_loss: list[float] = field(default_factory=list)
    test_accuracy: list[float] = field(default_factory=list)
    epsilon: list[float] = field(default_factory=list)

    def to_dict(self) -> dict[str, list[Any]]:
        return {
            "epoch": self.epoch,
            "train_loss": self.train_loss,
            "test_accuracy": self.test_accuracy,
            "epsilon": self.epsilon,
        }


def make_optimizer(model: nn.Module, cfg: TrainConfig) -> torch.optim.Optimizer:
    if cfg.optimizer == "sgd":
        return torch.optim.SGD(model.parameters(), lr=cfg.lr, momentum=0.9, weight_decay=cfg.weight_decay)
    return torch.optim.Adam(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)


def tensors(X: np.ndarray, y: np.ndarray) -> TensorDataset:
    return TensorDataset(torch.from_numpy(X.astype(np.float32)), torch.from_numpy(y.astype(np.int64)))


@torch.no_grad()
def predict_proba(model: nn.Module, X: np.ndarray, device: torch.device | None = None) -> np.ndarray:
    device = device or torch.device("cpu")
    model.eval()
    out = []
    for i in range(0, len(X), 4096):
        xb = torch.from_numpy(X[i : i + 4096].astype(np.float32)).to(device)
        out.append(torch.softmax(model(xb), dim=1).cpu().numpy())
    return np.vstack(out)


def per_sample_loss(probs: np.ndarray, y: np.ndarray) -> np.ndarray:
    p = np.clip(probs[np.arange(len(y)), y], 1e-12, 1.0)
    return -np.log(p)


def evaluate(
    model: nn.Module, X: np.ndarray, y: np.ndarray, device: torch.device | None = None
) -> dict[str, Any]:
    """Compute classification metrics. Multi-class metrics use macro averaging."""
    probs = predict_proba(model, X, device)
    pred = probs.argmax(1)
    n_classes = probs.shape[1]
    avg = "binary" if n_classes == 2 else "macro"
    metrics: dict[str, Any] = {
        "accuracy": float(accuracy_score(y, pred)),
        "precision": float(precision_score(y, pred, average=avg, zero_division=0)),
        "recall": float(recall_score(y, pred, average=avg, zero_division=0)),
        "f1": float(f1_score(y, pred, average=avg, zero_division=0)),
        "loss": float(per_sample_loss(probs, y).mean()),
        "confusion_matrix": confusion_matrix(y, pred, labels=list(range(n_classes))).tolist(),
        "n": len(y),
    }
    try:
        if n_classes == 2:
            metrics["roc_auc"] = float(roc_auc_score(y, probs[:, 1]))
        else:
            metrics["roc_auc"] = float(roc_auc_score(y, probs, multi_class="ovr"))
    except ValueError:
        metrics["roc_auc"] = None
    return metrics


def train_standard(
    model: nn.Module,
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_test: np.ndarray,
    y_test: np.ndarray,
    cfg: TrainConfig,
    device: torch.device | None = None,
    progress: ProgressFn = noop_progress,
    should_stop: Callable[[], bool] = lambda: False,
) -> tuple[nn.Module, TrainHistory, float]:
    """Train without privacy. Returns (model, history, seconds)."""
    device = device or torch.device("cpu")
    set_seed(cfg.seed)
    model.to(device)
    gen = torch.Generator().manual_seed(cfg.seed)
    loader = DataLoader(tensors(X_train, y_train), batch_size=cfg.batch_size, shuffle=True, generator=gen)
    opt = make_optimizer(model, cfg)
    loss_fn = nn.CrossEntropyLoss()
    hist = TrainHistory()
    t0 = time.perf_counter()
    for ep in range(1, cfg.epochs + 1):
        if should_stop():
            raise InterruptedError("cancelled")
        model.train()
        total, count = 0.0, 0
        for xb, yb in loader:
            xb, yb = xb.to(device), yb.to(device)
            opt.zero_grad()
            loss = loss_fn(model(xb), yb)
            loss.backward()
            opt.step()
            total += float(loss.item()) * len(yb)
            count += len(yb)
        acc = evaluate(model, X_test, y_test, device)["accuracy"]
        hist.epoch.append(ep)
        hist.train_loss.append(total / max(1, count))
        hist.test_accuracy.append(acc)
        progress(
            ep / cfg.epochs,
            f"epoch {ep}/{cfg.epochs}",
            {"epoch": ep, "loss": hist.train_loss[-1], "accuracy": acc},
        )
    return model, hist, time.perf_counter() - t0
