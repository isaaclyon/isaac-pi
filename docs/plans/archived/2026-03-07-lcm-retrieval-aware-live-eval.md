# LCM Phase 2 — Retrieval-aware Live Eval Harness

Build and validate a live-eval path that can use the new LCM retrieval tools (`lcm_describe`, `lcm_grep`, `lcm_expand`) during recall scoring, so we can measure whether retrieval workflows improve real recall versus summary-only behavior.

## User context

- You asked to rerun live testing after retrieval tooling landed, then explicitly asked to proceed with a retrieval-aware live eval.
- Current live eval repeatedly fails because it only scores summary-text recall and never exercises retrieval tools.
- Questionnaire decisions for this phase:
  - Success mode: **tools optional; measure recall improvement** (not “must use tools” hard requirement)
  - Validation scope: **full 5x low + 5x medium sweep**
  - Gate: **mean recall >= 67% per effort** (keep current gate)

## Key acceptance criteria

- [x] Add a retrieval-aware live eval mode that can execute LCM retrieval tool calls during recall answering.
- [x] Preserve current summary-only mode as baseline (no shim behavior changes; explicit mode split).
- [x] Capture per-run telemetry that shows whether tools were used and how many times.
- [x] Keep output machine-readable (`LIVE_EVAL_JSON` + sweep JSON) with retrieval-aware fields.
- [x] Keep sweep gating semantics unchanged: mean recall per effort must be >= threshold.
- [x] Add tests for new config parsing + result aggregation fields + tool-use accounting.
- [x] Run full LCM suite plus requested live sweep (5x low + 5x medium).

## Known gotchas / watchouts / risks

- Live model behavior is stochastic; tool-use prompting may be inconsistent across efforts.
- Retrieval calls can increase model-call count and risk budget failures if not bounded.
- The current live script directly calls `completeSimple`; retrieval-aware mode likely needs a small local tool-loop orchestration.
- We must avoid backward-compat hacks: keep a clear mode switch instead of implicit fallbacks.
- CI/local environments may not have credentials; tests should mock orchestration units, not live providers.

## Stage-gated implementation plan

### Phase 1 — Contracts + RED tests
- [x] Define retrieval-aware eval contract:
  - [x] mode selector env var(s)
  - [x] max retrieval steps/budget
  - [x] telemetry schema (tool call count, tool names, retrieval-used boolean)
- [x] Add failing tests for:
  - [x] config parsing (mode + limits)
  - [x] sweep/core summary compatibility with retrieval fields
  - [x] accounting logic for model calls vs retrieval calls
- [x] Verify RED.

### Phase 2 — Core retrieval-eval engine
- [x] Implement a deterministic eval loop module (new core file) that:
  - [x] assembles transcript/context
  - [x] asks model for answer with retrieval-tool instructions
  - [x] optionally executes requested LCM tool calls via local adapters
  - [x] enforces bounded step count and returns final answer
- [x] Keep baseline summary-only path available and explicit.
- [x] Turn tests GREEN.

### Phase 3 — Integrate with live script + JSON outputs
- [x] Wire new engine into `stage4-live-eval.mjs` with explicit mode branch.
- [x] Extend `LIVE_EVAL_JSON` with retrieval telemetry:
  - [x] `retrievalMode`
  - [x] `retrieval.used`
  - [x] `retrieval.toolCalls` (count + names)
  - [x] `retrieval.steps`
- [x] Ensure gate still evaluates recall + model-call budget correctly.

### Phase 4 — Sweep support + reporting
- [x] Update sweep script/core to preserve and summarize retrieval telemetry.
- [x] Ensure sweep table remains readable and gate logic remains per-effort mean recall.
- [x] Add/adjust sweep-core tests for new fields.

### Phase 5 — Validation + handoff
- [x] Run targeted tests (new core + live-eval-core + sweep-core).
- [x] Run full existing LCM suite.
- [x] Run requested live retrieval-aware sweep: 5x low + 5x medium.
- [x] Report side-by-side baseline vs retrieval-aware recall and tool-use rates.
- [x] Stop for review before any additional architecture changes.
