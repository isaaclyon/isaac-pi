# Polling GitHub PR lifecycle tracker for Pi

## Goal
Add a new Pi extension that tracks a single GitHub pull request per conversation, polls GitHub for lifecycle changes, surfaces detailed status in the footer, and injects major lifecycle updates into the conversation as custom Pi messages.

## User-aligned scope
- New extension, not a retrofit of an existing non-footer extension.
- Polling-based MVP, not webhooks or a GitHub App.
- One tracked PR per conversation/session.
- Major lifecycle events should appear in-chat as Pi-originated status messages.
- Footer should show ongoing PR detail.

## What I inspected
- `agent/extensions/custom-footer.ts`
  - This repo already replaces the built-in footer globally.
  - It refreshes itself on an interval and already has room for more status segments.
  - Because it owns the footer, the new PR tracker should not create a second footer; it should feed data into this one.
- `agent/extensions/review.ts`
  - Already uses `gh` via `pi.exec()` and has PR parsing/lookup patterns we can reuse.
- Pi docs: `docs/extensions.md`, `docs/tui.md`, `docs/session.md`
  - Confirmed `ctx.ui.setStatus()` contributes footer status text.
  - Confirmed custom footers can read `footerData.getExtensionStatuses()`.
  - Confirmed `pi.sendMessage()` is the right way to inject visible custom messages without pretending to be the user.
  - Confirmed `pi.appendEntry()` is the right persistence mechanism for extension state that should survive reloads/resume.
- Pi examples:
  - `examples/extensions/message-renderer.ts` for custom in-chat status rendering.
  - `examples/extensions/file-trigger.ts` for background/external event patterns.
  - `examples/extensions/custom-footer.ts` and `status-line.ts` for footer/status patterns.

## Key design decision
Use a **new `github-lifecycle` extension** for tracking, persistence, polling, commands, and message rendering, and make a **small update to `agent/extensions/custom-footer.ts`** so it renders extension-provided status text from `footerData.getExtensionStatuses()`.

That keeps GitHub logic isolated while preserving the existing custom footer as the single footer owner.

## Proposed file layout
- `agent/extensions/github-lifecycle/index.ts`
- `agent/extensions/github-lifecycle/types.ts`
- `agent/extensions/github-lifecycle/state.ts`
- `agent/extensions/github-lifecycle/github.ts`
- `agent/extensions/github-lifecycle/poller.ts`
- `agent/extensions/github-lifecycle/format.ts`
- `agent/extensions/github-lifecycle/index.test.ts`
- `agent/extensions/github-lifecycle/github.test.ts`
- `agent/extensions/github-lifecycle/poller.test.ts`
- small patch to `agent/extensions/custom-footer.ts`

## Functional design

### 1) Session-scoped tracked PR state
Persist one tracked PR per session with `pi.appendEntry("github-pr-lifecycle", data)`.

Stored state should include:
- `repo` (`owner/repo`)
- `prNumber`
- `url`
- `title`
- `headRefName`
- `baseRefName`
- `trackingSource` (`auto-detected` | `manual`)
- latest normalized status snapshot
- last announced major event fingerprint
- last poll time / last success / last error

Why:
- survives `/reload`, restart, and session resume
- avoids duplicate notifications after reload
- keeps tracking aligned to the conversation, not the working tree globally

### 2) PR registration flow
Support two paths:

#### Auto-detect on PR creation
Watch for successful `gh pr create` invocations from:
- `tool_result` for built-in `bash`
- `user_bash` / resulting bash execution path for user-triggered shell commands

On successful create:
- parse PR URL/number from command output if available
- if output is ambiguous, run `gh pr view --json ...` for the current branch to resolve the new PR
- persist tracked PR state
- emit a visible custom message like `Tracking PR #123: <title>`

#### Manual fallback commands
Add commands:
- `/pr-track` → track the PR for the current branch
- `/pr-track <number|url|branch>` → track a specific PR
- `/pr-untrack` → stop tracking for this conversation
- `/pr-status` → emit the latest normalized snapshot into chat
- `/pr-refresh` → force an immediate poll

Why manual commands matter:
- PRs may be created outside Pi
- `gh pr create` output parsing can fail
- it gives a recovery path without editing session state manually

### 3) Polling backend
Use `pi.exec("gh", [...])` and poll the tracked PR on an interval.

Recommended polling strategy:
- immediate poll when tracking starts
- every 30s while tracked PR is open
- every 15s while checks are pending
- every 60s after terminal states (`merged`, `closed`) for one cooldown cycle, then stop polling
- force refresh on `session_start` and `session_switch`

Recommended command:
- `gh pr view <number> --repo <owner/repo> --json number,title,url,state,isDraft,mergedAt,mergeable,mergeStateStatus,statusCheckRollup,headRefName,baseRefName,updatedAt`

Normalize GitHub data into internal states:
- `open`
- `checks_pending`
- `checks_failed`
- `checks_passed`
- `merge_conflict`
- `merged`
- `closed`
- `poll_error`

Status derivation rules:
- `mergedAt != null` → `merged`
- `state === "CLOSED"` and not merged → `closed`
- `mergeable === "CONFLICTING"` or `mergeStateStatus` indicates dirty/conflict → `merge_conflict`
- `statusCheckRollup` contains failing check/status → `checks_failed`
- `statusCheckRollup` contains pending/in-progress checks → `checks_pending`
- all known checks successful → `checks_passed`
- otherwise → `open`

For MVP, treat all returned checks as the tracked set. Required-check-only logic can wait.

### 4) Footer integration
Because `agent/extensions/custom-footer.ts` already owns the footer, update it to render extension statuses from `footerData.getExtensionStatuses()`.

Recommended footer behavior:
- keep existing top line unchanged
- append PR status to the bottom-left area after git state
- only render the PR segment when a PR is being tracked

Example segment shapes:
- `PR #123 ⏳ 3 pending`
- `PR #123 ✗ 2 failing`
- `PR #123 ✓ checks passed`
- `PR #123 ⚠ conflict`
- `PR #123 ✓ merged`

Implementation note:
- prefer reading the `github-pr` entry from `footerData.getExtensionStatuses()` so the new extension stays decoupled from footer internals
- if needed, keep the existing 10s footer refresh interval, since it already exists and is good enough for a polling MVP

### 5) In-chat Pi pings for major lifecycle events
Use `pi.sendMessage()` with `display: true` and a custom message type, e.g. `github-pr-event`.

Do **not** use `pi.sendUserMessage()` for this MVP; these are status updates, not user prompts.

Major events to announce:
- tracking started
- CI/checks failed
- CI/checks recovered/passed after previously pending/failed
- merge conflict detected
- merge conflict cleared
- PR merged
- PR closed without merge
- polling/auth failure after a healthy state

Deduping rules:
- only emit when normalized state meaningfully changes
- include enough fingerprinting to avoid replay after reload (`state + failing-check-names + mergedAt + updatedAt`)
- no chat spam for every pending poll tick

Rendering:
- register a custom message renderer so PR lifecycle messages appear as compact status cards/boxes instead of plain text blobs

### 6) Error handling
Fail loudly but keep tracking understandable.

Behavior:
- if `gh` is unavailable or unauthenticated, show a footer state like `PR auth error` and emit one visible warning message
- keep the tracked PR registered unless the user explicitly untracks it
- store the last polling error and timestamp in persisted state
- stop repeated identical error notifications

## Testing plan
Follow the repo’s existing extension test style (Vitest, as used under `agent/extensions/worktree/`).

### Unit tests
- `github.test.ts`
  - parses `gh pr view --json` responses into normalized states
  - handles pending/failed/passed/conflict/merged/closed cases
  - handles malformed JSON / command failure
- `poller.test.ts`
  - starts/stops interval correctly
  - changes cadence for pending vs steady states
  - emits major events only on meaningful transitions
  - does not duplicate announcements after restoring persisted state
- `index.test.ts`
  - registers commands, renderer, and session handlers
  - restores persisted tracked PR state on `session_start`

### Focused footer test coverage
If we touch footer formatting logic enough to extract helpers from `agent/extensions/custom-footer.ts`, add small pure tests around:
- extension status extraction
- truncation/placement behavior when PR segment is present

## Manual verification plan
1. Start Pi with the new extension loaded.
2. Run or let Pi run `gh pr create` from a branch with an openable PR.
3. Confirm a visible `Tracking PR #...` message appears.
4. Confirm the footer shows the PR segment.
5. Force a check failure and verify a single failure message plus footer update.
6. Re-run checks to green and verify a single recovery/passed message.
7. Create a merge conflict and verify the conflict event.
8. Merge the PR and verify merged state appears once, then polling stops.
9. Restart/reload Pi and confirm the tracked PR restores without replaying old events.

## Non-goals for this MVP
- Webhooks / GitHub App delivery
- Multiple tracked PRs per conversation
- Required-check-only branch protection analysis
- Auto-triggering the LLM to react to PR events
- Cross-session/global PR dashboards

## Implementation order
1. Patch `agent/extensions/custom-footer.ts` to surface extension statuses cleanly.
2. Build normalized PR snapshot parser and tests.
3. Build persisted tracker state restore/save logic.
4. Build the polling scheduler and event deduper.
5. Add auto-detection for `gh pr create` and manual `/pr-*` commands.
6. Add custom message renderer and event messages.
7. Run tests and a manual `gh` smoke test.

## Acceptance criteria
- [ ] A new extension under `agent/extensions/github-lifecycle/` tracks one PR per session.
- [ ] Tracking starts automatically after successful `gh pr create`, with manual `/pr-track` fallback.
- [ ] PR status is polled from GitHub via `gh` and normalized into stable lifecycle states.
- [ ] Major lifecycle changes are injected into chat as visible custom Pi messages without triggering extra agent turns.
- [ ] The existing custom footer displays the tracked PR status segment.
- [ ] Tracked PR state survives reload/restart/resume without duplicate status pings.
- [ ] Automated tests cover parsing, polling transitions, and restore/dedupe behavior.
