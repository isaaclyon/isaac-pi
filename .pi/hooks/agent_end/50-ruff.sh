#!/usr/bin/env sh
set -eu

# Run ruff only when installed and Python files exist.
if ! command -v ruff >/dev/null 2>&1; then
  exit 0
fi

if find . -name '*.py' -not -path './.git/*' | head -n 1 | grep -q .; then
  ruff check .
fi
