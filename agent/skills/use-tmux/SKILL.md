---
name: use-tmux
description: "Run parallel Pi workers in tmux windows with a repeatable spawn→dispatch→collect→exit workflow. Use when orchestrating concurrent workstreams and apply worktree isolation first."
---

# Tmux Parallel Orchestration

Use this skill when the user wants to run multiple Pi workers concurrently in separate tmux windows.

## Prerequisites

- `tmux` is installed.
- You can use `tmux` directly, or rely on the detached helper session.
- `pi` is available on `PATH` (or pass a custom command to the spawn script).
- `TMUX_WORKER_SESSION` (optional) can be used to pin the helper session name when detached.

## Worktree-first safety (required)

Before spawning workers, isolate file changes by creating one worktree per worker using the existing worktree interfaces:

- Tool: `worktree({ action: "create", branch: "feat/x" })`
- Command: `/worktree create feat/x`

Important: if tool output is empty, run `worktree list` immediately to verify creation before proceeding.

Recommended pattern:
1. Create or sync worktrees first.
2. Run one worker per worktree/branch.
3. Keep each worker focused on a single task stream.

Do **not** run parallel workers in the same checkout when they may touch overlapping files.

## Mandatory window naming convention

Name every worker window with this format:

`wk-<topic>-<nn>`

Rules:
- lowercase letters, numbers, and hyphens only
- include a short topic/branch hint
- end with a two-digit sequence (`01`, `02`, ...)

Examples:
- `wk-auth-refactor-01`
- `wk-tests-api-02`

## Standard orchestration workflow

All helper scripts are in `scripts/` relative to this skill.

1. Spawn worker window and start Pi:
   - `./scripts/spawn_worker.sh <window-name> [pi-command]`
2. Dispatch an imperative task prompt:
   - `./scripts/send_worker.sh <window-name> "Read the task and execute now: ..."`
3. Let worker run, then collect outputs/status in the coordinator window.
4. Exit worker cleanly when done:
   - `./scripts/exit_worker.sh <window-name>`

## Prompt dispatch guidance

- Send one clear objective per worker.
- Use a direct imperative at the start (for first dispatch):
  - `Read this file and execute now: ...`
- Include explicit scope, acceptance criteria, and expected output format.
- If Pi startup is slow, use `--delay` (or `TMUX_WORKER_SEND_DELAY`) when calling `send_worker.sh`.

## Coordination rules

- Assign disjoint file areas per worker whenever possible.
- Track ownership by window name and branch/worktree.
- Merge/check results centrally after each worker reports completion.
