#!/usr/bin/env bash
set -euo pipefail

if command -v lsof >/dev/null 2>&1; then
  lsof -ti :8000 | xargs -r kill
elif command -v fuser >/dev/null 2>&1; then
  fuser -k 8000/tcp || true
else
  echo "No supported process manager found to stop the app on port 8000." >&2
  exit 1
fi
