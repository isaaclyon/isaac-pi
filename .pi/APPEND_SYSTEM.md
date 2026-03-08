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
