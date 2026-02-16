#!/usr/bin/env sh
set -eu

# Run Pyright in the project environment (uv) for accurate results.
# Gracefully skip when uv/pyright is not available.
if [ ! -f pyrightconfig.json ] && [ ! -f pyproject.toml ] && \
   ! find . -name '*.py' -not -path './.git/*' | head -n 1 | grep -q .; then
  exit 0
fi

if ! command -v uv >/dev/null 2>&1; then
  exit 0
fi

if ! uv run pyright --version >/dev/null 2>&1; then
  exit 0
fi

uv run pyright
