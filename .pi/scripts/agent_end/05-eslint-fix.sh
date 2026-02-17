#!/usr/bin/env sh
set -eu

# Best-effort ESLint autofix.
# Never fails the hook directly; follow-up check scripts report remaining issues.
if [ ! -f eslint.config.js ] && [ ! -f eslint.config.mjs ] && [ ! -f eslint.config.cjs ] && \
   [ ! -f .eslintrc ] && [ ! -f .eslintrc.js ] && [ ! -f .eslintrc.cjs ] && \
   [ ! -f .eslintrc.json ] && [ ! -f .eslintrc.yml ] && [ ! -f .eslintrc.yaml ]; then
  exit 0
fi

if command -v npx >/dev/null 2>&1 && npx --no-install eslint --version >/dev/null 2>&1; then
  npx --no-install eslint . --fix || true
  exit 0
fi

if command -v eslint >/dev/null 2>&1; then
  eslint . --fix || true
fi
