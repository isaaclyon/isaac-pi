#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CHANGED_FILES="$($SCRIPT_DIR/../_shared/changed-files.sh)"

if [ -z "$CHANGED_FILES" ]; then
  exit 0
fi

has_py=0
while IFS= read -r file; do
  case "$file" in
    *.py) has_py=1 ;;
    *) ;;
  esac
done <<EOF
$CHANGED_FILES
EOF

if [ "$has_py" -ne 1 ]; then
  exit 0
fi

if [ ! -f pyrightconfig.json ] && [ ! -f pyproject.toml ] && \
   ! find . -name '*.py' -not -path './.git/*' | head -n 1 | grep -q .; then
  exit 0
fi

if ! command -v uv >/dev/null 2>&1; then
  exit 0
fi

if ! uv run pyright --version >/dev/null 2>&1; then
  exit 0
fi

uv run pyright
