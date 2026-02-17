#!/usr/bin/env sh
set -eu

# Run eslint only when config exists and the tool is available.
if [ ! -f eslint.config.js ] && [ ! -f eslint.config.mjs ] && [ ! -f eslint.config.cjs ] && \
   [ ! -f .eslintrc ] && [ ! -f .eslintrc.js ] && [ ! -f .eslintrc.cjs ] && \
   [ ! -f .eslintrc.json ] && [ ! -f .eslintrc.yml ] && [ ! -f .eslintrc.yaml ]; then
  exit 0
fi

if command -v npx >/dev/null 2>&1 && npx --no-install eslint --version >/dev/null 2>&1; then
  npx --no-install eslint .
  exit 0
fi

if command -v eslint >/dev/null 2>&1; then
  eslint .
  exit 0
fi

exit 0
