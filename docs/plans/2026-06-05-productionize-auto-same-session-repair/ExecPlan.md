# Replace `/productionize auto` side-session repair with same-session repair mode

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This repository does not have project-local `.agent/PLANS.md` or `.agent/SPECS.md` overrides, so this plan follows `/Users/isaaclyon/.pi/agent/skills/create-specs/PLANS.md` and `/Users/isaaclyon/.pi/agent/skills/create-specs/SPECS.md`.

## Purpose / Big Picture

`/productionize auto` currently repairs failures by launching a separate Pi JSON subprocess in a temporary worktree, streaming its events back into the panel, exporting a patch, and importing that patch into the foreground run. That architecture is mechanically safe, but it has already produced user-visible failures: the worker drafted manual instructions instead of fixing files, repair attempts appeared hung with weak progress visibility, and the run depended on child-process lifecycle, session-file, and patch-import machinery that is hard to reason about.

After this refactor, a user should still be able to run `/productionize auto` and watch the existing productionize panel drive branch, commit, push, PR, CI, merge, and return. The difference is that a repairable failure will enter a guarded repair mode inside the user’s existing Pi session, still using a temporary worktree for isolation, then resume productionize from the same session without a background side worker. Reliability is the top priority.

## Definition of Done

The refactor is complete when `/productionize auto` no longer depends on a side Pi subprocess, side-session JSONL file, or patch export/import handoff for version-one repair flows. Instead, when a supported auto-repair failure happens, the current Pi session enters an explicit repair mode bound to a temporary git worktree, shows inline repair progress in the productionize panel, blocks unsafe remote-mutation paths during repair, and then resumes the documented checkpoint matrix in the same session.

Version one must cover the highest-value repairable steps first: `commit`, `push`, and `ci`. Plain `/productionize` must keep its current manual fix-preview behavior. Repair mode must preserve the temporary-worktree isolation boundary, must never push, merge, mutate PRs, or invoke GitHub directly while repair mode is active, and must hard-stop with a clear summary rather than hang indefinitely.

The integrated proof is a disposable GitHub repository run where `/productionize auto` hits one intentionally repairable failure in the supported scope, enters same-session repair mode, makes a targeted fix in the temporary worktree, resumes from the documented safe checkpoint, and reaches a merged PR without relying on a side-session transcript. The proof is stronger than unit tests because it exercises the real TUI command, temp-worktree lifecycle, guard behavior, resume logic, and GitHub workflow together.

## Spec Sequence

1. `spec-01-same-session-contracts.md` defines the new same-session auto-mode contracts, reduced persistence shape, supported failure scope, and explicit migration boundaries before workflow code changes begin.
2. `spec-02-repair-mode-and-worktree.md` adds the in-process repair-mode controller, temporary-worktree lifecycle, and runtime guards that replace the side subprocess and patch-import path.
3. `spec-03-workflow-and-panel-cutover.md` rewires `/productionize auto` to use the new repair mode for `commit`, `push`, and `ci`, updates panel visibility, preserves plain `/productionize`, and lands the checkpoint resume behavior.
4. `spec-04-proof-and-cleanup.md` proves the end-to-end behavior in automated and disposable-repository flows, then removes obsolete side-session machinery once the new path is validated.

This order matters because the existing implementation spreads auto-mode behavior across `index.ts`, `workflow.ts`, `panel.ts`, `auto.ts`, and `repair-runner.ts`. The refactor needs crisp contracts first, then a replacement repair engine, then the workflow cutover, and only then deletion of obsolete code.

## Progress

- [x] (2026-06-05T00:00Z) Read the self-contained `create-specs` guidance in `/Users/isaaclyon/.pi/agent/skills/create-specs/SPECS.md` and `/Users/isaaclyon/.pi/agent/skills/create-specs/PLANS.md`.
- [x] (2026-06-05T00:00Z) Verified that this repository does not contain project-local `.agent/SPECS.md` or `.agent/PLANS.md` overrides.
- [x] (2026-06-05T00:00Z) Inspected the current implementation in `agent/extensions/productionize/index.ts`, `workflow.ts`, `panel.ts`, `auto.ts`, and `repair-runner.ts`, plus the earlier auto-mode plan folder under `docs/plans/2026-06-04-productionize-auto-mode/`.
- [x] (2026-06-05T00:00Z) Completed the mandatory five-batch discovery interview mechanically as 20 `ask_user_question` prompts across five sequential batches.
- [x] (2026-06-05T00:00Z) Recorded reduced-discovery constraints because only the first interview answer arrived in time; the remaining architectural choices in this plan use explicit recommended defaults.
- [x] (2026-06-05T00:00Z) Attempted the required read-only reviewer subagent twice (`productionize-spec-review`, then `productionize-spec-review-retry`); both runs stalled without returning feedback, so this plan now records the missing-review constraint explicitly and proceeds with manual self-review.
- [x] (2026-06-05T00:00Z) Performed a manual feasibility review and tightened the plan/specs around the real same-session mechanism available in Pi: `pi.sendUserMessage()` plus `before_agent_start` / `tool_call` interception in the current session.
- [ ] Commit this plan folder as a checkpoint before implementation begins.

## Surprises & Discoveries

- Observation: the current side-session design already has two distinct reliability failures in real use: a wrong repair prompt shape and a hanging-looking repair state.
  Evidence: the current implementation had to be patched so `buildRepairPrompt()` stopped using the manual handoff prompt builder, and `repair-runner.ts` needed a timeout because a wedged subprocess could leave the panel in `status: running` indefinitely.

- Observation: the repository’s auto-mode persistence model is currently shaped around side-session artifacts such as `sessionFile`, `childToken`, `spawnTimestamp`, `pid`, and `verifiedCommand`.
  Evidence: `agent/extensions/productionize/auto.ts` stores those fields on `ActiveRepairState`, and `repair-runner.ts` uses them for orphan verification and child relaunch.

- Observation: the productionize panel currently exposes side-worker details directly.
  Evidence: `agent/extensions/productionize/panel.ts` renders `side session: ...` and `last event: ...` inside auto step details.

- Observation: Pi already exposes the same-session building blocks this refactor needs, so a replacement architecture is feasible without session replacement.
  Evidence: `docs/extensions.md` documents `pi.sendUserMessage()` for injecting a real user turn into the current session and `before_agent_start` / `tool_call` handlers for per-turn prompt injection and runtime guard enforcement.

## Decision Log

- Decision: optimize the refactor for reliability first.
  Rationale: this was the only interview answer the user explicitly completed, and it matches the real failure mode of the current design.
  Date/Author: 2026-06-05 / coding agent.

- Decision: use same-session repair in a temporary worktree as the target architecture.
  Rationale: this preserves the most important safety boundary from the current design while deleting the highest-risk failure surface: subprocess/session orchestration and patch import.
  Date/Author: 2026-06-05 / coding agent.

- Decision: keep plain `/productionize` unchanged in version one.
  Rationale: the current user pain is specifically about `/productionize auto`, and changing manual mode at the same time would widen risk without helping the primary reliability goal.
  Date/Author: 2026-06-05 / coding agent.

- Decision: version one same-session repair scope is `commit`, `push`, and `ci` failures only.
  Rationale: these are the most common code-fixable failures and are the easiest to reason about with a bounded checkpoint matrix. Merge-conflict and PR-state recovery can remain explicit non-goals for this plan.
  Date/Author: 2026-06-05 / coding agent.

- Decision: keep local validation narrowly focused during repair mode.
  Rationale: reliability beats breadth. Allow only targeted local checks tied to the failing path, not unrestricted full-suite validation inside repair mode.
  Date/Author: 2026-06-05 / coding agent.

- Decision: if repair mode cannot produce a credible fix or times out, stop auto mode with a concise summary and preserve edits rather than auto-reverting them.
  Rationale: silent rollback would hide useful work and make recovery harder. Reliability here means clear state and easy human takeover.
  Date/Author: 2026-06-05 / coding agent.

- Decision: phase the migration in two steps: cut over `/productionize auto` first, then delete obsolete side-session code after proof passes.
  Rationale: this keeps the main behavior change isolated from cleanup so the first pass can be proven before code deletion obscures the rollback path.
  Date/Author: 2026-06-05 / coding agent.

- Decision: implement same-session repair by sending a repair prompt into the current session with `pi.sendUserMessage()` and enforcing repair-mode boundaries via in-process `before_agent_start` and `tool_call` handlers.
  Rationale: this is the concrete mechanism Pi already supports today; it avoids inventing a nonexistent “switch the current session cwd” API and removes the side-session subprocess without giving up hard runtime guards.
  Date/Author: 2026-06-05 / coding agent.

## Outcomes & Retrospective

At planning time, no implementation work for same-session repair mode has landed yet. The current code still uses the side-session architecture in `agent/extensions/productionize/repair-runner.ts` and related `auto.ts` state. This section should be updated after implementation and proof.

## Context and Orientation

The current auto-mode entry point lives in `agent/extensions/productionize/index.ts`. It reconstructs persisted state on `session_start`, launches the custom productionize panel, and calls `runWorkflow()`.

Pi already provides two key same-session primitives that the refactor should use directly. `pi.sendUserMessage()` can inject a real user message into the current active session and trigger an agent turn without switching sessions. `before_agent_start` and `tool_call` handlers can inject repair-mode instructions into that turn and block or rewrite unsafe tool calls while the repair mode flag is active. The plan should build on those real primitives rather than assuming the extension can magically retarget the whole session cwd.

The real workflow lives in `agent/extensions/productionize/workflow.ts`. That file owns the productionize checkpoints (`branch`, `commit`, `push`, `pr`, `ci`, `merge`, `return`), classifies failures as recoverable or unrecoverable, generates repair prompts, launches repair attempts, persists summaries, invalidates downstream state, and resumes after repair.

The serializable auto-run state lives in `agent/extensions/productionize/auto.ts`. Today it stores side-session fields like `sessionFile`, `childToken`, `spawnTimestamp`, `pid`, `verifiedCommand`, `tempWorktree`, and `lastSeenEventType`. Those fields exist because the repair worker is external.

The current replacement repair engine lives in `agent/extensions/productionize/repair-runner.ts` plus `repair-guard.ts`. It creates a detached temporary worktree, spawns `pi --mode json`, strips GitHub auth from the child environment, listens to JSON events, stages child edits, exports a binary-safe patch, and asks the foreground workflow to import that patch back into the main worktree.

The panel lives in `agent/extensions/productionize/panel.ts`. It currently assumes that auto repair is a side-worker concept and renders `side session` and `last event` details. Same-session repair mode will need different visibility: it should show that the current session is in guarded repair mode, the current attempt count, the last local validation or guard event, and whether productionize is about to resume.

The previous plan folder at `docs/plans/2026-06-04-productionize-auto-mode/` is important context, but this new plan intentionally supersedes one of its core architectural decisions. The earlier plan insisted on a side repair agent with a separate persisted session and a patch-import boundary. This new plan keeps only the temp-worktree and no-remote-mutation safety goals while removing the side-session requirement.

## Plan of Work

First, simplify the contracts. Replace side-session-specific persisted fields in `agent/extensions/productionize/auto.ts` with same-session repair-mode state that describes what the foreground session is doing now: current repair step, attempt count, active temp-worktree path, guarded mode status, last visible repair action, timeout metadata, and the resume checkpoint. Keep only the minimum persistence needed to survive reload and reconstruct the panel. Update the plan and tests so unsupported steps (`pr`, `merge`, `return`, and unrecoverable prerequisites) stay on the manual-stop path.

Second, add an in-process repair-mode controller. The new module should own creation and cleanup of the temporary worktree, activation of a repair-mode flag, injection of the repair prompt into the current session with `pi.sendUserMessage()`, collection of the resulting repair summary, running only narrowly-scoped local validation commands when allowed, and surfacing structured repair progress back to `workflow.ts` and `panel.ts`. This controller replaces the subprocess runner and patch import machinery. It must expose an explicit guard layer through the current extension process so repair mode cannot recurse into `/productionize*`, cannot invoke GitHub commands, cannot push or merge, cannot mutate PR state, and cannot read or write outside the active temp worktree.

Third, rewire the workflow and panel. `workflow.ts` should call the same-session repair controller instead of `repair-runner.start()` for supported repair steps. The existing resume matrix must remain explicit, but version one only needs to route `commit`, `push`, and `ci` into repair mode. `index.ts` should keep auto-mode reconstruction, but it should no longer need child-PID reconciliation or side-session relaunch. `panel.ts` should replace side-session details with same-session repair-mode details such as `repair mode active`, `attempt 1/3`, `last action`, `timed out`, or `ready to resume from commit`.

Fourth, prove the cutover, then remove dead code. Once the same-session path is working in focused automated tests and the disposable-repository proof passes, delete obsolete side-session machinery such as patch import/export helpers, JSON child-process event parsing, child-session persistence fields, and side-session wording in the panel and summaries. Keep the git temp-worktree helpers that are still useful to the new architecture.

## Validation and Acceptance

Automated validation must prove the same-session path, not just the pure helpers. The minimum focused test command should become:

    cd /Users/isaaclyon/.pi
    node --test \
      agent/extensions/productionize/core.test.ts \
      agent/extensions/productionize/auto.test.ts \
      agent/extensions/productionize/repair-mode.test.ts \
      agent/extensions/productionize/workflow-auto.test.ts \
      agent/extensions/productionize/workflow-auto.integration.test.ts

Expected focused proof:

- `repair-mode.test.ts` proves temp-worktree creation, guard enforcement, bounded timeout handling, and focused-local-validation behavior;
- `workflow-auto.test.ts` proves supported failures enter same-session repair mode and unsupported failures do not;
- `workflow-auto.integration.test.ts` proves a supported failure can repair, resume from the explicit matrix, and invalidate downstream state correctly when `HEAD` changes;
- no test depends on a side-session JSONL file existing.

Required integrated proof after `/reload`:

    /productionize auto

In a disposable GitHub repository with one intentionally repairable failing check, the operator should observe these concrete states in one foreground session: productionize opens or reuses the PR, a supported failure moves the panel into repair mode, the same session edits files in a temporary worktree, focused local validation succeeds or is skipped according to the failure type, productionize resumes from the documented checkpoint, CI goes green on the repaired head, and the PR squash-merges. No side-session path or patch import step should be involved.

## Idempotence and Recovery

Repair mode must be safe to restart after `/reload`. Because the repair worker is no longer a separate process, reconstruction should not attempt child-PID verification or relaunch. Instead, persisted state should tell the session whether a temp-worktree-backed repair attempt was in progress, whether it had already produced edits, whether it had timed out, and what checkpoint productionize should rerun or stop at after reconstruction.

Temporary worktree lifecycle must be idempotent. If the same repair attempt is reconstructed and its temp worktree still exists, reuse it only if the recorded branch head and base branch still match the persisted metadata. Otherwise, stop auto mode safely and leave the recorded repair edits intact for manual takeover.

If repair mode stops after making edits but before productionize can resume safely, preserve those edits in the user-visible working state and explain why automatic resume stopped. Do not auto-revert or silently stash them.

## Artifacts and Notes

Discovery interview record for this plan:

- Batch 1 asked four questions. The user answered only one: optimize for reliability first.
- Batches 2 through 5 were still issued to satisfy the required 20-question interview protocol, but no further answers arrived in time.
- Because the user neither rejected the interview nor supplied alternative answers, this plan adopts the recommended defaults from the interview options. Those defaults are now explicit decisions in this document.

Recommended-default decisions captured from reduced discovery:

- same-session repair in a temporary worktree;
- keep the productionize panel visible;
- keep local-only repair restrictions with targeted local validation;
- stop with a concise summary when repair fails or times out;
- keep audit history in the main session rather than a side-session file;
- scope version one to `commit`, `push`, and `ci`;
- keep plain `/productionize` unchanged;
- preserve edits on unsafe-resume stop;
- use a fixed resume matrix;
- require a hard timeout;
- require disposable-GitHub integrated proof;
- remove old side-session code only after the new path is proven.

Relevant files for implementation:

- `agent/extensions/productionize/index.ts`
- `agent/extensions/productionize/workflow.ts`
- `agent/extensions/productionize/panel.ts`
- `agent/extensions/productionize/auto.ts`
- `agent/extensions/productionize/types.ts`
- `agent/extensions/productionize/repair-runner.ts`
- `agent/extensions/productionize/repair-guard.ts`
- `agent/extensions/productionize/workflow-auto.test.ts`
- `agent/extensions/productionize/workflow-auto.integration.test.ts`
- `agent/extensions/productionize/repair-runner.test.ts`

## Interfaces and Dependencies

The refactor should keep using the Pi extension runtime from `@earendil-works/pi-coding-agent` and the existing productionize panel entrypoint. It should stop depending on `pi --mode json` child-process behavior for repair execution. The key runtime APIs are `pi.sendUserMessage()` for starting the repair turn in the current session and `before_agent_start` / `tool_call` handlers for repair-mode prompt injection plus guard enforcement. If a small helper module is needed to model repair-mode commands or status events, keep it local to `agent/extensions/productionize/` and test it directly.

The target interfaces should look more like this than the current subprocess design:

    interface SameSessionRepairState {
      stepId: StepId;
      attempt: number;
      maxAttempts: number;
      status: "starting" | "editing" | "validating" | "resuming" | "failed" | "cancelled";
      tempWorktree: string;
      headShaBefore: string;
      baseBranch: string;
      baseShaBefore: string;
      lastAction?: string;
      resumeCheckpoint?: StepId;
      timeoutAt?: string;
      errorMessage?: string;
    }

    interface SameSessionRepairController {
      start(input: SameSessionRepairInput): Promise<SameSessionRepairResult>;
      abort(): void;
    }

`SameSessionRepairResult` should carry only foreground-session data: whether edits were made, whether validation ran, whether the attempt timed out or failed, the resulting `HEAD` SHA if it changed, and a concise summary string suitable for the main session log.

## Revision Notes

This new plan supersedes the side-session architectural assumption in `docs/plans/2026-06-04-productionize-auto-mode/ExecPlan.md`. That earlier plan should remain as historical context, but the implementation work from this plan should update the code toward same-session repair mode instead of hardening the side-session model further.
