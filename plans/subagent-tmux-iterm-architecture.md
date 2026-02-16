# Subagent Runtime Plan: tmux + iTerm2 Viewer

## Status
Draft v0.2 (architecture + interfaces)

## Goal
Add subagents that:
1. Run reliably in the background (even if iTerm window closes).
2. Can be viewed live in an iTerm2 side pane.
3. Keep existing `subagent` tool behavior (status, usage, errors, rendering).

## Key decision
- **tmux is the runtime** (source of truth).
- **iTerm2 is the viewer** (optional side pane attached to tmux).
- **pi extension is the control plane** (spawn/send/list/kill and UI updates).

This means the main `pi` session does **not** need to start in tmux.

---

## User experience

### Normal start (no setup friction)
1. Open iTerm2.
2. `cd` into repo.
3. Run `pi` as usual.
4. First `subagent` call auto-creates a tmux session in the background.
5. If enabled, an iTerm2 side pane opens and attaches to that tmux session.

### If iTerm2 closes
- Subagents continue running in tmux.
- User can reattach later.

---

## Architecture

```text
subagent tool (extension)
    |
    v
Subagent Manager
    |
    +--> Tmux Runtime Adapter (spawn/send/kill/list)
    |        |
    |        +--> tmux session/window/panes (actual subagent processes)
    |        +--> per-agent logs/events (jsonl)
    |
    +--> iTerm2 Viewer Adapter (optional)
             |
             +--> split pane + attach to tmux for live viewing
```

---

## Responsibilities by layer

### 1) Subagent Manager (existing tool entry)
- Validate mode (`single`, `parallel`, `chain`, `orchestrator`, pool actions).
- Keep limits and safety checks.
- Convert runtime events to tool `onUpdate` + `renderResult` details.

### 2) Tmux Runtime Adapter (new)
- Create/reuse tmux session per parent pi session.
- Spawn each agent as its own tmux window or pane.
- Track pid/state/exit.
- Provide kill/kill-all.
- Write structured event stream for parser.

### 3) Event Parser (new)
- Parse JSON-mode subagent output from log stream.
- Build message history + usage + final response.
- Feed updates back to existing renderer.

### 4) iTerm2 Viewer Adapter (new, optional)
- Open/focus split pane in iTerm2.
- Attach pane to tmux session/window.
- Never own lifecycle (tmux remains source of truth).

---

## Session model

- tmux session name: `pi-sa-<parentSessionId>`
- one subagent = one tmux window (v1)
- optional deeper pane trees later

Why window-per-agent first:
- simpler lifecycle
- easier mapping for `spawn/send/kill/list`
- less fragile than nested pane layouts

---

## Execution flow (spawn)

1. Tool request received (`subagent` action/mode).
2. Manager asks Runtime Adapter to spawn.
3. Runtime Adapter ensures tmux session exists.
4. Starts command in tmux window:
   - `pi --mode json -p --no-session -ne ...`
5. Output is captured to per-agent JSONL log.
6. Parser streams updates to tool UI.
7. If configured, Viewer Adapter opens/attaches iTerm side pane.

---

## Kill flow

- `kill <id>`: terminate tmux window/process, mark dead.
- `kill-all`: terminate tmux session, cleanup agent state/log handles.

---

## Config (proposed)

```json
{
  "pi-subagent": {
    "runtimeMode": "tmux",
    "viewerMode": "iterm2",
    "openViewerOnSpawn": true,
    "tmuxSessionPrefix": "pi-sa",
    "logDir": "~/.pi/subagents",
    "iterm": {
      "splitDirection": "vertical",
      "focusViewer": false
    }
  }
}
```

### Fallback behavior
- If tmux missing: fail with clear instructions.
- If iTerm automation fails: continue headless (runtime still works).

---

## Implementation phases

### Phase 1: tmux runtime (no iTerm automation required)
- Add Runtime Adapter and parser.
- Preserve existing `subagent` API and TUI rendering.
- Keep old direct subprocess path behind feature flag (`runtimeMode: process`).

### Phase 2: iTerm2 viewer integration
- Add Viewer Adapter.
- Optional auto-open side pane + attach to tmux.
- Keep fully optional and non-blocking.

### Phase 3: polish
- Better reconnect/focus behavior.
- Cleaner naming and cleanup on session end.
- Optional per-agent quick attach commands.

---

## Risks and mitigations

1. **iTerm automation brittleness**
   - Mitigation: iTerm is optional viewer only.

2. **Orphaned tmux sessions**
   - Mitigation: cleanup hooks + `kill-all` + stale session sweep.

3. **Parsing/log drift**
   - Mitigation: strict JSON event parser + tests with sample transcripts.

4. **Complexity jump**
   - Mitigation: phase rollout + preserve current process runtime as fallback.

---

## Acceptance criteria (v1)

- User can start main `pi` normally (not in tmux).
- First subagent call auto-creates tmux runtime.
- Subagent results/usage still render in pi as before.
- `kill` and `kill-all` work reliably.
- If viewer enabled, iTerm side pane opens and attaches.
- If viewer fails, subagent still runs and reports correctly.

---

## Open questions

1. iTerm integration method for v1:
   - AppleScript/JXA first, Python API later?
2. Pane strategy in viewer:
   - one shared attached pane vs per-agent panes?
3. Log retention:
   - keep for debugging vs auto-prune policy?
4. Default behavior:
   - enable viewer by default or opt-in?

---

## Interface contracts (proposed)

### RuntimeAdapter

```ts
export type RuntimeMode = "process" | "tmux";

export interface RuntimeSpawnOptions {
  id: string;
  agentName: string;
  task: string;
  cwd: string;
  model?: string;
  toolsCsv?: string;
  noTools?: boolean;
  extensions?: string[];
  skills?: string[];
  noSkills?: boolean;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  systemPrompt?: string;
  timeoutMs: number;
  env?: Record<string, string>;
}

export type RuntimeEvent =
  | { type: "started"; id: string; pid?: number; runtimeRef: string }
  | { type: "message"; id: string; message: any }
  | { type: "tool_result"; id: string; message: any }
  | { type: "stderr"; id: string; text: string }
  | { type: "exit"; id: string; exitCode: number; durationMs: number }
  | { type: "error"; id: string; error: string };

export interface RuntimeHandle {
  id: string;
  runtimeRef: string; // tmux session/window ref or process id ref
  send(message: string): Promise<void>; // noop for one-shot in v1
  kill(signal?: "SIGTERM" | "SIGKILL"): Promise<void>;
}

export interface RuntimeAdapter {
  mode: RuntimeMode;
  spawn(opts: RuntimeSpawnOptions, onEvent: (event: RuntimeEvent) => void): Promise<RuntimeHandle>;
  list(): Promise<Array<{ id: string; runtimeRef: string; state: "starting" | "idle" | "streaming" | "dead" }>>;
  kill(id: string): Promise<void>;
  killAll(): Promise<void>;
  dispose(): Promise<void>;
}
```

### ViewerAdapter (iTerm)

```ts
export type ViewerMode = "none" | "iterm2";

export interface ViewerAttachOptions {
  sessionName: string; // tmux session name
  target?: string; // tmux target, e.g. "session:window"
  splitDirection?: "vertical" | "horizontal";
  focus?: boolean;
}

export interface ViewerAdapter {
  mode: ViewerMode;
  isAvailable(): Promise<boolean>;
  attach(opts: ViewerAttachOptions): Promise<{ viewerRef: string }>;
  focus(viewerRef: string): Promise<void>;
}
```

### Event parser contract

```ts
export interface ParsedRunState {
  messages: any[];
  response: string;
  exitCode: number;
  stderr: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    totalTokens: number;
    turns: number;
  };
  model: string | null;
  stopReason: string | null;
  errorMessage: string | null;
}

export interface RuntimeEventParser {
  onRuntimeEvent(event: RuntimeEvent): ParsedRunState | null; // returns snapshots for streaming UI
  getFinalState(): ParsedRunState;
}
```

---

## Wire-up points in `pi-subagent`

### `src/tool.ts`
- Replace direct `runIsolatedAgent(...)` calls with `runtime.spawn(...)`.
- Keep `runAgent(...)` as orchestration boundary, but feed it runtime events.
- Keep existing `renderCall`/`renderResult` unchanged as much as possible.
- Add optional viewer attach after spawn success:
  - only when `runtimeMode: "tmux"`
  - only when `viewerMode: "iterm2"`
  - swallow viewer errors (log, do not fail run).

### `src/pool.ts`
- Store `runtimeRef` per pool node.
- `spawn/send/kill/list` delegate to RuntimeAdapter.
- ensure child cleanup remains recursive.

### `src/runner.ts`
- Keep as `ProcessRuntimeAdapter` implementation (existing behavior).
- Add new `TmuxRuntimeAdapter` in new file:
  - `src/runtime/tmux.ts`
- Keep shared parsing/utilities in:
  - `src/runtime/events.ts`

### `src/settings.ts`
- Add new settings keys:
  - `runtimeMode`, `viewerMode`, `openViewerOnSpawn`
  - `tmuxSessionPrefix`, `logDir`
  - `iterm.splitDirection`, `iterm.focusViewer`

---

## tmux command strategy (v1)

- Ensure session:
  - `tmux has-session -t <session> || tmux new-session -d -s <session>`
- Spawn agent window:
  - `tmux new-window -t <session> -n <agentId> '<wrapped-command>'`
- Capture output (v1 decision):
  - direct stdout/stderr redirection to per-run files.
  - defer `pipe-pane` support to later if needed.
- Kill agent:
  - `tmux kill-window -t <session>:<agentId>`
- Kill all:
  - `tmux kill-session -t <session>`

### Wrapped command shape

```bash
pi --mode json -p --no-session -ne [flags] "Task: ..."
```

- write system prompt to temp file and pass `--append-system-prompt`.
- pass extension whitelist via repeated `-e` flags.

---

## iTerm attach strategy (v1)

- Primary: AppleScript/JXA for simple attach command.
- Command run in side pane:

```bash
tmux attach -t <session>
```

- Future: Python API if we need stronger pane targeting + richer automation.

Non-goal in v1:
- running business logic inside iTerm automation layer.

---

## Pressure-test scenarios (must pass)

1. **Main pi not in tmux**
   - Start `pi` normally, spawn subagent, confirm tmux auto-created.

2. **Viewer failure**
   - Block iTerm automation, confirm subagent still runs and reports.

3. **Parent terminal closed**
   - Close iTerm window, reattach tmux, confirm subagent survives.

4. **Parallel burst**
   - Spawn N parallel tasks near max limits, verify state updates and cleanup.

5. **Kill behavior**
   - kill one node, then kill-all; verify no orphan windows/session.

6. **Timeout + abort**
   - Force hung task, verify timeout state and proper process termination.

7. **Project agent safety**
   - Keep existing confirmation flow for project-scoped agents.

---

## Headless review / pressure-test results

A separate headless `pi` run reviewed this plan and returned a **conditional GO**.

### Main risks it flagged
1. Event integrity (line handling under burst output).
2. Kill semantics (window kill vs full process tree kill).
3. Naming collisions for sessions/windows.
4. Recovery behavior after manager restart/crash.
5. Shell quoting/injection risk in wrapped command construction.
6. Session/log bloat without retention + cleanup.

### Required gates before implementation (must-have)
1. Decide one canonical event transport and parser failure behavior.
2. Define TERM→KILL escalation and orphan verification checks.
3. Define naming/recovery/cleanup policies for sessions and logs.
4. Use quote-safe command construction (no raw string interpolation of user text).

---

## Phase 1 decisions (locked now)

To reduce risk and keep scope tight, v1 will do the following:

1. **No `send()` behavior in runtime v1**
   - Runtime is one-shot only for initial tmux implementation.
   - Pool `send` remains on existing non-tmux path until explicitly added.

2. **Event transport = per-run files first**
   - Prefer direct stdout/stderr file redirection for each run.
   - Avoid `pipe-pane` as default in v1.

3. **Viewer stays out of runtime critical path**
   - iTerm failures never fail or block subagent execution.

4. **`runtimeMode: "process"` remains default**
   - tmux stays opt-in until pressure tests pass.

5. **Cleanup required**
   - Add startup cleanup + periodic stale-session/log cleanup job.

---

## Next step
Execute the ordered checklist in:
- `plans/subagent-phase1-implementation-checklist.md`

Then run the pressure-test scenarios above and only promote tmux defaults after all gates pass.
