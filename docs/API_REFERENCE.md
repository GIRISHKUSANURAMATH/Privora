# API Reference

Base URL: `http://127.0.0.1:8000`. All endpoints are JSON unless noted. Interactive OpenAPI
docs are served at **`/api/docs`** while the backend runs (schema at `/api/openapi.json`).

Errors return `{"detail": "..."}`; validation errors return
`{"detail": "Validation failed", "errors": [{"loc": [...], "msg": "..."}]}` with status 422.

## System

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | `{"status": "ok", "version"}` |
| GET | `/api/system` | Python / torch / Opacus versions, device, CPU count, configured limits |
| GET | `/api/dashboard` | Aggregates for the overview page (totals, ε range, model points, attacks, recent) |

## Datasets

| Method | Path | Description |
|---|---|---|
| GET | `/api/datasets` | List datasets |
| GET | `/api/datasets/synthetic/catalog` | Available synthetic generators |
| POST | `/api/datasets/synthetic` | `{"key": "patients"\|"credit", "n": 200–100000, "seed"?}` → 201 |
| POST | `/api/datasets/upload` | multipart `file` (.csv/.tsv/.txt, UTF-8, size-limited) → 201, 413, 422 |
| GET | `/api/datasets/{id}` | Metadata + `profile` (stats, quality) + 25-row `preview` |
| GET | `/api/datasets/{id}/rows?offset&limit` | Paginated rows (limit ≤ 500) |
| GET | `/api/datasets/{id}/pii` | PII scan: findings per column, summary, k-anonymity |
| POST | `/api/datasets/{id}/transform` | `{"rules": [ColumnRule], "save": bool, "name"?}` → before/after report, optional new dataset |
| GET | `/api/datasets/{id}/export` | CSV download with formula-injection protection |
| DELETE | `/api/datasets/{id}` | 204 |

`ColumnRule`: `{"column", "action": keep|suppress|redact|mask|pseudonymize|generalize|local_dp,
"bin_width"?, "keep_chars"?, "epsilon"?, "lower"?, "upper"?}`

## Privacy accounting

| Method | Path | Description |
|---|---|---|
| GET | `/api/privacy/accountants` | Names, references and rigour notes for rdp / prv / gdp |
| POST | `/api/privacy/calculator` | `{"n", "batch_size", "epochs", "delta", "noise_multiplier"? or "target_epsilon"?, "accountant"}` → σ, ε, q, steps, accountant comparison, ε-vs-steps curve |

## Experiments

| Method | Path | Description |
|---|---|---|
| POST | `/api/experiments` | Submit an `ExperimentRequest` → 202 with the queued record |
| GET | `/api/experiments?type=` | List (results omitted, `headline` summary included) |
| GET | `/api/experiments/{id}` | Full record incl. `progress`, `live`, `results`, `error` |
| POST | `/api/experiments/{id}/cancel` | Request cancellation (checked each epoch/round) |
| DELETE | `/api/experiments/{id}` | 204; 409 while running |

`ExperimentRequest`:

```jsonc
{
  "type": "baseline | dp | comparison | budget_sweep | federated | attack | pii",
  "name": "optional label",
  "data":  { "dataset_id": "<32 hex>", "target": "high_risk", "exclude": [], "auto_exclude_pii": true,
             "test_size": 0.3, "max_train_rows": null },
  "model": { "hidden": [64, 32], "dropout": 0, "activation": "relu", "epochs": 15, "batch_size": 64,
             "lr": 0.001, "optimizer": "adam", "weight_decay": 0, "seed": 42 },
  "dp":    { "target_epsilon": 3.0, "noise_multiplier": null, "delta": 1e-5, "max_grad_norm": 1.0,
             "accountant": "rdp" },                                    // dp, comparison
  "sweep": { "epsilons": [0.5, 1, 2, 4, 8], "delta": 1e-5, "max_grad_norm": 1.0 },   // budget_sweep
  "federated": { "num_clients": 8, "rounds": 15, "client_fraction": 0.5, "local_epochs": 2,
                 "batch_size": 32, "lr": 0.05, "partition": "iid|dirichlet", "dirichlet_alpha": 0.5,
                 "privacy": "none|client_dp|local_dp_sgd", "clip_norm": 1.0, "noise_multiplier": 1.0,
                 "delta": 1e-5 },
  "attack": { "epsilons": [1, 8], "shadow_models": 3, "max_eval": 1000, "attribute": null, "delta": 1e-5 },
  "pii":    { "dataset_id": "...", "target": "high_risk", "rules": null, "measure_utility": true }
}
```

`results` shape (abridged): `data` (split sizes, features used/excluded), `models[]` (each with
`test`/`train` metrics, `history`, `privacy` ledger, `model_id`), plus `utility_cost`
(comparison), `curve` (sweep), `federated` (rounds, clients, communication, privacy),
`attack`/`leakage`/`attribute_inference` per model and `setup` (attack), or
`scan_before`/`scan_after`/`transform`/`utility` (pii).

## Models

| Method | Path | Description |
|---|---|---|
| GET | `/api/models` | Saved artifacts with metrics and privacy ledger |
| POST | `/api/models/{id}/evaluate` | `{"dataset_id"}` — reloads weights from disk (`weights_only=True`) and evaluates |

## Reports

| Method | Path | Description |
|---|---|---|
| POST | `/api/reports/{experiment_id}` | Generate (completed experiments only, else 409) → record + Markdown |
| GET | `/api/reports` | List |
| GET | `/api/reports/{id}/download?format=md\|html\|json` | Download |
| DELETE | `/api/reports/{id}` | 204 |
