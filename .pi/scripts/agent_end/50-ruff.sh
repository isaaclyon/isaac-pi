#!/usr/bin/env sh
set -eu

# Run Ruff checks in the project environment when possible.
if ! find . -name '*.py' -not -path './.git/*' | head -n 1 | grep -q .; then
  exit 0
fi

if command -v uv >/dev/null 2>&1 && uv run ruff --version >/dev/null 2>&1; then
  uv run ruff check .
  exit 0
fi

if command -v ruff >/dev/null 2>&1; then
  ruff check .
  exit 0
fi

exit 0
