---
name: use-feature-branch-workflow
description: "Use this skill when finishing a feature branch: commit, push, create a PR, monitor CI, and merge safely."
---

# Feature Branch Workflow

Finish work in a feature branch: commit → push → PR → check conflicts → monitor CI → merge.

**Assumes:** You're in a repo with work to ship. If currently on `main`, automatically create and switch to a feature branch before committing.

**Mandatory first decision:** explicitly choose PR target branch before creating/updating any PR.
- `dev` = shared development environment
- `main` = production promotion path

```
Commit → Push → PR → Check Conflicts → Monitor CI → Merge
                          │                  │
                          ▼                  ▼
                     CONFLICTS?          CI FAILED?
                     Report & stop       Report & stop
```

## Step 0: Select PR target (required)

Always capture the target branch up front.

```bash
# Required: pick exactly one target branch for this PR
# dev  = promote to shared dev environment
# main = promote to production path
TARGET_BRANCH="<dev-or-main>"

if [[ "$TARGET_BRANCH" != "dev" && "$TARGET_BRANCH" != "main" ]]; then
  echo "Error: TARGET_BRANCH must be 'dev' or 'main'."
  exit 1
fi

echo "Using PR target: $TARGET_BRANCH"
```

Do not continue until `TARGET_BRANCH` is explicit.

## Step 1: Verify Context (and auto-branch if needed)

```bash
# Check current branch
current_branch=$(git branch --show-current)

# If on main, create and switch to a feature branch automatically.
# Name format: <type>/<short-slug>-<YYYYMMDD>
# - type: feat | fix | chore (pick based on the work)
# - short-slug: 2-6 kebab-case words describing the change
if [ "$current_branch" = "main" ]; then
  branch_name="feat/<short-slug>-$(date +%Y%m%d)"
  git switch -c "$branch_name"
fi

# Check working tree
git status
```

**Stop if:** No changes to commit and no commits ahead of upstream.

## Step 2: Commit All Changes

Analyze all modified/added/deleted files and create atomic conventional commits:

- Group related changes logically
- Use conventional commit format: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Stage specific files per commit (never `git add -A`)
- Use HEREDOC for commit messages:

```bash
git add src/specific-file.py
git commit -m "$(cat <<'EOF'
feat(scope): add feature description

- Detail about the change
- Another detail
EOF
)"
```

**Rules:**
- One logical change per commit
- Focus on "why" not "what"
- Never stage secrets (.env, credentials)

## Step 3: Push to Remote

```bash
# Check if upstream exists
git branch -vv

# If no upstream:
git push -u origin $(git branch --show-current)

# If upstream exists:
git push
```

## Step 4: Create or Find PR (target-aware)

```bash
# Check if PR exists for this head branch
gh pr view 2>/dev/null

# If no PR exists, create against explicit target branch
gh pr create --fill --base "$TARGET_BRANCH"
```

Report PR URL and target branch to the user.

## Step 5: Check for Merge Conflicts

```bash
gh pr view --json mergeable,mergeStateStatus,baseRefName -q '{state: .mergeStateStatus, base: .baseRefName}'
```

| Status | Action |
|--------|--------|
| `DIRTY` or `BLOCKED` | **STOP** - Report conflicts, provide: `git fetch && git merge origin/$TARGET_BRANCH` |
| `BEHIND` | Warn user, suggest merge/rebase from `origin/$TARGET_BRANCH`, continue |
| `CLEAN` or `UNSTABLE` | Continue to CI |

Also verify PR base matches `TARGET_BRANCH`; if not, update it before continuing.

## Step 6: Monitor CI

```bash
gh pr checks --watch --fail-fast
```

| Exit Code | Action |
|-----------|--------|
| 0 (pass) | Continue to merge |
| 1 (fail) | **STOP** - Report failed checks |

## Step 7: Merge PR

```bash
gh pr merge --squash
```

- Squash merge keeps history clean
- Do NOT use `--delete-branch` — the repo has "auto-delete head branches" enabled, so GitHub deletes the remote branch automatically after merge.

## Step 8: Report Success

- Confirm merge completed
- Report the merged PR URL
- Report target branch used (`dev` or `main`)
- Remind user to clean up the local worktree when done:
  ```bash
  # From the main worktree:
  git worktree remove .worktrees/<name>
  git branch -d <branch-name>
  ```

---

## Error Handling Summary

| Scenario | Detection | Action |
|----------|-----------|--------|
| Missing target branch choice | `TARGET_BRANCH` empty | Stop and require explicit `dev` or `main` |
| Invalid target branch | not `dev`/`main` | Stop and correct target |
| On main branch | `git branch --show-current` = main | Auto-create/switch to feature branch, then continue |
| No changes | git status clean, no commits ahead | Stop, nothing to do |
| Merge conflicts | mergeStateStatus = DIRTY | Stop, provide merge command against `origin/$TARGET_BRANCH` |
| Branch behind | mergeStateStatus = BEHIND | Warn, continue |
| CI fails | gh pr checks exit 1 | Stop, list failed checks |
| PR already exists | gh pr view succeeds | Use existing PR; verify base branch |
| Worktree merge error | `fatal: 'main' is already used by worktree` | Merge succeeded — don't use `--delete-branch`; repo auto-deletes remote branches on merge |

## Quick Reference

| Action | Command |
|--------|---------|
| Set required target | `TARGET_BRANCH="dev"` or `TARGET_BRANCH="main"` |
| Check branch | `git branch --show-current` |
| Auto-create feature branch (if on main) | `git switch -c feat/<short-slug>-$(date +%Y%m%d)` |
| Commit | `git add file && git commit -m "type: msg"` |
| Push (new) | `git push -u origin $(git branch --show-current)` |
| Push (existing) | `git push` |
| Create PR against explicit target | `gh pr create --fill --base "$TARGET_BRANCH"` |
| Check conflicts/base | `gh pr view --json mergeStateStatus,baseRefName` |
| Monitor CI | `gh pr checks --watch --fail-fast` |
| Merge | `gh pr merge --squash` |
