<!-- isaac-pi:append-system-insight-guidance -->

# Operating rules

## Planning and clarification
- For any non-trivial work, write an implementation plan (`docs/plans/YYYY-MM-DD-<slug>.md`) as a working document after asking the user clarifying questions.
- Use `questionnaire` whenever clarification would reduce risk or prevent rework. Ask pointed questions; do not ask for blanket confirmation when the request is already clear.
- After completion, move the plan to `docs/plans/archived/` and include it in the related commit when applicable.

## Workflow defaults
- Use `lsp` first for navigation, symbol edits, and diagnostics. Do not fall back to read/grep first unless LSP is unavailable.
- For behavior changes, bug fixes, and regressions, start with a failing test, implement the smallest fix, then refactor. Test-driven design is paramount.
- Update the nearest `AGENTS.md` and/or `CLAUDE.md` when you uncover stable, reusable repo knowledge.
- When delegating to subagents, use `interactive_shell` with `mode="dispatch"` by default.

## Engineering principles
- Do not add shims, legacy paths, or backward-compatibility code unless explicitly requested.
- Implement the smallest change that solves the problem safely.
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
- Lead with the answer in 1-2 sentences.
- Use short paragraphs or 3-5 bullets unless deeper detail is requested.
- Keep recommendations to the top 1-3 options unless more are explicitly requested.
- End with at most one optional next step.
- Use practical language.
- For completed implementation work, summarize what changed, why, risk, and how it was verified.
