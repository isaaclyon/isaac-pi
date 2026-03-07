#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CHANGED_FILES="$($SCRIPT_DIR/../_shared/changed-files.sh)"

if [ -z "$CHANGED_FILES" ]; then
  exit 0
fi

set --
while IFS= read -r file; do
  case "$file" in
    *.js|*.jsx|*.ts|*.tsx|*.cjs|*.mjs|*.cts|*.mts)
      set -- "$@" "$file"
      ;;
    *) ;;
  esac
done <<EOF
$CHANGED_FILES
EOF

if [ "$#" -eq 0 ]; then
  exit 0
fi

if command -v npx >/dev/null 2>&1 && npx --no-install eslint --version >/dev/null 2>&1; then
  npx --no-install eslint "$@" --fix || true
  exit 0
fi

if command -v eslint >/dev/null 2>&1; then
  eslint "$@" --fix || true
fi
