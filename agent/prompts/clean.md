---
description: "Commit all intended work and leave the branch clean"
---

You are helping finish the current branch by committing all intended changes and leaving the working tree clean.

Arguments passed to template: $@

Execution rules:
1) Inspect `git status`.
2) Determine whether the arguments include `push` and/or `pr`.
3) Stage all intended tracked and untracked changes for this branch.
4) If anything looks risky or unrelated, ask a brief clarification before staging.
5) Inspect the staged diff and create a Conventional Commit message.
6) Commit.
7) Confirm the working tree is clean.
8) If `PUSH=true`, push the current branch to origin.
9) If `PR=true`, ensure the branch is pushed, open or update a PR, check CI, and merge if green.
10) Report the final commit hash and branch state.

Safety:
- Never force-push unless explicitly requested.
- Never include secrets or unrelated work.
