# Git Worktree Extension — Plan

## Overview

A pi extension that manages the full lifecycle of git worktrees: creation with automatic dependency installation and config file copying, safe removal with dirty-state checks, listing with status info, and syncing with the default branch.

## Prerequisites

- Git 2.7+ (for `git worktree list --porcelain`). The extension checks this on first use and returns a clear error if the version is too old.

## Tools

### `worktree_create`

- **Params:**
  - `branch` (required) — branch name to create or check out
  - `base` (optional) — base ref to branch from (tag, commit, branch). Defaults to the repo's default branch.
  - `configFiles` (optional, string array) — extra file paths/globs to copy from the main repo into the worktree (in addition to `.env*`)
  - `force` (optional boolean) — skip "already exists" errors and return the existing worktree path
- **Worktree location:** `.worktrees/<repo-name>-<sanitized-branch>/` at repo root
  - Branch name sanitization: replace `/` with `-`, strip leading/trailing `-`
- **Branch handling:**
  - If branch exists → check it out in the worktree
  - If branch doesn't exist → create it from `base` (or auto-detected default branch)
  - If a worktree already exists for this branch → return its path (with `force`) or error (without)
- **Auto-gitignore:** adds `.worktrees/` to `.gitignore` on first use if not already present. Reports this in the tool result.
- **Direnv bootstrap:** if a `.envrc` file is present in the worktree, runs `direnv allow` after creation.
- **Dep install (blocking, foreground):**
  - Detection priority order (first match wins): `pnpm-lock.yaml` → `package-lock.json` → `yarn.lock` → `bun.lockb` → `uv.lock` → `requirements.txt`
  - Runs the corresponding install command in the worktree
  - If no lockfile found → skip silently
- **Config copy:**
  - Globs `.env*` at repo root — copies any matches into the worktree
  - If `configFiles` param is provided, copies those too (resolved relative to repo root)
  - Reports which files were copied in the tool result
- **Returns:** worktree path, branch name, package manager used (if any), config files copied, whether `.gitignore` was modified

### `worktree_remove`

- **Params:**
  - `branch` (required) — identifies the worktree to remove (looked up from `git worktree list`)
  - `deleteBranch` (optional boolean, default false) — also delete the local branch after removal
  - `force` (optional boolean) — skip all safety checks
- **Safety checks (unless `force`):**
  - **Block** if uncommitted changes exist in the worktree
  - **Warn** (in tool result, but still proceed) if the branch has unpushed commits
- Runs `git worktree remove <path>`, then `git worktree prune`
- If `deleteBranch` → runs `git branch -d <branch>` (safe delete — fails if unmerged, unless `force` which uses `-D`)
- **Returns:** success/failure, whether branch was deleted, any warnings

### `worktree_list`

- **No required params**
- Parses `git worktree list --porcelain`
- **Shows for each worktree:**
  - Branch name (or "detached HEAD" if applicable)
  - Directory path
  - Dirty/clean status
  - Unpushed commit count (compared to upstream tracking branch, if set)
- **Returns:** structured array of worktree info objects

### `worktree_sync`

- **Params:**
  - `branch` (optional) — sync a single worktree. If omitted, syncs all.
- **Steps (per worktree):**
  1. Pull the default branch in the main repo
  2. Rebase the worktree's branch onto the updated default branch
  3. If rebase conflicts → `git rebase --abort`, return error with list of conflicting files. Do **not** auto-resolve.
  4. Re-run dep install in the worktree (foreground, blocking)
- **Returns:** per-worktree result — success/failure, conflict info if applicable, dep install outcome

## Error Handling

Follow the pattern from `tmux/` extension:

- Define an `ErrorCode` enum: `GIT_TOO_OLD`, `NOT_A_GIT_REPO`, `BRANCH_NOT_FOUND`, `WORKTREE_EXISTS`, `WORKTREE_NOT_FOUND`, `DIRTY_WORKTREE`, `REBASE_CONFLICT`, `DEP_INSTALL_FAILED`, `REMOVE_FAILED`
- Use `buildToolResult` / `makeToolError` helpers for consistent structured output
- All tool results include a `details` field with structured data (path, branch, package manager, etc.)

## Default Branch Detection

Strategy (in order):

1. `git symbolic-ref refs/remotes/origin/HEAD` → parse the branch name
2. `git remote show origin` → grep for `HEAD branch:`
3. Check if `main` branch exists locally → use it
4. Check if `master` branch exists locally → use it
5. Error: could not determine default branch

## File Structure

```
.pi/extensions/worktree/
├── index.ts            # Extension entry — default export calls registerWorktreeTools(pi)
├── register-tools.ts   # Tool registration (tool schemas + handlers)
├── create.ts           # worktree_create logic
├── remove.ts           # worktree_remove logic
├── list.ts             # worktree_list logic
├── sync.ts             # worktree_sync logic
├── git.ts              # Git operations: default branch detection, dirty checks, unpushed detection, version check
├── deps.ts             # Package manager detection (priority order) and install commands
├── config.ts           # .env copying, .gitignore entry management
├── types.ts            # ErrorCode, ToolError, WorktreeInfo, PackageManager, tool result types
└── results.ts          # buildToolResult / makeToolError helpers
```

## Known Limitations

- **Monorepos:** dep install runs at the worktree root only. Subdirectory installs (Nx, Turborepo, Lerna, etc.) are not auto-detected. Run them manually after creation.
- **Shallow clones:** `git worktree add` may behave unexpectedly in shallow clones. Not explicitly handled.
- **Windows:** path separators are not explicitly handled. Extension targets macOS/Linux primarily.
- **Concurrent operations:** no locking or guards. Don't run `worktree_sync` while other tools are actively working inside a worktree.
- **Detached HEAD worktrees:** `worktree_list` displays them but `worktree_remove` and `worktree_sync` require a branch name, so detached HEAD worktrees must be managed manually.

## Workflow Example

```
Agent creates a worktree:
  → worktree_create(branch: "feat/new-api")
  → Creates .worktrees/pi-feat-new-api/
  → Detects pnpm-lock.yaml → runs pnpm install
  → Copies .env, .env.local
  → Returns { path: ".worktrees/pi-feat-new-api", branch: "feat/new-api", packageManager: "pnpm", configFilesCopied: [".env", ".env.local"] }

Agent works in the worktree:
  → bash("cd .worktrees/pi-feat-new-api && pnpm test")
  → bash("cd .worktrees/pi-feat-new-api && git add -A && git commit -m 'feat: new api'")

Agent syncs with main:
  → worktree_sync(branch: "feat/new-api")
  → Pulls main, rebases feat/new-api onto main, reinstalls deps

Agent finishes and cleans up:
  → worktree_remove(branch: "feat/new-api", deleteBranch: true)
  → Checks clean state, removes worktree, deletes branch
```
