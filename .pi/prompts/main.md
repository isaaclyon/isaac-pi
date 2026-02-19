---
description: "Return to the main branch from a feature branch or worktree, pull latest, and resolve any conflicts"
---
You are helping with git workflow in this repository.

Goal: get back to the main (default) branch cleanly, pull the latest changes, and ensure everything is in a good state.

Execution rules:
1) Check for uncommitted changes on the current branch.
   - If there are uncommitted changes, ask whether to stash, commit, or discard them before proceeding.
2) Determine the default branch name (usually `main` or `master`).
   - Use `git remote show origin` or check `git branch -r` to find it.
3) If currently inside a git worktree (not the main working tree):
   - Use the `worktree_list` tool to show all worktrees.
   - Suggest the user run `/move-session <main-worktree-path>` to switch back to the main working tree.
   - Once in the main working tree, continue with the remaining steps.
   - Optionally offer to clean up the old worktree with `worktree_remove` if the feature work is done.
4) Switch to the default branch:
   - `git checkout <default-branch>`
5) Pull latest changes:
   - `git pull --rebase origin <default-branch>`
   - If there are merge/rebase conflicts, resolve them:
     a) Show the conflicting files.
     b) Open and inspect each conflict.
     c) Resolve conflicts sensibly (prefer upstream changes unless the user directs otherwise).
     d) `git add` resolved files and `git rebase --continue`.
   - If rebase fails irrecoverably, abort with `git rebase --abort` and report the issue.
6) Confirm the branch is clean and up to date:
   - `git status` should show a clean working tree on the default branch.
   - `git log --oneline -3` to show the latest commits for confirmation.
7) Report final state: current branch, latest commit, and whether everything is clean.

Safety:
- Never discard uncommitted work without explicit confirmation.
- Never force-push unless explicitly requested.
- If anything looks unexpected, pause and explain before continuing.
