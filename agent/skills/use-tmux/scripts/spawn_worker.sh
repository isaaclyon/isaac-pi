#!/usr/bin/env sh
set -eu

usage() {
  cat <<'EOF'
Usage:
  spawn_worker.sh <window-name> [pi-command]

Examples:
  spawn_worker.sh wk-auth-refactor-01
  spawn_worker.sh wk-auth-refactor-01 "pi --model gpt-5"

Notes:
  - If not currently attached to tmux, creates (or reuses) a detached session.
  - Set TMUX_WORKER_SESSION to control the default session name when detached.
  - If [pi-command] is omitted, defaults to: pi
EOF
}

error() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
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

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

[ "$#" -ge 1 ] || {
  usage >&2
  exit 2
}

command -v tmux >/dev/null 2>&1 || error "tmux is not installed or not on PATH"
resolve_session

WINDOW_NAME="$1"
shift

if [ "$#" -gt 0 ]; then
  PI_COMMAND="$*"
else
  PI_COMMAND="pi"
fi

window_exists "$WINDOW_NAME" && error "Window '$WINDOW_NAME' already exists in session '$SESSION'"

tmux new-window -d -t "$SESSION:" -n "$WINDOW_NAME" || error "Failed to create window '$WINDOW_NAME'"
tmux send-keys -t "$SESSION:$WINDOW_NAME" -- "$PI_COMMAND" C-m || error "Failed to start command in window '$WINDOW_NAME'"

printf "Created worker window: %s:%s\n" "$SESSION" "$WINDOW_NAME"
printf "Started command: %s\n" "$PI_COMMAND"
