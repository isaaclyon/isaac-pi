#!/usr/bin/env sh
set -eu

# Best-effort Ruff autofix/format in the project environment when possible.
# Never fails the hook directly; follow-up check scripts report remaining issues.
if ! find . -name '*.py' -not -path './.git/*' | head -n 1 | grep -q .; then
  exit 0
fi

if command -v uv >/dev/null 2>&1 && uv run ruff --version >/dev/null 2>&1; then
  uv run ruff check . --fix || true
  uv run ruff format . || true
  exit 0
fi

if command -v ruff >/dev/null 2>&1; then
  ruff check . --fix || true
  ruff format . || true
fi
