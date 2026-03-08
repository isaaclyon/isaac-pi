Rework LCM so it remains useful but cannot break tool-call sessions. Keep LCM enabled by default in safe mode, with automatic fallback to native context whenever tool-pair safety is uncertain.

## User context (why they asked, what they are working on)

- You observed repeated runtime failures across sessions:
  - OpenAI path: `No tool output found for function call ...`
  - Anthropic path: `tool_use ids ... without tool_result blocks immediately after ...`
- We validated that disabling LCM (`.pi/lcm.json -> enabled: false`) immediately restores stable tool execution.
- You asked if we can rework LCM to be nonbreaking.
- Via interview, you selected:
  - **Mode:** Safe-by-default
  - **Safety policy:** Auto fallback to native context
  - **Validation depth:** Targeted regression + live smoke in `lola` and `remove-dagster`

## Key acceptance criteria

- [ ] LCM never injects reconstructed context that violates tool adjacency requirements.
- [ ] When safety is uncertain, LCM automatically falls back to native context for that turn (non-fatal).
- [ ] LCM still stores messages and keeps retrieval tools functional.
- [ ] Live tool calls in both problem repos/worktree succeed with LCM enabled in safe mode.
- [ ] Behavior is visible to operator (single concise notification/status, no spam).

## Known gotchas, watchouts, risks

- Current `assembleContext()` reconstructs message history from DB and may not preserve provider-required tool message adjacency/shape.
- Provider constraints differ (OpenAI function call ids vs Anthropic `tool_use/tool_result` sequencing), so safety checks must be provider-agnostic.
- Returning `{ messages }` from `pi.on("context")` replaces/augments runtime context path; malformed output can poison every subsequent tool turn.
- We should avoid partial heuristics that “sometimes rewrite”; guard must be deterministic and conservative.

## Detailed step-by-step instructions with stage gates / phases

### Stage 1 — Design safe contract [GATE]
- [ ] Define a strict context-safety invariant for LCM injection:
  - If any unresolved tool call pair exists in assembled messages, do not inject.
  - If trailing assistant turn contains tool-call blocks without immediate tool result pair, do not inject.
- [ ] Specify fallback behavior:
  - Return `{}` from `context` hook (native context path) and set one-shot status/notify.
- [ ] Decide scope of first fix:
  - Keep storage + retrieval unchanged.
  - Only gate injection path.

### Stage 2 — Implement nonbreaking guardrails [GATE]
- [ ] Add a validator (new helper module) that inspects assembled messages for tool-pair integrity.
- [ ] In `agent/extensions/lcm/index.ts` context hook, inject only when validator passes.
- [ ] Add one-shot operator visibility:
  - status line and/or single notify when fallback activates.
- [ ] Keep hard cut semantics (no backward-compat shim layers).

### Stage 3 — Regression tests (targeted) [GATE]
- [ ] Add tests for validator cases:
  - valid assistant tool-call + immediate tool-result pair
  - missing result pair
  - id mismatch / malformed pair
  - no-tool messages pass through
- [ ] Add context hook behavior tests:
  - validator pass -> returns `{ messages }`
  - validator fail -> returns `{}`

### Stage 4 — Live validation in real repos [GATE]
- [ ] Re-enable LCM in:
  - `/Users/isaaclyon/Developer/lola/.pi/lcm.json`
  - `/Users/isaaclyon/Developer/lola/.worktrees/remove-dagster/.pi/lcm.json`
- [ ] Reload and run tool smoke in each:
  - `read` tool prompt in `pi -p`
  - one retrieval tool call (`lcm_describe` with fake id)
- [ ] Confirm no provider adjacency errors.

### Stage 5 — Closeout and archive [GATE]
- [ ] Summarize root cause, fix design, and trade-offs.
- [ ] Document safe-mode behavior in LCM README/config notes.
- [ ] Move completed plan to `docs/plans/archived/` after sign-off.
