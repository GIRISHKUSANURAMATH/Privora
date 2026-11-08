# Verification Report

Version 1.0.0 · last updated 8 November 2026 (pre-publication release audit)

Everything below was executed, not estimated. Anything not executed is marked **NOT VERIFIED**
with the reason. Results reported by the project owner are labelled as such.

## 1. Environments

| Environment | Who ran it | Used for |
|---|---|---|
| **Windows PC** ("dell"), Windows PowerShell, project folder on `D:` | Project owner, by hand | `setup.ps1`, `verify.ps1` runs 1–2 (§2). A run after the release audit is still to do (§10) |
| Linux x86-64 build container, 2 CPU cores, 8.4 GB RAM, no GPU; Python 3.13.18, Node 22.23, PowerShell 7.4.6, Chromium via Playwright, axe-core 4.14 | Build agent | Everything else in this report |

Versions: torch 2.15.0 (run on CPU), opacus 1.6.0, numpy 2.5.4, pandas 3.1.1, scipy 1.18.1,
scikit-learn 1.9.1, fastapi 0.162.2, uvicorn 0.54.0, pydantic 2.14.3, pytest 9.2.0, ruff 0.17.4,
mypy 2.4.1, bandit 1.9.4, pip-audit 2.10.1; react 18.3.1, react-router-dom 7.18.5, vite 6.4.5,
typescript 5.9.3, tailwindcss 4.3.5, vitest 5.1.0.

## 2. Windows history (reported by the project owner)

| Run | Result | Notes |
|---|---|---|
| 1 | 14 passed, 2 failed | PowerShell 5.1 quote stripping in `verify.ps1`; `os.sysconf_names` missing on Windows (mypy). Both fixed, see §3 |
| 2 | **16 passed, 0 failed, 0 skipped** | After the fixes in §3 |
| 3 | **pending** | Needed because the release audit (§4–§7) changed code after run 2 |

## 3. Windows fixes (after run 1)

| Failure | Root cause | Fix |
|---|---|---|
| `NameError: name 'cuda' is not defined` | Windows PowerShell 5.1 strips embedded double quotes from native-command arguments, so the inline `python -c` snippet's string literals became bare names | `scripts/check_env.py`, a script file instead of an inline snippet |
| mypy: `os` has no attribute `sysconf_names` | `os.sysconf` does not exist on Windows; memory reporting never worked there | `backend/ppml/system_info.py`: `GlobalMemoryStatusEx` on Windows, `sysctlbyname` on macOS, `sysconf` elsewhere |
| App crash on route change (found by the browser walkthrough) | `useEffect(() => window.scrollTo(0, 0))` returned the Promise that current Chromium's `scrollTo` returns | Block-bodied effects, plus regression and static guard tests |

## 4. Release audit: security findings

| # | Severity | Finding | Evidence | Fix | Verified by |
|---|---|---|---|---|---|
| S1 | **Medium** | Upload size limit bypassable with chunked transfer encoding | A 31.5 MB chunked request was fully accepted, then rejected with 413; Starlette spools multipart bodies to disk before the endpoint runs, so multi-GB requests could fill the disk | `ppml/security.py` `BodySizeLimitMiddleware` counts streamed bytes and answers 413 before parsing | A 300 MB chunked upload to the real server is cut off at ≈ 26 MB; tests `test_chunked_upload_over_limit_rejected`, `test_body_limit_stops_reading_the_stream`, `test_declared_content_length_over_limit_rejected` |
| S2 | **Medium** | Any `Host` header accepted, the precondition for DNS rebinding (a malicious web page reading the local API) | `Host: evil.example` → 200 | `TrustedHostMiddleware`, `PPML_ALLOWED_HOSTS` defaulting to `127.0.0.1`, `localhost`, `[::1]` | `Host: evil.example` → 400 on the real server; `test_foreign_host_header_rejected` |
| S3 | **Medium** | JSON report downloads contained original, unmasked PII | A PII-protection report exported 8 real-format e-mails and 8 national IDs from `transform.sample_before` | `redact_for_export()` applied to every JSON export and to `scripts/run_experiments.py`; published `docs/results/experiments.json` redacted the same way (only that field removed, verified) | `test_json_report_never_contains_unmasked_sample_rows` (JSON, MD, HTML) |
| S4 | Low | CSP still allowed Google Fonts hosts although fonts are self-hosted | Header inspection | Third-party sources removed; `form-action 'self'` added | `test_csp_has_no_third_party_sources` |
| S5 | Low | `.gitignore` did not cover `.env.*`, `*.pem`/`*.key`, stray `*.pt` weights or coverage output | Review | Added, keeping `!.env.example` | Review |
| S6 | Info | No authentication by design; local single-user tool | Unchanged; documented in README, SECURITY.md, THREAT_MODEL.md | — | — |

No issues were found in these areas:
- **Secrets:** pattern scan of every file for AWS/GitHub/OpenAI/Slack/Google keys, private keys and hard-coded passwords found none. The local `.env` on the PC is byte-identical to `.env.example`.
- **`subprocess`/`eval`/`exec`/`shell=True`/pickle/YAML loads:** none in application code. `subprocess` is used only in one test, with a fixed argument list.
- **SQL:** parameterised values; table and column identifiers are allow-listed against the schema.
- **Deserialisation:** model weights are loaded only with `torch.load(weights_only=True)`, and a malicious-pickle test confirms rejection.
- **CORS:** two localhost dev origins only, no credentials.
- **Debug mode:** none. No `--reload` in the run scripts; a generic 500 handler hides tracebacks; OpenAPI docs are served locally only.
- **Logs:** an e-mail/phone scrubber is in place, and the server log from a full run contained 0 PII matches.

Dependency audit: pip-audit (requirements and installed environment) and npm audit both found **0 known vulnerabilities**.

## 5. Release audit: privacy and ML correctness

Independent checks, not relying on the docs:

| Claim | Check | Result |
|---|---|---|
| DP-SGD is actually applied | Model wrapped by Opacus `GradSampleModule`; per-sample clipping active (98 % of gradients clipped in epoch 1); σ = 40 drives accuracy below the majority baseline while σ = 0.1 trains normally | **Holds** |
| ε/δ reporting is meaningful | ε read from Opacus accountants; a test recomputes it independently from (σ, q, steps, δ); target-ε runs land within tolerance; RDP/PRV regression values pinned | **Holds** |
| Federated learning is real | Clients train locally from the global weights; FedAvg is a sample-weighted update average; an aggregation-identity test (lr = 0 leaves the model unchanged); per-round update norms and participation recorded | **Holds** (single-process simulation; no network transport) |
| Attack results come from real procedures | Loss, entropy and shadow-model attacks, thresholds fitted on a calibration half, AUC/TPR/FPR on a disjoint half | **Holds** |
| "Empirical ε lower bound (95 %)" | Computed from a single training run: member/non-member samples are not the independent trials a valid DP audit needs | **Overclaimed. Fixed:** renamed to *attack-implied ε (heuristic)* in the API (`attack_implied_epsilon`), UI, reports and docs, with the reason stated |
| Dashboard ε summary | Pooled client-level ε (DP-FedAvg) with example-level ε | **Misleading. Fixed:** every privacy record now carries a `unit`, and summaries and charts use example-level only, with a count of excluded client-level models (`test_dashboard_does_not_mix_client_and_example_level_epsilon`) |
| PII masking does not leak originals | Logs: 0 matches. MD/HTML reports: 0. JSON report: leaked before S3 | **Fixed** (S3) |
| Reproducibility | All reference experiments re-run on a clean instance | **48 of 48 published metrics identical** |

Known and documented (not changed): preprocessing statistics are not covered by ε; hyper-parameter
search is not accounted for; Opacus `secure_mode` is off by default; leakage levels and PII risk
scores are heuristics; attacks are lower-strength than LiRA.

## 6. Release audit: documentation findings (all fixed)

* The Python badge and requirements claimed 3.10–3.13; only 3.13 is tested. Now "3.13 tested; 3.10+ untested".
* The static "tests: 91 + 9" badge was already out of date and has no CI behind it, so it was removed.
* macOS was presented as supported. It is now marked untested.
* "No pickle anywhere" was false, because `torch.save` uses a pickle-based format. The docs now describe what is actually true: JSON app state, and weights loaded only with `weights_only=True`.
* Install instructions hard-coded the owner's `D:` path. They now use a generic path.
* The headless experiment command did not work on Windows as written. The `.venv\Scripts\python.exe` form is now given.
* Docker was presented as working. It is now marked as not built or tested.
* Unverified resource figures were replaced with measured ones (≈ 0.9 GB peak for the smoke suite, ≈ 0.7 GB backend after all experiments).
* The threat model listed DNS rebinding as unmitigated. It now records S1–S3 as mitigations (T2, T16, T17).
* Internal Markdown links and README image paths: **0 broken**.
* License: MIT, kept at the owner's explicit choice, with the copyright holder consistent in `LICENSE` and the README.

## 7. Release audit: UI/UX and accessibility

* **axe-core 4.14, WCAG 2.0/2.1 A + AA + best practice.** The first scan found 5 rules violated:
  - colour contrast: 20 failing pairs
  - unlabelled inputs
  - scroll regions not reachable by keyboard
  - SVG chart points without names
  - a label/name mismatch

  Results views added two more: an `aria-label` on a `div` without a role, and duplicate region names. **After the fixes: 0 violations** on 11 pages × 2 themes, the DP/FL/attack results views, the inspector preview and the mobile drawer.
* Contrast tokens were recomputed for ≥ 4.5:1, and the earlier UI review's claim of AA compliance was corrected.
* Labels were fixed where implementation and display disagreed: attack-implied ε, and example-level ε in charts.

## 8. Final automated results (build environment)

`pwsh -File ./verify.ps1`:

| Check | Status | Detail |
|---|---|---|
| Environment, dependencies, `pip check`, file structure | PASS (5) | |
| Ruff lint / format | PASS | 43 files |
| Mypy | PASS | 35 files; also clean with `--platform win32`, `linux` and `darwin` |
| Bandit | PASS | 0 issues, 4,054 LOC (5 reviewed `nosec B608` on allow-listed SQL identifiers) |
| pip-audit | PASS | 0 known vulnerabilities |
| Secret scan | PASS | |
| Pytest | PASS | **98 passed**, 0 failed, 0 skipped |
| Smoke tests | PASS | 7/7 |
| TypeScript / Vitest / production build | PASS | Vitest **9 passed** |
| **Total** | **16 passed, 0 failed, 0 skipped** | |

| Suite | Tests |
|---|---|
| `test_data.py` | 27 |
| `test_ml_privacy.py` | 34 |
| `test_api.py` (incl. 7 release-audit regressions) | 25 |
| `test_platform.py` (Windows/PowerShell/cross-platform) | 12 |
| Vitest | 9 |
| `scripts/smoke.py` | 7 |

**Browser workflow** (Playwright/Chromium, empty data directory, real clicks): all 12 steps pass:
- create dataset → profile → PII preview → DP calculator
- train conventional vs DP (ε 2.9976) → federated run → attack evaluation (≈ 55 s)
- model reload → report → analytics → settings (memory reported) → theme switch

There were **0 console/page errors** and **0 backend log errors**. 18 screenshots were recaptured with the final build: 0 errors, 0 horizontal overflow.

## 9. Repository hygiene and authorship

* Every text file on the PC was byte-compared with the tested copy after the audit.
* The 18 PNG screenshots and `frontend/public/mark.svg` carry no embedded provenance or authoring metadata. The PNGs contain only `IHDR`, `IDAT` and `IEND` chunks, and every image is byte-identical (SHA-256) to the capture that was reviewed.
* No `.git` directory exists. No `git init`, identity configuration, commits, tags, remotes or pushes were performed.
* Build-machine paths in source or documentation: none.

## 10. Not verified

| Item | Status | Reason / action |
|---|---|---|
| **`verify.ps1` on the Windows PC after this audit** | **NOT VERIFIED** | Run 2 passed 16/16 before the audit. This audit then changed backend, frontend and docs, and has no shell on the PC. Run `.\verify.ps1` once more before publishing. |
| Windows `GlobalMemoryStatusEx` path at runtime | Indirectly verified | Owner's run 2 passed the tests that exercise it on Windows |
| macOS | **NOT VERIFIED** | Type-checked for darwin only |
| CUDA / GPU | **NOT VERIFIED** | No GPU available |
| Docker build / run | **NOT VERIFIED** | No Docker daemon available |
| Python 3.10–3.12 | **NOT VERIFIED** | Only 3.13 tested |
| Manual screen-reader test | **NOT VERIFIED** | Automated axe-core only |
| Penetration test / DAST | **NOT PERFORMED** | Static review, targeted probes and tests only |
