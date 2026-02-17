---
name: tmux
description: "Manage tmux sessions/windows safely with a managed prefix. Use for create/list/attach/switch/cleanup workflows without touching unrelated sessions."
---

# tmux Skill (safe, managed-session workflow)

Use this skill when the task is about terminal multiplexing: long-running jobs, parallel shells, attach/switch, or cleanup.

## Safety defaults
- Prefer managed session names with a prefix (default: `pi-`).
- Do **not** use `tmux kill-server`.
- Do not kill non-managed sessions unless the user explicitly asks.

## Quick start

```bash
# 1) Pick a managed name
SESSION="pi-task-$(date +%Y%m%d-%H%M%S)"

# 2) Create detached session in current repo
tmux new-session -d -s "$SESSION" -c "$PWD"

# 3) Add a work window
tmux new-window -t "$SESSION" -n work -c "$PWD"

# 4) Run command in that window
tmux send-keys -t "$SESSION":work 'npm test' C-m

# 5) Attach
tmux attach -t "$SESSION"
```

## Core commands

```bash
# List sessions
tmux list-sessions

# Attach / switch
tmux attach -t <session>
tmux switch-client -t <session>

# New window / rename window
tmux new-window -t <session> -n <window> -c "$PWD"
tmux rename-window -t <session>:<window> <new-name>

# Send command to window
tmux send-keys -t <session>:<window> 'your command' C-m

# Capture recent output
tmux capture-pane -pt <session>:<window> -S -200
```

## Safe kill pattern (managed sessions only)

```bash
SESSION="pi-demo-20260216-1945"
case "$SESSION" in
  pi-*) tmux kill-session -t "$SESSION" ;;
  *) echo "Refusing to kill non-managed session: $SESSION" ;;
esac
```

## Stale cleanup (prefix + TTL)

Only removes sessions matching the managed prefix and older than TTL.

```bash
PREFIX="pi-"
TTL_SECONDS="86400"   # 24h
NOW="$(date +%s)"

tmux list-sessions -F '#{session_name} #{session_created}' 2>/dev/null |
while read -r NAME CREATED; do
  case "$NAME" in
    ${PREFIX}*)
      AGE=$((NOW - CREATED))
      if [ "$AGE" -ge "$TTL_SECONDS" ]; then
        echo "Killing stale managed session: $NAME (age=${AGE}s)"
        tmux kill-session -t "$NAME"
      fi
      ;;
  esac
done
```

## Optional dedicated socket (extra isolation)

If you want a separate tmux server for pi-managed work:

```bash
SOCKET_DIR="${XDG_RUNTIME_DIR:-/tmp}/pi-tmux"
mkdir -p "$SOCKET_DIR"
SOCKET="$SOCKET_DIR/default.sock"

tmux -S "$SOCKET" new-session -d -s pi-demo -c "$PWD"
tmux -S "$SOCKET" list-sessions
tmux -S "$SOCKET" attach -t pi-demo
```

Use the same `-S "$SOCKET"` on all related commands.

## Troubleshooting
- `tmux: command not found` → install tmux and retry.
- `no sessions` → create one first with `tmux new-session ...`.
- Attach fails from inside tmux → use `tmux switch-client -t <session>`.
