#!/usr/bin/env sh
set -eu

usage() {
  cat <<'EOF'
Usage:
  exit_worker.sh [--timeout <seconds>] <window-name>

Examples:
  exit_worker.sh wk-auth-refactor-01
  exit_worker.sh --timeout 6 wk-auth-refactor-01

Options:
  --timeout, -t   Grace period in seconds before hard close (default: TMUX_WORKER_EXIT_TIMEOUT or 4)
EOF
}

error() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

is_integer() {
  printf '%s' "$1" | grep -Eq '^[0-9]+$'
}

resolve_session() {
  if [ -n "${TMUX_WORKER_SESSION:-}" ]; then
    SESSION="$TMUX_WORKER_SESSION"
  elif [ -n "${TMUX:-}" ]; then
    SESSION="$(tmux display-message -p '#S' 2>/dev/null || true)"
  fi

  if [ -z "${SESSION:-}" ]; then
    SESSION="pi-workers"
  fi

  if tmux has-session -t "$SESSION" 2>/dev/null; then
    return 0
  fi

  tmux new-session -d -s "$SESSION" -n "coordinator" || error "Failed to create tmux session '$SESSION'"
  printf "Created detached tmux session: %s\n" "$SESSION" >&2
  printf "Attach when ready: tmux attach -t %s\n" "$SESSION" >&2
}

window_exists() {
  tmux list-windows -t "$SESSION" -F '#W' 2>/dev/null | grep -Fx -- "$1" >/dev/null 2>&1
}

TIMEOUT="${TMUX_WORKER_EXIT_TIMEOUT:-4}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    -t|--timeout)
      [ "$#" -ge 2 ] || error "--timeout requires a value"
      TIMEOUT="$2"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -* )
      error "Unknown option: $1"
      ;;
    *)
      break
      ;;
  esac
done

[ "$#" -eq 1 ] || {
  usage >&2
  exit 2
}

is_integer "$TIMEOUT" || error "Timeout must be a non-negative integer"

command -v tmux >/dev/null 2>&1 || error "tmux is not installed or not on PATH"
resolve_session

WINDOW_NAME="$1"
TARGET="$SESSION:$WINDOW_NAME"

window_exists "$WINDOW_NAME" || error "Window '$WINDOW_NAME' not found in session '$SESSION'"

tmux send-keys -t "$TARGET" -- "/exit" C-m || error "Failed to send /exit to '$TARGET'"

# Try a gentle shell exit too (if pi has already returned to shell).
tmux send-keys -t "$TARGET" -- "exit" C-m || true

if [ "$TIMEOUT" -gt 0 ]; then
  START="$(date +%s)"
  END=$((START + TIMEOUT))
  while window_exists "$WINDOW_NAME"; do
    NOW="$(date +%s)"
    [ "$NOW" -lt "$END" ] || break
    sleep 1
  done
fi

if window_exists "$WINDOW_NAME"; then
  tmux kill-window -t "$TARGET" || error "Failed to hard-close '$TARGET'"
  printf "Hard-closed worker window after timeout: %s\n" "$TARGET"
else
  printf "Worker exited cleanly: %s\n" "$TARGET"
fi
