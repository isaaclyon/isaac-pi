# Subagent Phase 1 Implementation Checklist (Ordered)

## Scope
Phase 1 only:
- tmux runtime support (opt-in)
- no iTerm automation required for success
- no new long-lived `send()` behavior in tmux path
- keep existing process runtime as default

## Exit criteria for Phase 1
- `runtimeMode: "process"` remains default.
- `runtimeMode: "tmux"` works for one-shot subagent runs.
- Existing render/usage behavior is preserved.
- All pressure tests pass.
- Cleanup job prevents stale tmux sessions/log buildup.

---

## Work items (build order)

### P1-01 — Add settings and feature flags
**Goal:** Make rollout safe and reversible.

- Add settings keys in `src/settings.ts`:
  - `runtimeMode: "process" | "tmux"` (default `"process"`)
  - `viewerMode: "none" | "iterm2"` (default `"none"`)
  - `openViewerOnSpawn` (default `false`)
  - `tmuxSessionPrefix` (default `"pi-sa"`)
  - `logDir` (default `~/.pi/subagents`)
- Validate values and provide clear fallback defaults.

**Done when:** invalid config can’t crash startup; defaults are documented.

---

### P1-02 — Extract runtime interface and preserve current behavior
**Goal:** Create runtime abstraction with zero behavior changes first.

- Add runtime contracts (types/interfaces) under `src/runtime/types.ts`.
- Wrap current `runIsolatedAgent` behavior as `ProcessRuntimeAdapter`.
- Keep existing orchestration logic in `tool.ts` working unchanged through adapter.

**Done when:** with `runtimeMode: "process"`, behavior matches today.

---

### P1-03 — Implement quote-safe command builder for tmux
**Goal:** prevent shell interpolation bugs.

- Build tmux run command from controlled args, not raw string interpolation.
- Use temp files for complex user text (`task`, system prompt) where needed.
- Avoid embedding raw user content directly in shell command text.

**Done when:** command assembly is test-covered for quotes/newlines/special chars.

---

### P1-04 — Implement `TmuxRuntimeAdapter` (one-shot)
**Goal:** run subagents in tmux windows reliably.

- Ensure session create/reuse (`tmux has-session` / `new-session -d`).
- Spawn one window per run (`new-window`).
- Save `runtimeRef` (`<session>:<window>`).
- Record start time + basic state transitions.

**Done when:** one-shot subagent runs successfully in tmux and returns output.

---

### P1-05 — Lock event transport for v1 (file-based)
**Goal:** robust event parsing with minimal moving parts.

- For each run, write:
  - stdout JSON stream file
  - stderr file
- Implement streaming parser that reads JSON lines from stdout file.
- Define parser failure behavior (soft error + fallback text + clear status).

**Done when:** message/tool_result/exit usage aggregation matches process path in sample runs.

---

### P1-06 — Kill semantics + timeout/abort semantics
**Goal:** no orphan processes.

- Define TERM → wait → KILL escalation path.
- Verify kill actually stops window/process; if not, force kill and mark error.
- Ensure timeout and user abort map to clear final states.

**Done when:** pressure tests for timeout/abort/kill pass without orphans.

---

### P1-07 — Naming, collision, and recovery policy
**Goal:** avoid runtime identity problems.

- Session naming includes enough uniqueness (prefix + session id + short hash/nonce).
- Window naming sanitized and collision-safe.
- Define restart behavior:
  - If manager restarts, stale runs become `unknown/dead` unless rehydration is explicitly implemented.

**Done when:** concurrent runs/repos cannot collide in naming.

---

### P1-08 — Cleanup and retention
**Goal:** keep machine clean over time.

- Add startup cleanup for stale sessions/log directories.
- Add periodic cleanup task with conservative TTL.
- Keep logs useful for debugging but bounded.

**Done when:** stale artifacts are pruned automatically and safely.

---

### P1-09 — Wire into tool + pool safely
**Goal:** integrate without regressions.

- `tool.ts` uses runtime adapter by mode.
- tmux path is one-shot only in Phase 1; no new `send()` on tmux path.
- Keep current project-agent safety confirmation behavior.

**Done when:** single/parallel/chain one-shot modes work on process mode + tmux mode.

---

### P1-10 — Optional viewer hooks (non-blocking)
**Goal:** prepare for Phase 2 without coupling runtime success.

- Add viewer adapter scaffolding only (if easy).
- Ensure viewer errors never fail a run.
- Keep default `viewerMode: "none"`.

**Done when:** runtime success is independent of viewer availability.

---

### P1-11 — Pressure-test pass
**Goal:** enforce quality gates before rollout.

Run and record results for:
1. Main pi not in tmux
2. Viewer failure
3. Parent terminal closed
4. Parallel burst near limits
5. Kill one + kill-all
6. Timeout + abort
7. Project-agent safety confirmation

**Done when:** all tests pass in tmux mode with no silent failures.

---

### P1-12 — Release guardrails
**Goal:** safe adoption.

- Keep default `runtimeMode: "process"`.
- Add docs for enabling tmux mode explicitly.
- Add troubleshooting section (tmux missing, permission issues, stale sessions).

**Done when:** users can opt in confidently; rollback is one setting change.

---

## Suggested issue breakdown

- Issue 1: Settings + runtime abstraction (`P1-01`, `P1-02`)
- Issue 2: tmux adapter core + safe command builder (`P1-03`, `P1-04`)
- Issue 3: event parser + file transport (`P1-05`)
- Issue 4: kill/timeout semantics (`P1-06`)
- Issue 5: naming/recovery/cleanup (`P1-07`, `P1-08`)
- Issue 6: tool/pool wiring (`P1-09`)
- Issue 7: optional viewer scaffolding (`P1-10`)
- Issue 8: pressure tests + rollout docs (`P1-11`, `P1-12`)
