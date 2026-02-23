---
description: "Pull latest main and rebase current branch onto it. In a worktree, this brings main INTO the worktree — it does not switch back to the main working tree."
---
You are helping with git workflow in this repository.

Goal: fetch the latest default branch (main/master) and rebase the current work onto it, so the current branch is up to date with upstream.

Execution rules:
1) Check for uncommitted changes on the current branch.
   - If there are uncommitted changes, ask whether to stash, commit, or discard them before proceeding.
2) Determine the default branch name (usually `main` or `master`).
   - Use `git remote show origin` or check `git branch -r` to find it.
3) Fetch the latest from origin:
   - `git fetch origin <default-branch>`
4) If currently inside a git worktree (not the main working tree):
   - Stay in the worktree. The purpose is to bring the latest main INTO this worktree's branch, not to leave the worktree.
   - Use `worktree_sync` to rebase the worktree branch onto the updated default branch and re-install dependencies.
   - If `worktree_sync` reports conflicts, resolve them:
     a) Show the conflicting files.
     b) Open and inspect each conflict.
     c) Resolve conflicts sensibly (prefer upstream changes unless the user directs otherwise).
     d) `git add` resolved files and `git rebase --continue`.
   - Skip to step 7.
5) If on the default branch already:
   - `git pull --rebase origin <default-branch>`
   If on a feature branch (not in a worktree):
   - `git fetch origin <default-branch>`
   - `git rebase origin/<default-branch>`
6) If there are rebase conflicts, resolve them:
   a) Show the conflicting files.
   b) Open and inspect each conflict.
   c) Resolve conflicts sensibly (prefer upstream changes unless the user directs otherwise).
   d) `git add` resolved files and `git rebase --continue`.
   - If rebase fails irrecoverably, abort with `git rebase --abort` and report the issue.
7) Confirm the branch is clean and up to date:
   - `git status` should show a clean working tree.
   - `git log --oneline -3` to show the latest commits for confirmation.
8) Report final state: current branch, latest commit, and whether everything is clean.

Safety:
- Never discard uncommitted work without explicit confirmation.
- Never force-push unless explicitly requested.
- If anything looks unexpected, pause and explain before continuing.
