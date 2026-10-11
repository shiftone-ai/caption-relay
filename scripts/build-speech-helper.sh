#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "$(uname -s)" != Darwin ]] || ! command -v xcrun >/dev/null 2>&1; then
  echo 'Apple speech helper skipped: a Mac with the macOS 26 SDK is required.'
  exit 0
fi
if ! SDK_VERSION="$(xcrun --sdk macosx --show-sdk-version 2>/dev/null)"; then
  echo 'Apple speech helper skipped: the macOS SDK is unavailable.'
  exit 0
fi
if [[ "${SDK_VERSION%%.*}" -lt 26 ]]; then
  echo 'Apple speech helper skipped: the macOS 26 SDK is required.'
  exit 0
fi
mkdir -p "$ROOT/.cache"
xcrun swiftc -parse-as-library "$ROOT/native/speech-helper.swift" -o "$ROOT/.cache/apple-speech-helper"
"$ROOT/.cache/apple-speech-helper" --probe
