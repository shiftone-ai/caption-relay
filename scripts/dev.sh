#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f frontend/dist/index.html || ! -f frontend/dist/view.html ]]; then
  echo "Build the frontend first: bash scripts/setup.sh" >&2
  exit 1
fi

exec uv run --project backend --locked uvicorn app.main:app \
  --app-dir "$ROOT/backend" --reload --reload-dir "$ROOT/backend/app" \
  --host 127.0.0.1 --port "${CAPTION_RELAY_PORT:-24681}" --no-access-log \
  --ws-max-size 262144 --ws-max-queue 8
