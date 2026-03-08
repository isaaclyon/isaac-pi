# Feasibility plan: LCM-style lossless context management for pi (single-session first)

Short description: Evaluate and prototype a thin, optional, Node/TS-only implementation of Lossless Context Management (LCM) in pi to reduce long-thread forgetting without full OpenClaw parity.

## User context

- User cited the LCM paper and wants to bring the core idea into pi.
- Primary pain: agent forgets earlier decisions/details in long sessions.
- Preferred immediate scope: feasibility analysis first, not full implementation.
- Initial target: single-session memory continuity (user is open to cross-session later).
- MVP win condition: automatic DAG-style compaction + context assembly.
- Constraints: no new binary services; SQLite is acceptable; must be optional/toggleable.

## Key acceptance criteria

- [x] A documented architecture maps LCM concepts onto pi extension/runtime hooks with no hand-wavy gaps.
- [ ] A thin prototype proves these flows end-to-end in pi:
  - [x] persist conversation units to SQLite
  - [x] leaf + condensed DAG summarization
  - [x] context assembly from summaries + recent raw tail
  - [x] optional enable/disable switch
- [x] Prototype does not require external binaries/services beyond Node/TS + SQLite.
- [x] Measured feasibility report includes quality + cost/latency trade-offs and go/no-go recommendation.

## Known gotchas, watchouts, risks

- pi currently supports custom compaction via `session_before_compact`, but LCM needs deeper lifecycle behavior than a single flat summary swap.
- Without careful message-shape preservation, tool-call/result coherence can break when reconstructing context.
- Summarization quality failures can cause silent detail loss unless we add strict fallback/escalation rules.
- Token accounting must use realistic estimates, or compaction triggers/assembly will thrash.
- SQLite contention or per-turn heavy summarization can add noticeable latency.
- Scope creep risk: full parity features (search/expand/TUI) can overwhelm feasibility goals.

## Stage-gated execution plan

### Stage 0 — Capability mapping + design decision (no code changes) [GATE]

- [x] Trace pi extension/runtime surfaces relevant to LCM (`context`, `session_before_compact`, `before_agent_start`, session persistence APIs).
- [x] Produce a constraints matrix:
  - [x] What can be implemented entirely as extension
  - [x] What requires pi core changes
  - [x] What should be deferred from MVP
- [x] Define hard-cut architecture for MVP (no backward-compat shims unless explicitly requested).
- [x] Output: short design note with chosen insertion points and rejected alternatives.

### Stage 1 — Data + storage foundation [GATE]

- [x] Add an isolated extension module (feature-flagged) for LCM storage.
- [x] Define SQLite schema (conversations/messages/summaries/parents/context_items minimal set).
- [x] Implement migration/bootstrap path and integrity checks.
- [x] Persist incoming session messages in canonical form needed for summarization + assembly.
- [x] Output: storage smoke tests + schema doc.

### Stage 2 — Compaction DAG prototype [GATE]

- [x] Implement leaf summarization pass over evictable old ranges.
- [x] Implement condensed pass (depth-aware prompts, bounded fanout).
- [x] Implement escalation strategy: normal -> aggressive -> deterministic fallback.
- [x] Add compaction trigger logic (threshold + fresh-tail protection).
- [x] Output: deterministic test scenarios showing DAG nodes created and context size reduced.

### Stage 3 — Context assembly in pi [GATE]

- [x] Assemble runtime prompt context from ordered `context_items` + protected recent tail.
- [x] Preserve message/tool structural correctness in assembled output.
- [x] Add safe fallback to native pi context path on failure.
- [x] Verify extension remains optional/toggleable at runtime.
- [x] Output: before/after transcripts showing improved recall across long sessions.

### Stage 4 — Evaluation + recommendation [FINAL GATE]

- [x] Build a fixed evaluation script with long-session tasks and expected recall checks.
- [x] Measure:
  - [x] recall quality vs baseline compaction
  - [x] added token cost
  - [x] turn latency impact
- [x] Produce go/no-go recommendation for:
  - [x] keep as extension
  - [x] move pieces into pi core
  - [x] defer/stop
- [x] Output: final feasibility report + next implementation backlog (if go).

## Proposed out-of-scope for this feasibility pass

- Full OpenClaw parity tools (`grep/describe/expand`) on day one.
- Dedicated TUI management binary.
- Cross-conversation memory federation.

## Checkpoint protocol

- Stop after each stage gate for user review before continuing.
- Keep this plan updated with checked boxes as stages complete.
- On completion, move this plan to `docs/plans/archived/`.
