# LCM Option A — Live Recall Quality Validation (Quick Smoke)

Implement a **new live evaluation script** that calls a real model to measure recall across a context boundary after LCM compaction, with **env-driven model selection**, **3–5 calls**, and **hard-fail thresholds**.

## User context

- You selected **Option A** after P0 summarizer wiring to validate real recall quality before further backlog work.
- Interview choices (questionnaire):
  - Deliverable: **new eval script only**
  - Model selection: **env vars with sensible defaults**
  - Budget: **quick smoke (~3–5 model calls)**
  - Gate behavior: **hard fail on threshold miss**
- Goal: quickly detect whether LLM-based summaries retain key facts after crossing compaction boundaries.

## Key acceptance criteria

- [x] Add a new script (separate from existing deterministic `stage4-eval.mjs`) that runs live LLM recall checks.
- [x] Script uses model/provider settings from env vars with sensible defaults and clear startup logging.
- [x] Script performs a quick smoke workload (3–5 model calls total).
- [x] Script computes explicit recall metrics and compares them against configurable thresholds.
- [x] Script exits with non-zero code when threshold(s) are missed (hard gate).
- [x] Missing credentials/config fail fast with actionable error text.
- [x] Existing suites (`smoke-test`, `stage2`, `stage3`, `stage4-eval`, `code-review-fixes`, `p0-llm-summarizer`) remain green.

## Known gotchas / watchouts / risks

- Live model output is nondeterministic; tight thresholds can cause flaky failures.
- Provider/API credentials may be absent in local environments; script must surface this clearly.
- Small sample size (3–5 calls) gives quick signal, not statistical certainty.
- Cost/latency depends on selected model; defaults should bias toward fast/cheap verification.
- If summary prompt shape is weak, failures may reflect prompt quality, not storage/assembly correctness.

## Implementation plan (stage-gated)

### Phase 1 — Design + red tests
- [x] Define live eval contract: env vars, defaults, scenario count, metrics, thresholds, exit semantics.
- [x] Add focused failing tests for the evaluation logic (metric computation + gate behavior), independent of live API.
- [x] Run new tests and verify **RED** (fail for expected reason).

### Phase 2 — Build live eval script
- [x] Implement new script (e.g. `agent/extensions/lcm/stage4-live-eval.mjs`) that:
  - [x] seeds synthetic conversation with planted facts
  - [x] runs async LCM compaction with live summarizer
  - [x] assembles compacted context
  - [x] asks model recall question(s)
  - [x] scores recall and aggregates pass/fail
- [x] Implement env parsing/defaults and fail-fast configuration checks.
- [x] Ensure total model calls stay within quick-smoke budget (3–5).

### Phase 3 — Green + regression verification
- [x] Run new tests and verify **GREEN**.
- [ ] Run live script once in smoke mode (if credentials available) and verify output shape + hard-fail path. *(blocked: no ANTHROPIC_API_KEY in current shell)*
- [x] Re-run existing LCM suites to confirm no regressions.

### Phase 4 — Handoff
- [x] Provide run commands + env var examples.
- [x] Summarize observed trade-offs and recommended next move (threshold tuning vs prompt tuning).
- [x] Stop for your review before any follow-on backlog work.
