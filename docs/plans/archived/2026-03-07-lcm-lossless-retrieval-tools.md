# LCM Phase 1 — Lossless Retrieval Protocol + Memory Tools

Implement deterministic retrieval plumbing so summaries are navigable instead of trusted as perfect memory: add `lcm_describe`, `lcm_grep`, and `lcm_expand`; expose stable summary IDs in assembled context; and gate `lcm_expand` to sub-agents only.

## User context

- You asked to implement the highest-ROI gap vs the paper/system description: retrieval over immutable history rather than relying on recursive prose summaries.
- You approved proceeding with “1/2 first” (lossless retrieval protocol + memory tools), and asked for deeper explanation of operator-level recursion and compression validation.
- Questionnaire decisions (captured now):
  - Tool scope: **all three tools now** (`lcm_describe`, `lcm_grep`, `lcm_expand`)
  - `lcm_expand` access: **sub-agents only**
  - Active-context shape: **include stable summary IDs inline** in LCM summary messages

## Key acceptance criteria

- [x] Register three LCM tools in the extension:
  - [x] `lcm_describe(id)`
  - [x] `lcm_grep(pattern, summary_id?)`
  - [x] `lcm_expand(summary_id)`
- [x] Enforce **sub-agent-only** access for `lcm_expand` (root/main agent calls rejected with clear guidance).
- [x] Assemble LCM summary context with **machine-readable summary IDs** in text so model can call tools directly.
- [x] Implement retrieval against immutable store with deterministic behavior:
  - [x] `lcm_describe` returns summary metadata (+ provenance pointers) and file/unknown handling behavior
  - [x] `lcm_grep` searches persisted message history and optionally constrains to summary scope
  - [x] `lcm_expand` returns source messages for a summary (lossless reconstruction path)
- [x] Add/extend tests that verify:
  - [x] tool registration + parameter validation
  - [x] access control for expand
  - [x] summary-id injection format in assembled context
  - [x] grep/expand correctness on realistic stored conversations
- [x] Preserve existing LCM smoke/eval behavior (no regressions in current suites).

## Known gotchas / risks

- Extension API does not expose an explicit “sub-agent” flag; `lcm_expand` is gated by session lineage (`session.header.parentSession`).
- Returning too much data from `lcm_expand`/`lcm_grep` can flood context; response shaping/pagination may be needed in a follow-up.
- Regex/substring semantics must be explicit and deterministic.
- Summary-ID injection format must be stable and parse-friendly while remaining readable.
- DB schema has provenance tables (`summary_messages`, `summary_parents`); retrieval joins must preserve ordering guarantees.

## Stage-gated implementation plan

### Phase 1 — Contracts + RED tests
- [x] Define tool contracts + output formats for `describe/grep/expand`.
- [x] Define summary-ID inline text format for assembled `[LCM Summary]` messages.
- [x] Add failing tests for:
  - [x] registration of the three tools
  - [x] expand access control behavior
  - [x] grep + optional summary scope filtering
  - [x] expand returns ordered original messages
  - [x] summary-ID inline rendering in `assembleContext`
- [x] Verify RED.

### Phase 2 — Store/query primitives
- [x] Add store-level query helpers needed by tools:
  - [x] summary metadata + parent/message provenance fetch
  - [x] message search over immutable messages table
  - [x] summary→message expansion in deterministic order
- [x] Keep APIs deterministic and side-effect free.
- [x] Turn associated tests GREEN.

### Phase 3 — Tool wiring in extension
- [x] Register `lcm_describe`, `lcm_grep`, `lcm_expand` via `pi.registerTool` in LCM extension.
- [x] Implement runtime guards:
  - [x] extension enabled check
  - [x] active conversation check
  - [x] sub-agent-only enforcement for `lcm_expand`
- [x] Return concise text + structured details payloads.
- [x] Keep failure mode fail-open/non-fatal for unrelated agent flow.

### Phase 4 — Context shape update
- [x] Update summary assembly text to include stable summary IDs inline.
- [x] Ensure format is consistent across all summary nodes.
- [x] Validate no breakage in current stage tests.

### Phase 5 — Validation + handoff
- [x] Run new tests (tool + store + assembly).
- [x] Run existing LCM suites (smoke/stage2/stage3/stage4/core/p0).
- [x] Provide a short usage playbook (example calls + expected responses).
- [x] Stop for your review before any additional architectural changes (e.g., schema-enforced summarization).
