#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for tool in node npm uv; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Required tool is missing: $tool. See docs/remote-development.md." >&2
    exit 1
  fi
done

node --input-type=module -e '
const [major, minor, patch] = process.versions.node.split(".").map(Number);
const supported = (major === 22 && (minor > 23 || (minor === 23 && patch >= 4)))
  || (major === 24 && (minor > 22 || (minor === 22 && patch >= 1)))
  || (major === 26 && (minor > 12 || (minor === 12 && patch >= 1))) || major > 26;
if (!supported) {
  console.error("Use Node.js ^22.23.4, ^24.22.1, or >=26.12.1. See .node-version.");
  process.exit(1);
}
'

node --version
uv --version
uv sync --project backend --python "$(cat .python-version)" --locked --extra dev
uv run --project backend --locked python --version
npm --prefix frontend ci
npm --prefix frontend run build
bash "$ROOT/scripts/build-speech-helper.sh"
