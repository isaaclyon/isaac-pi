---
title: "Global handoff-style compaction using current session model"
status: approved
decision: new_session
approvedAt: 2026-02-22T20:19:01.755Z
sessionId: 2026-02-22T20-13-48-492Z_c97402d7-dbb9-4d20-bad9-a1685294d16a
sessionFile: "/Users/isaaclyon/.pi/agent/sessions/--Users-isaaclyon-Developer-personal-pi--/2026-02-22T20-13-48-492Z_c97402d7-dbb9-4d20-bad9-a1685294d16a.jsonl"
---

# Global handoff-style compaction using current session model

### 1) Goal
Set up **global** compaction behavior so every compact uses a handoff-quality summary (using the same model/session context as the current agent), in the same prompting style as `.pi/extensions/handoff.ts`, instead of the generic default compact summary.

### 2) Context
- `session_before_compact` is the hook to customize compaction globally.
- `SessionBeforeCompactEvent` exposes:
  - `preparation` (messages to summarize, split-turn prefix, previous summary, file ops, token metadata)
  - `customInstructions` (existing focus string)
  - `signal`
- The existing repository already has one handoff-style implementation, but it is **loop-scoped**:
  - `.pi/extensions/loop.ts` uses `session_before_compact` and appends `getHandoffCompactionInstructions(...)`.
- `handoff.ts` currently generates a handoff prompt by:
  - serializing conversation text with `convertToLlm + serializeConversation`
  - calling `complete(...)` with a dedicated system prompt.
- `compact(...)` already exists and handles split-turn edge cases automatically, but only takes a custom focus string; to match `/handoff` style more closely, we can generate the summary manually with `complete(...)` and return a `CompactionResult`.

### 3) Steps
1. **Add a shared handoff prompt module** (for reuse, to avoid duplication):
   - New file: `.pi/extensions/_shared-handoff.ts` (or similar).
   - Export a `HANDOFF_SYSTEM_PROMPT` and `buildHandoffCompactionPrompt({conversationText, previousSummary?})` using the `/handoff` language plus fields needed by compact:
     - what was decided
     - what was done
     - blockers
     - key files touched
     - current state + next concrete step(s)

2. **Create a global compaction extension**:
   - New file: `.pi/extensions/custom-compaction-handoff.ts` (or similar).
   - Register `pi.on("session_before_compact", async (event, ctx) => { ... })`.

3. **Implement handler logic to use the current session model (same behavior as `/handoff`)**:
   - Validate `ctx.model` and resolve `apiKey` from `ctx.modelRegistry`.
   - Build summarized input from:
     - `event.preparation.messagesToSummarize`
     - `event.preparation.turnPrefixMessages` (important when split turns are involved)
     - optional `event.preparation.previousSummary`
   - Convert to text via existing helpers:
     - `convertToLlm(...)`
     - `serializeConversation(...)`
   - Call `complete(ctx.model, { systemPrompt: HANDOFF_SYSTEM_PROMPT, messages: [...] }, { apiKey, signal: event.signal, ... })`.
   - On success, return:
     ```ts
     return {
       compaction: {
         summary,
         firstKeptEntryId: event.preparation.firstKeptEntryId,
         tokensBefore: event.preparation.tokensBefore,
         // optional, if you want parity with built-in compaction details:
         // details: { readFiles, modifiedFiles }
       }
     };
     ```
   - On model/API error, log/notify and return `undefined` so default compaction can be used as fallback.

4. **Resolve interaction with existing loop extension handler**:
   - Current `.pi/extensions/loop.ts` also has a `session_before_compact` handler.
   - Since `session_before_compact` handlers are all executed and later non-null results can overwrite earlier ones, decide precedence explicitly:
     - Option A (cleanest): remove loop compaction override and rely on shared handoff prompt helper only.
     - Option B: keep loop handler but ensure it sets richer loop-specific focus via shared helper and global handler appends/merges only when `event.customInstructions` exists (or vice versa).

5. **Add tests** (recommended):
   - New test file under `.pi/tests/` for the new extension:
     - asserts that `complete(...)` is called for global compaction
     - asserts handoff-style text is included in the user payload
     - verifies returned shape has `summary`, `firstKeptEntryId`, `tokensBefore`
     - verifies fallback when API key/model is missing
     - verifies failure falls back (returns `undefined`) rather than throwing

6. **Validate behavior in-session**:
   - Generate enough context to trigger compaction and confirm resulting compaction entry reads like a handoff prompt.
   - Verify file operations summary continuity and loop behavior remain sensible.

### 4) Risks
- **Handler collision:** multiple `session_before_compact` handlers can conflict; order/precedence must be intentional.
- **Prompt/style drift:** replacing `compact(...)` with a manual `complete(...)` path shifts from built-in summary framing; if prompt drifts, summaries can be noisier.
- **Token/cost/performance impact:** handoff-style prompts are richer than default and can consume more budget.
- **Split-turn nuances:** including both summarized and turn-prefix messages is important; omitting either can reduce continuity.
- **Fallback safety:** if the custom path fails, must explicitly allow default compaction to continue.

### 5) Open Questions
- Do you want the global compaction prompt to be strictly `/handoff`-style (Context/Task format), or slightly constrained to keep default compact's structure?  
- Should loop-specific metadata (goal/condition) still be injected while compacting, or should global compaction ignore it?
- Should we append custom instructions or fully replace compaction framing for your use case?
- Do you want this feature behind an option (e.g., check a setting) so you can toggle it per-repo/session?
