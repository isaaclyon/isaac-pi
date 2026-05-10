# PR CI Watch Extension Research Spike

## Assumptions

- Target host is GitHub.
- The local machine has `gh` available and authenticated.
- The extension should run inside Pi interactive sessions and inject a user message when CI fails.
- "PR is made" can mean either the agent/user creates a PR from the current working tree, or a PR already exists for the current branch.

## Pi extension findings

- Pi extensions can run TypeScript from `~/.pi/agent/extensions/` globally or `.pi/extensions/` project-locally and hot reload with `/reload`.
- Extensions can keep background timers/processes; examples use `setInterval`, with cleanup in `session_shutdown`.
- Extensions can run shell commands with `pi.exec(command, args, { cwd, timeout, signal })`.
- Extensions can inject real user messages with `pi.sendUserMessage(...)`.
  - If `ctx.isIdle()` is true, call `pi.sendUserMessage(message)`.
  - If Pi is streaming/busy, `deliverAs` is required or `sendUserMessage` throws; use `pi.sendUserMessage(message, { deliverAs: "followUp" })` for this use case.
  - Injected input has `event.source === "extension"` in the `input` event, so the extension can avoid reacting to its own messages.
- `ctx.ui.notify(...)` is available for lightweight non-agent notifications; user-message injection is the right API if we want the agent to act on failure.

## GitHub / CI findings

- There is no local "subscribe to CI events" API from `gh` comparable to a persistent event stream.
- GitHub can emit webhook events (`pull_request`, `check_run`, `check_suite`, `status`, `workflow_run`), but a local terminal extension would need a reachable webhook endpoint/tunnel and auth/secret handling.
- The simplest local solution is polling/watching through `gh`:
  - `gh pr view --json number,url,title,headRefName,headRefOid` detects the PR for the current branch.
  - `gh pr checks --json name,workflow,bucket,state,link,description,startedAt,completedAt` summarizes check state.
  - `gh pr checks --watch --fail-fast` can block until checks finish or fail, but a poll loop is easier to manage inside an extension and avoids long-running child process edge cases.

## Recommended MVP

Build a polling Pi extension first, not webhooks.

Behavior:

1. On `session_start`, determine whether `ctx.cwd` is inside a git repo.
2. Every N seconds, run `gh pr view` in that cwd.
3. If no PR exists for the current branch, keep polling quietly.
4. Once a PR is found, store `{ repo, branch, prNumber, headRefOid }` in memory and show `ctx.ui.notify`.
5. Poll `gh pr checks` for that PR.
6. Keep polling single-flight: skip a tick if the previous poll is still running, and put a timeout on every `gh` invocation.
7. If any check bucket becomes `fail` or `cancel`, inject exactly one user message for that commit/PR failure, using `ctx.isIdle()` to decide whether to include `{ deliverAs: "followUp" }`, e.g.:

   > CI failed for PR #123: <title/url>. Failed checks: test, lint. Please inspect the failure and propose the smallest fix.

8. De-dupe by PR number + head SHA + failed check names so the extension does not spam the conversation.
9. Clean up timers/controllers on `session_shutdown`.

Error handling:

- Quiet/expected: not in a git repo, no PR for current branch.
- Notify once: `gh` missing, `gh` unauthenticated, non-GitHub remote.
- Back off/avoid spam: transient network/API failures.
- In-memory de-dupe is acceptable for MVP, but `/reload` or session restart may re-announce the same failure. Use `pi.appendEntry(...)` later if persistent de-dupe is required.

Suggested controls:

- `/ci-watch on` / `/ci-watch off`
- `/ci-watch status`
- Optional config constants at top of file: poll interval, required-only checks, auto-start enabled.

## Stretch version

Webhook mode can be added later if polling is too slow/noisy:

- Start a local HTTP server from the extension.
- Use a tunnel (`cloudflared`, `ngrok`, Tailscale Funnel, etc.).
- Register repo webhook for `pull_request`, `check_run`, `check_suite`, `status`, or `workflow_run`; this may require repo admin permission or a suitably scoped token.
- Validate webhook signatures.
- Map events back to current cwd/repo/session before injecting messages.

This is more complex and less portable, so it should not be MVP.

## Open questions before implementation

1. Should the watcher auto-start for every Pi session in a git repo, or only after `/ci-watch on`?
2. Should it watch only the current branch's PR, or any PR in the repo authored by the current GitHub user?
3. Should a CI failure merely notify, or should it always trigger an agent turn via `sendUserMessage`?
4. Should cancelled checks count as failures?
5. Should it include all checks or only required checks?

## Implementation notes

Implemented as a global extension under `agent/extensions/ci-watch/`:

- `core.ts` contains testable watcher logic independent of Pi.
- `index.ts` wires the watcher into Pi lifecycle events and `/ci-watch` commands.
- Auto-start is disabled by default; run `/ci-watch on` per session.
- The extension lightly polls for the current branch PR, then starts one background `gh pr checks --watch --fail-fast` process per PR head SHA.
- On watch failure it fetches structured check JSON and injects one user message, using `followUp` when Pi is busy.
- It persists de-dupe keys with `pi.appendEntry("ci-watch-state", ...)`.

## Verification

- `node --test agent/extensions/ci-watch/core.test.ts` passes.
- Covered core cases:
  - failed/cancelled check selection,
  - stable de-dupe keys,
  - failure message formatting,
  - non-overlapping PR discovery polls,
  - background watch failure triggers exactly one follow-up message.
- Smoke-tested extension loading with:
  - `pi --offline --no-session --no-tools --no-skills --no-prompt-templates --no-context-files --no-extensions -e ./agent/extensions/ci-watch/index.ts -p '/ci-watch status'`
