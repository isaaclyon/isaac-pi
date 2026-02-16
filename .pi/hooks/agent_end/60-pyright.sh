#!/usr/bin/env sh
set -eu

# Run pyright only when installed and Python typing config or files exist.
if ! command -v pyright >/dev/null 2>&1; then
  exit 0
fi

if [ -f pyrightconfig.json ] || [ -f pyproject.toml ] || \
   find . -name '*.py' -not -path './.git/*' | head -n 1 | grep -q .; then
  pyright
fi
