# Architecture

Privora is a local, single-user application: a Python backend that does all data handling,
training, privacy accounting and attacks, and a React single-page app that drives it over a
JSON API. Nothing leaves the machine.

```
┌──────────────────────────── Browser (React 18 + TypeScript + Vite) ───────────────────────────┐
│  Overview · Dataset Studio · Privacy Inspector · DP Studio · Federated Studio · Attack Lab     │
│  Experiments · Analytics · Reports · Settings · Documentation                                 │
│  TanStack Query (server state, polling) · Recharts (charts) · Tailwind CSS v4 (design tokens)  │
└───────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                │ fetch /api/*  (same origin in production,
                                                │ Vite proxy in development)
┌───────────────────────────────────────────────▼───────────────────────────────────────────────┐
│ FastAPI app  (ppml.main.create_app)                                                            │
│   middleware: security headers · CSP · body-size guard · CORS (localhost only)                 │
│   routers:    ppml.api.datasets  ·  ppml.api.experiments                                        │
│   static:     serves frontend/dist when it exists (single-port mode)                           │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ExperimentRunner (ThreadPoolExecutor, cancellable jobs, progress persisted to SQLite)          │
│   baseline · dp · comparison · budget_sweep · federated · attack · pii                         │
├───────────────┬────────────────┬───────────────────┬─────────────────┬─────────────────────────┤
│ core.data     │ core.ml        │ core.privacy      │ core.federated  │ core.attacks            │
│  loader       │  models (MLP)  │  dp (Opacus       │  fedavg         │  membership             │
│  pii          │  training      │   DP-SGD)         │   partitioning  │   loss/confidence       │
│  transforms   │  artifacts     │  accounting       │   FedAvg        │   shadow models         │
│  preprocessing│   (weights_only│   RDP / PRV / GDP │   DP-FedAvg     │   attribute inference   │
│  synthetic    │    reload)     │                   │   local DP-SGD  │   leakage indicators    │
│  store        │                │                   │                 │                         │
├───────────────┴────────────────┴───────────────────┴─────────────────┴─────────────────────────┤
│ core.reports — Markdown / HTML / JSON built only from stored experiment records                │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Storage (PPML_DATA_DIR, default ./data):                                                       │
│   ppml.sqlite3  (datasets, experiments, models, reports — parameterised SQL)                   │
│   datasets/<uuid>.csv · artifacts/<uuid>/{weights.pt, model.json, encoder.json} · reports/     │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Request lifecycle of a training job

1. The UI posts an `ExperimentRequest` (Pydantic-validated: types, ranges, allowed enums).
2. The API checks that the dataset and target column exist, inserts a `queued` row and hands
   the job to the worker pool. It returns immediately with `202 Accepted`.
3. The worker loads the CSV, calls `prepare()` (split → fit encoder on the training split only
   → encode), builds a `TabularMLP`, and runs the handler for the experiment type.
4. Training loops call a progress callback (throttled to ~2.5 writes/s) that updates
   `progress`, `message` and `live` (epoch, loss, accuracy, ε) in SQLite.
5. The UI polls `GET /api/experiments/{id}` every second while the job runs.
6. On completion the full results JSON (metrics, histories, privacy ledger, attack curves) is
   stored; each trained model is saved as an artifact and registered in `models`.
7. Reports are rendered on demand from the stored record, so they always match the data.

Cancellation sets a `threading.Event` checked at the start of every epoch / round. If the
server restarts mid-job, jobs left `running` are marked `failed` at the next start-up.

## Module responsibilities

| Module | Responsibility |
|---|---|
| `config.py` | `pydantic-settings` configuration from `PPML_*` environment variables / `.env` |
| `logging_config.py` | JSON logs with e-mail and phone-number scrubbing |
| `db.py` | SQLite wrapper; table/column fragments are allow-listed, values are bound parameters |
| `core/data/loader.py` | Upload validation (extension, size, binary sniffing, UTF-8, row/column limits), profiling, CSV-injection-safe export |
| `core/data/pii.py` | Header + content heuristics, Luhn check, k-anonymity |
| `core/data/transforms.py` | suppress / redact / mask / pseudonymise (HMAC) / generalise / local DP |
| `core/data/preprocessing.py` | JSON-serialisable encoder, train-only fitting |
| `core/ml/*` | MLP without BatchNorm (Opacus-compatible), training/evaluation, safe artifacts |
| `core/privacy/dp.py` | Opacus `PrivacyEngine`, Poisson sampling, per-epoch ε, clip diagnostics |
| `core/privacy/accounting.py` | Stand-alone accountant API used by the calculator and by DP-FedAvg |
| `core/federated/fedavg.py` | Client partitioning, FedAvg, DP-FedAvg, local DP-SGD, communication stats |
| `core/attacks/membership.py` | MIA (3 attacks), calibrated thresholds, ROC, TPR@low-FPR, heuristic attack-implied ε, attribute inference |
| `core/experiments/runner.py` | Orchestration of the seven experiment types |
| `core/reports/generator.py` | Report rendering with HTML escaping |

## Frontend structure

```
frontend/src
├── main.tsx              router (lazy-loaded pages), providers
├── index.css             design tokens (CSS variables for dark/light), Tailwind theme mapping
├── lib/api.ts            typed API client and response types
├── lib/hooks.ts          useExperiment (polling), useRunner (submit + track + toasts)
├── lib/theme.tsx         theme provider, chart colours resolved from CSS variables
├── components/ui.tsx     Button, Panel, Stat, Badge, inputs, Slider, Segmented, Toggle, Tip,
│                         Progress, Empty, ErrorNote, Callout, Toasts, Confirm, Tabs, KV
├── components/charts.tsx Lines, Bars, ROC, PrivacyUtility (Recharts wrappers with a11y captions)
├── components/shared.tsx DatasetPicker, ModelParamsForm, RunStatus, MetricsTable, PrivacyLedger…
├── components/views.tsx  result views per experiment type (training, sweep, FL, attack, PII)
└── pages/*.tsx           one file per page
```

## Design decisions

* **React + FastAPI instead of Streamlit** — the brief required a custom, premium UI with
  routing, state and fine-grained interaction; Streamlit's layout model cannot deliver that.
* **Threads, not Celery/Redis** — a single-user local tool does not justify a broker. The pool
  size is configurable; PyTorch releases the GIL in its kernels.
* **SQLite + files** — zero setup on Windows; metadata is small and relational.
* **No unrestricted unpickling** — encoder state and model architecture are JSON; weights are a plain
  `state_dict` reloaded with `weights_only=True`.
* **MLP for tabular data** — compatible with Opacus per-sample gradients, fast on CPU, and the
  same architecture is used across conventional, DP, federated and attack experiments so
  comparisons are like-for-like.
