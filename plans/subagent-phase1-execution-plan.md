# Subagent Phase 1 Execution Plan (from P1 checklist)

## Context
This plan turns `P1-01` to `P1-12` into concrete implementation steps against the `pi-subagent` codebase at:

- `extensions/pi-subagent` (from `https://github.com/espennilsen/pi/tree/main/extensions/pi-subagent`)

Phase 1 scope remains:
- tmux runtime support (opt-in)
- process runtime stays default
- one-shot focus for tmux path
- viewer is optional/non-blocking

---

## Ordered work plan with file-level targets

### P1-01 — Add settings and feature flags
**Goal:** safe, reversible rollout.

**Files:**
- `extensions/pi-subagent/src/settings.ts`
- `extensions/pi-subagent/src/types.ts`
- `extensions/pi-subagent/README.md`

**Tasks:**
- Add settings keys:
  - `runtimeMode: "process" | "tmux"` (default `"process"`)
  - `viewerMode: "none" | "iterm2"` (default `"none"`)
  - `openViewerOnSpawn: boolean` (default `false`)
  - `tmuxSessionPrefix: string` (default `"pi-sa"`)
  - `logDir: string` (default `~/.pi/subagents`)
- Validate/sanitize config values and fallback safely.

---

### P1-02 — Runtime abstraction with process parity
**Goal:** introduce runtime layer with no behavior changes.

**Files:**
- `extensions/pi-subagent/src/runtime/types.ts` (new)
- `extensions/pi-subagent/src/runtime/process.ts` (new)
- `extensions/pi-subagent/src/runtime/factory.ts` (new)
- `extensions/pi-subagent/src/tool.ts`
- `extensions/pi-subagent/src/runner.ts` (minimal reuse)
- `extensions/pi-subagent/src/types.ts`

**Tasks:**
- Define runtime contracts: adapter, handle, events.
- Wrap current `runIsolatedAgent` one-shot path in `ProcessRuntimeAdapter`.
- Wire `tool.ts` to runtime factory for one-shot execution.

---

### P1-03 — Quote-safe tmux command builder
**Goal:** prevent shell interpolation/injection bugs.

**Files:**
- `extensions/pi-subagent/src/runtime/command-builder.ts` (new)
- `extensions/pi-subagent/src/runtime/tmux.ts` (new, consumed later)

**Tasks:**
- Build command from argument arrays (no raw interpolation).
- Use temp files for user text/system prompt.
- Sanitize tmux identifiers (session/window names).

---

### P1-04 — Implement `TmuxRuntimeAdapter` (one-shot)
**Goal:** reliable one-shot runs in tmux windows.

**Files:**
- `extensions/pi-subagent/src/runtime/tmux.ts` (new)
- `extensions/pi-subagent/src/runtime/factory.ts`

**Tasks:**
- Ensure/create tmux session (`has-session` / `new-session -d`).
- Spawn one window per run (`new-window`).
- Emit start/state/exit events and set `runtimeRef` (`session:window`).

---

### P1-05 — Canonical event transport + parser behavior
**Goal:** robust v1 event parsing.

**Files:**
- `extensions/pi-subagent/src/runtime/events.ts` (new)
- `extensions/pi-subagent/src/runtime/tmux.ts`
- `extensions/pi-subagent/src/tool.ts`

**Tasks:**
- Canonical transport: per-run files (`stdout.jsonl`, `stderr.log`).
- Implement line-safe JSONL parser.
- Parser failure behavior:
  - soft error event
  - fallback to stderr/raw text
  - explicit final error status (never silent)

---

### P1-06 — TERM→KILL + timeout/abort semantics
**Goal:** no orphans.

**Files:**
- `extensions/pi-subagent/src/runtime/tmux.ts`
- `extensions/pi-subagent/src/runtime/types.ts`

**Tasks:**
- Implement TERM → grace wait → KILL escalation.
- Verify process/window actually ended; force kill and mark error if not.
- Map timeout/abort to clear final states.

---

### P1-07 — Naming, collision, recovery policy
**Goal:** avoid identity collisions and undefined recovery.

**Files:**
- `extensions/pi-subagent/src/runtime/naming.ts` (new)
- `extensions/pi-subagent/src/runtime/tmux.ts`

**Tasks:**
- Unique naming: prefix + session id + nonce/hash.
- Sanitize names.
- Define restart behavior: stale runs become `dead/unknown` in Phase 1 (no rehydration).

---

### P1-08 — Cleanup and retention
**Goal:** avoid stale session/log buildup.

**Files:**
- `extensions/pi-subagent/src/runtime/cleanup.ts` (new)
- `extensions/pi-subagent/src/index.ts`
- `extensions/pi-subagent/src/runtime/tmux.ts`

**Tasks:**
- Startup stale-session/log cleanup.
- Periodic cleanup job with conservative TTL.
- Keep logs bounded but still useful for debugging.

---

### P1-09 — Wire into tool + pool safely
**Goal:** integrate without regressions.

**Files:**
- `extensions/pi-subagent/src/tool.ts`
- `extensions/pi-subagent/src/pool.ts`

**Tasks:**
- Runtime selection by `runtimeMode`.
- tmux path one-shot only in Phase 1.
- Keep pool/send semantics on existing process/RPC path.

---

### P1-10 — Optional viewer hooks (non-blocking)
**Goal:** prep for later, no coupling to runtime success.

**Files:**
- `extensions/pi-subagent/src/viewer/types.ts` (new)
- `extensions/pi-subagent/src/viewer/iterm2.ts` (new, scaffold)
- `extensions/pi-subagent/src/tool.ts`
- `extensions/pi-subagent/src/settings.ts`

**Tasks:**
- Add viewer scaffolding only.
- Viewer errors never fail the run.

---

### P1-11 — Pressure tests
**Goal:** pass mandatory scenarios before enabling by default.

**Files:**
- `extensions/pi-subagent/README.md`
- `extensions/pi-subagent/plans/phase1-test-matrix.md` (optional new)

**Tasks:**
Run and record:
1. Main pi not in tmux
2. Viewer failure
3. Parent terminal closed
4. Parallel burst near limits
5. Kill one + kill-all
6. Timeout + abort
7. Project-agent safety confirmation

---

### P1-12 — Release guardrails
**Goal:** safe adoption and rollback.

**Files:**
- `extensions/pi-subagent/src/settings.ts`
- `extensions/pi-subagent/README.md`

**Tasks:**
- Keep default `runtimeMode: "process"`.
- Document explicit tmux opt-in and one-step rollback.
- Add troubleshooting section (tmux missing, permissions, stale sessions).

---

## Initial PR scope (smallest safe slice)

## PR 1 (recommended)
Include only:
- `P1-01` settings/flags
- `P1-02` runtime abstraction + process adapter parity
- small docs update

Do **not** include tmux behavior yet.

### Why this scope
- Very low regression risk
- Creates clean foundation for tmux
- Keeps default behavior unchanged

### First files to touch
1. `extensions/pi-subagent/src/types.ts`
2. `extensions/pi-subagent/src/settings.ts`
3. `extensions/pi-subagent/src/runtime/types.ts` (new)
4. `extensions/pi-subagent/src/runtime/process.ts` (new)
5. `extensions/pi-subagent/src/runtime/factory.ts` (new)
6. `extensions/pi-subagent/src/tool.ts`
7. `extensions/pi-subagent/src/runner.ts` (minimal)
8. `extensions/pi-subagent/README.md`

---

## Acceptance criteria for PR 1
- `runtimeMode` exists and defaults to `"process"`.
- Single/parallel/chain one-shot behavior unchanged.
- Pool/orchestrator behavior unchanged.
- Invalid settings values do not crash startup; defaults apply.
- `npm run typecheck` passes in `extensions/pi-subagent`.

## Short test plan for PR 1
1. Typecheck (`npm run typecheck`)
2. Single mode smoke test
3. Parallel mode smoke test (streaming)
4. Chain mode smoke test (`{previous}`)
5. Pool/orchestrator smoke tests (spawn/send/list/kill)
6. Invalid settings fallback test (`runtimeMode`, `viewerMode`)

---

## Handling unrelated untracked files
Current local untracked files:
- `.pi/extensions/mcporter-auth.ts`
- `.pi/extensions/mcporter.ts`
- `.pi/extensions/mcporter/`

Recommended before implementation:

```bash
git stash push -u -m "wip: mcporter local files" -- \
  .pi/extensions/mcporter-auth.ts \
  .pi/extensions/mcporter.ts \
  .pi/extensions/mcporter
```

This keeps implementation changes focused and reviewable.
