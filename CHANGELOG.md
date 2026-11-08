# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-11-08

### Added
- Dataset Studio: synthetic data generators (patients, credit), CSV/TSV upload with validation,
  profiling, data-quality score, paginated preview, safe export.
- Privacy Inspector: heuristic PII detection (header + content + Luhn), k-anonymity, seven
  protection actions including local DP (Laplace / randomized response), before/after comparison.
- Differential Privacy Studio: Opacus DP-SGD with Poisson sampling, target-ε or fixed-σ modes,
  RDP and PRV accountants, live budget calculator, conventional-vs-DP comparison, budget sweeps.
- Federated Learning Studio: FedAvg with IID / Dirichlet partitions, DP-FedAvg (client-level DP),
  local DP-SGD per client, communication statistics, participation grid.
- Attack Laboratory: loss / confidence threshold and shadow-model membership inference,
  calibrated thresholds, ROC, TPR at low FPR, empirical ε lower bound, attribute inference.
- Experiments, Analytics and Reports (Markdown / HTML / JSON) built from stored results.
- React + TypeScript UI with dark (default) and light themes, responsive layout, accessibility.
- FastAPI backend with SQLite metadata, safe model artifacts, security headers.
- PowerShell `setup.ps1`, `run.ps1`, `verify.ps1`; Dockerfile and docker-compose.
- pytest suite, Vitest tests, smoke tests, documentation set.

### Security (pre-release audit)
- Request bodies are limited while streaming, before multipart parsing; chunked uploads with no
  `Content-Length` can no longer bypass the upload limit.
- Host-header allow-list (`PPML_ALLOWED_HOSTS`) blocks DNS-rebinding access to the local API.
- Exported reports no longer include original pre-masking sample rows from PII-protection runs.
- Content-Security-Policy no longer allows third-party font hosts (fonts are self-hosted).

### Fixed (pre-release audit)
- Windows: `verify.ps1` dependency check failed under PowerShell 5.1 quoting; `/api/system`
  memory reporting now works on Windows, Linux and macOS.
- App crash on route change in browsers whose `window.scrollTo` returns a Promise.
- Dashboard no longer mixes client-level and example-level ε in one summary.

### Changed (pre-release audit)
- "Empirical ε lower bound" renamed to "attack-implied ε (heuristic)", since a single training run
  is not a valid DP audit. JSON field: `attack_implied_epsilon`.
