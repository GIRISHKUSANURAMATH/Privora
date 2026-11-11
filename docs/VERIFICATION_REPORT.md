# Verification Report

Version 1.0.0 · pre-publication release audit 8 November 2026 · post-publication audit 9 November 2026 (§11)

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

There were **0 console/page errors** and **0 backend log errors**. 18 screenshots were recaptured with the final build: 0 errors, 0 horizontal overflow. *(Correction in §11: the overflow measurement was flawed; two phone-width overflows existed.)*

## 9. Repository hygiene and authorship (state at the pre-release audit)

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

## 11. Post-publication audit (9 November 2026)

After the initial commit was pushed, the product was renamed **Privora** and the published tree
was re-audited. The commit contents were read from the Git index on the PC; every check below ran
in the Linux build container, not on the PC.

### Findings

| # | Severity | Finding | Fix | Verified by |
|---|---|---|---|---|
| P1 | **High** | `.gitignore` rule `data/` (meant for the runtime folder) also matched the source package `backend/ppml/core/data/`. Its 7 files were never committed, so a clone of the published repository failed at import (`No module named 'ppml.core.data'`). `verify.ps1` passed on the PC because it ran on the working tree, where the files exist. | Rule anchored to `/data/`; the package is now committable | A checkout of exactly the committed files reproduced the import error; the corrected file set passes pytest 98/98, smoke 7/7, Ruff, mypy, TypeScript, Vitest and the build |
| P2 | Medium | Two phone-width layout overflows: Attack Lab 411 px and Federated Studio results 520 px at a 390 px viewport (see `UI_UX_REVIEW.md`). The earlier "0 horizontal overflow" result was a measurement error. | `grid-cols-1` on breakpoint grids; positioned scroll containers | All 11 pages measured at 390 px and 820 px against the requested width; 2 static guard tests (each confirmed to fail when its fix is reverted) |
| P3 | Low | Former product name (Umbra) in UI, HTML metadata, package metadata, scripts, Docker files and docs; screenshots showed it | Renamed; `ppml` package and `PPML_` variables unchanged | Case-insensitive search: no matches in the files to be committed |
| P4 | Low | `CHANGELOG.md` still listed an "empirical ε lower bound"; `EXPERIMENTS.md` called attack results "lower bounds on leakage" | Reworded as a heuristic / as measuring only the implemented attacks | Manual review of all privacy wording |

Also checked, with no change needed:
* **Attribution:** no Claude or Anthropic text in the files to be committed.
* **Images:** the 18 committed PNGs and `mark.svg` on the PC are byte-identical to the clean
  originals, and the PNGs contain only `IHDR`/`IDAT`/`IEND` chunks.
* **Secrets:** `detect-secrets` 1.5.0 plus key and token patterns over the files to be committed.
  The only findings were 7 experiment record IDs (hexadecimal UUIDs), which are false positives.
  This was not a scan of Git history.
* **Ignore rules:** `.gitignore` was checked against 26 representative paths. A `git add` dry run
  on a copy of the project with its local folders present would stage only the 115 committed
  files plus 9 new ones.

### Results (build container)

| Check | Result |
|---|---|
| `verify.ps1` (pwsh) | 16 passed, 0 failed, 0 skipped |
| Pytest | 98 passed |
| Vitest | 12 passed (3 new layout-guard tests) |
| Smoke tests | 7/7 |
| Ruff lint + format · mypy (win32, linux, darwin) · Bandit (`backend/ppml`) | clean |
| pip-audit (runtime + dev) · npm audit | 0 known vulnerabilities |
| Browser workflow, empty data directory | 12/12 steps, 0 console errors |
| axe-core 4.14, 11 pages × 2 themes | 0 violations |
| `scripts/capture_screenshots.py` end to end | 18/18 captures passed every check (errors, overflow, product name, PNG chunks) |
| Fresh-clone simulation (only the files to be committed) | pytest 98, smoke 7/7, Ruff, mypy, TypeScript, Vitest 12, build: all pass |

### Not verified in this audit

| Item | Status |
|---|---|
| `verify.ps1` on the Windows PC after these changes | **NOT VERIFIED**: no shell on the PC |
| Screenshots regenerated on the PC with `scripts/capture_screenshots.py` | **NOT VERIFIED** until the owner runs it |
| A real `git clone` of the corrected repository | **NOT VERIFIED**: simulated with the exact file set |
| Docker, macOS, GPU, Python 3.10–3.12, screen reader, penetration test | **NOT VERIFIED** (unchanged from §10) |

## 12. Windows release check, first run (11 November 2026)

The owner ran `screenshots-capture\release_check.ps1` (Check mode) on Windows 11. Results that
passed there: `verify.ps1` 16/16; Git identity and remote; ignore rules; the clone of the published
commit is missing the 7 package files (the P1 bug); and the exported tree to be committed installed
independently with its own `.venv` (`setup.ps1` passed and `verify.ps1` passed 16/16 in the copy).
Two steps failed:

| # | Failure on Windows | Root cause | Fix |
|---|---|---|---|
| W1 | Screenshot capture exited 1 with no images | `run_experiments.py` printed `→`; piped stdout on Windows uses cp1252, so Python raised `UnicodeEncodeError`. With that fixed, the experiment names (which contain `ε`) failed the same way | `configure_console()` keeps the encoding and escapes unencodable characters; called first in both scripts. Tests reproduce the crash under cp1252 and confirm the fix |
| W2 | "Independent of original folder" reported `No module named 'ppml'` | Defect in the release-check script, not the project: its query helper ignored the requested working directory, so the import probe ran in the original project root, where `ppml` is not importable. `ppml` is intentionally not pip-installed; every entry point puts `backend` on the path | The helper honours the working directory; the probe runs like `run.ps1`/`verify.ps1` (`PYTHONPATH=<copy>\backend`, working directory `backend`) and compares real paths in Python (handles 8.3 short names), also failing if any `sys.path` entry lies in the original folder |

In the Linux build container: capture with output piped and forced to cp1252 produced 18/18
passing screenshots; `verify.ps1` 16/16 with pytest 104 passed; the release-check logic passed its
50 + 8 scripted checks. **Windows re-run: NOT VERIFIED** until the owner runs Check mode again.

## 13. Screenshot defects from the visual inspection (11 November 2026)

The visual review of the 18 captures from the first passing Windows Check run found six defects,
all also present in the published screenshots. The fixes, and four further defects that the new
automated checks found while verifying them:

| # | Defect | Root cause | Fix and regression test |
|---|---|---|---|
| S1 | Overview cards 7 px past their panel at 390 px (15) | `grid sm:grid-cols-2 lg:grid-cols-3` had no base column, so the implicit `auto` track grew to the cards' min-content width | `grid-cols-1` on all 14 responsive grids without one; the static guard now covers sm/md/lg/xl/2xl |
| S2 | ROC labels 0.0, 0.3, 0.5, 0.8, 1.0 at the 0, 0.25, 0.5, 0.75, 1 gridlines (07, 16) | Recharts chose 0.25-step ticks and `toFixed(1)` rounded them | Explicit ticks 0, 0.2, ..., 1.0 on both axes. Every data-driven value axis now uses 1/2/5 x 10^k steps kept only if the chart's formatter prints them exactly. Rendered-SVG tests compare labels with pixel positions |
| S3 | Analytics category labels ran together, chips cut mid-word, "Non-private" label covered by points (08) | Single-line category ticks; `name.slice(0, 28)`; reference label drawn inside the plot | Labels wrap inside their band (font down to 9 px only if a word would not fit); word-boundary shortening with the full name as tooltip; reference labels moved below the plot |
| S4 | Duplicate report and success toast in the Reports shot (09; Overview count in 15) | `run_experiments.py` already writes a report per experiment; the capture then clicked "Generate report" | Saved reports have a Preview button; the capture previews an existing report (generates only if none exists), fails if the report count changes, and waits for notifications to close (error notifications are reported, not hidden) |
| S5 | "Entropy threshold" / "Shadow models" ran together at 390 px (16) | Same as S3 | Same as S3 |
| S6 | "Documentation" half under the Collapse bar at 1280 x 720 (18) | The sidebar needed 747 px | Compact spacing (687 px), `min-h-0` so the menu scrolls on its own, brand and footer `shrink-0`; height-budget test and browser reachability checks at 720/600/480 px |
| S7 | ROC x-axis title touched the legend | Title sat in the bottom margin that the legend also occupies | Axis band sized for ticks plus title |
| S8 | Histogram bins 1.5 wide labelled 15, 16, 18 ... (02) | Bin starts rounded to whole numbers | Fewest decimals within 2 % of a bin, about five labels per histogram; unit test |
| S9 | Data quality chart: axis "100000000%", bars invisible (02, after the S2 change) | The new tick helper treated a `${v}%` formatter as a fraction formatter, so no step was exact and it widened without limit | Formatter scale inferred (`fmt(1)`); steps never widen past the data range; unit tests |
| S10 | Analytics at 390 px intermittently 439 px wide | A hidden Recharts tooltip wrapper sat beyond the viewport | Chart frames use `overflow-x: clip`; test |

New browser checks in the capture (each tested against a page with the defect and one without):
elements sticking out of a non-clipping parent, overlapping chart text, data points over labels,
text cut off at the chart edge, numeric axis labels that do not match their positions (linear or
log), notifications still on screen, sidebar items not reachable above the footer; plus layout
checks of Overview at 820 px, Analytics at 390/820 px, Attack Lab at 820 px, Reports and Dataset
Studio at 390 px.

`release_check.ps1` (owner's helper, not in the repository) now writes each Check run's captures to
a new `screenshots-capture\shots-<time>` folder (it never overwrites or deletes one), records it as
`shots_dir` in the JSON summary, and ApplyScreenshots applies only that folder: the summary must be
the latest Check run, overall PASS, with a passing capture, a recorded folder named after its own
timestamp and matching SHA-256 hashes, and no later Check run may have left a log without a summary.
Neither mode stages, commits or pushes. ApplyScreenshots replaces only the 18 recorded files (verified by
SHA-256) and then proves that the Git index (`git ls-files --stage`), every other file in
`assets\screenshots` and the rest of `git status` are unchanged; the owner stages and commits himself.

`scripts/capture_screenshots.py` type-checks cleanly (mypy, Windows/Linux/macOS targets, with and
without Playwright installed): Playwright event handlers are typed one-argument functions instead of
two-argument lambdas, and the viewport is a `ViewportSize`. A pytest runs mypy on the script.

Results in the Linux build container: `verify.ps1` 16/16 (pytest 118 passed, Vitest 37 passed,
Ruff, mypy, Bandit, pip-audit, build); capture with cp1252 output: 18/18 screenshots and all extra
checks passed; release-check script tests 75 + 8 passed. **Windows: NOT VERIFIED** until the owner
runs Check mode again.
