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
    *.py)
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

if command -v uv >/dev/null 2>&1 && uv run ruff --version >/dev/null 2>&1; then
  uv run ruff check "$@"
  exit 0
fi

if command -v ruff >/dev/null 2>&1; then
  ruff check "$@"
fi
