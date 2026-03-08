Build a new pi extension that runs a deterministic/restartable “Ralph loop” using isolated subprocess sessions in tmux, with loop budgets, success checks, persistence, and operator controls.

## User context

- You want a new pi extension that repeatedly runs a task in isolated contexts (no shared context window) and restarts from prior progress until success or limits are hit.
- You explicitly care about:
  - defining success conditions (tests/quantitative targets)
  - forcing a loop before context is exhausted (e.g., at 50% window)
  - optional bounded turns/tool-call budgets
  - tmux subprocess isolation
  - continuing from previous loop progress
- Interview answers (today):
  - Scope: near-complete v1 extension
  - Loop budget: context usage threshold preferred
  - Success checks: deterministic bash assertions + optional qualitative mode
  - Persistence: SQLite
  - UX: commands + footer/status widget

## Key acceptance criteria

- [ ] New extension exists in `agent/extensions/ralph-loop/` and auto-loads from your existing extension discovery setup.
- [ ] The extension can start a looped orchestration run with:
  - [ ] success conditions
  - [ ] max loops
  - [ ] optional max turns / max tool calls per sub-session
  - [ ] context threshold trigger (e.g., 50%)
- [ ] Each sub-run executes in a separate tmux-backed subprocess context (no parent-context sharing).
- [ ] On budget hit, sub-run exits cleanly, emits structured checkpoint, and next loop starts from checkpoint.
- [ ] Success evaluation supports:
  - [ ] deterministic mode (required failing tests before implementation, then passing tests)
  - [ ] command-based quantitative checks (exit code + optional output assertions)
  - [ ] optional qualitative mode (agent self-report + guardrails)
- [ ] State persists in SQLite across restarts (run config, loop history, checkpoints, outcomes).
- [ ] Operator controls exist via commands plus live footer/widget status.
- [ ] Hard-cut behavior (no legacy shim/backward-compat layer unless you later request it).

## Known gotchas, watchouts, risks

- tmux session/window lifecycle can leak processes if abort paths are not centralized.
- Per-loop “continue from progress” must be explicit and deterministic (checkpoint artifact + handoff prompt), or quality will drift.
- Context-threshold stopping inside a child agent requires robust signal source:
  - either child emits usage telemetry in JSON mode
  - or parent uses strict turn/tool budgets as fallback ceiling
- Deterministic TDD success mode needs strict state machine:
  - required tests must fail before implementation phase
  - same tests must pass before run can be marked success
- SQLite writes from async orchestration paths need serialized access to avoid lock contention.

## Detailed stage-gated plan

### Stage 0 — Design lock + contract finalization [GATE]

- [x] Finalize command/tool contract for v1:
  - [x] `/ralph-start`
  - [x] `/ralph-stop`
  - [x] `/ralph-status`
  - [x] `/ralph-runs`
  - [x] optional `ralph_loop` tool for agent-driven invocations
- [x] Finalize budget semantics:
  - [x] `contextThresholdPercent` primary trigger
  - [x] optional `maxAssistantTurns` / `maxToolCalls` hard ceilings
  - [x] `maxLoops` global stop
- [x] Finalize success modes:
  - [x] deterministic TDD mode contract (`mustFail[]`, `mustPass[]`)
  - [x] quantitative assertions (`commands[]`)
  - [x] optional qualitative mode toggle
- [x] Define checkpoint format (what gets handed to next loop).
- [x] Confirm v1 defaults and failure policy with you (pending explicit gate sign-off).

### Stage 1 — Extension scaffold + persistence [GATE]

- [x] Create `agent/extensions/ralph-loop/` module structure:
  - [x] `index.ts` (extension registration)
  - [x] `config.ts` (validation/defaults)
  - [x] `db.ts` + `schema.sql` (SQLite setup/migrations)
  - [x] `store.ts` (runs/loops/checkpoints/events CRUD)
  - [x] `types.ts`
- [x] Implement hard-cut schema (no compatibility migration layer).
- [x] Add smoke tests for config + DB/store primitives.

### Stage 2 — Runner engine (tmux + pi subprocess) [GATE]

- [x] Implement child-run launcher with tmux isolation:
  - [x] unique tmux session/window naming
  - [x] child `pi` invocation in JSON/print mode as appropriate
  - [x] lifecycle controls (start, monitor, cancel, cleanup)
- [x] Build loop supervisor state machine:
  - [x] initialize run from config + initial task
  - [x] execute loop N
  - [x] detect stop trigger (context threshold or caps)
  - [x] checkpoint + restart loop N+1
- [x] Persist per-loop telemetry/events to SQLite.

### Stage 3 — Success evaluator + checkpoint handoff [GATE]

- [x] Implement deterministic TDD evaluator:
  - [x] precondition: `mustFail[]` commands fail before implementation loop(s)
  - [x] success: `mustPass[]` commands pass
  - [x] enforce same command set identity across run
- [x] Implement quantitative evaluator:
  - [x] command exit-code checks
  - [x] optional stdout/stderr regex assertions
- [x] Implement optional qualitative evaluator mode (explicitly marked non-deterministic).
- [x] Implement handoff prompt builder using last loop checkpoint + unchanged success conditions.

### Stage 4 — Operator UX (commands + status widget/footer) [GATE]

- [x] Register commands:
  - [x] `/ralph-start <config-or-preset>`
  - [x] `/ralph-stop [runId]`
  - [x] `/ralph-status [runId]`
  - [x] `/ralph-runs`
- [x] Add status rendering:
  - [x] current run/loop number
  - [x] active trigger thresholds
  - [x] last evaluator result
  - [x] tmux child health
- [x] Ensure non-UI mode degrades cleanly (no crash).

### Stage 5 — Validation + docs + handoff [FINAL GATE]

- [x] Add tests for:
  - [x] loop stop conditions
  - [x] evaluator correctness
  - [x] persistence/resume behavior
  - [x] command argument validation
- [x] Run end-to-end scenario with sample repo task.
- [x] Write usage docs under `agent/extensions/ralph-loop/README.md`.
- [x] Provide config presets:
  - [x] `deterministic-tdd`
  - [x] `quantitative-only`
  - [x] `hybrid`
- [x] Prepare final review summary and request your sign-off before any branch-finalization steps.

## Implementation notes (hard cuts)

- No backward compatibility layer for prior run formats.
- No legacy shims for old command names.
- One canonical run schema for v1.
- If we later need compatibility, we add it intentionally as a separate scoped task.
