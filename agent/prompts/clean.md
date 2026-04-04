---
description: "Commit all dirty work and leave the branch clean"
---

You are executing the user's direct request to commit all dirty work and leave the working tree clean.

Arguments passed to template: $@

Execution rules:
1) Inspect `git status`.
2) Stage every tracked and untracked change that is present.
3) Inspect the staged diff and create a Conventional Commit message.
4) Commit.
5) Confirm the working tree is clean.
6) Report the commit hash and final branch state.

Rules:
- Do not ask about push or PR.
- Do not ask for clarification about scope.
- Do not force-push.
- Do not include secrets.
