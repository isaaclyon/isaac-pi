---
name: tmux
description: "Manage tmux sessions/windows safely with a managed prefix. Use for create/list/attach/switch/cleanup workflows without touching unrelated sessions."
---

# tmux Skill (safe, managed-session workflow)

Use this skill when the task is about terminal multiplexing: long-running jobs, parallel shells, dev servers, attach/switch, or cleanup.

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

## Tools overview

| Tool | Purpose |
|------|---------|
| `tmux_ensure_session` | Create or reuse a managed session (pi-*) |
| `tmux_run` | Run a one-off command, optionally wait for completion |
| `tmux_capture` | Capture recent output from a session/window |
| `tmux_list` | List managed sessions |
| `tmux_cleanup` | Clean up stale or specific managed sessions |
| `tmux_serve` | Start a long-running process with crash monitoring |
| `tmux_serve_stop` | Stop monitoring (optionally kill session) |
| `tmux_serve_list` | List active serve monitors and their status |

## Dev server workflow (tmux_serve)

Use `tmux_serve` for long-running background processes like dev servers, watchers, and database processes. It starts the command and monitors it — if the process crashes, you are automatically alerted with the last output.

### Typical flow

1. **Create a session** with `tmux_ensure_session`.
2. **Start the server** with `tmux_serve`, specifying a `readyPattern` if the server emits a "ready" message.
3. **Work normally** — the monitor runs in the background.
4. **On crash** — you receive an automatic alert with context. Investigate with `tmux_capture` and restart with `tmux_serve`.
5. **When done** — stop monitoring with `tmux_serve_stop` (optionally pass `killSession: true`).

### Example: Node.js dev server

```
tmux_ensure_session  sessionName="pi-myapp"
tmux_serve           sessionName="pi-myapp" windowName="server" command="npm run dev" readyPattern="listening on port"
```

The monitor will:
- Show `⚡ pi-myapp:server: node (running)` in the status bar while alive.
- Show `✅ pi-myapp:server: node (ready)` once the ready pattern matches.
- Alert you with last output if the process exits unexpectedly.

### Example: Multiple services

```
tmux_ensure_session  sessionName="pi-stack"
tmux_serve           sessionName="pi-stack" windowName="api"    command="npm run dev:api"    readyPattern="API ready"
tmux_serve           sessionName="pi-stack" windowName="worker" command="npm run dev:worker" readyPattern="Worker started"
tmux_serve           sessionName="pi-stack" windowName="db"     command="docker compose up postgres redis"
```

### Stopping monitors

```
tmux_serve_list                                           # see all active monitors
tmux_serve_stop  monitorId="serve-1-abc123"               # stop monitoring only
tmux_serve_stop  monitorId="serve-1-abc123" killSession=true  # stop + kill session
```

### Key details

- **Crash detection** uses `pane_current_command` — when the foreground process exits back to a shell (`bash`, `zsh`, etc.), the monitor detects it.
- **Grace period**: after starting, the monitor waits ~2 poll cycles before flagging a shell as a crash (handles slow-starting processes).
- **Session killed externally**: if the session is killed (e.g., via `tmux_cleanup`), the monitor stops silently without alerting.
- **`readyPattern`** is a JavaScript regex tested against the last 50 lines of pane output. Use simple patterns like `listening on port`, `ready in`, `Server started`.
- **Polling interval** defaults to 3 seconds. Increase for low-overhead monitoring of stable services.

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
- Serve monitor says "process exited immediately" → the command may have a syntax error or port conflict. Use `tmux_capture` to check output.
- Serve monitor not detecting crashes → the process may be spawning a child and exiting (e.g., daemonizing). Use `tmux_run` for daemon-style processes instead.
