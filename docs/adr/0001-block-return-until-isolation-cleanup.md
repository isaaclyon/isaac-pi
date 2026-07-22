---
status: accepted
---

# Block return until isolation cleanup completes

## Context

Moving a Pi session into a Git worktree makes isolation convenient, but an
unresolved return to the original session leaves worktrees and temporary
branches without an owner. Cleanup also cannot safely delete the worktree while
Pi's effective cwd still points at it.

## Decision

Treat return as a transaction with exactly two exits: verified
rebase/fast-forward integration, or explicitly confirmed discard. Pi switches
to the original session only after persisting cleanup intent. The original
runtime synchronously removes the exact owned worktree and temporary ref during
`session_start` before normal interaction. If cleanup fails, the manifest
remains and the original runtime shuts down. Non-interactive input, tool calls,
and user shell commands are blocked as a second fail-closed boundary. Since Pi
dispatches extension commands before input interception, unresolved source
sessions terminate at startup in print, JSON, and RPC modes.

State discovery depends on the Git common directory rather than the current
branch, so conflict-time detached heads remain governed. Every transition
reloads and validates the expected job while holding the repository lock.
Before deletion, cleanup verifies a per-worktree owner marker and persists the
exact temporary ref head used for compare-and-delete.

The source session persists a pointer to the Git-common-dir job before the
manifest is created. That pointer governs recovery even when repository
discovery fails. Cleanup records a verified tombstone before clearing the
manifest, then a cleared tombstone afterward, so each crash boundary remains
fail-closed without treating completed cleanup as unresolved forever.

The initial handoff may keep a fresh replacement-session context alive while
the isolated agent works. This lets `isolate_finish` signal automatic
integration after that turn settles. Recovered sessions require explicit
`/isolate finish` submission because Pi tools cannot queue extension commands.

## Consequences

- A usable original session implies that no managed isolation worktree or
  temporary branch remains.
- Conflicts and failed integration stay in the isolated session.
- Cleanup is conservative, idempotent, and recoverable from the Git-common-dir
  manifest.
- Users cannot leave isolation while preserving an unresolved managed
  worktree; they must finish or explicitly discard it.
