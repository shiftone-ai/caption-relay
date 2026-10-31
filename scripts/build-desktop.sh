#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'The desktop bundle currently requires macOS.' >&2
  exit 1
fi
npm --prefix frontend run build
bash scripts/build-speech-helper.sh
uv run --project backend --locked --extra desktop pyinstaller --noconfirm --clean \
  --distpath "$ROOT/.cache/desktop" --workpath "$ROOT/.cache/desktop-build" scripts/desktop.spec
cd "$ROOT/desktop"
../frontend/node_modules/.bin/tauri icon icon.svg
exec ../frontend/node_modules/.bin/tauri build "$@"
