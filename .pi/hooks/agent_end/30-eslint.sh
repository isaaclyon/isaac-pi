#!/usr/bin/env sh
set -eu

# Run eslint only when installed and config exists.
if ! command -v eslint >/dev/null 2>&1; then
  exit 0
fi

if [ -f eslint.config.js ] || [ -f eslint.config.mjs ] || [ -f eslint.config.cjs ] || \
   [ -f .eslintrc ] || [ -f .eslintrc.js ] || [ -f .eslintrc.cjs ] || \
   [ -f .eslintrc.json ] || [ -f .eslintrc.yml ] || [ -f .eslintrc.yaml ]; then
  eslint .
fi
