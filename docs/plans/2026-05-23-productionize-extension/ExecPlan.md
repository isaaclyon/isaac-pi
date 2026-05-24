# Build the productionize Pi extension

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This repository does not have project-local `.agent/` planning guidance, so this plan follows the self-contained guidance in `agent/skills/create-specs/PLANS.md` and `agent/skills/create-specs/SPECS.md`.

## Purpose / Big Picture

The user wants a Pi extension named `productionize` that turns the current repository state into a merged GitHub pull request with minimal manual work. After this change, a user can type `/productionize` in Pi and see a full-screen progress tracker that branches if needed, commits dirty files, pushes, opens a PR, polls GitHub checks as todo boxes, squash-merges on green CI, and shows a generated fix instruction preview if any step fails.

The extension is intentionally user-level and lives under `agent/extensions/productionize/`. It should run from whatever project Pi is currently editing, using that session's `ctx.cwd` as the target Git repository.

## Definition of Done

The feature is complete when `/productionize` is auto-discovered by Pi and implements the agreed behavior from the 20-question clarification round: slash command trigger, full-screen panel, autopilot mutations, commit all dirty files, branch from local `main` or `master` only when needed, reuse existing non-main branches, generate conventional branch names and commit messages with `openai-codex/gpt-5.3-codex-spark`, push with upstream-aware behavior, use GitHub CLI for PR creation, create deterministic PR bodies grouped by directory, poll GitHub Checks, auto squash-merge with remote branch deletion on green CI, and offer a Fix button that pastes generated Pi instructions into the editor on failure.

A developer must be able to run the focused Node tests for the productionize helper logic and see them pass. Manual acceptance is that Pi can be reloaded, `/productionize` appears as a command, invoking it in a GitHub checkout opens the productionize panel rather than sending the text to the model, and the full happy path is exercised in a disposable GitHub repository with at least one real check before claiming end-to-end success.

## Spec Sequence

1. `spec-01-core-workflow.md` creates the deterministic, testable workflow helpers for git status parsing, branch-name sanitization, PR body formatting, check-state classification, and fix prompt construction.
2. `spec-02-extension-tui.md` wires the helpers into a Pi slash command with a full-screen custom component and the actual git, GitHub CLI, and Spark model operations.
3. `spec-03-validation-and-reload.md` validates the helper tests, inspects extension loading constraints, and records any remaining manual verification steps.

The specs should be implemented in order because the extension UI should call stable helper functions instead of embedding fragile parsing and formatting directly in the component.

## Progress

- [x] (2026-05-24T04:35Z) Asked and recorded 20 structured product questions. The selected answers define the extension behavior in this plan.
- [x] (2026-05-24T04:35Z) Updated the global `create-specs` skill to include self-contained `PLANS.md` and `SPECS.md` guidance copied from `Developer/lola-data-platform` and committed that guidance change.
- [x] (2026-05-24T04:35Z) Read Pi extension and TUI documentation plus relevant examples for commands, custom UI components, model calls, editor text insertion, GitHub CLI autocomplete, and existing CI watch behavior.
- [x] (2026-05-24T04:35Z) Ran a read-only reviewer subagent pressure test and incorporated the accepted findings into this ExecPlan and the atomic specs.
- [x] (2026-05-24T04:35Z) Implemented Spec 1 helper logic and tests in `agent/extensions/productionize/core.ts` and `core.test.ts`.
- [x] (2026-05-24T04:35Z) Implemented Spec 2 extension command, full-screen TUI, Spark helpers, git/PR/CI/merge workflow, and failure paste path under `agent/extensions/productionize/`.
- [x] (2026-05-24T04:35Z) Implemented Spec 3 validation: productionize helper tests pass, CI watch regression tests pass, and Pi RPC `get_commands` discovers `/productionize`.
- [x] (2026-05-24T04:35Z) Addressed code review findings: merge now uses `--match-head-commit`, check classification prioritizes GitHub `bucket`, protected-branch reruns reuse existing local generated branches, and PR file-list generation fails on base fetch/diff errors instead of using stale refs.
- [ ] Run a disposable GitHub repository happy-path validation before claiming end-to-end branch/commit/push/PR/check/merge proof.

## Surprises & Discoveries

- Observation: The requested model name `gpt-5.3 spark` corresponds to `openai-codex/gpt-5.3-codex-spark` in this Pi installation.
  Evidence: `pi --list-models` lists `openai-codex  gpt-5.3-codex-spark`.

- Observation: Existing local extension tests can run directly through Node's test runner against `.ts` files.
  Evidence: `node --test agent/extensions/ci-watch/core.test.ts` passed 5 tests.

## Decision Log

- Decision: Use a directory-style extension at `agent/extensions/productionize/index.ts` with helper code in `core.ts` and focused tests in `core.test.ts`.
  Rationale: The workflow is large enough that pure helper logic should be testable without launching Pi, and Pi auto-discovers `agent/extensions/*/index.ts`.
  Date/Author: 2026-05-24 / coding agent.

- Decision: Treat a clean worktree as a successful no-op commit step.
  Rationale: The user asked to commit all dirty files; if there are no dirty files, failing the workflow would make productionizing an already-committed branch unnecessarily brittle.
  Date/Author: 2026-05-24 / coding agent.

- Decision: Generate AI text through `complete()` with `openai-codex/gpt-5.3-codex-spark`, falling back to deterministic text only if the Spark call cannot be made.
  Rationale: Branch names, commit messages, PR titles, and fix instructions were explicitly requested from GPT-5.3 Spark, but the extension should still surface actionable failures if auth or model lookup fails.
  Date/Author: 2026-05-24 / coding agent.

- Decision: Auto-merge only after at least one non-skipped GitHub check is discovered and every discovered non-skipped check is passing.
  Rationale: Repositories with no checks or never-starting checks should not be merged silently just because no failure was observed. The workflow should time out and show a fix prompt instead.
  Date/Author: 2026-05-24 / coding agent.

## Outcomes & Retrospective

The productionize extension is implemented and auto-discovered by Pi. The repository now contains a directory-style extension at `agent/extensions/productionize/` with focused helper tests, a full-screen progress panel, Spark-powered branch/commit/title/fix generation, git branch/commit/push workflow, GitHub CLI PR creation or reuse, GitHub Checks polling, conservative green-check merge gating, automatic squash merge with remote branch deletion, and a failure screen that pastes repair instructions into Pi's editor.

Automated validation passed for helper logic and the existing CI watch regression tests. Pi RPC `get_commands` also found `/productionize`, proving extension discovery/loading works. Full end-to-end validation in a disposable GitHub repository remains manual and intentionally was not run in this `.pi` repository because `/productionize` performs real commits, pushes, PR creation, and merge operations.

## Context and Orientation

Pi user extensions are TypeScript modules under `agent/extensions/`. Pi auto-discovers either `agent/extensions/name.ts` or `agent/extensions/name/index.ts`; the directory style is appropriate here because the extension needs helper code and tests. A slash command is registered with `pi.registerCommand("productionize", { handler })`.

A custom full-screen interaction can be built with `ctx.ui.custom()`. The component object returns `render(width)`, `handleInput(data)`, and `invalidate()`. The extension can update a state object from asynchronous work and call `tui.requestRender()` to redraw. To paste generated repair instructions into the Pi input editor after the panel closes, the command handler should call `ctx.ui.setEditorText(instruction)`.

The existing `agent/extensions/ci-watch/` extension already demonstrates using `gh pr view`, `gh pr checks`, and controller tests. The existing `agent/extensions/handoff.ts` extension demonstrates using `complete()` from `@earendil-works/pi-ai`, retrieving model auth through `ctx.modelRegistry.getApiKeyAndHeaders(model)`, and writing generated text into the editor.

## Plan of Work

First, create `agent/extensions/productionize/core.ts` with pure functions and shared types. These helpers should not call git, GitHub, Pi, or the model. They should parse status and checks, sanitize Spark outputs, format deterministic PR bodies grouped by directory, classify GitHub check buckets, compute progress counts, and build the failure prompt sent to Spark.

Second, create `agent/extensions/productionize/core.test.ts` using `node:test` and `node:assert/strict`. The tests should cover branch-name sanitization, status detection, directory grouping, check classification, and failure prompt content.

Third, create `agent/extensions/productionize/index.ts`. The command handler should require interactive UI, wait for Pi to be idle, open a custom component, and start the workflow asynchronously. The workflow should use `pi.exec()` for git and `gh` commands, `complete()` for Spark generations, and update the panel state after every step. The Fix button should close the panel with generated instructions, and the handler should then set those instructions into the editor.

Fourth, run the focused tests. If possible, run a lightweight extension-load check by asking Pi for commands after reload or by relying on TypeScript execution through Node tests. Record validation evidence in this plan.

## Validation and Acceptance

Run from `/Users/isaaclyon/.pi`:

    node --test agent/extensions/productionize/core.test.ts

The expected result is all productionize helper tests passing with zero failures. Evidence from implementation:

    node --test agent/extensions/productionize/core.test.ts
    tests 11
    pass 11
    fail 0

Regression validation also passed:

    node --test agent/extensions/productionize/core.test.ts agent/extensions/ci-watch/core.test.ts
    tests 16
    pass 16
    fail 0

Extension discovery validation passed:

    printf '{"type":"get_commands"}\n' | pi --mode rpc --no-session | grep '"name":"productionize"'
    productionize command found: yes

Manual acceptance after implementation is:

    /reload
    /productionize

After `/reload`, `/productionize` should appear as an extension command. After `/productionize`, Pi should show a productionize panel with the steps Branch, Commit, Push, Pull Request, CI Checks, and Merge. If run in a disposable GitHub repository with a real check, it should progress through branch, commit, push, PR creation or reuse, CI polling, and squash merge/delete. If run outside a Git repository, without `gh`, without `gh` auth, from a detached HEAD, or against a non-GitHub remote, it should show a failure preview and pressing `F` should return to the normal Pi TUI with a generated repair instruction in the editor.

The CI success rule is intentionally conservative: the extension may merge only after at least one non-skipped check has appeared for the PR head SHA and every discovered non-skipped check has a passing bucket. Any failing or cancelled check fails the workflow. If no check appears before the CI timeout, the workflow fails with repair instructions rather than merging.

## Idempotence and Recovery

The extension should be safe to rerun. If already on a non-main branch, it reuses that branch. If no dirty files exist, the commit step is marked complete without creating an empty commit. If a PR already exists for the branch, the PR step should reuse it when possible. If any git, push, PR, CI, or merge step fails, the extension should stop further mutation, generate a repair instruction, and leave the user in control. Existing PR reuse is detected with `gh pr view --json number,title,url,headRefName,headRefOid` on the current branch; a "no pull requests" style response means create a new PR, while other `gh pr view` failures stop the workflow and generate repair instructions.

The workflow intentionally performs real mutations when invoked: it creates branches, commits, pushes, opens PRs, and may squash-merge and delete the remote branch. This matches the user's Autopilot answer, so the command itself is the explicit start signal.

## Artifacts and Notes

Clarification decisions captured before implementation:

    Trigger: Slash command.
    UI: Full-screen panel.
    Safety: Autopilot.
    Dirty files: Commit all.
    Branch base: Use current main.
    Existing branch: Reuse branch.
    Branch convention: Conventional prefixes.
    Protected branches: main and master.
    Commit message: GPT generated.
    Remote: Upstream remote.
    Push mode: Detect best.
    Provider: GitHub only.
    PR creation: gh CLI.
    PR changed-file view: By directory.
    PR text: GPT title only, deterministic body.
    CI source: GitHub checks.
    CI failure detail: Status only.
    Fix paste: Preview then paste.
    Merge gate: Auto squash.
    Final failure screen: Fix button.

## Interfaces and Dependencies

The new extension files are:

    agent/extensions/productionize/index.ts
    agent/extensions/productionize/core.ts
    agent/extensions/productionize/core.test.ts

The command name is:

    /productionize

External commands used at runtime are:

    git status --porcelain
    git branch --show-current
    git checkout -b <branch>
    git add -A
    git commit -m <message>
    git rev-parse --abbrev-ref --symbolic-full-name @{u}
    git push or git push -u <remote> <branch>
    gh pr view
    gh pr create
    gh pr checks
    gh pr merge --squash --delete-branch

The AI model dependency is `openai-codex/gpt-5.3-codex-spark`. The extension should find it through `ctx.modelRegistry.find("openai-codex", "gpt-5.3-codex-spark")`.

## Revision Notes

Revision note 2026-05-24T04:35Z: Initial plan created after the 20-question clarification round and after updating the `create-specs` skill to be self-contained.

Revision note 2026-05-24T04:35Z: Incorporated reviewer feedback by adding a disposable-repo end-to-end validation requirement, defining the conservative CI merge rule, requiring Spark output hardening for commit messages and PR titles, spelling out failure modes, and clarifying existing PR reuse.

Revision note 2026-05-24T04:35Z: Completed implementation and recorded validation evidence. End-to-end disposable GitHub validation remains explicitly unrun in this session.

Revision note 2026-05-24T04:35Z: Addressed code review by hardening merge-head matching, check classification, branch reruns from protected branches, and PR base fetch handling. Re-ran focused tests and command discovery successfully.
