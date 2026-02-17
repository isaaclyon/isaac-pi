# tmux Extension Spec (MVP: 5 tools)

## Goal
Provide a small, safe tmux toolset so agents can run background work without long ad-hoc shell command chains.

## MVP tool list
1. `tmux_ensure_session`
2. `tmux_run`
3. `tmux_capture`
4. `tmux_list`
5. `tmux_cleanup`

## Safety model (non-negotiable)
- Managed sessions are identified by internal prefix: `pi-`.
- Destructive actions only target managed sessions.
- Never call `tmux kill-server`.
- Cleanup defaults to `dryRun: true`.

## Internal constants
```ts
const MANAGED_PREFIX = "pi-";
const DEFAULT_WINDOW = "main";
const DEFAULT_CAPTURE_LINES = 200;
const DEFAULT_CAPTURE_TIMEOUT_SEC = 30;
const DEFAULT_TIMEOUT_SEC = 600;
const DEFAULT_STALE_TTL_SEC = 86_400;
```

---

## 1) `tmux_ensure_session`
Create a managed session if missing, or return existing metadata.

### Arguments
```ts
{
  sessionName?: string; // if omitted: "pi-<taskSlug>-<timestamp>"
  taskSlug?: string;    // default: "task"
  cwd?: string;         // default: process.cwd()
  socketPath?: string;  // optional dedicated socket
}
```

### Response
```ts
{
  ok: boolean;
  sessionName: string;
  managed: true;
  created: boolean;
  createdAtEpoch: number;
  cwd: string;
  socketPath?: string;
  command: string;
  error?: string;
  code?: ErrorCode;
}
```

---

## 2) `tmux_run`
Run a command in a session/window. Supports fire-and-forget and optional wait mode.

### Arguments
```ts
{
  sessionName: string;
  command: string;
  windowName?: string;            // default: "main"
  cwd?: string;
  socketPath?: string;
  createWindowIfMissing?: boolean; // default: true
  waitForExit?: boolean;          // default: false
  timeoutSec?: number;            // default: 600 (only when waitForExit=true)
  doneMarker?: string;            // optional; if omitted in wait mode, tool auto-generates one
}
```

### Response
```ts
{
  ok: boolean;
  sessionName: string;
  windowName: string;
  socketPath?: string;
  started: boolean;
  startedAtEpoch: number;
  command: string;

  // present only when waitForExit=true
  completed?: boolean;
  completedAtEpoch?: number;
  marker?: string;
  exitCode?: number | null;
  timeout?: boolean;

  error?: string;
  code?: ErrorCode;
}
```

### Wait mode rules
- If `waitForExit=true` and no `doneMarker` is provided, the tool generates one (example: `__PI_DONE__<random>`).
- The command is wrapped to print marker + exit code.
- `completed`, `timeout`, and `exitCode` are only populated in wait mode.
- On timeout, the tool returns `timeout: true` and does **not** kill the underlying process/session.

---

## 3) `tmux_capture`
Capture recent pane output for progress/result reporting.

### Arguments
```ts
{
  sessionName: string;
  windowName?: string;            // default: "main"
  lines?: number;                 // default: 200
  socketPath?: string;
  stripAnsi?: boolean;            // default: true
  joinWrappedLines?: boolean;     // default: true  (uses tmux -J)
  trimTrailingEmptyLines?: boolean; // default: true
  collapseEmptyLines?: boolean;   // default: true
  captureTimeoutSec?: number;     // default: 30
}
```

### Response
```ts
{
  ok: boolean;
  sessionName: string;
  windowName: string;
  socketPath?: string;
  lines: number;
  content: string;
  error?: string;
  code?: ErrorCode;
}
```

### Capture rules
- If tmux does not respond within `captureTimeoutSec`, return `{ ok: false, code: "TIMEOUT" }`.
- By default wrapped terminal lines are joined (`joinWrappedLines: true`) to reduce visual line breaks from pane width wrapping.

---

## 4) `tmux_list`
List managed sessions (optionally expanded with windows).

### Arguments
```ts
{
  socketPath?: string;
  includeWindows?: boolean; // default: false
}
```

### Response
```ts
{
  ok: boolean;
  socketPath?: string;
  sessions: Array<{
    name: string;
    managed: true;
    createdEpochSec?: number;
    attached?: boolean;
    windows?: Array<{
      index: number;
      name: string;
      active: boolean;
    }>;
  }>;
  error?: string;
  code?: ErrorCode;
}
```

---

## 5) `tmux_cleanup`
Safe cleanup for one managed session or stale managed sessions.

### Arguments
```ts
{
  mode: "single" | "stale"; // explicit (no default)
  sessionName?: string;         // required when mode="single"
  staleTtlSec?: number;         // default: 86400 (used when mode="stale")
  socketPath?: string;
  dryRun?: boolean;             // default: true
}
```

### Stale definition
- In `mode: "stale"`, session age is measured from tmux `session_created` epoch (equivalent to session creation time).
- A session is stale when: `now - session_created >= staleTtlSec`.

### Response
```ts
{
  ok: boolean;
  mode: "single" | "stale";
  socketPath?: string;
  dryRun: boolean;
  checked: number;
  matched: number;
  killed: string[];
  skipped: Array<{ sessionName: string; reason: string }>;
  error?: string;
  code?: ErrorCode;
}
```

---

## Shared error codes
```ts
type ErrorCode =
  | "TMUX_NOT_FOUND"
  | "INVALID_ARGUMENT"
  | "SESSION_NOT_FOUND"
  | "WINDOW_NOT_FOUND"
  | "TIMEOUT"
  | "TMUX_COMMAND_FAILED";
```

All tools should return machine-friendly error payloads:
```ts
{
  ok: false,
  error: string,
  code: ErrorCode
}
```

---

## Example agent flow
1. `tmux_ensure_session({ taskSlug: "calc-demo", socketPath })`
2. `tmux_run({ sessionName, windowName: "build", command: "pi -p @prompt.md", waitForExit: false })`
3. Poll with `tmux_capture({ sessionName, windowName: "build", lines: 300 })`
4. `tmux_list({ socketPath })` for diagnostics
5. `tmux_cleanup({ mode: "stale", staleTtlSec: 3600, dryRun: false, socketPath })`

---

## Why this is minimal
- 5 tools cover create → run → observe → inspect → cleanup.
- No extra knobs for unsafe behavior.
- Clear defaults reduce mistakes while keeping enough flexibility for real workflows.
