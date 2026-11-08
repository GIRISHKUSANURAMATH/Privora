# Threat Model

Scope: Umbra as shipped — a local, single-user research tool started with `run.ps1` and bound
to `127.0.0.1`. This document follows a STRIDE-style walk through assets, actors, surfaces
and trust boundaries. It is a design review, **not** a penetration test.

## 1. Assets

| Asset | Why it matters |
|---|---|
| Uploaded datasets (`data/datasets/*.csv`) | May contain personal data if a user uploads real data |
| Trained model weights (`data/artifacts/`) | Can leak training data (that is what the Attack Lab measures) |
| Experiment results / reports | Contain aggregate statistics and sample rows (before/after previews) |
| Host machine | Code execution via unsafe deserialisation or path traversal would compromise it |
| Integrity of privacy claims | A wrong ε or an overstated guarantee misleads users about real risk |

## 2. Threat actors

1. **Malicious file** — a crafted CSV supplied to the user (CSV injection, oversized/binary
   content, path-like names).
2. **Malicious web page in the user's browser** — attempts cross-origin requests to
   `127.0.0.1:8000` (CSRF-style, DNS rebinding).
3. **Malicious model artifact** — a `weights.pt` swapped on disk to achieve code execution on load.
4. **Model consumer / attacker with query access** — the privacy adversary studied by the Attack Lab.
5. **Honest-but-curious federated server** — sees client updates (simulated).
6. **Local user with network exposure** — runs the server on `0.0.0.0` by mistake.

## 3. Trust boundaries and attack surfaces

```
[ user files ] ──upload──▶ │ FastAPI │ ──▶ [ data dir ]
[ browser tab ] ──HTTP──▶  │ 127.0.0.1:8000 │
[ other sites ] ──CORS?──▶ │                │
                           └── worker threads (training, attacks)
```

* HTTP API (`/api/*`) — JSON bodies, multipart upload, query parameters, path parameters.
* File system — dataset, artifact and report paths.
* Deserialisation — CSV parsing, model weight loading.
* Output rendering — exported CSV opened in spreadsheets; HTML reports opened in browsers.

## 4. Threats and mitigations

| # | Threat (STRIDE) | Mitigation in code | Location |
|---|---|---|---|
| T1 | Path traversal via dataset/model/report IDs (T, I) | IDs must match `^[a-f0-9]{32}$`; resolved paths checked to stay under their root; user filenames are display-only and sanitised | `store.py`, `artifacts.py`, `loader.sanitize_filename` |
| T2 | Oversized upload / disk-filling DoS (D) | ASGI body-size guard that counts streamed bytes and answers 413 before multipart parsing (also covers chunked requests with no `Content-Length`), per-file byte limit, row/column limits, `nrows` cap in pandas | `security.py`, `api/datasets.py`, `loader.py` |
| T3 | Non-CSV or binary file (T) | Extension allow-list, NUL-byte sniffing, strict UTF-8 decoding, `on_bad_lines="error"` | `loader.parse_tabular` |
| T4 | CSV/formula injection on export (E on the user's spreadsheet) | Cells starting with `= + - @ \t \r` are prefixed with `'` | `loader.neutralize_formulas` |
| T5 | Code execution via pickled weights (E) | `torch.load(weights_only=True)`; encoder/architecture as JSON; no `pickle`/`joblib` | `artifacts.py`, test `test_reload_rejects_pickled_objects` |
| T6 | SQL injection (T) | All values bound; the few identifier fragments are allow-listed | `db.py` |
| T7 | XSS via dataset content in UI or HTML report (T) | React escapes by default, no `dangerouslySetInnerHTML`; report renderer `html.escape`s every cell; CSP `script-src 'self'` | `generator.py`, `main.py` |
| T8 | Cross-origin requests from other sites (S) | CORS allows only the two localhost dev origins; no cookies/credentials exist; JSON content type required for writes (non-simple request → preflight) | `main.py` |
| T9 | Clickjacking (T) | `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'` | `main.py` |
| T10 | Sensitive data in logs (I) | JSON logger scrubs e-mails and phone-like strings; dataset contents are never logged | `logging_config.py` |
| T11 | Stack traces leaking internals (I) | Generic 500 handler; validation errors return field locations only | `main.py` |
| T12 | Overstated privacy guarantees (integrity of claims) | ε only ever comes from Opacus accountants; assumptions listed with every result; FedAvg without DP labelled "no formal guarantee"; heuristic PII scan carries a disclaimer | `dp.py`, `fedavg.py`, `pii.py`, UI |
| T13 | Membership / attribute inference on released models (I) | DP-SGD, DP-FedAvg, local DP-SGD; the Attack Lab quantifies residual leakage | `privacy/`, `attacks/` |
| T14 | Untrusted FL server reading updates (I) | Local DP-SGD mode privatises each client's update before upload (simulated) | `fedavg.py` |
| T15 | Vulnerable dependencies (E) | `pip-audit` and `npm audit` in verification | `verify.ps1` |
| T16 | DNS rebinding: a malicious site resolves its own domain to 127.0.0.1 and reads the API (I) | `TrustedHostMiddleware` answers only `127.0.0.1`, `localhost`, `[::1]` (configurable via `PPML_ALLOWED_HOSTS`); others get 400 | `main.py`, `config.py` |
| T17 | Original PII leaking through shared reports (I) | Exported reports (JSON/MD/HTML) never include the pre-masking sample rows kept for the local before/after view | `reports/generator.py::redact_for_export` |

## 5. Security assumptions

* The machine and the user account running Umbra are trusted.
* The server is bound to `127.0.0.1` (default). Docker publishes on `127.0.0.1` only.
* Only one person uses the instance; there is **no authentication or authorisation**.
* The browser enforces CORS and CSP correctly.
* Synthetic data is used unless the user deliberately uploads something else.

## 6. Residual risks (not mitigated)

* **No authentication.** Anyone who can reach the port can read datasets and start jobs.
  Exposing it on a LAN (`PPML_HOST=0.0.0.0`) is unsafe.
* **Local before/after samples** — the SQLite store keeps 8 original rows per PII-protection run
  so the UI can show the comparison. They never leave the machine via reports, but they are in
  `data/` until the experiment is deleted.
* **Resource exhaustion by legitimate-looking jobs** — large epoch counts or sweeps can occupy
  the CPU for a long time; only the concurrent-job limit bounds it.
* **Data at rest is not encrypted.** Datasets and artifacts are plain files in `data/`.
* **Non-cryptographic noise RNG** by default in DP-SGD (Opacus `secure_mode=False`). Floating-point
  side channels in noise sampling (Mironov 2012) are not addressed.
* **Privacy accounting does not cover** preprocessing statistics, hyper-parameter search across
  runs, or users who contribute several rows.
* **PII detection is heuristic** and will miss identifiers (e.g. free-text notes, non-Latin names).
* **Simulated FL** has no transport security, secure aggregation or Byzantine-robust aggregation.

## 7. Evidence

Static analysis (Bandit, Ruff security rules), dependency audits and the automated tests that
exercise T1–T7 and T11 are listed in [`VERIFICATION_REPORT.md`](VERIFICATION_REPORT.md).
No external penetration test has been performed, and no compliance certification is claimed.
