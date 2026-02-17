#!/usr/bin/env sh
set -eu

# Run project lint script if present.
# Gracefully skip non-Node repos/environments.
if ! command -v npm >/dev/null 2>&1; then
  exit 0
fi

if [ ! -f package.json ]; then
  exit 0
fi

npm run lint --if-present
