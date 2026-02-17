#!/usr/bin/env sh
set -eu

# Run prettier check only when configured and available.
if [ ! -f .prettierrc ] && [ ! -f .prettierrc.json ] && [ ! -f .prettierrc.yml ] && [ ! -f .prettierrc.yaml ] && \
   [ ! -f .prettierrc.js ] && [ ! -f .prettierrc.cjs ] && [ ! -f .prettierrc.mjs ] && \
   [ ! -f prettier.config.js ] && [ ! -f prettier.config.cjs ] && [ ! -f prettier.config.mjs ]; then
  exit 0
fi

if command -v npx >/dev/null 2>&1 && npx --no-install prettier --version >/dev/null 2>&1; then
  npx --no-install prettier --check .
  exit 0
fi

if command -v prettier >/dev/null 2>&1; then
  prettier --check .
  exit 0
fi

exit 0
