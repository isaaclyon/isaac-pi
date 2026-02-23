---
description: "Commit intended current changes with a Conventional Commit message"
---
You are helping with git workflow in this repository.

Goal: make one clean commit for the intended current changes.

Execution rules:
1) Review git status.
   - If there is nothing to commit, say so and stop.
2) Identify which changed files are intended for this commit.
   - If scope is unclear, ask a short clarification before staging.
3) Stage only intended files.
4) Inspect staged diff and create a Conventional Commit message.
   - Format: `<type>: <short summary>`
   - Allowed types: feat, fix, docs, refactor, test, chore, ci, build, perf, revert
5) Commit.
6) Report the commit hash and summarize what was committed.

Safety:
- Never force-push unless explicitly requested.
- Never include unrelated files without confirmation.
