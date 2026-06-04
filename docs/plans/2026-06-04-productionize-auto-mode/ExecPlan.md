# Add unattended auto-repair mode to `/productionize`

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This repository does not have project-local `.agent/PLANS.md` or `.agent/SPECS.md` overrides, so this plan follows the self-contained guidance in `/Users/isaaclyon/.pi/agent/skills/create-specs/PLANS.md` and `/Users/isaaclyon/.pi/agent/skills/create-specs/SPECS.md`.

## Purpose / Big Picture

The user wants a hands-off `/productionize auto` mode that keeps driving a branch to final merge. When `/productionize` hits a recoverable failure, it should automatically generate a repair handoff, run a side repair agent, return to the same productionize checkpoint, and continue until the pull request merges or a clear stop rule is hit. The user should not need to manually paste repair prompts back into Pi during the happy path.

After this change, a user can run `/productionize auto` in a disposable GitHub repository with at least one real check and watch the existing productionize panel continue through branch, commit, push, pull request, CI, repair attempts, and merge. Recoverable failures should trigger up to three autonomous repair loops per `step + HEAD SHA`, while unrecoverable prerequisite failures should stop immediately with a manual-fix summary.

## Definition of Done

The feature is complete when all of the following are true:

`/productionize auto` is accepted as the canonical entry point for unattended mode, uses the current Pi session model for the side repair agent, persists auto-run state in session custom entries, shows inline repair-loop status in the productionize panel, and automatically launches a side repair agent with a generated handoff prompt whenever a recoverable productionize checkpoint fails.

The side repair agent must run without stealing the visible productionize session, must leave an inspectable side-session audit trail plus a compact repair summary message in the main productionize session, and must be mechanically unable to talk to GitHub or push or merge remotely. It may only read files and edit code in its temporary worktree. The foreground productionize workflow remains the only actor allowed to validate, commit to the canonical branch head, push, update the PR, poll CI, and merge. After each repair attempt, productionize must rerun the nearest safe checkpoint instead of trusting the repair agent’s self-report. If the branch head changed, downstream PR, CI, merge, and return state must be invalidated and recomputed.

Auto mode must stop after three retries for the same `step + HEAD SHA` key, or immediately on unrecoverable prerequisites such as “not a git repository”, detached HEAD, missing GitHub auth, or a non-GitHub remote. Cancellation must abort both the foreground productionize workflow and any active side repair process.

The integrated proof is a disposable GitHub repository with one intentionally failing check where the operator runs `/productionize auto`, productionize opens or reuses a PR, a recoverable failure triggers the side repair agent, that agent produces a local repair result, the foreground workflow imports it and performs the normal commit or push steps, productionize reruns the safe checkpoint, CI turns green, and the PR squash-merges while retaining the side-session audit trail and a summary in the main session.

## Spec Sequence

1. `spec-01-auto-contracts-and-runner.md` defines the new auto-mode contracts, retry accounting, persistence schema, and background repair-runner abstraction in small testable modules before the main workflow changes.
2. `spec-02-auto-panel-and-session-state.md` wires `/productionize auto` into command parsing, panel rendering, cancellation, and session reconstruction so the user-facing shell exists before repair orchestration is added.
3. `spec-03-auto-repair-loop.md` integrates recoverable-failure detection, handoff generation, side-agent execution, checkpoint reruns, and downstream invalidation into the real workflow.
4. `spec-04-integration-proof.md` adds focused automated integration coverage and records the disposable-repository end-to-end proof that shows the feature reaches real merge behavior rather than just passing unit tests.

This order matters because the current `agent/extensions/productionize/workflow.ts` is already large, so the first spec must carve out crisp seams before the workflow learns auto-repair behavior.

## Progress

- [x] (2026-06-04T21:07Z) Inspected the current repository state, including `agent/extensions/productionize/`, `agent/extensions/ci-watch/`, and the earlier productionize plan folder.
- [x] (2026-06-04T21:07Z) Read the self-contained `create-specs` guidance plus Pi extension and TUI documentation relevant to commands, session replacement, custom UI, session persistence, and JSON subprocess execution.
- [x] (2026-06-04T21:07Z) Completed the mandatory five-batch discovery interview with 20 questions and captured the resulting product decisions in this plan.
- [x] (2026-06-04T21:07Z) Pressure-tested this plan folder with a read-only reviewer subagent and incorporated the resulting findings around resume semantics, child safety boundaries, path confinement, and deterministic patch import.
- [ ] Commit `docs/plans/2026-06-04-productionize-auto-mode/` as the pre-implementation checkpoint.

## Surprises & Discoveries

- Observation: `ctx.newSession()` and related session-replacement APIs are foreground session switches, not background workers.
  Evidence: `docs/extensions.md` says `withSession` runs only after the old session shuts down and the replacement session is rebound, which would tear down the visible productionize panel.

- Observation: The existing productionize implementation currently lives mostly in `agent/extensions/productionize/workflow.ts`, which is already about 700 lines long.
  Evidence: repository inspection showed `workflow.ts` is substantially larger than the other productionize modules, so auto mode should be split into new helper files instead of extending that file monolithically.

- Observation: Pi already documents two useful building blocks for this feature: persisted custom session entries via `pi.appendEntry(...)` and background-style agent execution via a separate `pi` JSON subprocess.
  Evidence: `docs/extensions.md` documents `pi.appendEntry(...)`, and the shipped `examples/extensions/subagent/` example spawns `pi --mode json` child processes and streams their events.

## Decision Log

- Decision: Treat `/productionize auto` as the canonical command syntax in version one.
  Rationale: The user explicitly chose a command argument rather than a separate command or panel-only toggle.
  Date/Author: 2026-06-04 / coding agent.

- Decision: Key the retry budget by `workflow step + branch HEAD SHA`, with a hard limit of three repair attempts.
  Rationale: The user wants bounded retries, and a new commit should reset the budget because it represents a materially different repair state.
  Date/Author: 2026-06-04 / coding agent.

- Decision: Keep the visible productionize panel in the foreground and run the repair agent in a separate persisted Pi subprocess rather than via `ctx.newSession()`.
  Rationale: The user asked for background summaries plus a side agent “or something like that”. Pi’s session-replacement API cannot satisfy that requirement without destroying the current session UI, so a separate subprocess is the smallest viable interpretation.
  Date/Author: 2026-06-04 / coding agent.

- Decision: Narrow the side repair agent’s authority to read and edit operations only; validation, commit, push, PR mutation, CI polling, and final merge actions remain owned by the foreground productionize workflow.
  Rationale: The user originally preferred broader git powers for repair, but any child with shell or remote authority weakens the unattended safety guarantee. Keeping all execution and remote mutation in foreground productionize preserves a hard safety boundary while still achieving hands-off repair and resume.
  Date/Author: 2026-06-04 / coding agent.

- Decision: After a repair attempt, productionize must rerun the nearest safe checkpoint and invalidate downstream state when HEAD changes.
  Rationale: The user rejected trusting agent self-report and asked to resume from the nearest safe checkpoint, not blindly continue.
  Date/Author: 2026-06-04 / coding agent.

- Decision: Unrecoverable prerequisites stay manual-stop failures in auto mode.
  Rationale: The user explicitly chose “stop with prompt” for missing GitHub auth, non-GitHub remotes, and similar environment problems.
  Date/Author: 2026-06-04 / coding agent.

- Decision: Auto mode will not broaden scope to change the current CI policy beyond repair-loop behavior.
  Rationale: The request is about unattended repair and resume. Changing productionize’s broader CI gating semantics is separate work and would muddy this feature slice.
  Date/Author: 2026-06-04 / coding agent.

## Outcomes & Retrospective

Planning is complete enough to start implementation once the reviewer pass and checkpoint commit are done. The major design risk is not user intent but API shape: background repair work cannot use the foreground session-replacement helpers. The plan resolves that by using a persisted side-session subprocess while preserving the requested user-facing behavior.

Implementation is expected to add new productionize helper modules, new tests, and session-persistence behavior, but should not require changes outside `agent/extensions/productionize/` and this plan folder.

## Context and Orientation

The current extension lives under `agent/extensions/productionize/`.

- `index.ts` registers the `/productionize` command, opens the custom panel, and pastes a manual fix instruction back into the editor when the user presses `F`.
- `workflow.ts` owns the real git, GitHub CLI, and Spark-driven workflow steps: branch, commit, push, pull request, CI polling, merge, and return.
- `panel.ts` renders the full-screen progress UI and currently knows only about success, failure, cancellation, and the manual fix path.
- `types.ts` defines the shared workflow state.
- `core.ts` and `core.test.ts` hold pure helpers for parsing, formatting, and failure-prompt generation.

The current behavior stops on failure, generates a Spark repair instruction, and waits for the user to press `F` so the instruction is pasted into the main editor. There is no auto mode, no persisted retry state, no side repair worker, and no checkpoint resume machine.

The related `agent/extensions/ci-watch/index.ts` extension demonstrates session persistence with `pi.appendEntry(...)`. The local `agent/extensions/handoff.ts` extension demonstrates handoff-prompt generation, but it uses `ctx.newSession()` and editor prefill, which is not suitable for a background repair worker because it replaces the current session.

Terms used throughout this plan are concrete. “Current Pi session model” means the model currently selected in the foreground `ExtensionCommandContext` and passed into the side repair subprocess as its `--model` choice. “Productionize checkpoint” means one of the concrete workflow step IDs in `DEFAULT_STEPS`: `branch`, `commit`, `push`, `pr`, `ci`, `merge`, or `return`. “Nearest safe checkpoint” means the exact step the foreground workflow must rerun after a repair attempt according to the resume matrix below, never a free-form judgment call.

The implementation should keep `workflow.ts` from growing further. Add new files for auto-mode state and repair-runner behavior instead of burying the new state machine inside the existing workflow module.

## Plan of Work

First, add a small pure helper module for auto-mode contracts. That module should parse `/productionize auto`, describe serializable retry and checkpoint state, generate retry keys from `step + HEAD SHA`, reset downstream step state after a branch-head change, and translate persisted custom entries back into in-memory state. Pair it with focused unit tests.

Second, add a repair-runner module that can launch a separate Pi subprocess in JSON mode with a dedicated session file, stream status back into the foreground workflow, and kill the child cleanly on cancel. The runner should accept a generated handoff prompt, the current session model, and the target repository `cwd`. It should emit compact progress summaries and a final result object that the foreground workflow can persist. The runner must also enforce a hard safety boundary for the child by running in a temporary worktree for the current feature branch with GitHub credentials removed and a child-only guard extension that allows only `read`, `edit`, and `write` tool calls. The child may produce a local diff only. After the child exits, the foreground workflow should deterministically export that worktree delta by first running `git add -A` in the temp worktree, then capturing `git diff --cached --binary --full-index HEAD` so newly created files, deletes, and binary hunks are preserved. Apply that patch back into the canonical worktree with `git apply --index --3way`. If staging, patch export, or patch apply fails, auto mode must stop with an explicit import failure instead of guessing. The foreground workflow should then run validation itself and continue with the normal `commit`/`push`/`pr` checkpoints. It should also verify that the PR is still unmerged and that the snapshotted base-branch SHA did not advance before it resumes normal productionize steps.

Third, extend the productionize state, panel, and command handler. The command parser should recognize `/productionize auto`. The state should track whether auto mode is active, the current repair attempt, the side-session file or identifier, retry counts, and whether the current run was reconstructed from session entries after reload. Add a resumable foreground run controller that owns the checkpoint machine outside the one-shot command callback so `session_start` can recreate the panel and continue the run from persisted state after `/reload` or restart. The panel should show repair-loop status inline under the active step, not as a new top-level step.

Fourth, integrate the auto-repair loop into the real workflow. Recoverable failures should route through the repair runner, append persisted state updates, wait for the side agent to finish, summarize the attempt back into the main session, recalculate the safe resume checkpoint, invalidate downstream PR/CI/merge/return state when HEAD changed, and rerun the checkpoint. Unrecoverable prerequisite failures should skip the repair runner and stop immediately.

Use this explicit resume matrix so the implementation cannot guess:

- `branch` failure: rerun `branch`; clear `commit`, `push`, `pr`, `ci`, `merge`, `return`, PR metadata, and displayed checks.
- `commit` failure: rerun `commit`; if HEAD changed unexpectedly, still clear `push`, `pr`, `ci`, `merge`, `return`, PR metadata, and displayed checks.
- `push` failure: rerun `push`; if HEAD changed, clear `pr`, `ci`, `merge`, `return`, PR metadata, and displayed checks.
- `pr` failure: rerun `pr`; always clear stored PR metadata, `ci`, `merge`, `return`, and displayed checks.
- `ci` failure: if HEAD is unchanged, rerun `ci`; if HEAD changed, rerun `push` and then `pr`/`ci`, clearing `pr`, `ci`, `merge`, `return`, PR metadata, and displayed checks first.
- `merge` failure: if HEAD is unchanged, rerun `merge`; if HEAD changed, rerun `push` and then `pr`/`ci`/`merge`, clearing `pr`, `ci`, `merge`, `return`, PR metadata, and displayed checks first.
- `return` failure: rerun `return` when HEAD is unchanged; if HEAD changed, rerun `push` and then downstream `pr`/`ci`/`merge`/`return` with full downstream invalidation.

Finally, prove the feature. Add a focused automated integration test around the resume state machine plus a semi-real repository flow with real git transitions, then run a disposable GitHub-repository scenario with one failing check that the side agent can fix. Record the proof and any remaining manual-only risks in this plan.

## Validation and Acceptance

Automated validation should include the existing helper tests plus new focused tests for auto-mode contracts, repair-runner event parsing, workflow retry decisions, and one mocked integration path.

Run from `/Users/isaaclyon/.pi/.worktrees/productionize-auto`:

    node --test \
      agent/extensions/productionize/core.test.ts \
      agent/extensions/productionize/auto.test.ts \
      agent/extensions/productionize/repair-runner.test.ts \
      agent/extensions/productionize/workflow-auto.test.ts \
      agent/extensions/productionize/workflow-auto.integration.test.ts

Expected automated proof:

- all listed tests pass with zero failures;
- retry keys reset when HEAD changes;
- downstream PR/CI/merge state is cleared when the repair agent creates a new commit;
- unrecoverable prerequisites do not launch a repair subprocess;
- cancellation aborts both the foreground workflow and child repair process.

Required manual integrated proof after `/reload`:

    /productionize auto

In a disposable GitHub repository that has at least one real failing check, the panel should stay visible, show an inline repair attempt, launch a side repair agent automatically, log a compact repair summary in the main session, rerun the nearest safe checkpoint, observe green CI on the new head SHA, and squash-merge the PR. This manual run is the acceptance proof named in `Definition of Done`.

## Idempotence and Recovery

Auto mode must be safe to rerun. Persist only serializable run state in session custom entries so reloads and restarts can reconstruct status. If the foreground session restarts while a repair attempt is active, the implementation must reconcile it deterministically without live reattachment: persist child PID when available, child spawn timestamp, a stable random child token embedded in the session file and temp-worktree names, attempt number, handoff prompt, and last-seen event timestamp; on the next `session_start`, verify that the PID still belongs to the expected Pi child by matching the tokenized session or worktree path plus the recorded spawn time before sending a signal. Only then kill it to avoid duplicate workers, append an “interrupted” summary, and relaunch exactly one replacement child for the same checkpoint using the persisted prompt and attempt metadata.

Checkpoint reruns must be idempotent. Re-running `push`, `pr`, or `ci` after a repair attempt should prefer refresh and reuse over duplicate creation. If the side repair agent already pushed a new commit, the foreground workflow should update PR and CI state against the new head rather than assuming prior results still apply.

Cancellation should kill the active child process where possible and record that the run was cancelled. Side-session files should be kept for audit even when the main run stops.

## Artifacts and Notes

Discovery interview outcomes that materially constrain this plan:

- optimize for hands-off merge;
- canonical entry point is `/productionize auto`;
- use a side agent with a generated handoff prompt;
- resume from the nearest safe checkpoint;
- stop after bounded retries keyed by `step + SHA`;
- trigger auto repair for most step failures, not for unrecoverable prerequisites;
- use the current session model for repair work;
- persist run state in session entries;
- keep the side session for audit and emit a compact summary into the main session.

One planned adaptation intentionally narrows the requested authority model: the side agent does not keep remote push or merge powers because that cannot be made mechanically safe enough for unattended operation with unrestricted shell access.

Relevant files for implementation:

- `agent/extensions/productionize/index.ts`
- `agent/extensions/productionize/workflow.ts`
- `agent/extensions/productionize/panel.ts`
- `agent/extensions/productionize/types.ts`
- `agent/extensions/productionize/core.ts`
- `agent/extensions/ci-watch/index.ts`
- `agent/extensions/handoff.ts`

## Interfaces and Dependencies

Use the existing Pi extension API from `@earendil-works/pi-coding-agent`, the existing Spark completion path from `@earendil-works/pi-ai`, and plain child-process spawning for the side repair worker. The side worker should be a normal Pi process launched in JSON mode with a dedicated session file so the result is inspectable later.

The foreground workflow needs new interfaces roughly shaped like this:

    interface ProductionizeRunOptions {
      auto: boolean;
    }

    interface AutoRetryState {
      key: string;              // `${stepId}:${headSha}`
      attempts: number;
      lastSessionFile?: string;
      lastPrompt?: string;
    }

    interface RepairAttemptSummary {
      stepId: StepId;
      headShaBefore: string;
      headShaAfter?: string;
      baseBranch: string;
      baseShaBefore: string;
      sessionFile: string;
      summary: string;
      outcome: "succeeded" | "failed" | "cancelled";
    }

    interface RepairRunner {
      start(input: RepairRunnerInput): Promise<RepairAttemptSummary>;
      abort(): void;
    }

    interface ProductionizeRunController {
      start(input: ProductionizeRunOptions): Promise<void>;
      resumeFromPersistedState(): Promise<void>;
      abort(): void;
    }

    interface RepairSummaryEntry {
      stepId: StepId;
      attempt: number;
      headShaBefore: string;
      headShaAfter?: string;
      outcome: "succeeded" | "failed" | "cancelled";
      sessionFile: string;
      persistedAt: string;
    }

The child-process protocol must at minimum capture the session header event, assistant `message_end` events, tool execution end events, and terminal success or failure so the foreground workflow can show progress, keep the side-session file path, and distinguish retryable failure from abort. The child must run under a stronger sandbox than prompt instructions alone: launch the subprocess with only `read`, `edit`, and `write` tools enabled, then add a child-only extension that intercepts `input` and `tool_call` events to block `/productionize*` user messages and enforce path confinement. Those file tools must be confined to the temporary worktree root after symlink and `realpath` resolution for existing paths, plus canonical parent-directory checks for new write targets, and they must explicitly reject any path inside the temp worktree’s `.git/` directory. That prevents absolute paths or `..` escapes from reaching the parent repository, home directory, or git metadata internals. There is no child `bash`, no child `gh`, and no remote-capable command surface at all. The guard layer must expose enough structured information for tests to prove that recursive productionize commands, non-allowlisted tool attempts, path escapes, and `.git/` writes are blocked.

The exact file names can differ if the implementation stays equally small and testable, but the responsibilities must remain separated: pure auto-state logic, child repair-runner logic, and foreground workflow integration.
## Revision Notes

- 2026-06-04 / coding agent: Created this new ExecPlan and atomic spec sequence for unattended productionize auto mode after a full 20-question discovery interview, repository inspection, and Pi extension-doc review. The main revision-driving discovery was that background repair work cannot use `ctx.newSession()` without replacing the visible productionize session, so the plan now targets a persisted side-process repair worker instead.