"""Experiment, model, privacy-calculator, report and dashboard endpoints."""

from __future__ import annotations

import os
import platform
import sys
import uuid
from typing import Any, Literal

import numpy as np
import opacus
import sklearn
import torch
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ppml import __version__
from ppml.api.deps import AppState, get_state, not_found
from ppml.core.experiments.schemas import ExperimentRequest
from ppml.core.ml.artifacts import load_model
from ppml.core.ml.training import evaluate
from ppml.core.privacy.accounting import ACCOUNTANT_INFO, calculator
from ppml.core.reports.generator import markdown_to_html, to_json, to_markdown
from ppml.db import now
from ppml.system_info import total_memory_gb

router = APIRouter(prefix="/api", tags=["experiments"])


class CalcRequest(BaseModel):
    n: int = Field(ge=2, le=10_000_000)
    batch_size: int = Field(ge=1)
    epochs: int = Field(ge=1, le=1000)
    delta: float = Field(gt=0, lt=1)
    noise_multiplier: float | None = Field(default=None, ge=0.05, le=50)
    target_epsilon: float | None = Field(default=None, ge=0.01, le=100)
    accountant: Literal["rdp", "prv", "gdp"] = "rdp"


class EvalRequest(BaseModel):
    dataset_id: str = Field(pattern=r"^[a-f0-9]{32}$")


# ---------------------------------------------------------------- system
@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@router.get("/system")
def system(state: AppState = Depends(get_state)) -> dict[str, Any]:
    s = state.settings
    mem_gb = total_memory_gb()
    return {
        "version": __version__,
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "cpu_count": os.cpu_count(),
        "memory_gb": mem_gb,
        "torch": torch.__version__,
        "opacus": opacus.__version__,
        "sklearn": sklearn.__version__,
        "numpy": np.__version__,
        "cuda_available": torch.cuda.is_available(),
        "device": str(state.device),
        "limits": {
            "max_upload_mb": s.max_upload_mb,
            "max_rows": s.max_rows,
            "max_columns": s.max_columns,
            "max_concurrent_jobs": s.max_concurrent_jobs,
        },
    }


# ---------------------------------------------------------------- privacy
@router.get("/privacy/accountants")
def accountants() -> dict[str, Any]:
    return ACCOUNTANT_INFO


@router.post("/privacy/calculator")
def privacy_calculator(body: CalcRequest) -> dict[str, Any]:
    try:
        return calculator(
            body.n,
            body.batch_size,
            body.epochs,
            body.delta,
            body.noise_multiplier,
            body.target_epsilon,
            body.accountant,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


# ---------------------------------------------------------------- experiments
def _summary(e: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in e.items() if k not in ("results",)}
    r = e.get("results") or {}
    out["headline"] = _headline(e["type"], r)
    return out


def _headline(t: str, r: dict[str, Any]) -> dict[str, Any] | None:
    if not r:
        return None
    if t == "pii":
        return {
            "risk_before": r["scan_before"]["summary"]["risk_score"],
            "risk_after": r["scan_after"]["summary"]["risk_score"],
        }
    models = r.get("models") or []
    if not models:
        return None
    last = models[-1]
    h: dict[str, Any] = {
        "accuracy": last.get("test", {}).get("accuracy"),
        "epsilon": (last.get("privacy") or {}).get("epsilon"),
    }
    if t == "attack":
        h["attack_auc"] = {m["label"]: m["attack"]["best_attack_auc"] for m in models}
    return h


@router.post("/experiments", status_code=202)
def create_experiment(body: ExperimentRequest, state: AppState = Depends(get_state)) -> dict[str, Any]:
    ds = body.data.dataset_id if body.data else body.pii.dataset_id if body.pii else None
    meta = state.store.get(ds) if ds else None
    if meta is None:
        raise not_found("Dataset")
    if body.data:
        cols = state.store.load(body.data.dataset_id).columns
        if body.data.target not in cols:
            raise HTTPException(422, f"Target column '{body.data.target}' not in dataset")
    try:
        return state.runner.submit(body)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/experiments")
def list_experiments(
    type: str | None = Query(None, pattern="^[a-z_]{2,20}$"), state: AppState = Depends(get_state)
) -> list[dict[str, Any]]:
    rows = state.db.list("experiments", "type = ?", [type]) if type else state.db.list("experiments")
    return [_summary(e) for e in rows]


@router.get("/experiments/{exp_id}")
def get_experiment(exp_id: str, state: AppState = Depends(get_state)) -> dict[str, Any]:
    e = state.db.get("experiments", exp_id)
    if e is None:
        raise not_found("Experiment")
    return e


@router.post("/experiments/{exp_id}/cancel")
def cancel_experiment(exp_id: str, state: AppState = Depends(get_state)) -> dict[str, bool]:
    if state.db.get("experiments", exp_id) is None:
        raise not_found("Experiment")
    return {"cancelled": state.runner.cancel(exp_id)}


@router.delete("/experiments/{exp_id}", status_code=204)
def delete_experiment(exp_id: str, state: AppState = Depends(get_state)) -> Response:
    e = state.db.get("experiments", exp_id)
    if e is None:
        raise not_found("Experiment")
    if e["status"] in ("queued", "running"):
        raise HTTPException(409, "Cancel the experiment before deleting it")
    state.db.delete("experiments", exp_id)
    return Response(status_code=204)


# ---------------------------------------------------------------- models
@router.get("/models")
def list_models(state: AppState = Depends(get_state)) -> list[dict[str, Any]]:
    return state.db.list("models")


@router.post("/models/{model_id}/evaluate")
def evaluate_model(model_id: str, body: EvalRequest, state: AppState = Depends(get_state)) -> dict[str, Any]:
    """Reload a saved artifact from disk (weights_only) and evaluate it on a dataset."""
    if state.db.get("models", model_id) is None:
        raise not_found("Model")
    if state.store.get(body.dataset_id) is None:
        raise not_found("Dataset")
    try:
        model, enc, meta = load_model(state.settings.artifacts_dir, model_id)
        df = state.store.load(body.dataset_id)
        missing = [c for c in [*enc.numeric, *enc.categorical, enc.target] if c not in df.columns]
        if missing:
            raise HTTPException(422, f"Dataset lacks columns required by the model: {missing}")
        df = df.dropna(subset=[enc.target])
        metrics = evaluate(model, enc.transform(df), enc.transform_target(df))
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {
        "model_id": model_id,
        "reloaded_from_disk": True,
        "meta": meta,
        "note": "Evaluated on the full dataset (includes training rows).",
        "metrics": metrics,
    }


# ---------------------------------------------------------------- reports
@router.post("/reports/{exp_id}", status_code=201)
def create_report(exp_id: str, state: AppState = Depends(get_state)) -> dict[str, Any]:
    e = state.db.get("experiments", exp_id)
    if e is None:
        raise not_found("Experiment")
    if e["status"] != "completed":
        raise HTTPException(409, "Reports can only be generated for completed experiments")
    ds = state.store.get(e["dataset_id"]) if e.get("dataset_id") else None
    md = to_markdown(e, ds)
    rid = uuid.uuid4().hex
    path = state.settings.reports_dir / f"{rid}.md"
    path.write_text(md, encoding="utf-8")
    rec = {"id": rid, "experiment_id": exp_id, "title": e["name"], "created_at": now()}
    state.db.insert("reports", rec)
    return {**rec, "markdown": md}


@router.get("/reports")
def list_reports(state: AppState = Depends(get_state)) -> list[dict[str, Any]]:
    out = []
    for r in state.db.list("reports"):
        e = state.db.get("experiments", r["experiment_id"])
        out.append({**r, "experiment_type": e["type"] if e else None, "experiment_exists": bool(e)})
    return out


@router.get("/reports/{report_id}/download")
def download_report(
    report_id: str, format: Literal["md", "html", "json"] = "md", state: AppState = Depends(get_state)
) -> Response:
    r = state.db.get("reports", report_id)
    if r is None:
        raise not_found("Report")
    e = state.db.get("experiments", r["experiment_id"])
    if e is None:
        raise not_found("Experiment")
    ds = state.store.get(e["dataset_id"]) if e.get("dataset_id") else None
    base = f"ppml-report-{e['type']}-{report_id[:8]}"
    if format == "json":
        return Response(
            to_json(e, ds),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{base}.json"'},
        )
    md = to_markdown(e, ds)
    if format == "html":
        return Response(
            markdown_to_html(md, e["name"]),
            media_type="text/html",
            headers={"Content-Disposition": f'attachment; filename="{base}.html"'},
        )
    return Response(
        md, media_type="text/markdown", headers={"Content-Disposition": f'attachment; filename="{base}.md"'}
    )


@router.delete("/reports/{report_id}", status_code=204)
def delete_report(report_id: str, state: AppState = Depends(get_state)) -> Response:
    if state.db.get("reports", report_id) is None:
        raise not_found("Report")
    p = state.settings.reports_dir / f"{report_id}.md"
    if p.exists() and p.parent == state.settings.reports_dir:
        p.unlink()
    state.db.delete("reports", report_id)
    return Response(status_code=204)


# ---------------------------------------------------------------- dashboard
@router.get("/dashboard")
def dashboard(state: AppState = Depends(get_state)) -> dict[str, Any]:
    exps = state.db.list("experiments")
    models = state.db.list("models")
    datasets = state.store.list()
    completed = [e for e in exps if e["status"] == "completed"]
    by_type: dict[str, int] = {}
    for e in exps:
        by_type[e["type"]] = by_type.get(e["type"], 0) + 1
    points = []
    for m in models:
        pv = m.get("privacy") or {}
        met = m.get("metrics") or {}
        points.append(
            {
                "model_id": m["id"],
                "label": m["label"],
                "kind": m["kind"],
                "experiment_id": m["experiment_id"],
                "accuracy": met.get("accuracy"),
                "f1": met.get("f1"),
                "epsilon": pv.get("epsilon"),
                # Records written before units were stored are DP-SGD (example-level) or DP-FedAvg.
                "privacy_unit": pv.get("unit")
                or ("client" if pv.get("mode") == "client_dp" else "example" if pv else None),
                "created_at": m["created_at"],
            }
        )
    # ε values with different units are not comparable; the summary covers example-level only.
    eps_values = [p["epsilon"] for p in points if p["epsilon"] is not None and p["privacy_unit"] == "example"]
    fed_clients = 0
    for e in completed:
        if e["type"] == "federated":
            fed_clients = max(fed_clients, len(e["results"]["federated"]["clients"]))
    attacks = []
    for e in completed:
        if e["type"] == "attack":
            for m in e["results"]["models"]:
                attacks.append(
                    {
                        "experiment_id": e["id"],
                        "label": m["label"],
                        "auc": m["attack"]["best_attack_auc"],
                        "epsilon": (m.get("privacy") or {}).get("epsilon"),
                    }
                )
    return {
        "totals": {
            "experiments": len(exps),
            "completed": len(completed),
            "running": sum(1 for e in exps if e["status"] in ("running", "queued")),
            "failed": sum(1 for e in exps if e["status"] == "failed"),
            "models": len(models),
            "dp_models": sum(1 for p in points if p["epsilon"] is not None),
            "datasets": len(datasets),
            "reports": len(state.db.list("reports")),
            "federated_clients": fed_clients,
        },
        "by_type": by_type,
        "privacy_budget": {
            "min_epsilon": min(eps_values) if eps_values else None,
            "max_epsilon": max(eps_values) if eps_values else None,
            "median_epsilon": float(np.median(eps_values)) if eps_values else None,
            "unit": "example",
            "client_level_models": sum(1 for p in points if p["privacy_unit"] == "client"),
        },
        "model_points": points,
        "attacks": attacks,
        "recent": [_summary(e) for e in exps[:8]],
        "recent_reports": state.db.list("reports", limit=5),
    }
