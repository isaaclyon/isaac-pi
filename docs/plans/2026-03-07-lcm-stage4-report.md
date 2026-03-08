# LCM Feasibility Report — Final

**Date**: 2026-03-07  
**Stage**: 4 (final gate)  
**Status**: ✅ GO recommendation  

---

## What we built

A thin, optional Node/TS pi extension that implements LCM-style context management using SQLite as the only new dependency. Zero external services. Fully toggled by `PI_LCM_ENABLED=true`.

### Components

| File | Purpose |
|---|---|
| `agent/extensions/lcm/index.ts` | Extension entry; hooks `session_start`, `session_switch`, `message_end`, `turn_end`, `context` |
| `agent/extensions/lcm/store.ts` | All SQLite reads/writes |
| `agent/extensions/lcm/db.ts` | Connection init, WAL config, migration runner |
| `agent/extensions/lcm/compaction.ts` | Leaf + condensed DAG passes, escalation strategy |
| `agent/extensions/lcm/assembly.ts` | `assembleContext()` — builds `AgentMessage[]` from context_items |
| `agent/extensions/lcm/config.ts` | Env var + `.pi/lcm.json` config resolution |
| `agent/extensions/lcm/types.ts` | Shared types, `toStoredMessage()` (full message JSON) |
| `agent/extensions/lcm/schema.sql` | Tables: conversations, messages, summaries, summary_messages, summary_parents, context_items |

### Runtime flow (implemented and verified)

1. `session_start` / `session_switch` → resolve conversation key, bootstrap from branch
2. `message_end` → persist each `AgentMessage` as `StoredMessage` (full JSON in `contentJson`)
3. `turn_end` → if usage ≥ `contextThreshold`, run incremental compaction
4. `context` → assemble context from DAG summaries + fresh raw tail; fail-open on any error

---

## Evaluation results (from `stage4-eval.mjs`, all 7 scenarios pass)

### 1. Context coverage (60-message session)

| Metric | LCM | Baseline (truncation) |
|---|---|---|
| Context items assembled | 8 (2 summary + 6 tail) | 4 (tail only) |
| Token budget used | 560 | ~220 |
| Covers full session history | ✅ yes (via summaries) | ❌ no (early turns dropped) |
| Compression ratio | **6.42x** | 1x |
| Token reduction | **84%** | 0% |

**Interpretation**: LCM assembles a context that spans all 60 turns; naive truncation silently drops the first 56. The compressed history is a structural win even before evaluating recall quality.

### 2. Fact preservation (leaf depth=0)

| Metric | Result |
|---|---|
| Fact planted at session start present in LCM context | ✅ yes |
| Same fact in baseline tail-only context | ❌ no |

**Interpretation**: Facts at the start of a leaf chunk survive in depth=0 summaries. Facts deeper into the summary chain get progressively truncated at each condensation level (see Limitations). This is expected for the current **deterministic** compactor — real LCM uses an LLM summarizer that can distill facts semantically.

### 3. Token compression ratios (deterministic compactor)

| Session size | Tokens before | Tokens after | Ratio | Reduction |
|---|---|---|---|---|
| 20 messages | 1,305 | 362 | **3.60x** | 72% |
| 40 messages | 2,615 | 724 | **3.61x** | 72% |
| 80 messages | 5,235 | 1,348 | **3.88x** | 74% |

Compression ratio is consistent across session sizes. Scales slightly better at larger sizes due to deeper DAG fanout.

### 4. Structural correctness

- `toolCallId`, `isError`, and `content` on `toolResult` messages: **perfect round-trip**  
- `content` arrays (text, toolCall, toolResult blocks) preserved exactly  
- No corruption of message role or content type  

### 5. Latency

| Operation | Median | p90 | p99 | Budget |
|---|---|---|---|---|
| Compaction (40 msgs, depth=2) | 1,604 μs | 2,001 μs | **2,373 μs** | < 100,000 μs |
| Assembly (compacted 60-msg conv) | 39 μs | 41 μs | **49 μs** | < 10,000 μs |

- **Compaction** (2.37ms p99): runs async at `turn_end`, not on the critical LLM path — well within budget.  
- **Assembly** (0.05ms p99): fires before every LLM call — essentially free.

### 6. Toggle safety

- `assembleContext()` on an empty conversation returns `[]`  
- `context` handler returns `{}` when `[]` (no native context override)  
- Disabling `PI_LCM_ENABLED` at any point causes the extension to clear all state and stop intercepting  

---

## Known limitations

### Deterministic summarizer — lossy at depth ≥ 1

The current compactor writes rule-based summaries:
```
[lcm leaf normal depth=0]
messages=8 seq=1-8 tokens=N
- user#1: first 180 chars of message...
- assistant#2: first 180 chars...
```
Each condensation level truncates the parent's summary to 180 chars. Facts beyond the first leaf message are not reliably preserved through deep condensed passes. This is expected — the architecture is designed to accept an LLM summarizer via a hook (see Next Backlog). Until that hook is wired, summaries are structural placeholders, not semantic distillations.

### Fresh-tail count is fixed

Default `freshTailCount=32`. For sessions with heavy tool use (many toolResult messages in the tail), 32 may not be enough to protect a full tool-call sequence. The config is tunable but needs documented guidance.

### Single-session only

Cross-session memory federation is explicitly out-of-scope for this feasibility pass. Each conversation is isolated by `conversationKey = cwd::sessionFile`.

### No token counting parity

`estimateTokens` uses `ceil(charCount / 4)` — a rough estimate. Real token counts depend on model tokenizer. Under-counting triggers compaction late; over-counting triggers it early. This is acceptable for the MVP but should be addressed before production use (use `countTokens` API if available).

---

## Constraints matrix revisited

| LCM need | Implemented | Gaps |
|---|---|---|
| Persist every message | ✅ `message_end` + batch bootstrap | — |
| DAG summarization | ✅ leaf + condensed passes | LLM summarizer not wired |
| Context assembly | ✅ `context` event override | — |
| Fail-open fallback | ✅ returns `{}` on any error | — |
| Feature flag | ✅ `PI_LCM_ENABLED` + `.pi/lcm.json` | — |
| Tool-call integrity | ✅ full round-trip via stored message JSON | — |
| Latency safety | ✅ compaction async, assembly <1ms | — |
| LLM summarizer | ❌ not yet | Needs `model.streamSimple` hook |
| Cross-session memory | ❌ deferred | — |
| Token count accuracy | ⚠️ rough estimate | Use real tokenizer API |

---

## Go/No-Go recommendation

### Decision: **GO — keep as extension, add LLM summarizer**

**Evidence**:
1. All pipeline stages work end-to-end: persist → compact → assemble → inject
2. Assembly is 0.05ms p99 — zero overhead on the critical LLM path
3. Compaction is 2.4ms p99 — async, well within per-turn budget
4. 3.6–6.4x token compression observed in offline testing
5. Structural correctness proven: tool-call sequences survive round-trip faithfully
6. Extension is genuinely optional/toggleable with no pi core changes required
7. Fail-open guarantee: any assembly error leaves native context untouched

**Why not move to pi core yet**: The extension-layer prototype proves the concept with zero core changes. Moving to core is appropriate only after the LLM summarizer is wired and real-session quality is validated. Premature core integration would lock in an architecture before the quality signals are clear.

**Why not defer/stop**: The compaction + assembly pipeline is working and measurably better than naive truncation. The remaining gap (LLM summarizer quality) is a known, scoped problem, not an architectural unknown.

---

## Next implementation backlog (if go)

| Priority | Item | Scope |
|---|---|---|
| P0 | **Wire LLM summarizer** — call `ctx.model` / `streamSimple` at `turn_end` to generate semantic summaries rather than rule-based content | extension |
| P0 | **Real token counting** — use model tokenizer API instead of char/4 heuristic | extension |
| P1 | **Cross-session bootstrap** — on `session_switch`, load prior conversation summaries to pre-seed context | extension |
| P1 | **Fresh-tail auto-sizing** — detect tool-call sequences and ensure tail includes complete call+result pairs | extension |
| P2 | **Compaction quality test** — evaluation harness that actually calls an LLM to assess recall quality of LLM-generated summaries vs baseline | eval |
| P2 | **TUI diagnostics** — `ctx.ui.setWidget` panel showing LCM status, context item count, compression ratio | extension |
| P3 | **Core context engine slot** — pi core-level abstraction for context providers (cleaner than event-layer interception) | pi core |
| P3 | **Cross-session memory federation** — link related conversations, inject relevant cross-session summaries | extension → core |

---

## Smoke tests / verification commands

```bash
# All three test suites must pass
node --experimental-strip-types agent/extensions/lcm/smoke-test.mjs         # Stage 1: DB + schema
node --experimental-strip-types agent/extensions/lcm/stage2-smoke-test.mjs  # Stage 2: DAG compaction
node --experimental-strip-types agent/extensions/lcm/stage3-smoke-test.mjs  # Stage 3: context assembly
node --experimental-strip-types agent/extensions/lcm/stage4-eval.mjs        # Stage 4: evaluation
```

## Enable in pi

```bash
PI_LCM_ENABLED=true pi
```

Optional config overrides (env or `.pi/lcm.json`):
- `PI_LCM_FRESH_TAIL_COUNT` (default: 32)
- `PI_LCM_CONTEXT_THRESHOLD` (default: 0.75)
- `PI_LCM_LEAF_CHUNK_TOKENS` (default: 20000)
- `PI_LCM_INCREMENTAL_MAX_DEPTH` (default: 1)
