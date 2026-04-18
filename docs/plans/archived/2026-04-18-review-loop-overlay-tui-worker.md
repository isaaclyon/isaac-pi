# Plan: review-loop overlay controller + full Pi TUI worker

## Goal
Replace the current headless `pi --mode json -p --no-session` review worker flow in `agent/git/github.com/nicobailon/pi-review-loop` with:
1. a floating overlay controller widget in the current session, and
2. a separately launched full `pi "<review prompt>"` TUI process for each review pass.

## User decision
- Chosen architecture: **separate child Pi TUI + floating controller widget**.
- Avoid embedding a PTY inside the current UI.

## Current state
- `index.ts` manages review mode and starts review passes through `runReviewWorkerPass()`.
- `worker.ts` spawns headless Pi in JSON mode and parses machine-readable completion/progress.
- `questionnaire.ts` demonstrates `ctx.ui.custom(..., { overlay: true })`-style UI patterns available in Pi.
- Pi docs confirm overlay widgets and persistent handles are supported.

## Constraints
- Must not disturb unrelated dirty files already present in the repo.
- Keep the change focused to the vendored `pi-review-loop` package unless a shared test helper is clearly warranted.
- Preserve the review-loop command/tool UX where practical.
- Fail loudly if launching the external TUI worker is not possible.

## Acceptance criteria
- Starting review mode shows an overlay controller widget instead of relying only on footer text.
- Review passes launch a full `pi` TUI process via a dedicated launcher path instead of headless JSON mode.
- The overlay shows meaningful state for active/inactive/error/cancel states and offers at least cancel/close guidance.
- Review loop tests cover the new launch behavior and widget lifecycle.
- Relevant `pi-review-loop` tests pass.

## TDD slices
1. Add a failing test for the new worker launcher arguments / launch contract.
2. Add a failing test for overlay lifecycle during `/review-start` and completion.
3. Implement the smallest launcher + state model to satisfy the tests.
4. Refactor naming/structure once green.
5. Run focused review-loop tests and archive this plan.

## Notes / open implementation choices
- Use a configurable launcher abstraction so the package can fail clearly on unsupported environments and remain testable.
- Prefer a lightweight persistent overlay controller in the parent session; do not block the session with a modal dialog.
- Keep fresh-context behavior explicit if the new worker no longer uses the old headless prompt injection path.
