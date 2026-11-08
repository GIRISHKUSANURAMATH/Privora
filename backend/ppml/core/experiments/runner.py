"""Experiment orchestration: runs jobs in a worker pool and persists progress and results."""

from __future__ import annotations

import logging
import threading
import time
import traceback
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeVar

import numpy as np
import torch
from sklearn.metrics import mutual_info_score

from ppml.core.attacks.membership import attribute_inference, leakage_indicators, membership_inference
from ppml.core.data.pii import scan
from ppml.core.data.preprocessing import PreparedData, prepare
from ppml.core.data.store import DatasetStore
from ppml.core.data.transforms import apply_rules, recommended_rules
from ppml.core.experiments.schemas import ExperimentRequest, ModelParams
from ppml.core.federated.fedavg import FedConfig, run_fedavg
from ppml.core.ml.artifacts import save_model
from ppml.core.ml.models import build_model, count_parameters
from ppml.core.ml.training import TrainConfig, evaluate, train_standard
from ppml.core.privacy.dp import DPConfig, train_dp
from ppml.db import Database, now

log = logging.getLogger("ppml.runner")

TITLES = {
    "baseline": "Conventional training",
    "dp": "Differentially private training",
    "comparison": "Conventional vs DP comparison",
    "budget_sweep": "Privacy budget sweep",
    "federated": "Federated learning",
    "attack": "Membership inference evaluation",
    "pii": "PII protection",
}


@dataclass
class Ctx:
    exp_id: str
    db: Database
    cancel: threading.Event
    stage_lo: float = 0.0
    stage_hi: float = 1.0
    _last: float = 0.0

    def stage(self, lo: float, hi: float, msg: str) -> None:
        self.stage_lo, self.stage_hi = lo, hi
        self.db.update("experiments", self.exp_id, {"progress": lo, "message": msg})

    def progress(self, frac: float, msg: str, data: dict[str, Any] | None = None) -> None:
        t = time.monotonic()
        if t - self._last < 0.4 and frac < 1.0:
            return
        self._last = t
        p = self.stage_lo + (self.stage_hi - self.stage_lo) * min(1.0, max(0.0, frac))
        upd: dict[str, Any] = {"progress": round(p, 4), "message": msg}
        if data is not None:
            upd["live"] = data
        self.db.update("experiments", self.exp_id, upd)

    def stopped(self) -> bool:
        return self.cancel.is_set()


T = TypeVar("T")


def _require(value: T | None, section: str) -> T:
    """Schema validation guarantees these sections exist; fail loudly if that ever changes."""
    if value is None:
        raise ValueError(f"Missing '{section}' section in experiment request")
    return value


def _cfg(m: ModelParams) -> TrainConfig:
    return TrainConfig(
        epochs=m.epochs,
        batch_size=m.batch_size,
        lr=m.lr,
        optimizer=m.optimizer,
        weight_decay=m.weight_decay,
        seed=m.seed,
    )


class ExperimentRunner:
    def __init__(
        self,
        db: Database,
        store: DatasetStore,
        artifacts_dir: Path,
        device: torch.device,
        max_workers: int = 1,
    ) -> None:
        self.db = db
        self.store = store
        self.artifacts_dir = artifacts_dir
        self.device = device
        self.pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="exp")
        self.cancels: dict[str, threading.Event] = {}
        self._recover()

    def _recover(self) -> None:
        """Jobs that were running when the server stopped cannot resume; mark them failed."""
        for status in ("running", "queued"):
            for e in self.db.list("experiments", "status = ?", [status]):
                self.db.update(
                    "experiments",
                    e["id"],
                    {
                        "status": "failed",
                        "error": "Server restarted before the job completed.",
                        "finished_at": now(),
                    },
                )

    # ------------------------------------------------------------------ public API
    def submit(self, req: ExperimentRequest) -> dict[str, Any]:
        exp_id = uuid.uuid4().hex
        ds_id = req.data.dataset_id if req.data else (req.pii.dataset_id if req.pii else None)
        if ds_id is None or self.store.get(ds_id) is None:
            raise ValueError("Dataset not found")
        rec = {
            "id": exp_id,
            "type": req.type,
            "name": req.name or TITLES[req.type],
            "status": "queued",
            "progress": 0.0,
            "message": "Queued",
            "dataset_id": ds_id,
            "config": req.model_dump(),
            "created_at": now(),
        }
        self.db.insert("experiments", rec)
        ev = threading.Event()
        self.cancels[exp_id] = ev
        self.pool.submit(self._run, exp_id, req, ev)
        return rec

    def cancel(self, exp_id: str) -> bool:
        ev = self.cancels.get(exp_id)
        if ev is None:
            return False
        ev.set()
        return True

    def run_sync(self, req: ExperimentRequest) -> dict[str, Any]:
        """Run in the calling thread (used by tests and the CLI)."""
        exp_id = uuid.uuid4().hex
        rec: dict[str, Any] = {
            "id": exp_id,
            "type": req.type,
            "name": req.name or TITLES[req.type],
            "status": "queued",
            "progress": 0.0,
            "message": "Queued",
            "dataset_id": req.data.dataset_id if req.data else req.pii.dataset_id if req.pii else None,
            "config": req.model_dump(),
            "created_at": now(),
        }
        self.db.insert("experiments", rec)
        self._run(exp_id, req, threading.Event())
        out = self.db.get("experiments", exp_id)
        if out is None:
            raise RuntimeError("experiment row disappeared")
        return out

    # ------------------------------------------------------------------ execution
    def _run(self, exp_id: str, req: ExperimentRequest, cancel: threading.Event) -> None:
        ctx = Ctx(exp_id, self.db, cancel)
        t0 = time.perf_counter()
        self.db.update(
            "experiments", exp_id, {"status": "running", "started_at": now(), "message": "Starting"}
        )
        handlers: dict[str, Callable[[Ctx, ExperimentRequest], dict[str, Any]]] = {
            "baseline": self._baseline,
            "dp": self._dp,
            "comparison": self._comparison,
            "budget_sweep": self._sweep,
            "federated": self._federated,
            "attack": self._attack,
            "pii": self._pii,
        }
        try:
            torch.set_num_threads(max(1, torch.get_num_threads()))
            results = handlers[req.type](ctx, req)
            self.db.update(
                "experiments",
                exp_id,
                {
                    "status": "completed",
                    "progress": 1.0,
                    "message": "Completed",
                    "results": results,
                    "finished_at": now(),
                    "duration_s": round(time.perf_counter() - t0, 3),
                },
            )
            log.info("experiment completed", extra={"ctx": {"id": exp_id, "type": req.type}})
        except InterruptedError:
            self.db.update(
                "experiments", exp_id, {"status": "cancelled", "message": "Cancelled", "finished_at": now()}
            )
        except Exception as exc:  # noqa: BLE001 - job boundary: record and continue
            log.error("experiment failed", extra={"ctx": {"id": exp_id, "error": str(exc)}})
            log.debug(traceback.format_exc())
            self.db.update(
                "experiments",
                exp_id,
                {
                    "status": "failed",
                    "error": str(exc)[:1000],
                    "message": "Failed",
                    "finished_at": now(),
                    "duration_s": round(time.perf_counter() - t0, 3),
                },
            )
        finally:
            self.cancels.pop(exp_id, None)

    def _prepare(
        self, req: ExperimentRequest, test_size: float | None = None, max_train_rows: int | None = None
    ) -> PreparedData:
        d = _require(req.data, "data")
        df = self.store.load(d.dataset_id)
        return prepare(
            df,
            d.target,
            d.exclude,
            test_size or d.test_size,
            req.model.seed,
            d.auto_exclude_pii,
            max_train_rows or d.max_train_rows,
        )

    def _new_model(self, p: PreparedData, m: ModelParams) -> torch.nn.Module:
        torch.manual_seed(m.seed)
        return build_model(p.encoder.n_features, len(p.encoder.classes), m.hidden, m.dropout, m.activation)

    def _save(
        self,
        exp_id: str,
        label: str,
        kind: str,
        model: torch.nn.Module,
        p: PreparedData,
        metrics: dict[str, Any],
        privacy: dict[str, Any] | None,
    ) -> str:
        mid = uuid.uuid4().hex
        save_model(
            self.artifacts_dir, mid, model, p.encoder, {"experiment_id": exp_id, "label": label, "kind": kind}
        )
        self.db.insert(
            "models",
            {
                "id": mid,
                "experiment_id": exp_id,
                "label": label,
                "kind": kind,
                "metrics": {k: v for k, v in metrics.items() if k != "confusion_matrix"},
                "privacy": privacy,
                "created_at": now(),
            },
        )
        return mid

    @staticmethod
    def _data_summary(p: PreparedData) -> dict[str, Any]:
        return {
            "n_train": len(p.y_train),
            "n_test": len(p.y_test),
            "n_features": p.encoder.n_features,
            "features_used": p.features_used,
            "excluded": p.excluded,
            "classes": p.encoder.classes,
            "class_balance_train": np.bincount(p.y_train).tolist(),
        }

    def _train_baseline(self, ctx: Ctx, p: PreparedData, m: ModelParams, label: str) -> dict[str, Any]:
        model = self._new_model(p, m)
        model, hist, secs = train_standard(
            model, p.X_train, p.y_train, p.X_test, p.y_test, _cfg(m), self.device, ctx.progress, ctx.stopped
        )
        test = evaluate(model, p.X_test, p.y_test, self.device)
        train = evaluate(model, p.X_train, p.y_train, self.device)
        mid = self._save(ctx.exp_id, label, "conventional", model, p, test, None)
        return {
            "label": label,
            "kind": "conventional",
            "model_id": mid,
            "test": test,
            "train": train,
            "history": hist.to_dict(),
            "train_seconds": secs,
            "parameters": count_parameters(model),
            "privacy": None,
            "_model": model,
        }

    def _train_dp(
        self, ctx: Ctx, p: PreparedData, m: ModelParams, dp: DPConfig, label: str
    ) -> dict[str, Any]:
        model = self._new_model(p, m)
        res = train_dp(
            model,
            p.X_train,
            p.y_train,
            p.X_test,
            p.y_test,
            _cfg(m),
            dp,
            self.device,
            ctx.progress,
            ctx.stopped,
        )
        test = evaluate(res.model, p.X_test, p.y_test, self.device)
        train = evaluate(res.model, p.X_train, p.y_train, self.device)
        mid = self._save(ctx.exp_id, label, "dp", res.model, p, test, res.privacy)
        return {
            "label": label,
            "kind": "dp",
            "model_id": mid,
            "test": test,
            "train": train,
            "history": res.history.to_dict(),
            "train_seconds": res.seconds,
            "parameters": count_parameters(res.model),
            "privacy": res.privacy,
            "_model": res.model,
        }

    @staticmethod
    def _strip(r: dict[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in r.items() if not k.startswith("_")}

    @staticmethod
    def _dpcfg(req: ExperimentRequest) -> DPConfig:
        d = _require(req.dp, "dp")
        return DPConfig(
            target_epsilon=d.target_epsilon,
            noise_multiplier=d.noise_multiplier,
            delta=d.delta,
            max_grad_norm=d.max_grad_norm,
            accountant=d.accountant,
        )

    # ------------------------------------------------------------------ handlers
    def _baseline(self, ctx: Ctx, req: ExperimentRequest) -> dict[str, Any]:
        ctx.stage(0.0, 0.05, "Preparing data")
        p = self._prepare(req)
        ctx.stage(0.05, 1.0, "Training conventional model")
        r = self._train_baseline(ctx, p, req.model, "Conventional")
        return {"data": self._data_summary(p), "models": [self._strip(r)]}

    def _dp(self, ctx: Ctx, req: ExperimentRequest) -> dict[str, Any]:
        ctx.stage(0.0, 0.05, "Preparing data")
        p = self._prepare(req)
        ctx.stage(0.05, 1.0, "Training with DP-SGD")
        r = self._train_dp(ctx, p, req.model, self._dpcfg(req), "DP-SGD")
        return {"data": self._data_summary(p), "models": [self._strip(r)]}

    def _comparison(self, ctx: Ctx, req: ExperimentRequest) -> dict[str, Any]:
        ctx.stage(0.0, 0.05, "Preparing data")
        p = self._prepare(req)
        ctx.stage(0.05, 0.45, "Training conventional model")
        base = self._train_baseline(ctx, p, req.model, "Conventional")
        ctx.stage(0.45, 1.0, "Training DP-SGD model")
        dp = self._train_dp(ctx, p, req.model, self._dpcfg(req), "DP-SGD")
        keys = ("accuracy", "precision", "recall", "f1", "roc_auc")
        diff = {
            k: (dp["test"][k] - base["test"][k])
            if dp["test"][k] is not None and base["test"][k] is not None
            else None
            for k in keys
        }
        return {
            "data": self._data_summary(p),
            "models": [self._strip(base), self._strip(dp)],
            "utility_cost": diff,
        }

    def _sweep(self, ctx: Ctx, req: ExperimentRequest) -> dict[str, Any]:
        s = _require(req.sweep, "sweep")
        ctx.stage(0.0, 0.03, "Preparing data")
        p = self._prepare(req)
        n_runs = len(s.epsilons) + 1
        ctx.stage(0.03, 0.03 + 0.97 / n_runs, "Training conventional reference")
        models = [self._strip(self._train_baseline(ctx, p, req.model, "Conventional"))]
        for i, eps in enumerate(s.epsilons, start=1):
            lo = 0.03 + 0.97 * i / n_runs
            ctx.stage(lo, lo + 0.97 / n_runs, f"Training DP-SGD at ε={eps:g}")
            dp = DPConfig(
                target_epsilon=eps, delta=s.delta, max_grad_norm=s.max_grad_norm, accountant=s.accountant
            )
            models.append(self._strip(self._train_dp(ctx, p, req.model, dp, f"DP ε={eps:g}")))
        curve = [
            {
                "target_epsilon": m["privacy"]["target_epsilon"],
                "epsilon": m["privacy"]["epsilon"],
                "noise_multiplier": m["privacy"]["noise_multiplier"],
                "accuracy": m["test"]["accuracy"],
                "f1": m["test"]["f1"],
                "roc_auc": m["test"]["roc_auc"],
                "train_seconds": m["train_seconds"],
            }
            for m in models[1:]
        ]
        return {
            "data": self._data_summary(p),
            "models": models,
            "curve": curve,
            "baseline_accuracy": models[0]["test"]["accuracy"],
        }

    def _federated(self, ctx: Ctx, req: ExperimentRequest) -> dict[str, Any]:
        f = _require(req.federated, "federated")
        ctx.stage(0.0, 0.03, "Preparing data and partitioning clients")
        p = self._prepare(req)
        ctx.stage(0.03, 0.2, "Training centralized reference")
        central = self._train_baseline(ctx, p, req.model, "Centralized reference")
        ctx.stage(0.2, 1.0, "Running federated rounds")
        cfg = FedConfig(**f.model_dump(), seed=req.model.seed)
        model = self._new_model(p, req.model)
        out = run_fedavg(
            model, p.X_train, p.y_train, p.X_test, p.y_test, cfg, self.device, ctx.progress, ctx.stopped
        )
        fmodel = out.pop("model")
        privacy = out["privacy"] if f.privacy != "none" else None
        mid = self._save(ctx.exp_id, "Federated global model", "federated", fmodel, p, out["final"], privacy)
        out["model_id"] = mid
        return {
            "data": self._data_summary(p),
            "federated": out,
            "models": [
                self._strip(central),
                {
                    "label": "Federated global model",
                    "kind": "federated",
                    "model_id": mid,
                    "test": out["final"],
                    "privacy": privacy,
                    "train_seconds": out["seconds"],
                    "parameters": count_parameters(fmodel),
                },
            ],
        }

    def _attack(self, ctx: Ctx, req: ExperimentRequest) -> dict[str, Any]:
        a = _require(req.attack, "attack")
        d = _require(req.data, "data")
        ctx.stage(0.0, 0.03, "Preparing target / shadow splits")
        p = self._prepare(req, test_size=max(d.test_size, 0.5), max_train_rows=d.max_train_rows or 600)
        half = len(p.y_test) // 2
        X_non, y_non = p.X_test[:half], p.y_test[:half]
        X_sh, y_sh = p.X_test[half:], p.y_test[half:]

        def shadow_trainer(X: np.ndarray, y: np.ndarray, seed: int) -> torch.nn.Module:
            m = req.model.model_copy(update={"seed": seed})
            sm = self._new_model(p, m)
            sm, _, _ = train_standard(
                sm, X, y, p.X_test[:50], p.y_test[:50], _cfg(m), self.device, should_stop=ctx.stopped
            )
            return sm

        attr_cols: list[int] = []
        attr = a.attribute
        if attr is None:
            # Pick the low-cardinality categorical feature most informative about the label:
            # the case where an attribute-inference adversary has the best chance.
            df_train = self.store.load(d.dataset_id)
            cands = [c for c in p.encoder.categorical if 2 <= len(p.encoder.categories[c]) <= 8]
            scored = []
            for c in cands:
                sub = df_train[[c, d.target]].dropna()
                scored.append((mutual_info_score(sub[c].astype(str), sub[d.target].astype(str)), c))
            attr = max(scored)[1] if scored else None
        if attr is not None and attr in p.encoder.categorical:
            names = p.encoder.feature_names
            attr_cols = [
                i for i, n in enumerate(names) if n.startswith(f"{attr}=") and not n.endswith("__other__")
            ]

        targets: list[dict[str, Any]] = []
        n_targets = 1 + len(a.epsilons)
        span = 0.97 / n_targets
        for i in range(n_targets):
            lo = 0.03 + span * i
            if i == 0:
                ctx.stage(lo, lo + span * 0.5, "Training conventional target")
                t = self._train_baseline(ctx, p, req.model, "Conventional")
            else:
                eps = a.epsilons[i - 1]
                ctx.stage(lo, lo + span * 0.5, f"Training DP target ε={eps:g}")
                t = self._train_dp(
                    ctx,
                    p,
                    req.model,
                    DPConfig(target_epsilon=eps, delta=a.delta, max_grad_norm=a.max_grad_norm),
                    f"DP ε={eps:g}",
                )
            ctx.stage(lo + span * 0.5, lo + span, f"Attacking {t['label']}")
            target_model = t["_model"]
            mia = membership_inference(
                target_model,
                p.X_train,
                p.y_train,
                X_non,
                y_non,
                shadow_trainer if a.shadow_models > 0 else None,
                X_sh,
                y_sh,
                n_shadow=a.shadow_models,
                max_eval=a.max_eval,
                seed=req.model.seed,
                delta=a.delta,
            )
            t["attack"] = mia
            t["leakage"] = leakage_indicators(t["train"], t["test"], mia)
            if attr_cols:
                ai_mem = attribute_inference(target_model, p.X_train, p.y_train, attr_cols, req.model.seed)
                ai_non = attribute_inference(target_model, X_non, y_non, attr_cols, req.model.seed)
                t["attribute_inference"] = {"attribute": attr, "members": ai_mem, "non_members": ai_non}
            targets.append(self._strip(t))
        return {
            "data": self._data_summary(p),
            "models": targets,
            "setup": {
                "members": len(p.y_train),
                "non_member_pool": int(half),
                "shadow_pool": len(y_sh),
                "shadow_models": a.shadow_models,
                "attribute": attr if attr_cols else None,
                "threat_model": "Black-box query access to softmax outputs; attacker "
                "holds disjoint data from the same distribution.",
            },
        }

    def _pii(self, ctx: Ctx, req: ExperimentRequest) -> dict[str, Any]:
        pii = _require(req.pii, "pii")
        ctx.stage(0.0, 0.2, "Scanning for PII")
        df = self.store.load(pii.dataset_id)
        meta = self.store.get(pii.dataset_id) or {}
        target = pii.target or meta.get("target_hint")
        scan_df = df.drop(columns=[target]) if target in df.columns else df
        result = scan(scan_df)
        rules = list(pii.rules) if pii.rules else recommended_rules(result)
        ctx.stage(0.2, 0.35, "Applying protections")
        tr = apply_rules(df, rules, result["summary"]["quasi_identifiers"], seed=req.model.seed)
        derived = self.store.save(
            tr.data,
            f"{meta.get('name', 'dataset')} (protected)",
            "derived",
            "Output of a PII protection run",
            target_hint=target,
            parent_id=pii.dataset_id,
            meta={"rules": [r.model_dump() for r in rules]},
        )
        after_scan = scan(tr.data.drop(columns=[target]) if target in tr.data.columns else tr.data)
        out: dict[str, Any] = {
            "scan_before": result,
            "scan_after": after_scan,
            "transform": tr.report,
            "derived_dataset_id": derived["id"],
            "rules": [r.model_dump() for r in rules],
        }
        if pii.measure_utility and target and target in df.columns:
            m = req.model.model_copy(update={"epochs": min(req.model.epochs, 15)})
            ctx.stage(0.35, 0.65, "Measuring utility on original data")
            p0 = prepare(df, target, seed=m.seed)
            r0 = self._train_baseline(ctx, p0, m, "Original data")
            ctx.stage(0.65, 1.0, "Measuring utility on protected data")
            p1 = prepare(tr.data, target, seed=m.seed)
            r1 = self._train_baseline(ctx, p1, m, "Protected data")
            out["utility"] = {
                "original": self._strip(r0),
                "protected": self._strip(r1),
                "accuracy_change": r1["test"]["accuracy"] - r0["test"]["accuracy"],
            }
        return out
