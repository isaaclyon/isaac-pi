---
description: Prune merged branches locally and remotely
---
Clean up merged branches safely.

Execution rules:
1) Detect the default branch (usually `main` or `master`) and current branch.
2) Fetch/prune remotes first.
3) Identify branches already merged into the default branch.
4) Delete merged local branches, excluding:
   - current branch
   - default branch
   - protected long-lived branches (if present, e.g. develop/release)
5) Identify corresponding remote branches that are already merged.
6) Delete merged remote branches with `git push origin --delete <branch>`.

Safety:
- Do not delete unmerged branches.
- If any branch is ambiguous/risky, ask before deleting.
- Show a short summary of deleted local and remote branches at the end.