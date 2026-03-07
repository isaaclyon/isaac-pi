---
name: worktree
description: "Manage git worktrees with a single tool/command interface: create, list, sync, and remove safely. Prefer structured tool calls over raw git edits."
---

# Worktree Skill

Use this skill when the user asks for branch isolation, worktree setup, cleanup, or syncing.

## Canonical interface (preferred)

### Tool: `worktree`
Call the unified tool with:

- `action: "create" | "remove" | "list" | "sync"`

Common forms:

- **Create**
  - `worktree({ action: "create", branch: "feat/name", base: "main", configFiles: [".env.local"], force: false })`
- **List**
  - `worktree({ action: "list" })`
- **Sync one**
  - `worktree({ action: "sync", branch: "feat/name" })`
- **Sync all**
  - `worktree({ action: "sync" })`
- **Remove**
  - `worktree({ action: "remove", branch: "feat/name", deleteBranch: false, force: false })`

### Command: `/worktree`
If the user is operating interactively, prefer:

- `/worktree create <branch> [--base <ref>] [--config <path>]... [--force]`
- `/worktree list`
- `/worktree sync [branch]`
- `/worktree remove <branch> [--delete-branch] [--force]`

## Recommended behavior

1. Prefer `/worktree create` or the unified `worktree` tool for lifecycle actions.
2. After create, switch context with `/move-session <worktree-path>` when the user wants to start working there.
3. Use `/worktree list` before remove/sync if you need to confirm branch/status.
4. For cleanup, use `action: "remove"` with `force` only when the user explicitly asks and accepts risk.
5. For update operations, use `action: "sync"` on the needed branch or all worktrees.

## Safety defaults

- `remove` checks for uncommitted changes (unless `force: true`).
- `sync` performs fetch + rebase (`origin/<default-branch>`); if no `origin` remote exists, it falls back to rebasing on the local default branch. Conflicts can abort and must be surfaced clearly.
- Keep operations branch-centric: avoid raw `git worktree` scripting unless the user explicitly asks.

## Tooling preference policy

- Primary: unified `worktree` tool.
- Secondary: `/worktree` command for concise human-readable flow.
- Avoid using individual old tools (`worktree_create`, `worktree_remove`, `worktree_list`, `worktree_sync`) since they are no longer available.
