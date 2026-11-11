# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Packaging: `.gitignore` used an unanchored `data/` rule, which also excluded the source
  package `backend/ppml/core/data/` from the initial commit, so a fresh clone failed to import.
  The rule is now anchored to the runtime folder (`/data/`) and the package is tracked.
- Windows: `scripts/run_experiments.py` (and `scripts/capture_screenshots.py`, which uses it)
  crashed with `UnicodeEncodeError` when its output was piped or redirected, because Windows
  then encodes stdout with the legacy code page (cp1252), which has no `→` and no Greek `ε`
  (used in experiment names). Both scripts now keep the stream encoding but escape characters
  it cannot represent. Regression tests reproduce the crash under cp1252.
- Charts: axis labels now always match their positions. The ROC axes printed 0.3 and 0.8 at
  the 0.25 and 0.75 gridlines; they use explicit ticks 0, 0.2, ..., 1.0. Percent and decimal
  axes use round steps whose labels the formatter prints exactly, and histogram bin labels keep
  the decimals the bin width needs.
- Charts: long category labels wrap within their band instead of running into each other;
  reference-line labels ("Non-private", "Centralized") moved below the plot, where data points
  cannot cover them; the ROC axis title no longer touches the legend.
- Analytics: chip and model labels are shortened at word boundaries (full name on hover).
- Overview: the "Start something" cards no longer stick out of their panel at phone width;
  every responsive grid has an explicit single column below its breakpoint.
- Sidebar: every item fits above the Collapse bar at 1280 x 720, and the menu scrolls on its own
  at smaller heights.
- `scripts/capture_screenshots.py` type-checks with mypy: Playwright event handlers were
  two-argument lambdas where one-argument handlers are expected, and the viewport was untyped.
- `scripts/capture_screenshots.py` no longer generates a duplicate report for the Reports
  screenshot; it previews the report `run_experiments.py` already wrote and fails if the number
  of saved reports changes.

### Changed
- Product name is **Privora** (previously Umbra) across the UI, HTML metadata, package
  metadata, scripts, Docker files and documentation. The Python package (`ppml`) and the
  `PPML_` environment-variable prefix are unchanged.
- Docker: service, image, volume and container user renamed to `privora` / `privora-data`
  (Docker remains untested).
- Browser storage keys for theme and sidebar state renamed to `privora-theme` /
  `privora-nav`; a previously saved theme or sidebar choice resets once.
- Wording: attack results are described as measuring only the implemented attacks, not as
  bounds on leakage.

### Added
- `scripts/capture_screenshots.py`: regenerates the README screenshots from a fresh,
  isolated instance and checks each page for the product name before capturing.
- Reports: a Preview button on each saved report shows its Markdown without generating it again.
- Screenshot checks: layout probes (`scripts/capture_probes.js`) fail the capture when an element
  sticks out of its container, chart labels overlap each other or a data point, numeric axis
  labels do not sit at the values they name, a notification is still on screen, or a sidebar
  item cannot be reached above the footer (1280 x 720, 600 and 480).

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
  calibrated thresholds, ROC, TPR at low FPR, heuristic attack-implied ε (not a DP audit),
  attribute inference.
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
