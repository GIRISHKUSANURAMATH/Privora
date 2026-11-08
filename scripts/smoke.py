"""Fast end-to-end smoke test of every engine. Used by verify.ps1 / verify.sh.

Runs in an isolated temporary data directory, prints one line per check, and exits non-zero on
any failure. Usage:  python scripts/smoke.py
"""

from __future__ import annotations

import sys
import tempfile
import time
import traceback
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from ppml.config import Settings
from ppml.core.data.store import DatasetStore
from ppml.core.data.synthetic import generate_patients
from ppml.core.experiments.runner import ExperimentRunner
from ppml.core.experiments.schemas import ExperimentRequest
from ppml.core.ml.artifacts import load_model
from ppml.core.reports.generator import markdown_to_html, to_markdown
from ppml.db import Database

FAST = {"hidden": [16], "epochs": 2, "batch_size": 64, "lr": 0.003, "seed": 1}


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="ppml-smoke-"))
    s = Settings(data_dir=tmp)
    s.ensure_dirs()
    db = Database(s.db_path)
    store = DatasetStore(s.datasets_dir, db)
    import torch

    runner = ExperimentRunner(db, store, s.artifacts_dir, torch.device("cpu"))
    ds = store.save(generate_patients(900, seed=5), "smoke", "synthetic", target_hint="high_risk")
    data = {"dataset_id": ds["id"], "target": "high_risk"}
    results: dict[str, dict] = {}
    failures = 0

    def check(name: str, fn: Callable[[], str]) -> None:
        nonlocal failures
        t0 = time.perf_counter()
        try:
            detail = fn()
            print(f"[PASS] {name:<34} {time.perf_counter() - t0:6.1f}s  {detail}")
        except Exception as exc:  # noqa: BLE001 - report and continue
            failures += 1
            print(f"[FAIL] {name:<34} {exc}")
            traceback.print_exc(limit=2)

    def run(key: str, body: dict) -> dict:
        e = runner.run_sync(ExperimentRequest(**body))
        if e["status"] != "completed":
            raise RuntimeError(e.get("error"))
        results[key] = e
        return e

    def ml() -> str:
        e = run("ml", {"type": "baseline", "data": data, "model": FAST})
        return f"accuracy={e['results']['models'][0]['test']['accuracy']:.3f}"

    def dp() -> str:
        e = run("dp", {"type": "dp", "data": data, "model": FAST, "dp": {"target_epsilon": 2.0}})
        p = e["results"]["models"][0]["privacy"]
        if not 0 < p["epsilon"] <= 2.05:
            raise AssertionError(f"epsilon {p['epsilon']} outside (0, 2]")
        return f"epsilon={p['epsilon']:.3f} sigma={p['noise_multiplier']:.3f} steps={p['steps']}"

    def fl() -> str:
        e = run(
            "fl",
            {
                "type": "federated",
                "data": data,
                "model": FAST,
                "federated": {"num_clients": 4, "rounds": 3, "privacy": "client_dp"},
            },
        )
        f = e["results"]["federated"]
        acc, eps = f["final"]["accuracy"], f["privacy"]["epsilon"]
        return f"rounds={len(f['rounds'])} accuracy={acc:.3f} eps={eps:.2f}"

    def attack() -> str:
        e = run(
            "attack",
            {
                "type": "attack",
                "data": {**data, "max_train_rows": 150},
                "model": FAST,
                "attack": {"epsilons": [2.0], "shadow_models": 1, "max_eval": 200},
            },
        )
        aucs = [m["attack"]["best_attack_auc"] for m in e["results"]["models"]]
        return "auc=" + ", ".join(f"{a:.3f}" for a in aucs)

    def pii() -> str:
        e = run("pii", {"type": "pii", "pii": {"dataset_id": ds["id"], "measure_utility": False}})
        r = e["results"]
        return (
            f"risk {r['scan_before']['summary']['risk_score']} -> {r['scan_after']['summary']['risk_score']}"
        )

    def reload() -> str:
        mid = results["dp"]["results"]["models"][0]["model_id"]
        _model, enc, _ = load_model(s.artifacts_dir, mid)
        return f"reloaded {mid[:8]} features={enc.n_features}"

    def report() -> str:
        md = to_markdown(results["dp"], ds)
        html = markdown_to_html(md, "smoke")
        if "Privacy accounting" not in md or "<table>" not in html:
            raise AssertionError("report missing sections")
        return f"markdown={len(md)} chars html={len(html)} chars"

    check("Conventional ML training", ml)
    check("Differential privacy (DP-SGD)", dp)
    check("Federated learning (DP-FedAvg)", fl)
    check("Membership inference attack", attack)
    check("PII detection and masking", pii)
    check("Model artifact save/reload", reload)
    check("Report generation", report)
    print(f"\n{7 - failures}/7 smoke checks passed (data dir: {tmp})")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
