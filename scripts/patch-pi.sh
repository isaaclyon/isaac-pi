#!/usr/bin/env bash
#
# Apply or revert mid-message slash command patches to the global pi installation.
#
# Usage:
#   ./scripts/patch-pi.sh apply    # Apply patches
#   ./scripts/patch-pi.sh revert   # Revert patches
#   ./scripts/patch-pi.sh check    # Check if patches are already applied
#
# After updating pi (npm update -g @mariozechner/pi-coding-agent), re-run:
#   ./scripts/patch-pi.sh apply
#
# If the patches fail to apply after an update, the upstream code changed at the
# patched lines. Update the .patch files in patches/ to match the new code.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PATCH_DIR="$SCRIPT_DIR/../patches"

# Find the global pi installation
PI_BIN="$(which pi 2>/dev/null || true)"
if [[ -z "$PI_BIN" ]]; then
  echo "Error: pi not found in PATH"
  exit 1
fi

# Resolve symlinks to find the actual installation
# pi binary symlinks to .../pi-coding-agent/dist/cli.js
PI_REAL="$(realpath "$PI_BIN")"
PI_PKG_DIR="$(dirname "$(dirname "$PI_REAL")")"

if [[ ! -f "$PI_PKG_DIR/package.json" ]]; then
  echo "Error: Could not find pi-coding-agent package directory"
  echo "  Resolved to: $PI_PKG_DIR"
  echo "  (from binary: $PI_REAL)"
  exit 1
fi

PI_TUI_DIR="$PI_PKG_DIR/node_modules/@mariozechner/pi-tui"

if [[ ! -d "$PI_TUI_DIR" ]]; then
  echo "Error: Could not find pi-tui package at $PI_TUI_DIR"
  exit 1
fi

PI_VERSION="$(node -e "console.log(require('$PI_PKG_DIR/package.json').version)")"
echo "pi version: $PI_VERSION"
echo "pi-coding-agent: $PI_PKG_DIR"
echo "pi-tui: $PI_TUI_DIR"
echo ""

ACTION="${1:-check}"

apply_patches() {
  local failed=0

  echo "Applying patches..."
  echo ""

  for patch_file in "$PATCH_DIR"/pi-tui-*.patch; do
    local name="$(basename "$patch_file")"
    echo -n "  $name ... "
    if cd "$PI_TUI_DIR" && patch -p1 --forward --dry-run < "$patch_file" > /dev/null 2>&1; then
      cd "$PI_TUI_DIR" && patch -p1 --forward < "$patch_file" > /dev/null 2>&1
      echo "applied"
    elif cd "$PI_TUI_DIR" && patch -p1 -R --dry-run < "$patch_file" > /dev/null 2>&1; then
      echo "already applied"
    else
      echo "FAILED (patch does not apply cleanly — upstream may have changed)"
      failed=1
    fi
  done

  for patch_file in "$PATCH_DIR"/pi-coding-agent-*.patch; do
    local name="$(basename "$patch_file")"
    echo -n "  $name ... "
    if cd "$PI_PKG_DIR" && patch -p1 --forward --dry-run < "$patch_file" > /dev/null 2>&1; then
      cd "$PI_PKG_DIR" && patch -p1 --forward < "$patch_file" > /dev/null 2>&1
      echo "applied"
    elif cd "$PI_PKG_DIR" && patch -p1 -R --dry-run < "$patch_file" > /dev/null 2>&1; then
      echo "already applied"
    else
      echo "FAILED (patch does not apply cleanly — upstream may have changed)"
      failed=1
    fi
  done

  echo ""
  if [[ $failed -eq 0 ]]; then
    echo "All patches applied. Restart pi to see changes."
  else
    echo "Some patches failed. You may need to update the patch files for the new pi version."
    exit 1
  fi
}

revert_patches() {
  local failed=0

  echo "Reverting patches..."
  echo ""

  for patch_file in "$PATCH_DIR"/pi-tui-*.patch; do
    local name="$(basename "$patch_file")"
    echo -n "  $name ... "
    if cd "$PI_TUI_DIR" && patch -p1 -R --dry-run < "$patch_file" > /dev/null 2>&1; then
      cd "$PI_TUI_DIR" && patch -p1 -R < "$patch_file" > /dev/null 2>&1
      echo "reverted"
    elif cd "$PI_TUI_DIR" && patch -p1 --forward --dry-run < "$patch_file" > /dev/null 2>&1; then
      echo "not applied (nothing to revert)"
    else
      echo "FAILED"
      failed=1
    fi
  done

  for patch_file in "$PATCH_DIR"/pi-coding-agent-*.patch; do
    local name="$(basename "$patch_file")"
    echo -n "  $name ... "
    if cd "$PI_PKG_DIR" && patch -p1 -R --dry-run < "$patch_file" > /dev/null 2>&1; then
      cd "$PI_PKG_DIR" && patch -p1 -R < "$patch_file" > /dev/null 2>&1
      echo "reverted"
    elif cd "$PI_PKG_DIR" && patch -p1 --forward --dry-run < "$patch_file" > /dev/null 2>&1; then
      echo "not applied (nothing to revert)"
    else
      echo "FAILED"
      failed=1
    fi
  done

  echo ""
  if [[ $failed -eq 0 ]]; then
    echo "All patches reverted. Restart pi to see changes."
  else
    echo "Some patches failed to revert."
    exit 1
  fi
}

check_patches() {
  echo "Checking patch status..."
  echo ""

  for patch_file in "$PATCH_DIR"/pi-tui-*.patch; do
    local name="$(basename "$patch_file")"
    echo -n "  $name: "
    if cd "$PI_TUI_DIR" && patch -p1 -R --dry-run < "$patch_file" > /dev/null 2>&1; then
      echo "APPLIED"
    elif cd "$PI_TUI_DIR" && patch -p1 --forward --dry-run < "$patch_file" > /dev/null 2>&1; then
      echo "not applied"
    else
      echo "CONFLICT (patch does not match current code)"
    fi
  done

  for patch_file in "$PATCH_DIR"/pi-coding-agent-*.patch; do
    local name="$(basename "$patch_file")"
    echo -n "  $name: "
    if cd "$PI_PKG_DIR" && patch -p1 -R --dry-run < "$patch_file" > /dev/null 2>&1; then
      echo "APPLIED"
    elif cd "$PI_PKG_DIR" && patch -p1 --forward --dry-run < "$patch_file" > /dev/null 2>&1; then
      echo "not applied"
    else
      echo "CONFLICT (patch does not match current code)"
    fi
  done
}

case "$ACTION" in
  apply)  apply_patches ;;
  revert) revert_patches ;;
  check)  check_patches ;;
  *)
    echo "Usage: $0 {apply|revert|check}"
    exit 1
    ;;
esac
