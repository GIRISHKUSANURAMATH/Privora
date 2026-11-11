# Installation

## Requirements

| | Minimum | Notes |
|---|---|---|
| OS | Windows 10/11 x64, Linux | Both verified. macOS is untested |
| Python | 3.10 or newer | Only 3.13 has been tested. Get it from python.org and tick **Add python.exe to PATH** |
| Node.js | 18 LTS or newer | Only needed to build the UI. 20/22 LTS recommended |
| RAM | 4 GB | Measured on Linux: ≈ 0.9 GB peak for the smoke suite, ≈ 0.7 GB backend after all reference experiments |
| Disk | a few GB | Mostly the PyTorch wheel in `.venv` and `frontend/node_modules`; exact size depends on platform |
| GPU | optional | CUDA is used automatically when available (`PPML_DEVICE=auto`) |

No paid APIs, accounts or internet access are needed after installation.

## Windows (PowerShell)

```powershell
git clone https://github.com/GIRISHKUSANURAMATH/Privora.git
cd Privora                     # the folder that contains setup.ps1

# If script execution is blocked, allow it for this window only:
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

.\setup.ps1          # creates .venv, installs Python packages, builds the UI
.\run.ps1            # starts http://127.0.0.1:8000 and opens the browser
.\verify.ps1         # optional: runs every check (tests, lint, security, smoke tests)
```

Options:

* `.\setup.ps1 -Cuda` — install the CUDA 12.6 PyTorch build for an NVIDIA GPU.
* `.\setup.ps1 -SkipFrontend` — backend only.
* `.\run.ps1 -Dev` — backend on :8000 plus the Vite dev server with hot reload on :5173.
* `.\run.ps1 -Port 8100 -NoBrowser`
* `.\verify.ps1 -Quick` — skips the full test suite, pip-audit and the production build.

### Common Windows issues

| Symptom | Fix |
|---|---|
| `running scripts is disabled on this system` | `Set-ExecutionPolicy -Scope Process Bypass`, or run `powershell -ExecutionPolicy Bypass -File .\setup.ps1` |
| `Python 3.10+ not found` although Python is installed | The Microsoft Store stub is first on PATH. Install from python.org, or disable *App execution aliases* for python.exe in Windows settings |
| `npm not found` | Install Node.js LTS and open a new terminal |
| Port 8000 busy | `.\run.ps1 -Port 8100` |
| Long path errors during `npm ci` | Enable long paths: `git config --system core.longpaths true` or move the project to a shorter path |

## Linux (macOS untested)

```bash
python3 -m venv .venv
.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu   # CPU wheel (Linux)
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
(cd frontend && npm ci && npm run build)
./run.sh            # or: PYTHONPATH=backend .venv/bin/uvicorn ppml.main:create_app --factory --app-dir backend
./verify.sh
```

PowerShell 7 (`pwsh`) can also run the `.ps1` scripts on Linux and macOS.

On macOS the default PyPI torch wheel is fine (it uses CPU/MPS; Privora uses CPU unless CUDA is present).

## Docker (not yet tested)

The `Dockerfile` and `docker-compose.yml` have **not been built or run**; treat them as a
starting point.

```bash
docker compose up --build
# open http://127.0.0.1:8000
```

The container runs as a non-root user with a read-only root filesystem; data is kept in the
`privora-data` volume. The port is published on `127.0.0.1` only.

## Configuration

Copy `.env.example` to `.env` (setup does this) and adjust. All variables use the `PPML_` prefix:

| Variable | Default | Meaning |
|---|---|---|
| `PPML_DATA_DIR` | `./data` | datasets, artifacts, reports, SQLite |
| `PPML_HOST` / `PPML_PORT` | `127.0.0.1` / `8000` | bind address — keep loopback |
| `PPML_MAX_UPLOAD_MB` | `20` | upload size limit |
| `PPML_MAX_ROWS` / `PPML_MAX_COLUMNS` | `200000` / `200` | dataset limits |
| `PPML_MAX_CONCURRENT_JOBS` | `1` | parallel training jobs |
| `PPML_DEVICE` | `auto` | `auto`, `cpu` or `cuda` |
| `PPML_TORCH_THREADS` | `0` | CPU threads for PyTorch (0 = default) |
| `PPML_LOG_LEVEL` | `INFO` | log level |

## Uninstall

Delete the project folder. Everything Privora writes lives inside it (`.venv`, `data`,
`frontend/node_modules`, `frontend/dist`).
