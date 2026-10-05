#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm --prefix frontend run check:api
npm --prefix frontend test
npm --prefix frontend run build
cd backend
uv run --locked --extra dev pyright
uv run --locked --extra dev pytest -q
