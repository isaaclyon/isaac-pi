# Promote the Roadmap Board into a Pi extension (always-on control surface)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` should be kept up to date as implementation proceeds.

## Purpose / Big Picture

Today the roadmap board exists as two things: a standalone, unpublished web-app + validating CLI (`roadmap-board/`, `roadmap-board-mvp` v0.1.0, `private: true`) and a **passive skill** (`agent/skills/roadmap-board/`, symlinked into `.claude/skills/`) that the agent invokes on demand. There is **no Pi extension** — nothing in `agent/extensions/` or `agent/settings.json` references the board.

A skill can only ever *describe* a control surface, because it is pull-based: the model decides to invoke it, it runs, it disappears. There is no runtime presence — no status line, no proactive surfacing of work, no binding to the session lifecycle, no human-facing slash commands.

After this change, a Pi **extension** makes the board *present* in every session: on session start it spins up the read-only UI server and prints a one-line notice (`📋 Roadmap → http://127.0.0.1:PORT · N ready, ROAD-x in progress`), paints a status widget, and exposes quick `/road …` commands for the human — all while reusing the board's existing `cli.js` as the single validating core. The skill stays exactly as-is: it remains the *agent's* programmatic interface; the extension is the *human's* always-on surface. The two share one brain (`cli.js`), so no logic is duplicated.

This is explicitly **not** an attempt to build an agentic workflow engine. Slash commands are thin wrappers; the prompt-action templates are handed to the *current* agent, and using a subagent for a stage stays a manual, in-the-moment choice — not a baked-in pipeline.

## Definition of Done

This work is complete when a local Pi extension under `agent/extensions/roadmap/` is auto-discovered by Pi and delivers:

- **Session-start behavior**: in a repo whose resolved project root owns `.pi/roadmap/roadmap.sqlite`, the extension ensures the read-only UI server is running and emits a `ctx.notify(...)` with the live URL plus a compact board summary (ready count + active card). In a repo with no board, it stays silent (or emits a single "run `/road init`" hint).
- **Server lifecycle**: exactly one server per **project root**, shared across concurrent sessions via a refcounted lock file, on a free (collision-free) port, and shut down automatically when the last attached session ends. No orphaned servers; stale locks are detected and recovered.
- **Worktree resolution**: all `git worktree` checkouts of one repo resolve to the **same** board + server (one roadmap per project); separate repos stay fully isolated.
- **Status widget**: an `aboveEditor` widget showing the active in-progress card and its epic's progress, refreshed when the board changes.
- **Slash commands**: at minimum `/road` (summary), `/road ready`, `/road get <id>`, and `/road plan|execute|review <id>` (fills the `prompts.json` template and hands it to the current agent). Read commands shell out to `cli.js`; nothing bypasses its validation.
- **Tests**: the non-UI logic (root resolution, lock-file refcount transitions, free-port selection, stale-lock recovery, prompt-template filling) is covered by focused tests, mirroring the `core.ts` + `core.test.ts` split that `agent/extensions/ci-watch/` already uses.
- **No regressions**: the existing skill and CLI behavior are unchanged; the board UI stays read-only.

## Architecture & key components

```
agent/extensions/roadmap/
  index.ts      # Pi entrypoint: registers hooks (session_start/shutdown), commands, widget
  server.ts     # resolve root, spawn/probe/track the read-only UI server, lock-file refcount
  core.ts       # pure helpers: root resolution, port pick, lock transitions, template fill
  core.test.ts  # node:test coverage for core.ts (no Pi runtime needed)
```

- **Single validating core.** Both the skill and the extension call `roadmap-board/src/server/cli.js`. The extension resolves the CLI the same way the skill's `scripts/roadmap.mjs` does (`$ROADMAP_CLI` → walk up for `roadmap-board/src/server/cli.js` → bundled copy), so the resolution logic stays consistent.
- **Types.** Import from `@mariozechner/pi-coding-agent` to match the hand-written local extensions (`handoff.ts`, `minimal-footer.ts`). (`ci-watch` uses the `@earendil-works` scope because it was vendored from a git source; new local code follows the `@mariozechner` convention.)

### Confirmed Pi ExtensionAPI primitives (verified against the installed `.d.ts`)

| Need | API |
|---|---|
| Run on session start | `pi.on("session_start", handler)` |
| Tear down on exit | `pi.on("session_shutdown", handler)` |
| TUI notice (the URL line) | `ctx.notify(message, "info" \| "warning" \| "error")` |
| Status widget | `ctx.setWidget(key, lines[], { placement: "aboveEditor" })` |
| Slash commands | `pi.registerCommand(name, options)` |
| One-shot shell calls to `cli.js` | `pi.exec(command, args, options)` → `Promise<ExecResult>` |
| Inject context for the agent | `pi.sendMessage(...)` / `pi.sendUserMessage(...)` |
| Persist per-session markers | `pi.appendEntry(customType, data)` |

The long-lived UI server is the **one** thing `pi.exec` cannot do (it is request/response), so the server is launched with Node's `child_process.spawn` and tracked by the extension.

### Project-root resolution (one roadmap per repo)

1. If `$ROADMAP_PROJECT_ROOT` is set, use it (realpath-canonicalized).
2. Else resolve the repo's main checkout via `git rev-parse --git-common-dir`, then take its parent — so linked worktrees resolve to the primary checkout that owns the gitignored `.pi/roadmap/roadmap.sqlite`.
3. Else walk up from cwd for `.pi/roadmap/roadmap.sqlite` (the skill's existing behavior).
4. If none of the above yields a root containing `.pi/roadmap/roadmap.sqlite`, the extension is inert for this session.

### Server lifecycle protocol

State lives in `<root>/.pi/roadmap/.server.json`:

```jsonc
{ "pid": 51847, "port": 51847, "startedAt": "2026-06-13T…Z", "refs": ["<sessionId>", …] }
```

- **session_start**
  1. Resolve root (above). If no board → inert.
  2. Acquire a short-lived mutex (`.server.lock` via `O_EXCL` create / rename) to avoid two sessions racing to spawn.
  3. Read `.server.json`. If `pid` is alive **and** the port answers a health probe → *attach*: add this session id to `refs`, persist, reuse the recorded port.
  4. Otherwise (missing / stale pid / dead port) → pick a free port (OS-assigned via an ephemeral `net` bind, then released), `spawn("node", [cliPath, "serve", "--port", port], { cwd: root, env: { ROADMAP_PROJECT_ROOT: root }, detached })`, wait until it answers, then write `.server.json` with `refs:[sessionId]`.
  5. Release the mutex.
  6. `ctx.notify("📋 Roadmap → http://127.0.0.1:<port>  ·  <N> ready, <active> in progress", "info")`.
  7. Optionally `pi.sendMessage(...)` a compact board summary so the agent "continues with these in mind."
- **session_shutdown**
  1. Remove this session id from `refs`.
  2. If `refs` is now empty → kill the server pid, delete `.server.json`.
  3. Else persist the reduced `refs` (server stays up for the other sessions).

Recovery rules: a lock whose pid is dead is treated as absent (respawn). A recorded port that no longer answers is treated as stale (respawn, overwrite lock). These two checks make crashes self-healing on the next session start.

### Command surface (thin, human-facing)

| Command | Action |
|---|---|
| `/road` | Board summary: epic progress + column counts + active card (via `cli.js list`/`epics`) |
| `/road ready [--epic E]` | Pickable cards (`ready`) |
| `/road get <id>` | Full card + event history |
| `/road blocked` | `blocked-deps` |
| `/road open` | (Re)print the URL; ensure the server is up |
| `/road brainstorm\|plan\|execute\|review <id>` | Read the `prompts.json` template, fill `{{id}}`/`{{title}}`, `pi.sendUserMessage(...)` to the current agent. Card moves stay explicit/opt-in to avoid surprising status changes. |

These are conveniences for the human. The agent continues to drive full CRUD through the skill.

## Progress

- [x] (2026-06-13) Mapped the current state: `roadmap-board/` is an unpublished standalone app + CLI; `agent/skills/roadmap-board/` is a skill (symlinked into `.claude/skills/`); there is no Pi extension and no `settings.json` reference.
- [x] (2026-06-13) Verified the Pi ExtensionAPI supports every required primitive (`session_start`/`session_shutdown` hooks, `ctx.notify`, `ctx.setWidget`, `registerCommand`, `exec`) against the installed `.d.ts`.
- [x] (2026-06-13) Confirmed product direction with the user: skill → extension, server-on-session-start with a TUI notice, one board per repo (git-common-dir resolution), refcounted per-project server, subagents out of scope for v1.
- [x] (2026-06-13) Wrote this ExecPlan.
- [x] (2026-06-13) Scaffolded `agent/extensions/roadmap/` (`core.ts` + `core.test.ts` first, pure logic). 17 unit tests pass under `node --test --experimental-strip-types`.
- [x] (2026-06-13) Implemented project-root resolution (env → git-common-dir parent → walk-up) with tests; verified against a real `git worktree` (resolves to the main checkout).
- [x] (2026-06-13) Implemented the server lifecycle (`O_EXCL` spawn mutex with stale recovery, free-port pick, health probe, refcounted `.server.json`, kill-on-empty) in `server.ts`; validated spawn/reuse/detach/kill in an isolated temp board.
- [x] (2026-06-13) Wired `session_start` (resolve → `ensureServer` → `ctx.notify` + widget) and `session_shutdown` (detach/kill). Context injection left off by default (see decision below).
- [x] (2026-06-13) Added the status widget (`aboveEditor`: active card + epic progress bar; falls back to ready/blocked counts).
- [x] (2026-06-13) Registered `/road` (summary, ready, get, blocked, open, init, brainstorm|plan|execute|review) as thin `cli.js` wrappers + prompt-template handoff via `pi.sendUserMessage`.
- [x] (2026-06-13) Validated: free-port assignment, two concurrent sessions share one server, worktree shares the main board, clean shutdown leaves no orphan, no-board → inert. Added `.server.json`/`.server.lock` to `.gitignore`.
- [ ] (Optional, later) Address the tracked-sqlite hygiene item; consider publishing `roadmap-board` so the CLI need not be vendored.

## Surprises & Discoveries

- Observation: `.pi/roadmap/roadmap.sqlite` is **gitignored by design** (only `prompts.json` is committed), so a fresh `git worktree` has no board DB. Keying the server by raw cwd would give each worktree a different, near-empty roadmap.
  Evidence: `.gitignore` ignores `.pi/roadmap/roadmap.sqlite*` while un-ignoring `prompts.json`; `CONTEXT.md` states local SQLite state should be ignored and prompt config committed.
  Consequence: resolve the board via `git rev-parse --git-common-dir` so all worktrees of a repo share the one board the main checkout owns.

- Observation: despite the ignore rule, `.pi/roadmap/roadmap.sqlite` is currently **tracked** in git (committed before the rule, or force-added). `git check-ignore` reports it ignored, yet `git ls-files` lists it.
  Evidence: `git ls-files .pi/` returns `.pi/roadmap/roadmap.sqlite`; `git check-ignore` returns it as ignored.
  Consequence: a `git rm --cached .pi/roadmap/roadmap.sqlite` would align reality with the design. Out of scope for the extension itself; logged so it is not forgotten.

- Observation: the repo already has `planner`/`implementer`/`worker`/`reviewer`/`scout` subagents (`agent/agents/`) that map almost 1:1 onto the board's `plan`/`execute`/`review` prompt actions, which are otherwise inert strings the UI copies.
  Consequence: an orchestration layer is a natural *future* extension, but the user explicitly scoped it out of v1 — slash commands hand the filled template to the current agent, and subagents stay a manual choice.

- Observation: `.claude/skills` is a symlink into `agent/skills/`, so the Claude Code and Pi copies of the skill are a single tracked file (`agent/skills/roadmap-board/SKILL.md`). Edits to either path land in the same place.

- Observation: Pi auto-discovered `agent/extensions/roadmap/index.ts` and ran its `session_start` mid-implementation — the first `ensureServer()` from the integration harness returned `reused=true` with the live session already in the refset. This is the lifecycle working as designed (one server per root, shared across attachers), and doubled as live confirmation that `session_start` spawns + attaches correctly.
  Consequence: a session's empty-refs kill path can't be observed while a real Pi session still holds a ref — validated separately in an isolated temp root instead.

- Observation: `ctx.sessionManager.getSessionId()` returns the absolute session-file path in this Pi build (e.g. `…/sessions/…/<ts>_<uuid>.jsonl`), not a bare uuid. It is still stable and unique per session, so it works fine as the refset key; just don't assume it's a short id.

- Observation: `ExecOptions` for `pi.exec` has no `env` field, but `cli.js` derives the project root from `process.cwd()` (not an env var), so passing `cwd: root` is sufficient for all read commands. The long-lived server is the one case that needs `env` (`ROADMAP_PROJECT_ROOT`/`PORT`), and it is launched via `child_process.spawn` (not `pi.exec`), where env is available.

- Observation: `.gitignore` un-ignores the whole `.pi/roadmap/` dir (`!.pi/roadmap/`) and only re-ignores `roadmap.sqlite*`, so the new `.server.json`/`.server.lock` runtime-state files would have been trackable.
  Consequence: added explicit ignore lines for both.

## Decision Log

- Decision: promote the integration from a skill to a Pi extension; keep the skill as the agent's interface and make the extension the human's always-on surface.
  Rationale: a skill is pull-based and has no runtime presence; only an extension can spin up the server, paint a widget, and register slash commands. The two share `cli.js`, so there is no duplicated logic.
  Date/Author: 2026-06-13 / coding agent with user.

- Decision: one UI server per **project root**, refcounted via `<root>/.pi/roadmap/.server.json`, on a free port, auto-shutdown when the last session detaches.
  Rationale: avoids port collisions across repos, reuses one server across concurrent sessions on the same repo, and leaves no orphaned processes.
  Date/Author: 2026-06-13 / coding agent with user.

- Decision: resolve the board by `git rev-parse --git-common-dir` so worktrees of a repo share one roadmap; separate repos stay isolated.
  Rationale: a project has one roadmap; per-worktree boards would give feature branches divergent, mostly-empty roadmaps, and the sqlite is gitignored anyway.
  Date/Author: 2026-06-13 / user decision.

- Decision: subagent orchestration is out of scope for v1.
  Rationale: the user does not want a full agentic workflow; slash commands hand prompt templates to the current agent, and subagents remain a manual, in-the-moment option.
  Date/Author: 2026-06-13 / user decision.

- Decision: keep the extension local under `agent/extensions/roadmap/` (tracked + rsynced), using `@mariozechner/pi-coding-agent` types.
  Rationale: matches the existing hand-written local extensions and the repo's restore-via-rsync model; no publishing step needed to start.
  Date/Author: 2026-06-13 / coding agent.

- Decision: card status moves triggered by `/road <stage>` commands stay explicit/opt-in rather than automatic.
  Rationale: silently moving a card on a prompt handoff would surprise the user; the board should reflect deliberate transitions.
  Date/Author: 2026-06-13 / coding agent.

- Decision: session-start context injection (`pi.sendMessage`) is left OFF; only `ctx.notify` + the widget surface the board at start.
  Rationale: injecting a board summary into the agent's context on every session start is persistent noise for marginal benefit; the URL line + widget already make the board present. The code path is trivial to add later if wanted.
  Date/Author: 2026-06-13 / coding agent.

- Decision: `/road` read subcommands shell out to `cli.js` via `pi.exec` (cwd = root) rather than reading the running server's HTTP API.
  Rationale: keeps the validating CLI the single source of truth for reads and makes commands work even in a session where the server failed to start; the HTTP API is used only for the session-start summary/widget, where the server is already up.
  Date/Author: 2026-06-13 / coding agent.

## Open questions / Out of scope

- Out of scope (v1): subagent orchestration; any write UI (board stays read-only); publishing `roadmap-board` to npm; server auth (localhost-only is assumed).
- Open: exact content/format of the session-start context injection for the agent (compact summary vs. nothing) — decide during implementation; default to a short ready/in-progress line.
- Open: whether `/road` should offer `init` for a board-less repo, or stay silent — leaning toward a single non-intrusive hint.

## Outcomes & Retrospective

Shipped `agent/extensions/roadmap/` (`core.ts`, `core.test.ts`, `server.ts`, `index.ts`) — a local Pi extension that makes the board present in every session and shares the board's `cli.js` as its single validating core, exactly as the skill does.

- **Delivered against the Definition of Done:**
  - Session-start: resolves the project root, ensures one server is running, emits `📋 Roadmap → http://127.0.0.1:PORT · N ready, ROAD-x in progress`, and paints the `aboveEditor` widget. Board-less repos get a single `/road init` hint and stay otherwise inert.
  - Server lifecycle: one server per project root, refcounted via `.pi/roadmap/.server.json`, on an OS-assigned free port, behind an `O_EXCL` spawn mutex with stale-lock recovery; killed when the last session detaches. Dead pids / unanswered ports self-heal on the next start.
  - Worktree resolution: `git rev-parse --git-common-dir` → parent resolves every linked worktree to the one main checkout that owns the board (verified with a real `git worktree`).
  - Commands: `/road` summary, `ready [--epic E]`, `get <id>`, `blocked`, `open`, `init`, and `brainstorm|plan|execute|review <id>` (fills `prompts.json`, hands it to the current agent; no implicit card moves).
  - Tests: 17 `node:test` cases cover root resolution, refcount transitions, reuse-vs-respawn, free-port, template fill, and summarisation. Effectful lifecycle validated by isolated integration runs (spawn/reuse/detach/kill, worktree, inert).
  - No regressions: the skill and `cli.js` are untouched; the board UI stays read-only.

- **What went smoothly:** the `core.ts`/`server.ts`/`index.ts` split kept all the fiddly concurrency rules in pure, fast-to-test functions; mirroring `ci-watch` and `roadmap.mjs` meant the conventions were already settled. Pi hot-loading the extension mid-build gave free real-world confirmation.

- **Follow-ups (unchanged from plan, still optional):** `git rm --cached .pi/roadmap/roadmap.sqlite` to align the tracked sqlite with its ignore rule; publishing `roadmap-board` so the CLI need not be resolved from an in-repo checkout; subagent orchestration for the `plan/execute/review` stages.

- **To activate in this running session:** `/reload` (or restart Pi) so the extension's `session_start` re-runs and registers `/road`. It already auto-loaded once during development, so a live server may already be attached.
