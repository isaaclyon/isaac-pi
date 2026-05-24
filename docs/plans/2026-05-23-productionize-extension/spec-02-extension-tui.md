# Spec 02: Wire the slash command and full-screen TUI

## Goal

Create the `/productionize` Pi extension command and a full-screen progress panel that runs the branch, commit, push, PR, CI, and merge workflow. After this spec, invoking `/productionize` in interactive Pi starts the real workflow and updates visible progress as each step completes or fails.

## Must do

- Create `agent/extensions/productionize/index.ts`.
- Register a `productionize` slash command.
- Require `ctx.hasUI` and wait for the agent to be idle before starting the workflow.
- Render a full-screen custom component with a progress bar, six workflow steps, CI todo boxes, and a failure preview area.
- Use `openai-codex/gpt-5.3-codex-spark` through `complete()` for branch names, commit messages, PR titles, and fix instructions.
- Use the last 10 user/assistant messages from `ctx.sessionManager.getBranch()` as branch-name context.
- If on `main` or `master`, create a new Spark-generated conventional branch from current local HEAD. If already on another branch, reuse it.
- Commit all dirty files with `git add -A` and a Spark-generated commit message; treat a clean tree as a successful no-op.
- Push with upstream-aware behavior: plain `git push` when an upstream exists, otherwise `git push -u <remote> <branch>`.
- Use GitHub CLI to create or reuse a PR, with GPT title only and deterministic grouped-by-directory body.
- Reuse an existing PR when `gh pr view --json number,title,url,headRefName,headRefOid` succeeds for the current branch; create a new PR only when `gh pr view` reports a no-PR condition.
- Poll GitHub checks and show each check as pending, passed, failed, or skipped.
- Merge only after at least one non-skipped check is discovered and all discovered non-skipped checks pass; fail on failed/cancelled checks or timeout with no checks.
- On green checks, run `gh pr merge --squash --delete-branch` automatically.
- On any failure, stop the workflow, generate a repair instruction, show the preview, and make `F` paste it into the editor after the panel closes.

## Constraints / Must not do

- Do not ask for additional confirmations during the workflow because the user chose Autopilot.
- Do not pull or rebase local main before branching.
- Do not support GitLab or Bitbucket in this first version.
- Do not fetch CI logs; include status-only check details for failure prompts.
- Do not auto-send the fix prompt to the agent; only paste it into the editor after the user presses Fix.
- Do not merge a PR that has no discovered checks before the CI timeout.

## Acceptance Criteria

- `/productionize` opens a custom full-screen progress panel.
- The panel visibly advances through Branch, Commit, Push, Pull Request, CI Checks, and Merge.
- Failure screens show both the failed step and generated repair instructions.
- Pressing `F` on a failure closes the panel and fills the Pi editor with the repair instructions.
- Pressing Escape while the workflow is running aborts outstanding commands and model calls through a shared `AbortController` where possible and marks the workflow cancelled.
- Failure screens are explicit for missing `gh`, unauthenticated `gh`, non-GitHub remotes, detached HEAD, missing remotes, existing PR lookup failures, CI failures, CI timeout, and merge command failure.

## Tests

- Existing helper tests from Spec 1 continue to pass.
- Manual smoke test after `/reload`: `/productionize` is recognized as an extension command and opens the panel.
- Manual failure smoke test outside a git repo produces a failure preview instead of crashing Pi.
- Manual cancellation smoke test: pressing Escape during a long poll stops further progress and returns control.
- Manual disposable-repo happy path: a test GitHub repository with one real check reaches squash merge and remote branch deletion before claiming end-to-end success.

## Todo

- [x] Implement the progress component and keyboard handling.
- [x] Implement Spark completion helpers.
- [x] Implement git branch, commit, and push workflow steps.
- [x] Implement PR creation/reuse and deterministic PR body generation.
- [x] Implement CI polling and squash merge.
- [x] Implement failure preview and editor paste path.
