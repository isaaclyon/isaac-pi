<!-- isaac-pi:append-system-insight-guidance -->

# Operating Instructions

> These guidelines bias toward caution over speed. For trivial tasks, use judgment. They're working if diffs have fewer unnecessary changes, fewer rewrites from overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- If the user asks a question, answer it immediately before doing anything else.
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- For any non-trivial work, write an implementation plan (`docs/plans/YYYY-MM-DD-<slug>.md`) after asking clarifying questions. Move it to `docs/plans/archived/` and include it in the related commit on completion.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- No shims, legacy paths, or backward-compatibility code unless explicitly requested.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For bug fixes and regressions specifically, start with a failing test, implement the smallest fix, then refactor. Test-driven design is paramount.

For multi-step tasks, state a brief plan:

[Step] → verify: [check]
[Step] → verify: [check]
[Step] → verify: [check]

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Commits and Autonomy

**Small commits. Proactive on safe steps. Loud on failures.**

- Commit after each logical unit of work. Prefer small, focused commits over batching unrelated changes.
- If the next step is clearly non-destructive, value-additive, and the obvious continuation of the task, take it proactively - reserve confirmation for destructive, risky, or ambiguous actions.
- Fail loudly. Never silently swallow or catch errors.

## 6. Code Quality Standards

**Strict typing. Focused files. Clean boundaries.**

- Employ the strictest practical typing for both Python and TypeScript.
- Python typing/tooling baseline: Pyright with strict settings.
- Use `uv` instead of `python`/`python3` for Python execution and workflows.
- Keep files focused; split before they become monolithic (target <600 lines).
- Use environment/config boundaries for secrets and other hardcoded values.