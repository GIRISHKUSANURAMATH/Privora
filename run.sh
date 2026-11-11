#!/usr/bin/env bash
# Start Privora on Linux/macOS: backend serves the built UI on http://127.0.0.1:8000
set -euo pipefail
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || { echo "Run setup first (see docs/INSTALLATION.md)"; exit 1; }
[ -f frontend/dist/index.html ] || (cd frontend && npm run build)
export PYTHONPATH="$PWD/backend"
exec .venv/bin/python -m uvicorn ppml.main:create_app --factory --host 127.0.0.1 --port "${PPML_PORT:-8000}" --app-dir backend
