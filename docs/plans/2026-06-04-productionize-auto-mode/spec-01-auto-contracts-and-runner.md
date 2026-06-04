# Spec 01: Define auto-mode contracts and the repair runner

## Goal

Create the small, testable building blocks that make `/productionize auto` possible without bloating the existing workflow module. After this spec, the codebase has a serializable auto-mode state model, retry-key logic, checkpoint invalidation helpers, and a background repair-runner abstraction that can drive a side Pi process and report structured outcomes back to the foreground workflow.

## Must do

- Create `agent/extensions/productionize/auto.ts` for pure auto-mode helpers and types.
- Create `agent/extensions/productionize/repair-runner.ts` for the background side-agent process wrapper.
- Define a serializable auto-state entry shape for `pi.appendEntry(...)`, including mode, active checkpoint, retry counts keyed by `step + HEAD SHA`, latest handoff prompt, latest side-session file, stable child token, and spawn timestamp.
- Add pure helpers in `auto.ts` for:
  - parsing `/productionize auto` versus plain `/productionize`;
  - building retry keys from `StepId` plus branch `HEAD` SHA;
  - deciding the nearest safe resume checkpoint;
  - invalidating downstream `pr`, `ci`, `merge`, and `return` step state after a head change;
  - reconstructing in-memory auto state from persisted custom entries.
- Implement `repair-runner.ts` so it can spawn a separate `pi` process in JSON mode, target a dedicated session file, stream JSON event updates, capture the final side-session file path, and return a structured `RepairAttemptSummary`.
- Start the child subprocess with an explicit tool allowlist that contains only `read`, `edit`, and `write`.
- Enforce a hard child safety boundary through a child-only guard extension loaded by the subprocess. That guard must intercept `input` and `tool_call` events so the side agent cannot invoke `/productionize*` and cannot call any tool other than `read`, `edit`, and `write`.
- Path-confine those allowed file tools to the temporary worktree root after `realpath` resolution for existing paths. For new write targets, canonicalize the parent directory first and then validate the basename-target path before allowing creation. Reject absolute-path escapes, `..` traversal, symlink escapes, writes outside the temp worktree, and any path inside the temp worktree’s `.git/` directory.
- Remove GitHub auth from the child environment and do not expose `bash`, `gh`, or any other command-execution surface to the child runtime.
- Launch the child inside a temporary worktree for the current feature branch. The child may only read and edit files there, and it must not have a path to remote mutation or arbitrary command execution.
- Snapshot the exact base branch name and base-branch SHA before the repair attempt starts, and return those values in the runner summary for post-run verification.
- Generate and persist a stable random child token, embed it in the child session-file and temp-worktree names, and retain it with the spawn timestamp for safe orphan detection on restart.
- Return enough information for the foreground workflow to import the child result back into the canonical worktree as a patch artifact. Generate it by running `git add -A` in the temp worktree after the child exits, then capturing `git diff --cached --binary --full-index HEAD` so creates, deletes, and binary hunks are preserved.
- Pin the child-process protocol in code and tests: require the JSON session header, assistant `message_end` events, tool execution end events, and terminal completion or error state to be recognized explicitly.
- Retain enough runner state to reconcile interruption after reload: session file path, child PID if available, child spawn timestamp, stable child token, verified command metadata, last seen event type, and last summarized text.
- On reload or restart, the runner strategy is kill-orphan-and-relaunch, not live reattachment. If a persisted child PID is still alive and still matches the recorded Pi child metadata, stable child token, and spawn time, terminate it first, record the interruption, and start one replacement child.
- Use the current Pi session model for the repair subprocess when one is selected.
- Add focused tests in `agent/extensions/productionize/auto.test.ts` and `agent/extensions/productionize/repair-runner.test.ts`.

## Constraints / Must not do

- Do not use `ctx.newSession()`, `ctx.switchSession()`, or `ctx.fork()` for the background repair worker, because those replace the visible session and would tear down the productionize panel.
- Do not add any workflow-step side effects to `auto.ts`; it must stay pure and unit-testable.
- Do not teach the runner to merge pull requests, mutate remotes, or execute project commands. The side repair agent may only read and edit files; all validation, commit, push, and merge actions stay in the foreground productionize workflow.
- Do not add more logic directly into `agent/extensions/productionize/workflow.ts` for this spec beyond small adapter shims needed to compile.

## Acceptance Criteria

- Auto-mode state can be serialized into custom session entries and reconstructed without losing retry counters, active checkpoint, or the last side-session file.
- The repair runner can consume a fixture JSON event stream and report useful progress plus a final success, failure, or cancellation outcome.
- The runner contract proves it launches a real subprocess with a persisted side-session file, not just a fake in-memory wrapper.
- The runner contract proves the child safety guard is active and blocks recursive productionize, every non-allowlisted tool call, every path escape outside the temporary worktree, and every write into the temp worktree’s `.git/` directory.
- The runner contract proves the child is launched with only `read`, `edit`, and `write` available.
- The runner contract proves it snapshots `baseBranch` and `baseShaBefore` before launching the child.
- The runner contract proves it returns an importable patch artifact for the foreground workflow.
- The runner contract proves that patch generation preserves edits, creates, deletes, and binary-safe hunks without guessing from ad hoc file copies.
- The runner contract proves the staging step happens inside the runner, not in the child, so untracked creates are captured deterministically.
- The runner contract proves it records a stable child token plus spawn timestamp for restart reconciliation.
- Abort and interrupted-run handling are observable from the returned summary data.
- The code clearly separates pure auto-state logic from child-process orchestration.
- `workflow.ts` remains focused and does not absorb the new runner implementation wholesale.

## Tests

- `node --test agent/extensions/productionize/auto.test.ts` passes.
- `node --test agent/extensions/productionize/repair-runner.test.ts` passes.
- `node --test agent/extensions/productionize/core.test.ts agent/extensions/productionize/auto.test.ts agent/extensions/productionize/repair-runner.test.ts` passes.
- Add at least one test proving that a new HEAD SHA resets the retry key while the same `step + SHA` increments the retry count.
- Add at least one test proving the runner surfaces a cancellation outcome when the child process is aborted.
- Add at least one subprocess smoke test that spawns a real short-lived `pi --mode json --session <file>` child and asserts the runner records the side-session file path plus a terminal outcome.
- Add at least one guard test that proves the child runtime blocks `/productionize` recursion and every non-allowlisted tool call before it can execute.
- Add at least one tool-interception test proving the child guard permits `read`, `edit`, and `write` only.
- Add at least one launch test proving the child subprocess is started with exactly the `read`, `edit`, `write` tool allowlist.
- Add at least one path-confinement test proving absolute paths, `..` traversal, symlink escapes, newly created files outside the temp worktree, and `.git/` write attempts are rejected.
- Add at least one test proving the runner returns an importable patch artifact.
- Add at least one test proving the patch artifact preserves file creates and deletes, and fails loudly if staging or export cannot be produced.
- Add at least one reload-recovery test that proves a persisted live child PID is killed and replaced by exactly one new child on restart only after the stable child token and spawn timestamp match the recorded child.

## Todo

- [ ] Add `auto.ts` with serializable types and pure helpers.
- [ ] Add `repair-runner.ts` with child-process launch and JSON event parsing.
- [ ] Add `auto.test.ts`.
- [ ] Add `repair-runner.test.ts`.
- [ ] Keep `workflow.ts` changes minimal in this slice.