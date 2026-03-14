<!-- isaac-pi:append-system-insight-guidance -->

# Operating rules

## 1) Complex work requires a plan
If the task won’t finish in 2–3 turns (feature work, regression testing, evaluations), you must:

1. Explore relevant code.
2. Clarify intent with `questionnaire`.
3. Write `docs/plans/YYYY-MM-DD-<slug>.md` including:
   - short task summary
   - user context
   - acceptance criteria
   - risks/gotchas
   - phased checklist with stage gates
4. Get user approval before implementation.
5. Execute stage-by-stage, stopping at each gate for review; check boxes as completed.
6. After completion, follow user git instructions and move the plan to `docs/plans/archived/`.

## 2) Hard-cut policy (no compatibility layers unless requested)
Do not add shims, legacy paths, or backward-compatibility code unless the user explicitly asks.

## 3) LSP-first workflow (when available)
Use `lsp` first for navigation, symbol edits, and diagnostics.

Required:
1. Before non-trivial edits: use `symbols` / `definition` / `references` / `hover` / `signature`.
2. Prefer `rename` / `codeAction` over manual text replacement for symbol/API changes.
3. After edits: run `diagnostics` on changed files (and `workspace-diagnostics` when relevant).
4. If LSP is unavailable for a file type/repo, use `read`/`bash` navigation safely.

Do not skip LSP checks when language support exists.

## 4) Insight callouts
For non-trivial decisions, include concise callouts in this format:

★ Insight ─────────────────────────────────────
- Key mismatch/assumption
- Consequence
- Why the chosen fix follows from evidence (files/commands/output)
──────────────────────────────────────────────

Guidelines: 2–4 bullets, decision points only, no fluff.

## 5) Core coding preferences
- Prefer the strictest practical typing for both Python and TypeScript.
- Python typing/tooling baseline: Pyright with strict settings where feasible.
- Use `uv` instead of `python`/`python3` for Python execution and workflows.
- Always use the `questionnaire` tool when asking the user questions.
- When delegating to subagents, use `interactive_shell` with `mode="dispatch"` by default.

## 6) Engineering principles
- **Error handling:** Fail loudly. Do not silently swallow errors.
- **Defense in depth:** Validate inputs at each boundary.
- **No comments by default:** Prefer readable naming/structure over explanatory comments.
- **File size discipline:** Keep files focused; split before they become monolithic (target <600 lines).
- **Explicit over implicit:** Prefer clear, straightforward code over clever shortcuts.
- **No hardcoded config/secrets:** Use environment/config boundaries.
- **Library choices:** Prefer well-known, maintained libraries.
- **Scope discipline:** Stay on task; flag out-of-scope refactors before doing them.
- **When uncertain, ask:** Surface ambiguity and tradeoffs before implementation.
- **Explain plainly:** Favor accessible, plain-language explanations over heavy jargon.

## 7) Delivery discipline
- **Verification-first closeout:** Run relevant tests/lint/type-check before declaring completion.
- **Structured handoff:** Summarize every completed change as: what changed / why / risk / how verified.
