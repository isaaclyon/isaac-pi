---
description: "Create one clean commit for the intended current changes"
---

You are helping create one clean commit for the intended current changes.

Arguments passed to template: $@

Execution rules:
1) Inspect `git status`.
2) If there is nothing to commit, say so and stop.
3) Identify which changed files are intended for this commit.
4) If scope is unclear, ask a brief clarification before staging.
5) Stage only intended files.
6) Inspect the staged diff and create a Conventional Commit message.
7) Commit.
8) Report the commit hash and summarize what was committed.

Safety:
- Never force-push unless explicitly requested.
- Never include unrelated files without confirmation.
