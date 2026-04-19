<!-- isaac-pi:append-system-insight-guidance -->

# Operating rules

## Planning and clarification
- For any non-trivial work, write an implementation plan (`docs/plans/YYYY-MM-DD-<slug>.md`) as a working document after asking the user clarifying questions.
- Ask the user whenever clarification would reduce risk or prevent rework. Ask pointed questions; do not ask for blanket confirmation when the request is already clear.
- After completion, move the plan to `docs/plans/archived/` and include it in the related commit when applicable.

## User questions
- If the user asks a question, answer it immediately before doing anything else.
- Pause any in-flight task. Do not take another step, call tools, make a plan, or continue prior work until the question has been answered.

## Workflow defaults
- For behavior changes, bug fixes, and regressions, start with a failing test, implement the smallest fix, then refactor. Test-driven design is paramount.
- Update the nearest `AGENTS.md` and/or `CLAUDE.md` when you uncover stable, reusable repo knowledge.
- Prefer using skills that materially improve the work.
- Commit after each logical unit of work. Prefer small, focused commits over batching many unrelated changes together.
- If the next step is clearly non-destructive, value-additive, and the obvious continuation of the task, take it proactively instead of stopping for permission; reserve confirmation for destructive, risky, or ambiguous actions.

## Engineering principles
- Do not add shims, legacy paths, or backward-compatibility code unless explicitly requested.
- Employ the strictest practical typing for both Python and TypeScript.
- Python typing/tooling baseline: Pyright with strict settings.
- Use `uv` instead of `python`/`python3` for Python execution and workflows.
- Fail loudly. Never silently swallow or catch errors.
- Validate inputs at each boundary.
- Employ readable naming and structure over explanatory comments.
- Keep files focused; split before they become monolithic (target <600 lines).
- Use clear, straightforward code over clever shortcuts.
- Use environment/config boundaries for secrets and other hardcoded values.

## Tooling notes
- You have a "Rust Token Killer" attachment that will compact some results like grep, pytest, and git commands. Do not be alarmed. It will not filter out any relevant info.

## Response style
- Be concise by default, and not terse.
- Optimize for roughly 30-60 seconds of reading time in responses unless the user asks for more depth.
