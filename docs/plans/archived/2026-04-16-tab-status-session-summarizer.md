# Tab status session summarizer

## Goal
Replace the current diff-driven tab-title reroll in `agent/extensions/tab-status.ts` with an LLM-generated session summary label that uses the opening and most recent conversation context.

## Desired behavior
1. Keep explicit session names sticky; never override `ctx.sessionManager.getSessionName()`.
2. Generate a structured short label via `gpt-5.4-mini` using low reasoning.
3. Send the first couple of user/assistant messages plus the most recent couple of user/assistant messages from the current session branch.
4. Enforce a local max of 4 words for the generated label.
5. Re-run label generation every 4 user+assistant exchange pairs, with debounce/stickiness to avoid churn.
6. Fall back safely to the existing prompt-derived label when the model is unavailable or the request fails.

## Plan
1. Add focused tests for the new message-window selection, pair-count cadence, structured label parsing, local word cap, and sticky fallback behavior.
2. Refactor `agent/extensions/tab-status.ts` to remove diff-based reroll inputs and replace them with conversation-window summarization logic built around `gpt-5.4-mini`.
3. Wire reroll triggering to completed exchange-pair cadence with a small debounce/stickiness guard.
4. Run the targeted Vitest coverage for `tab-status`, then archive this plan.

## Verification
- New `tab-status` tests cover cadence, message selection, and label normalization.
- Targeted Vitest run passes.