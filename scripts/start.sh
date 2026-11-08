#!/bin/sh
# Start the recorded preview database and recovered app on loopback only.
set -eu
EGI_APP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$EGI_APP_ROOT"
.venv/bin/python scripts/manage_preview_db.py start
exec .venv/bin/python -m uvicorn app.backend.main:app --host 127.0.0.1 --port 8000
