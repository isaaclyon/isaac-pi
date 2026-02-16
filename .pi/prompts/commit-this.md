---
description: "Commit only this session's work (optional: push, pr)"
---
You are helping with git workflow in this repository.

Goal: commit only the work completed in this session using a Conventional Commit message.

Arguments passed to this template: $@

Execution rules:
1) Determine flags from arguments:
   - If arguments include `push`, set PUSH=true.
   - If arguments include `pr`, set PR=true.
2) Identify files changed for this session's work only.
   - Prefer the files touched by this session.
   - If uncertain what should be included, ask a short clarification before committing.
3) Stage only those files (do not stage unrelated changes).
4) Inspect staged diff and write a clear Conventional Commit message.
   - Format: `<type>: <short summary>`
   - Allowed types: feat, fix, docs, refactor, test, chore, ci, build, perf, revert
5) Commit.

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
- Never include unrelated files without confirmation.
- If there is nothing to commit, say so and stop.