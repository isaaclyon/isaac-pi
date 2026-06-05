# Spec 03: Integrate the autonomous repair loop into the real workflow

## Goal

Teach the existing productionize workflow how to recover automatically from recoverable failures. After this spec, a failing checkpoint can launch a side repair agent, wait for it to finish, record the result, rerun the nearest safe checkpoint, and continue toward merge without requiring the user to re-paste fix prompts manually.

## Must do

- Edit `agent/extensions/productionize/workflow.ts` to accept auto-mode options and consult the new auto helpers instead of hard-coding one-shot failure behavior.
- Distinguish recoverable failures from unrecoverable prerequisites. Recoverable candidates must include most failures in `commit`, `push`, `pr`, `ci`, `merge`, and `return`; unrecoverable prerequisites must include at least “not a git repository”, detached HEAD, missing `gh` auth, missing remote, and non-GitHub remote cases.
- Codify the exact prerequisite probes or signatures in `workflow.ts` and tests. At minimum cover:
  - `git rev-parse --is-inside-work-tree` failing for “not a git repository”;
  - `git branch --show-current` returning empty output for detached HEAD;
  - `gh auth status` or the existing failing `gh` call returning auth-required stderr for missing GitHub auth;
  - `git remote` / push-remote resolution failing with no configured remote;
  - `gh repo view --json defaultBranchRef` or equivalent repo inspection failing because the remote is not GitHub-backed.
- Capture the current `HEAD` SHA before starting a repair attempt and again after the side repair agent finishes.
- Capture the exact base branch name and its SHA before starting the repair attempt so the foreground workflow can prove the child did not advance the base branch.
- Generate a guided-but-open repair handoff prompt that includes the failing step, command, stdout or stderr, recent log, branch, PR or checks context, and resume rules.
- Launch the side repair agent through `repair-runner.ts` with the current session model, target repo `cwd`, and generated handoff prompt.
- Allow the side repair agent to edit files only in its temporary worktree, but enforce a runtime guard so it cannot perform any remote mutation path: recursive `/productionize*`, `gh` usage, non-allowlisted tool calls, merge commands or APIs, or remote git commands.
- Route child safety through the child-only guard extension described in Spec 01 so the restriction is implemented by a launch-time `read`/`edit`/`write` tool allowlist plus intercepted `input` and `tool_call` events with realpath-based and parent-directory-based path confinement, not just by prompt text.
- After the child exits, deterministically import its local result back into the canonical foreground worktree by running `git add -A` in the temp worktree, exporting `git diff --cached --binary --full-index HEAD`, and applying that patch with `git apply --index --3way` before rerunning the foreground `commit` or later checkpoints.
- If staging, patch export, or patch apply fails, stop auto mode with an explicit repair-import failure instead of attempting a best-effort resume.
- After a repair attempt, append a compact summary to the main session, update the retry counter for the `step + HEAD SHA` key, and stop permanently after the third failed attempt for that key.
- Rerun the nearest safe checkpoint after the repair attempt instead of trusting the side agent’s self-report.
- Implement the resume matrix from `ExecPlan.md` exactly so each failing step has one unambiguous rerun target and one unambiguous downstream invalidation set.
- If `HEAD` changed, invalidate downstream `pr`, `ci`, `merge`, `return`, stored PR metadata, and displayed check state before rerunning.
- Before any resume, verify that the recorded base-branch SHA is unchanged and that the PR is still unmerged; if either check fails, stop auto mode as a safety violation instead of continuing.
- Preserve the current manual failure flow as the fallback path when auto mode is not enabled.
- Integrate with the session-start reconciliation path so a reload during an active repair attempt kills any orphaned worker and relaunches exactly one replacement worker before the foreground checkpoint resumes.
- Add focused workflow tests in `agent/extensions/productionize/workflow-auto.test.ts`.

## Constraints / Must not do

- Do not let the side repair agent perform the final merge or any remote push or PR mutation.
- Do not reuse old CI or merge state after the repair agent changed the branch head.
- Do not trust “I fixed it” text from the side agent as proof; the foreground workflow must rerun the checkpoint.
- Do not start an infinite repair loop. Hard-stop after three attempts for the same `step + HEAD SHA`.
- Do not change the existing non-auto `/productionize` behavior except where shared helpers must move.

## Acceptance Criteria

- A recoverable productionize failure in auto mode automatically starts repair attempt `1/3` without user paste or submit steps.
- The generated handoff prompt contains enough repository and failure context for the side agent to work independently.
- If the imported repair result changes `HEAD`, productionize reruns the exact safe checkpoint defined by the resume matrix and recomputes downstream PR, CI, merge, and return state on the new head SHA.
- File creates, deletes, and binary-safe diffs from the repair worktree survive the import step intact or fail loudly.
- Each unrecoverable prerequisite path is explicitly classified by command result or stderr pattern and bypasses the repair runner.
- The side repair worker is mechanically unable to recurse into `/productionize*`, execute `gh`, perform remote git mutations, edit files outside its temporary worktree, or tamper with temp-worktree git metadata because the child guard extension allows only path-confined `read`, `edit`, and `write` outside `.git/`.
- If the child somehow returns with a changed base-branch SHA or merged PR, the foreground workflow treats that as a safety failure and stops.
- If the same checkpoint fails three times on the same head SHA, auto mode stops with a clear exhausted-retries summary and preserved audit trail.
- Plain `/productionize` still ends in the current manual fix-preview flow.

## Tests

- `node --test agent/extensions/productionize/workflow-auto.test.ts` passes.
- `node --test agent/extensions/productionize/core.test.ts agent/extensions/productionize/auto.test.ts agent/extensions/productionize/repair-runner.test.ts agent/extensions/productionize/workflow-auto.test.ts` passes.
- Add at least one test proving each unrecoverable prerequisite path bypasses the repair runner.
- Add at least one test proving a changed `HEAD` resets downstream `pr`, `ci`, `merge`, `return`, PR metadata, and displayed checks before resume.
- Add at least one test proving patch import preserves file creates and deletes, and that import failure stops auto mode explicitly.
- Add at least one test per resume-matrix branch that differs in behavior, especially `ci` unchanged-HEAD versus changed-HEAD and `merge` unchanged-HEAD versus changed-HEAD.
- Add at least one test proving a reload during an active repair attempt kills any orphaned worker, relaunches exactly one replacement worker, and resumes correctly.
- Add at least one test proving a changed base-branch SHA after repair is treated as a safety failure.
- Add at least one test proving manual mode still uses the existing fix-instruction path.

## Todo

- [ ] Add recoverable-versus-unrecoverable failure classification.
- [ ] Capture `HEAD` SHA before and after repair attempts.
- [ ] Generate the guided repair handoff prompt.
- [ ] Call the repair runner from auto mode.
- [ ] Persist retry counters and repair summaries.
- [ ] Rerun the nearest safe checkpoint after repair.
- [ ] Reset downstream state when the branch head changes.
- [ ] Add `workflow-auto.test.ts`.