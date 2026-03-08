# LCM Stage 2 compaction prototype (pi extension)

Short description: implement deterministic leaf + condensed DAG compaction over persisted messages, including escalation and turn-end trigger wiring.

## Implemented files

- `agent/extensions/lcm/compaction.ts`
- `agent/extensions/lcm/store.ts`
- `agent/extensions/lcm/index.ts`
- `agent/extensions/lcm/stage2-smoke-test.mjs`

## Summary creation pipeline

## 1) Leaf pass

Input: oldest *evictable* raw message context items (fresh tail excluded).

Flow:
1. Select a contiguous run of message items from the evictable prefix.
2. Chunk by `leafChunkTokens` budget.
3. Build a summary node (`kind='leaf'`, `depth=0`) with strategy-specific formatting.
4. If summary is not smaller than source token sum, force deterministic fallback summary.
5. Persist summary + message links and replace the covered context range with one summary item.

DB writes:
- `summaries` upsert row
- `summary_messages` rewrite for ordered message coverage
- `summary_parents` cleared for leaf node
- `context_items` rewritten with range replacement

## 2) Condensed pass

Input: evictable summary items.

Flow:
1. Find first contiguous run of same-depth summary nodes (bounded fanout = 4).
2. Build parent summary (`kind='condensed'`, `depth=baseDepth+1`) with depth-aware metadata in content.
3. If parent summary is not smaller than children total tokens, force deterministic fallback condensed summary.
4. Persist parent + linkage and replace the parent range in context with one summary item.

DB writes:
- `summaries` upsert row
- `summary_parents` rewrite for ordered parent linkage
- `summary_messages` cleared for condensed node
- `context_items` rewritten with range replacement

## Escalation strategy

Compaction attempts run in order:
1. `normal`
2. `aggressive`
3. `fallback`

Even inside `normal`/`aggressive`, non-reducing outputs are hard-cut to deterministic fallback for guaranteed monotonic compression per node.

## Trigger path

`index.ts` now hooks `turn_end`:
- Reads `ctx.getContextUsage()`
- Triggers compaction only when `usage.percent >= contextThreshold`
- Computes `targetTokens = floor(contextWindow * contextThreshold)`
- Preserves `freshTailCount` raw messages
- Prevents re-entrant compaction with `compactionInFlight`

## Deterministic smoke coverage

`stage2-smoke-test.mjs` validates:
- DAG nodes are created (`summaries`, `summary_messages`, `summary_parents`)
- Context token estimate is reduced after compaction
- Fresh raw tail remains intact
- Deterministic fallback leaf summary is emitted for low-signal tiny inputs
- Re-running fallback scenario reuses same summary id (deterministic id derivation)
