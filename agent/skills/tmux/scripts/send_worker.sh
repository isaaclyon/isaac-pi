#!/usr/bin/env sh
set -eu

usage() {
  cat <<'EOF'
Usage:
  send_worker.sh [--delay <seconds>] [--no-prefix] <window-name> <command-or-task-prompt>
  send_worker.sh [--delay <seconds>] [--no-prefix] <window-name> -    # read prompt from stdin

Examples:
  send_worker.sh wk-auth-refactor-01 "Summarize failing tests and propose a fix plan"
  send_worker.sh --delay 1.5 wk-auth-refactor-01 "Implement Phase 1 from docs/plans/..."
  send_worker.sh --no-prefix wk-auth-refactor-01 "Read this file and execute now"
  printf 'Line 1\nLine 2\n' | send_worker.sh wk-auth-refactor-01 -

Options:
  --delay, -d       Seconds to wait before dispatch (default: TMUX_WORKER_SEND_DELAY or 0.6)
  --no-prefix, -n   Skip automatic execution-first prompt prefix
EOF
}

error() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

is_number() {
  printf '%s' "$1" | grep -Eq '^[0-9]+([.][0-9]+)?$'
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

DELAY="${TMUX_WORKER_SEND_DELAY:-0.6}"
AUTO_PREFIX="${TMUX_WORKER_AUTO_PREFIX:-1}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    -d|--delay)
      [ "$#" -ge 2 ] || error "--delay requires a value"
      DELAY="$2"
      shift 2
      ;;
    -n|--no-prefix)
      AUTO_PREFIX=0
      shift
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

[ "$#" -ge 2 ] || {
  usage >&2
  exit 2
}

is_number "$DELAY" || error "Delay must be a non-negative number"

command -v tmux >/dev/null 2>&1 || error "tmux is not installed or not on PATH"
resolve_session

SESSION="${SESSION:-}"

WINDOW_NAME="$1"
shift

if [ "$1" = "-" ] && [ "$#" -eq 1 ]; then
  PAYLOAD="$(cat)"
else
  PAYLOAD="$*"
fi

[ -n "$PAYLOAD" ] || error "Prompt text is empty"
window_exists "$WINDOW_NAME" || error "Window '$WINDOW_NAME' not found in session '$SESSION'"

if [ "$AUTO_PREFIX" = "1" ]; then
  PAYLOAD="Read the task and execute now. Return concise results and avoid asking for extra context unless required.

$PAYLOAD"
fi

sleep "$DELAY"

TARGET="$SESSION:$WINDOW_NAME"
BUFFER_NAME="pi-tmux-send-$$"

tmux set-buffer -b "$BUFFER_NAME" -- "$PAYLOAD" || error "Failed to stage payload in tmux buffer"
tmux paste-buffer -d -b "$BUFFER_NAME" -t "$TARGET" || error "Failed to paste payload into '$TARGET'"
tmux send-keys -t "$TARGET" C-m || error "Failed to submit payload in '$TARGET'"

printf "Dispatched prompt to: %s\n" "$TARGET"
