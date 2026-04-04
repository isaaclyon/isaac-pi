---
description: "Commit all intended work and leave the branch clean"
---

You are helping execute a direct request to commit all intended dirty work and leave the working tree clean. Do not treat this as a planning or branching exercise.

Arguments passed to template: $@

Execution rules:
1) Inspect `git status`.
2) Treat the current dirty work as the thing to commit; do not ask whether to push or open a PR.
3) Stage all tracked and untracked changes intended by the user.
4) If something is obviously unrelated or risky, ask a brief clarification only about that specific file or change.
5) Inspect the staged diff and create a Conventional Commit message.
6) Commit.
7) Confirm the working tree is clean.
8) Report the commit hash and final branch state.

Safety:
- Never force-push unless explicitly requested.
- Never include secrets or unrelated work.
