#!/usr/bin/env bash
# Linux/macOS wrapper: runs verify.ps1 with PowerShell 7 if available, else the core checks directly.
set -uo pipefail
cd "$(dirname "$0")"
if command -v pwsh >/dev/null 2>&1; then exec pwsh -NoProfile -File ./verify.ps1 "$@"; fi
PY=.venv/bin/python; fail=0
run() { echo "==> $1"; shift; "$@" || { echo "[FAIL]"; fail=1; }; }
run "ruff" $PY -m ruff check backend scripts
run "ruff format" $PY -m ruff format --check backend scripts
run "mypy" $PY -m mypy backend/ppml
run "bandit" $PY -m bandit -q -r backend/ppml -c backend/pyproject.toml
run "pip-audit" $PY -m pip_audit -r requirements.txt --progress-spinner off
run "pytest" bash -c "cd backend && PYTHONPATH=. ../$PY -m pytest -q"
run "smoke" $PY scripts/smoke.py
run "frontend" bash -c "cd frontend && npm run --silent typecheck && npm run --silent test && npm run --silent build"
exit $fail
