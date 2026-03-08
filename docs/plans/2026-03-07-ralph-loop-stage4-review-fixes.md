Fix Stage 4 Ralph loop review findings (P1 stop reliability, P1 runtime swap orphaning, P2 start-config success validation) with test-first regressions.

## User context

- You asked to "Act on the code review" after a branch review flagged Stage 4 operator UX issues.
- Review verdict was `needs attention` with:
  - P1: `/ralph-stop` not reliably terminating an in-flight child loop.
  - P1: runtime/db reinit can orphan active runs.
  - P2: inline success overrides bypass validation and fail late.
- Interview decision (just confirmed): on runtime swap, **hard-cut abort old runs immediately** before reinitializing.

## Key acceptance criteria

- [x] `/ralph-stop` causes prompt child-loop termination behavior, not just deferred abort between loops.
- [x] Runtime/db swap aborts and clears old active runs before creating a new runtime, preventing orphaned run handles.
- [x] `/ralph-start` rejects malformed `success` overrides at parse-time with clear error messaging.
- [x] New/updated tests cover all three regression classes and pass.
- [x] Existing Ralph-loop suite remains green.

## Known gotchas, watchouts, risks

- `AbortController` only works if signal is propagated all the way into loop execution and tmux stop path.
- Runtime swap behavior must be deterministic; partial migration of in-memory active run state across DBs is error-prone.
- Success validation should be strict but aligned with current `types.ts` mode contracts to avoid false rejects.
- Asynchronous completion handlers can race with runtime replacement if cleanup ordering is not explicit.

## Detailed stage-gated plan

### Stage A — Red tests for review findings [GATE]

- [x] Add failing test in `loop-executor.test.ts` proving abort signal during an active loop stops session and returns terminal stopped/failed behavior as intended.
- [x] Add failing test in `index.test.ts` proving runtime swap aborts previous runtime active signal(s) before swap.
- [x] Add failing test in `index.test.ts` proving malformed `success` inline override is rejected and does not start a run.
- [ ] Run targeted tests and confirm RED for expected reasons.

### Stage B — Implement P1 stop and runtime-swap hard-cut [GATE]

- [x] Propagate `signal` from supervisor input through engine default executor into `executeLoopWithTmux`.
- [x] Make loop executor abort-aware: on signal abort, immediately stop tmux session and exit with stopped result.
- [x] Update runtime initialization path to abort+clear all existing active runs before runtime replacement when db/config context changes.
- [x] Keep non-UI behavior safe (no crashes, clear notifications/messages).

### Stage C — Implement P2 success-validation hardening [GATE]

- [x] Replace unsafe success cast/merge behavior with explicit mode-shape validation for inline overrides.
- [x] Reject invalid/unknown success payloads with clear `/ralph-start` error text.
- [x] Preserve existing valid config/preset flows.

### Stage D — Green + regression sweep [GATE]

- [x] Run targeted tests added in Stage A and verify GREEN.
- [x] Run full Ralph-loop suite: `npx vitest run agent/extensions/ralph-loop/*.test.ts`.
- [x] Update plan checkboxes and summarize exact fixes + behavior impact.

### Stage E — Post-fix cleanup and handoff [FINAL GATE]

- [x] Keep changes scoped to Ralph-loop and plan files only.
- [x] Provide concise review-response mapping (P1/P2 -> implemented fix + tests).
- [x] Pause for your sign-off before any optional follow-on work.
