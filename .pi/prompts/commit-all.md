---
description: "Commit all current repo changes and clean branch (optional: push, pr)"
---
You are helping with git workflow in this repository.

Goal: commit all current work in this branch and move it to a clean working state.

Arguments passed to this template: $@

Execution rules:
1) Determine flags from arguments:
   - If arguments include `push`, set PUSH=true.
   - If arguments include `pr`, set PR=true.
2) Review git status and include all tracked/untracked changes intended for this branch.
   - If anything looks risky or unrelated, ask a brief clarification first.
3) Stage all intended changes.
4) Inspect staged diff and create a Conventional Commit message.
   - Format: `<type>: <short summary>`
   - Allowed types: feat, fix, docs, refactor, test, chore, ci, build, perf, revert
5) Commit.
6) Confirm working tree is clean.

Post-commit actions:
- If PUSH=true, push current branch to origin.
- If PR=true:
  a) Ensure branch is pushed.
  b) Open a PR with `gh pr create` (clear title/body based on the commit/diff).
  c) Check CI status with `gh pr checks` (or equivalent).
  d) If checks pass, merge the PR (squash merge is preferred unless repo conventions differ).
  e) Report final state (PR URL, CI result, merge result).

Safety:
- Never force-push unless explicitly requested.
- If there is nothing to commit, say so and stop.