#!/usr/bin/env bash
# Offline, dependency-free symbol map; runnable from any working directory.
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "${PYTHON:-python3}" "$SCRIPT_DIR/generate-repo-map.py" "$@"
