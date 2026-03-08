# LCM extension — Lossless Context Management for pi

SQLite-backed context management extension that prevents long-session forgetting via a DAG compaction pipeline + context assembly override.

## Status

All stages implemented:

- **Stage 1** — Conversation/message persistence, schema v2, migration runner
- **Stage 2** — Leaf + condensed DAG compaction passes, escalation strategy (`normal → aggressive → deterministic fallback`), turn-end threshold trigger
- **Stage 3** — Context assembly (`context` event override), fail-open fallback, tool-call round-trip fidelity
- **Stage 4** — Evaluation harness, feasibility report → **GO recommendation**
- **Stage 5** — Lossless retrieval protocol (`lcm_describe`, `lcm_grep`, `lcm_expand`) + summary-id annotations in assembled context

## Enable

Disabled by default. Set env var:

```bash
PI_LCM_ENABLED=true pi
```

## Configuration

| Env var | Default | Description |
|---|---|---|
| `PI_LCM_ENABLED` | false | Enable/disable the extension |
| `PI_LCM_DB_PATH` | `~/.pi/agent/lcm/lcm.sqlite` | SQLite database path |
| `PI_LCM_FRESH_TAIL_COUNT` | 32 | Raw messages kept outside compaction |
| `PI_LCM_CONTEXT_THRESHOLD` | 0.75 | Context usage % that triggers compaction |
| `PI_LCM_LEAF_CHUNK_TOKENS` | 20000 | Token budget per leaf summary chunk |
| `PI_LCM_INCREMENTAL_MAX_DEPTH` | 1 | Max condensation depth per turn |

Project-level override: `.pi/lcm.json` (same keys, camelCase).

## Smoke tests / evaluation

```bash
node --experimental-strip-types agent/extensions/lcm/smoke-test.mjs         # Stage 1: DB + schema
node --experimental-strip-types agent/extensions/lcm/stage2-smoke-test.mjs  # Stage 2: DAG compaction
node --experimental-strip-types agent/extensions/lcm/stage3-smoke-test.mjs  # Stage 3: context assembly
node --experimental-strip-types agent/extensions/lcm/stage4-eval.mjs        # Stage 4: deterministic evaluation
node --experimental-strip-types agent/extensions/lcm/stage4-live-eval.mjs   # Stage 4: live LLM recall gate
node --experimental-strip-types agent/extensions/lcm/stage4-live-eval-retrieval-core-test.mjs # Stage 4: retrieval-aware loop core
node --experimental-strip-types agent/extensions/lcm/stage4-live-eval-sweep.mjs # Stage 4: repeated live sweep (multi-run)
node --experimental-strip-types agent/extensions/lcm/lossless-retrieval-tools-test.mjs # Stage 5: retrieval tooling
```

### Live eval with local Codex OAuth (no API key env required)

```bash
PI_LCM_LIVE_EVAL_PROVIDER=openai-codex \
PI_LCM_LIVE_EVAL_MODEL_ID=gpt-5.3-codex \
PI_LCM_LIVE_EVAL_REASONING=low \
node --experimental-strip-types agent/extensions/lcm/stage4-live-eval.mjs
```

The live eval script reads OAuth token from `~/.codex/auth.json` (`tokens.access_token`).
Optional overrides:

- `PI_LCM_LIVE_EVAL_REASONING` — one of `minimal|low|medium|high|xhigh` (default: `low`)
- `PI_LCM_LIVE_EVAL_MODE` — `summary-only|retrieval-aware` (default: `summary-only`)
- `PI_LCM_LIVE_EVAL_RETRIEVAL_MAX_STEPS` — max recall-model turns when retrieval-aware (default: `3`)
- `PI_LCM_LIVE_EVAL_RETRIEVAL_MAX_TOOL_CALLS` — max retrieval tool calls per run (default: `6`)
- `PI_LCM_LIVE_EVAL_CODEX_AUTH_PATH` — custom path to Codex auth file
- `PI_LCM_LIVE_EVAL_API_KEY` — explicit token override

### Multi-run sweep (5× low + 5× medium)

```bash
PI_LCM_LIVE_EVAL_SWEEP_RUNS=5 \
PI_LCM_LIVE_EVAL_SWEEP_EFFORTS=low,medium \
node --experimental-strip-types agent/extensions/lcm/stage4-live-eval-sweep.mjs
```

Sweep output:

- Console comparison table (`mean/min/max/pass/fail` per effort)
- JSON summary file at `agent/extensions/lcm/stage4-live-eval-sweep-summary.json` by default

Sweep-specific env vars:

- `PI_LCM_LIVE_EVAL_SWEEP_RUNS` — runs per effort (default: `5`)
- `PI_LCM_LIVE_EVAL_SWEEP_EFFORTS` — comma-separated efforts (default: `low,medium`)
- `PI_LCM_LIVE_EVAL_SWEEP_OUTPUT_PATH` — explicit summary JSON path

## Lossless retrieval tools

When LCM injects summaries into context, each summary is tagged inline:

```text
[LCM Summary] id=lcm_leaf_0_abc123 depth=0
...summary content...
```

Tools:

- `lcm_describe(id)`
  - Returns summary metadata + provenance pointers (parent summary ids, direct message ids, source message count).
- `lcm_grep(pattern, summary_id?)`
  - Searches persisted immutable message history.
  - Optional `summary_id` scopes search to messages represented by that summary.
- `lcm_expand(summary_id)`
  - Returns ordered source messages for the summary.
  - Restricted to **sub-agent sessions** (root agent gets a guidance error).

## Key numbers (from `stage4-eval.mjs`)

| Metric | Result |
|---|---|
| Token compression (60-msg session) | **6.42x** (84% reduction) |
| Token compression (steady state) | **3.6–3.9x** (72–74%) |
| Compaction latency p99 (40 msgs, depth=2) | **2.4ms** |
| Assembly latency p99 (hot path) | **0.05ms** |
| Tool-call round-trip fidelity | ✅ perfect (toolCallId, isError, content) |
| Early-session fact in LCM vs baseline | ✅ present vs ❌ dropped |

## Architecture

```
session_start / session_switch
    └─ getOrCreateConversation()
    └─ bootstrapFromBranch()  ← seeds DB from existing branch

message_end
    └─ insertMessage()  ← stores full AgentMessage JSON

turn_end (async, non-blocking)
    └─ if usage% ≥ contextThreshold → runLcmCompaction()
          ├─ runLeafPass()     ← summarise evictable chunk → leaf node
          └─ runCondensedPass()← collapse same-depth leaf nodes → condensed node

context (before every LLM call)
    └─ assembleContext()  ← rebuild AgentMessage[] from context_items
          ├─ summary items → synthetic user message "[LCM Summary]\n..."
          └─ message items → reconstruct from stored contentJson
    └─ return { messages } or {} (fail-open)
```

## Known limitations

- **Deterministic summarizer**: leaf/condensed content is rule-based (first 180 chars per message). LLM-generated summaries (P0 backlog item) will improve recall quality dramatically.
- **Token counting**: uses `ceil(charLen/4)` heuristic — real tokenizer API should replace this.
- **Single-session only**: cross-session federation is deferred.

## Feasibility report

See [`docs/plans/2026-03-07-lcm-stage4-report.md`](../../../docs/plans/2026-03-07-lcm-stage4-report.md) for the full evaluation, go/no-go recommendation, and next implementation backlog.
