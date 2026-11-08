"""Federated Averaging simulator (McMahan et al., 'Communication-Efficient Learning of Deep
Networks from Decentralized Data', AISTATS 2017).

Privacy modes
-------------
``none``
    Plain FedAvg. Raw records never leave clients, but model updates can still leak
    information about them (gradient inversion, membership inference). **No formal guarantee.**
``client_dp``
    DP-FedAvg (McMahan et al., 'Learning Differentially Private Recurrent Language Models',
    ICLR 2018). Each round, clients are Poisson-sampled with rate ``q``; each participating
    client's update is clipped to L2 norm ``S``; the server adds ``N(0, (z·S)²)`` to the sum and
    divides by the expected number of participants ``q·K``. Accounting uses the RDP accountant
    for the subsampled Gaussian mechanism → **client-level** (ε, δ)-DP: protects the
    participation of an entire client's dataset. Assumes a trusted server adds the noise.
``local_dp_sgd``
    Every client trains locally with Opacus DP-SGD. Each client's update — and thus the
    global model — is **example-level** (ε, δ)-DP with respect to that client's records, even
    against an untrusted server. The reported ε is the maximum over clients.
"""

from __future__ import annotations

import copy
import time
import warnings
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

import numpy as np
import torch
from opacus import PrivacyEngine
from torch import nn
from torch.utils.data import DataLoader

from ppml.core.ml.models import count_parameters
from ppml.core.ml.training import (
    ProgressFn,
    evaluate,
    noop_progress,
    set_seed,
    tensors,
)
from ppml.core.privacy.accounting import epsilon_for

PrivacyMode = Literal["none", "client_dp", "local_dp_sgd"]


@dataclass
class FedConfig:
    num_clients: int = 8
    rounds: int = 15
    client_fraction: float = 0.5
    local_epochs: int = 2
    batch_size: int = 32
    lr: float = 0.05
    partition: Literal["iid", "dirichlet"] = "iid"
    dirichlet_alpha: float = 0.5
    privacy: PrivacyMode = "none"
    clip_norm: float = 1.0  # client_dp: update clip S
    noise_multiplier: float = 1.0  # client_dp: z ; local_dp_sgd: σ for DP-SGD
    delta: float = 1e-5
    local_max_grad_norm: float = 1.0
    seed: int = 42

    def validate(self) -> None:
        if not 2 <= self.num_clients <= 100:
            raise ValueError("num_clients must be in [2, 100]")
        if not 1 <= self.rounds <= 500:
            raise ValueError("rounds must be in [1, 500]")
        if not 0 < self.client_fraction <= 1:
            raise ValueError("client_fraction must be in (0, 1]")
        if not 1 <= self.local_epochs <= 50:
            raise ValueError("local_epochs must be in [1, 50]")
        if self.dirichlet_alpha <= 0:
            raise ValueError("dirichlet_alpha must be > 0")
        if self.privacy != "none" and self.noise_multiplier <= 0:
            raise ValueError("noise_multiplier must be > 0")


@dataclass
class Client:
    cid: int
    X: np.ndarray
    y: np.ndarray
    engine: PrivacyEngine | None = None
    rounds_participated: int = 0
    history: list[dict[str, Any]] = field(default_factory=list)

    @property
    def n(self) -> int:
        return len(self.y)


def partition(
    X: np.ndarray,
    y: np.ndarray,
    k: int,
    mode: str,
    alpha: float,
    rng: np.random.Generator,
    min_size: int = 10,
) -> list[Client]:
    """Split data across ``k`` clients, IID or label-skewed via a Dirichlet(α) prior."""
    n = len(y)
    if n < k * min_size:
        raise ValueError(f"Need at least {k * min_size} training rows for {k} clients")
    if mode == "iid":
        idx = rng.permutation(n)
        parts = np.array_split(idx, k)
    else:
        classes = np.unique(y)
        for _attempt in range(100):
            buckets: list[list[int]] = [[] for _ in range(k)]
            for c in classes:
                ids = rng.permutation(np.where(y == c)[0])
                props = rng.dirichlet([alpha] * k)
                cuts = (np.cumsum(props) * len(ids)).astype(int)[:-1]
                for b, chunk in zip(buckets, np.split(ids, cuts), strict=True):
                    b.extend(chunk.tolist())
            if min(len(b) for b in buckets) >= min_size:
                break
        else:
            raise ValueError(
                "Could not create a Dirichlet partition with the minimum client size; "
                "increase alpha or reduce the number of clients"
            )
        parts = [np.array(rng.permutation(b)) for b in buckets]
    return [Client(cid=i, X=X[p], y=y[p]) for i, p in enumerate(parts)]


def _flat(model: nn.Module) -> torch.Tensor:
    return torch.cat([p.detach().reshape(-1) for p in model.state_dict().values()])


def _load_flat(model: nn.Module, vec: torch.Tensor) -> None:
    state = model.state_dict()
    i = 0
    new = {}
    for k, v in state.items():
        n = v.numel()
        new[k] = vec[i : i + n].reshape(v.shape).to(v.dtype)
        i += n
    model.load_state_dict(new)


def _local_train(
    global_model: nn.Module, client: Client, cfg: FedConfig, device: torch.device, round_seed: int
) -> tuple[torch.Tensor, float]:
    local = copy.deepcopy(global_model).to(device)
    local.train()  # Opacus requires training mode; the global model was left in eval mode
    gen = torch.Generator().manual_seed(round_seed)
    loader = DataLoader(
        tensors(client.X, client.y), batch_size=min(cfg.batch_size, client.n), shuffle=True, generator=gen
    )
    opt: torch.optim.Optimizer = torch.optim.SGD(local.parameters(), lr=cfg.lr, momentum=0.0)
    if cfg.privacy == "local_dp_sgd":
        if client.engine is None:
            client.engine = PrivacyEngine(accountant="rdp")
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            local, opt, loader = client.engine.make_private(
                module=local,
                optimizer=opt,
                data_loader=loader,
                noise_multiplier=cfg.noise_multiplier,
                max_grad_norm=cfg.local_max_grad_norm,
                poisson_sampling=True,
            )
    loss_fn = nn.CrossEntropyLoss()
    total, count = 0.0, 0
    local.train()
    for _ in range(cfg.local_epochs):
        for xb, yb in loader:
            if len(yb) == 0:
                continue
            xb, yb = xb.to(device), yb.to(device)
            opt.zero_grad()
            loss = loss_fn(local(xb), yb)
            loss.backward()
            opt.step()
            total += float(loss.item()) * len(yb)
            count += len(yb)
    inner = getattr(local, "_module", local)
    return _flat(inner).cpu(), total / max(1, count)


def run_fedavg(
    model: nn.Module,
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_test: np.ndarray,
    y_test: np.ndarray,
    cfg: FedConfig,
    device: torch.device | None = None,
    progress: ProgressFn = noop_progress,
    should_stop: Callable[[], bool] = lambda: False,
) -> dict[str, Any]:
    """Run the simulation and return per-round and per-client metrics."""
    cfg.validate()
    device = device or torch.device("cpu")
    set_seed(cfg.seed)
    rng = np.random.default_rng(cfg.seed)
    clients = partition(X_train, y_train, cfg.num_clients, cfg.partition, cfg.dirichlet_alpha, rng)
    if cfg.privacy == "local_dp_sgd":
        for c in clients:
            if cfg.delta >= 1.0 / c.n:
                raise ValueError(f"delta must be < 1/n_client (smallest client has {c.n} rows)")
    model.to(device)
    n_params = count_parameters(model)
    bytes_per_model = n_params * 4
    rounds: list[dict[str, Any]] = []
    t0 = time.perf_counter()
    total_upload = total_download = 0
    expected_m = cfg.client_fraction * cfg.num_clients

    for r in range(1, cfg.rounds + 1):
        if should_stop():
            raise InterruptedError("cancelled")
        if cfg.privacy == "client_dp":
            mask = rng.random(cfg.num_clients) < cfg.client_fraction  # Poisson client sampling
            selected = [c for c, m in zip(clients, mask, strict=True) if m]
        else:
            m = max(1, round(cfg.client_fraction * cfg.num_clients))
            selected = [clients[i] for i in sorted(rng.choice(cfg.num_clients, m, replace=False))]

        g_vec = _flat(model).cpu()
        updates, weights, losses = [], [], []
        clipped = 0
        for c in selected:
            vec, loss = _local_train(model, c, cfg, device, round_seed=cfg.seed * 1000 + r * 100 + c.cid)
            delta_vec = vec - g_vec
            if cfg.privacy == "client_dp":
                norm = float(delta_vec.norm(2))
                if norm > cfg.clip_norm:
                    clipped += 1
                delta_vec = delta_vec * min(1.0, cfg.clip_norm / (norm + 1e-12))
            updates.append(delta_vec)
            weights.append(c.n)
            losses.append(loss)
            c.rounds_participated += 1
            total_download += bytes_per_model
            total_upload += bytes_per_model

        if cfg.privacy == "client_dp":
            summed = torch.stack(updates).sum(0) if updates else torch.zeros_like(g_vec)
            noise = torch.normal(0.0, cfg.noise_multiplier * cfg.clip_norm, size=g_vec.shape)
            agg = (summed + noise) / expected_m
        elif updates:
            w = torch.tensor(weights, dtype=torch.float32)
            agg = (torch.stack(updates) * (w / w.sum())[:, None]).sum(0)
        else:
            agg = torch.zeros_like(g_vec)
        _load_flat(model, g_vec + agg)

        glob = evaluate(model, X_test, y_test, device)
        client_metrics = []
        for c in clients:
            cm = evaluate(model, c.X, c.y, device)
            c.history.append({"round": r, "accuracy": cm["accuracy"]})
            client_metrics.append(
                {"client": c.cid, "accuracy": cm["accuracy"], "n": c.n, "participated": c in selected}
            )
        eps = None
        if cfg.privacy == "client_dp":
            eps = epsilon_for(cfg.noise_multiplier, cfg.client_fraction, r, cfg.delta, "rdp")
        elif cfg.privacy == "local_dp_sgd":
            eps = (
                max(float(c.engine.get_epsilon(cfg.delta)) for c in clients if c.engine)
                if any(c.engine for c in clients)
                else 0.0
            )
        rec = {
            "round": r,
            "participants": [c.cid for c in selected],
            "global_accuracy": glob["accuracy"],
            "global_f1": glob["f1"],
            "global_loss": glob["loss"],
            "mean_local_loss": float(np.mean(losses)) if losses else None,
            "update_norm": float(agg.norm(2)),
            "clipped_updates": clipped,
            "epsilon": eps,
            "client_accuracy": client_metrics,
        }
        rounds.append(rec)
        progress(
            r / cfg.rounds,
            f"round {r}/{cfg.rounds} · {len(selected)} clients",
            {"round": r, "accuracy": glob["accuracy"], "epsilon": eps},
        )

    final = evaluate(model, X_test, y_test, device)
    if cfg.privacy == "client_dp":
        guarantee = "client-level (ε, δ)-DP (DP-FedAvg, trusted server, Poisson client sampling)"
    elif cfg.privacy == "local_dp_sgd":
        guarantee = "example-level (ε, δ)-DP per client (local DP-SGD; max ε over clients)"
    else:
        guarantee = "none — FedAvg alone provides no formal privacy guarantee"
    return {
        "model": model,
        "seconds": time.perf_counter() - t0,
        "rounds": rounds,
        "final": final,
        "clients": [
            {
                "client": c.cid,
                "n": c.n,
                "rounds_participated": c.rounds_participated,
                "label_distribution": np.bincount(c.y, minlength=len(np.unique(y_train))).tolist(),
                "final_accuracy": c.history[-1]["accuracy"] if c.history else None,
                "epsilon": float(c.engine.get_epsilon(cfg.delta)) if c.engine else None,
            }
            for c in clients
        ],
        "communication": {
            "parameters": n_params,
            "bytes_per_model": bytes_per_model,
            "total_upload_bytes": total_upload,
            "total_download_bytes": total_download,
            "client_updates": sum(len(r["participants"]) for r in rounds),
        },
        "privacy": {
            "mode": cfg.privacy,
            "guarantee": guarantee,
            # What one unit of protection is: a whole client (DP-FedAvg) or one record.
            "unit": {"client_dp": "client", "local_dp_sgd": "example"}.get(cfg.privacy),
            "epsilon": rounds[-1]["epsilon"] if rounds else None,
            "delta": cfg.delta if cfg.privacy != "none" else None,
            "noise_multiplier": cfg.noise_multiplier if cfg.privacy != "none" else None,
            "clip_norm": cfg.clip_norm
            if cfg.privacy == "client_dp"
            else cfg.local_max_grad_norm
            if cfg.privacy == "local_dp_sgd"
            else None,
            "client_sampling": "Poisson" if cfg.privacy == "client_dp" else "uniform without replacement",
        },
    }
