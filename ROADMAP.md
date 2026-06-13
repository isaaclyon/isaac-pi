# Roadmap

> Generated from `.pi/roadmap/roadmap.sqlite`. Do not edit directly.

## Epics

- **EPIC-006** — Agent work visibility
  - Summary: Make agent work visible on the roadmap by connecting cards to active Pi sessions and showing what those sessions are doing over time.
  - Progress: 0 / 2 (0%)
  - Cards: ROAD-024, ROAD-025

## Archived Epics

- **EPIC-001** — Board UX polish
  - Progress: 4 / 4 (100%)
  - Cards: ROAD-001, ROAD-019, ROAD-005, ROAD-002
- **EPIC-002** — Frictionless agent loop
  - Progress: 3 / 3 (100%)
  - Cards: ROAD-009, ROAD-008, ROAD-006
- **EPIC-003** — Dependencies & sequencing
  - Progress: 3 / 3 (100%)
  - Cards: ROAD-012, ROAD-010, ROAD-011
- **EPIC-004** — Robustness & tests
  - Progress: 3 / 3 (100%)
  - Cards: ROAD-013, ROAD-014, ROAD-015
- **EPIC-005** — Epic depth
  - Progress: 2 / 2 (100%)
  - Cards: ROAD-016, ROAD-017

## Triage

- **ROAD-023** — Attach documents to roadmap cards
  - Summary: Allow roadmap cards to reference supporting documents and artifacts, such as attaching a review to an implementation card, adding follow-up idea notes, or preserving proof/validation artifacts alongside the card.
- **ROAD-024** — Support active ownership claims on roadmap cards
  - Summary: Let Pi sessions claim roadmap cards so concurrent agents can see which session is actively using a card. Claims should be visible in the board and stored as metadata, enabling discussion of whether this becomes a focused feature or a larger ownership/coordination epic.
  - Epic: EPIC-006
- **ROAD-025** — Show a live agent activity timeline
  - Summary: Provide a chronological feed of active Pi session activity so the roadmap can show what agents are doing now and what just happened, including current steps, notable tool/status events, stalls, and final results. This should complement card ownership claims by making claimed work observable over time.
  - Epic: EPIC-006
  - Depends on: ROAD-024

## Backlog

_No cards._

## Up next

_No cards._

## In progress

_No cards._

## Blocked

_No cards._

## Review

_No cards._

## Completed

- **ROAD-001** — Dark mode with auto toggle
  - Summary: Respect prefers-color-scheme on load and add a manual light/dark toggle persisted to localStorage. Swap the existing CSS custom properties (--surface, --text, --border…) under a [data-theme] attribute on <html>.
  - Epic: EPIC-001
- **ROAD-019** — Epic detail view (open an epic)
  - Summary: Add an epic detail modal: opening an epic shows its full summary, derived progress, and its child cards (click-through to each CardModal). Today epic rows only toggle the board filter (focusEpicId) and the rail clamps the summary to one line with an ellipsis, so the full text is unreadable. Resolve the click conflict with a two-gesture model: single click selects the epic (sets focus/filter, the current focusEpicId behavior), and double click opens the epic detail view.
  - Epic: EPIC-001
- **ROAD-005** — Modal focus management and trap
  - Summary: Return focus to the originating card when the modal closes and trap Tab focus within the dialog for accessibility. CardModal already focuses the panel and handles Escape.
  - Epic: EPIC-001
- **ROAD-002** — Keyboard navigation across cards
  - Summary: Arrow keys move focus between cards within and across columns; Enter opens the card modal. Build on the existing role=button/tabIndex on .card. Modal already closes on Escape.
  - Epic: EPIC-001
- **ROAD-009** — Agent epic delete
  - Summary: Add deleteEpic to model.js (clear child cards' epic_id, log an event, re-export markdown), plus a CLI command and DELETE /api/epics/:id route. Fills the gap found while clearing the board.
  - Epic: EPIC-002
- **ROAD-008** — Surface the events audit trail
  - Summary: Render per-card history in the modal from the events table (event_type, actor_type, created_at). Data is already captured on every mutation but never shown; add a read endpoint or include it in the snapshot.
  - Epic: EPIC-002
- **ROAD-006** — Portable roadmap board skill
  - Summary: Ship a portable Claude Code skill (not MCP, no server) that drives the board through cli.js. A self-contained resolver locates the target board (.pi/roadmap/roadmap.sqlite, walking up from cwd with a ROADMAP_PROJECT_ROOT override) and the CLI, then thin helper scripts wrap the existing write verbs (update/move/assign/epic CRUD/delete/reorder/events) and add token-light reads: get <id> (card + its events) and a filtered list (by status/epic) instead of the full snapshot dump. Surface valid statuses and parsed validation errors. Mutations already auto-export ROADMAP.md, so no manual export step. Requires Node 22+ (node:sqlite).
  - Epic: EPIC-002
- **ROAD-012** — Dependency cycle detection
  - Summary: Reject a depends_on/enables link that would form a cycle. model.js validateCardIds already checks existence and self-links but not cycles; extend agentUpdate validation.
  - Epic: EPIC-003
- **ROAD-010** — Ready-next view
  - Summary: Surface cards whose depends_on targets are all completed (and that aren't completed themselves). Expose as a UI filter/badge and a CLI query. Uses existing depends_on data, no new schema.
  - Epic: EPIC-003
- **ROAD-011** — Auto-flag dependency-blocked cards
  - Summary: Visually mark a card as effectively blocked when any depends_on target isn't completed, distinct from the explicit 'blocked' status. Derived at render time, not stored.
  - Epic: EPIC-003
  - Depends on: ROAD-010, ROAD-012
- **ROAD-013** — Server/API endpoint tests
  - Summary: DONE: Added tests/server.test.js — 8 tests covering all 8 Express routes (snapshot, events, agentUpdate, epic create/update/delete, assign-epic, move). Zero new deps: boots startServer on an ephemeral port and drives it over real HTTP with global fetch. Asserts happy paths, the httpError->HTTP status mapping via the error middleware (400/404), the {error} envelope, and agent-actor attribution. Full suite green: 27/27 (19 model + 8 server).
  - Epic: EPIC-004
- **ROAD-014** — UI error and offline states
  - Summary: Handle fetch failures in the client: load() ignores res.ok and the 2s poller swallows errors, so a downed server shows a blank board. Add an error/offline banner with retry.
  - Epic: EPIC-004
- **ROAD-016** — Agent epic rename
  - Summary: Hardened the agent epic-rename path (model.updateEpic + CLI epic-update + PATCH /api/epics/:id). updateEpic now whitelists title/summary/sort_index (400 on unknown keys), logs only fields that actually changed, short-circuits no-op patches (no event/updated_at churn), and records renamed_from/renamed_to for an auditable rename trail. Added model + server tests. Browser remains read-only.
  - Epic: EPIC-005
  - Depends on: ROAD-009
- **ROAD-015** — Migration and concurrency hardening
  - Summary: Hardened the SQLite forward-migration path and concurrent-writer safety on the single WAL database. Migrations are now versioned via PRAGMA user_version with an append-only, idempotent step list applied in transactions on open; legacy unversioned DBs upgrade with no data loss. All mutations run in BEGIN IMMEDIATE transactions (atomic row+event+markdown), with busy_timeout=5000 and synchronous=NORMAL so concurrent writers queue instead of failing. Added tests/migration.test.js covering partial/legacy/idempotent schemas and transaction rollback; documented the concurrency model in README.
  - Epic: EPIC-004
- **ROAD-017** — Agent epic reorder
  - Summary: Let agents reorder epics by setting sort_index (updateEpic already accepts it; add a clear reorder command/route). No manual drag in the browser.
  - Epic: EPIC-005
  - Depends on: ROAD-009
  - Blocked reason: reorderEpics added across model/CLI/server/skill with tests; UI unchanged (read-only by design)
