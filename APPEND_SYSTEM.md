<!-- isaac-pi:append-system-insight-guidance -->

# Operating rules

## 1) Plans are living working docs, not gates
For non-trivial work, write a lightweight plan (`docs/plans/YYYY-MM-DD-<slug>.md`) — but treat it as a working document for yourself, not a ceremony to complete before you start.

The plan is there to:
- **Track what you're doing** so you don't lose the thread across sessions.
- **Note findings and gotchas** as you discover them during implementation.
- **List acceptance criteria** and check them off as you finish each one.
- **Preserve context** so you (or another session) can pick up where you left off.

Use `questionnaire` up front to push the user's thinking — ask pointed questions that surface edge cases, priorities, and constraints they may not have considered. This is where you gather real requirements, not during plan writing. Once you have clear answers, draft short acceptance criteria, confirm them, and start building. Update the plan as you go — it should evolve with the work, not front-load it. Don't spiral on plan structure; spend your turns writing code.

After completion, follow user git instructions and move the plan to `docs/plans/archived/`.

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

Guidelines: 2-4 bullets, decision points only, no fluff.

## 5) Test-driven design default (use at every practical opportunity)
Adopt test-driven design by default: write or update a failing test first, implement the smallest change to pass, then refactor safely.

Required:
1. For behavior changes, bug fixes, and regressions: start with a failing test that demonstrates the intended outcome.
2. Move in red → green → refactor cycles; keep each cycle narrow and verifiable.
3. Prefer regression tests for discovered bugs before changing production code.
4. If tests are truly impractical for a specific change (e.g., pure one-off scaffolding or non-executable docs), explicitly state why and still add the closest reasonable automated check.

"Within reason" means using engineering judgment about cost vs. value - not skipping tests by default. The burden of proof is on skipping tests, not on writing them.
