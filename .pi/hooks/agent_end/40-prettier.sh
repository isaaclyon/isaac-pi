#!/usr/bin/env sh
set -eu

# Run prettier check only when installed and configured.
if ! command -v prettier >/dev/null 2>&1; then
  exit 0
fi

if [ -f .prettierrc ] || [ -f .prettierrc.json ] || [ -f .prettierrc.yml ] || [ -f .prettierrc.yaml ] || \
   [ -f .prettierrc.js ] || [ -f .prettierrc.cjs ] || [ -f .prettierrc.mjs ] || \
   [ -f prettier.config.js ] || [ -f prettier.config.cjs ] || [ -f prettier.config.mjs ]; then
  prettier --check .
fi
