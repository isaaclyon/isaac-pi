# Proactive next-step system prompt

## Goal
Tighten the prompt guidance so the agent takes the obvious safe next step instead of ending responses with permission-seeking phrasing when the continuation is clearly non-destructive and value-additive.

## Scope
- Update `agent/APPEND_SYSTEM.md` with explicit proactivity guidance.
- Sync the same prompt content to top-level `APPEND_SYSTEM.md` and `.pi/APPEND_SYSTEM.md`.

## Approach
- Keep confirmation behavior for destructive, irreversible, risky, or ambiguous actions.
- Add one concise rule that favors proactive continuation when the next step is clear.
- Preserve the rest of the prompt structure.

## Validation
- Re-read all three `APPEND_SYSTEM.md` files and confirm they match.
- Check `git diff` to ensure only the intended prompt files changed.
