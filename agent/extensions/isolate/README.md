# Pi Isolate

`/isolate` runs a task in a managed Git worktree while moving the current Pi
conversation with it.

## Commands

```text
/isolate <task>  Create a worktree, move this session there, and start the task
/isolate finish  Integrate the branch, clean up, and return
/isolate discard Confirm deletion of all isolated work, clean up, and return
/isolate status  Show the active isolation job
```

The isolated agent receives `isolate_finish`. When the initial handoff driver is
still active, calling the tool automatically starts integration after the turn
settles. After a restart, the tool safely prefills `/isolate finish` for the
user to submit because Pi does not expose deferred extension commands.

## Invariant

The original session is not usable while isolation is unresolved. It becomes
usable only after either:

1. the isolated commit is rebased and fast-forwarded into the original branch,
   then the worktree and temporary branch are removed; or
2. the user explicitly confirms discard, then the worktree and temporary
   branch are removed.

Integration conflicts and validation failures remain in the isolated session.
Cleanup runs synchronously during the original session's startup. A cleanup
failure preserves the Git-common-dir manifest and shuts that runtime down
before interaction. Input, tool calls, and user shell commands are also
blocked while the original session is unresolved. Because Pi cannot cancel
extension commands before dispatch, an unresolved source session terminates
the process during startup in print, JSON, and RPC modes.

## State and recovery

One isolation job may be active per repository. Its atomic manifest and
transition lock live under:

```text
<git-common-dir>/pi-isolate/
```

The source session also stores an immutable pointer to the active job. This
keeps the session governed if its repository moves or Git discovery fails.
Cleanup appends verified and cleared tombstones around manifest removal.

Managed worktrees live under `<repository>/.worktrees/`. The extension adds the
exact `/.worktrees/` pattern to the repository's Git `info/exclude`; it does
not modify the tracked `.gitignore`. Each managed worktree has an ownership
marker in its Git administrative directory. Cleanup verifies that marker, the
Git common directory, registered worktree path, and branch head before removal.

If Pi exits while isolated, resume the isolated session shown in the startup
error. The manifest is reconciled on the next finish or discard attempt. A
crash during initial creation is rolled back automatically when the original
session next starts. Repository state discovery uses the Git common directory,
so it remains active while a conflicted rebase has detached `HEAD`.
