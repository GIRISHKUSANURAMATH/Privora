"""Run the five reference experiments (A–E) against the live API and save their results.

Start the backend first (run.ps1 / run.sh), then:  python scripts/run_experiments.py
Results go to docs/results/experiments.json; nothing is fabricated or post-edited.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from ppml.core.reports.generator import redact_for_export

BASE = "http://127.0.0.1:8000"
OUT = Path(__file__).resolve().parents[1] / "docs" / "results" / "experiments.json"


def call(method: str, path: str, body: dict[str, Any] | None = None) -> Any:
    if not path.startswith("/api/"):
        raise ValueError("path must be an /api/ route")
    data = json.dumps(body).encode() if body is not None else None
    # The URL is always the fixed http://127.0.0.1 base plus an /api/ path (checked above).
    req = urllib.request.Request(  # noqa: S310
        BASE + path, data=data, method=method, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310
        txt = r.read().decode()
        return json.loads(txt) if txt else None


def run(body: dict[str, Any]) -> dict[str, Any]:
    e = call("POST", "/api/experiments", body)
    print(f"→ {body['name']} ({e['id'][:8]})", flush=True)
    while True:
        time.sleep(2)
        e = call("GET", f"/api/experiments/{e['id']}")
        print(
            f"   {e['status']:<9} {e['progress'] * 100:5.1f}%  {e.get('message') or ''}", end="\r", flush=True
        )
        if e["status"] in ("completed", "failed", "cancelled"):
            print()
            if e["status"] != "completed":
                raise SystemExit(f"{body['name']} {e['status']}: {e.get('error')}")
            call("POST", f"/api/reports/{e['id']}")
            return e


def main() -> int:
    ds = call("POST", "/api/datasets/synthetic", {"key": "patients", "n": 4000, "seed": 7})
    data = {"dataset_id": ds["id"], "target": "high_risk"}
    model = {"hidden": [64, 32], "epochs": 15, "batch_size": 128, "lr": 0.002, "seed": 42}
    exps = {
        "A_comparison": run(
            {
                "type": "comparison",
                "name": "Experiment A · Conventional vs DP (ε=3)",
                "data": data,
                "model": model,
                "dp": {"target_epsilon": 3.0, "delta": 1e-5},
            }
        ),
        "B_budget_sweep": run(
            {
                "type": "budget_sweep",
                "name": "Experiment B · Privacy budget sweep",
                "data": data,
                "model": model,
                "sweep": {"epsilons": [0.25, 0.5, 1, 2, 4, 8], "delta": 1e-5},
            }
        ),
        "C_federated": run(
            {
                "type": "federated",
                "name": "Experiment C · FedAvg, 10 clients (no DP)",
                "data": data,
                "model": {**model, "epochs": 10},
                "federated": {
                    "num_clients": 10,
                    "rounds": 20,
                    "client_fraction": 0.5,
                    "local_epochs": 2,
                    "lr": 0.05,
                },
            }
        ),
        "C_federated_dirichlet_local_dp": run(
            {
                "type": "federated",
                "name": "Experiment C2 · FedAvg non-IID + local DP-SGD",
                "data": data,
                "model": {**model, "epochs": 10},
                "federated": {
                    "num_clients": 10,
                    "rounds": 20,
                    "client_fraction": 0.5,
                    "local_epochs": 2,
                    "lr": 0.05,
                    "partition": "dirichlet",
                    "dirichlet_alpha": 1.0,
                    "privacy": "local_dp_sgd",
                    "noise_multiplier": 1.0,
                    "delta": 1e-4,
                },
            }
        ),
        "D_attack": run(
            {
                "type": "attack",
                "name": "Experiment D · Membership inference vs DP",
                "data": {**data, "max_train_rows": 600, "test_size": 0.5},
                "model": {"hidden": [256, 128], "epochs": 120, "batch_size": 64, "lr": 0.002, "seed": 7},
                "attack": {"epsilons": [1.0, 8.0], "shadow_models": 3, "max_eval": 1000},
            }
        ),
        "E_pii": run(
            {
                "type": "pii",
                "name": "Experiment E · PII protection",
                "pii": {"dataset_id": ds["id"], "target": "high_risk"},
                "model": {"hidden": [64, 32], "epochs": 12, "seed": 42},
            }
        ),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    exps = {k: redact_for_export(v) for k, v in exps.items()}  # never publish pre-masking rows
    OUT.write_text(json.dumps({"dataset": ds, "experiments": exps}, indent=2, default=str))
    print(f"Saved {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
