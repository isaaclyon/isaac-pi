# Roadmap

> Generated from `.pi/roadmap/roadmap.sqlite`. Do not edit directly.

## Epics

- **EPIC-001** — Board UX polish
  - Summary: Refinements to the read-only board UI: theming, keyboard navigation, search, first-load, and accessibility.
  - Progress: 4 / 4 (100%)
  - Cards: ROAD-001, ROAD-019, ROAD-005, ROAD-002
- **EPIC-002** — Frictionless agent loop
  - Summary: Close the gap between the board and the agent: native API access, deep links, history, and the missing epic delete.
  - Progress: 3 / 3 (100%)
  - Cards: ROAD-009, ROAD-008, ROAD-006
- **EPIC-003** — Dependencies & sequencing
  - Summary: Turn the existing depends_on/enables data into planning value: ready-next, blocked-by-dependency, cycle safety.
  - Progress: 3 / 3 (100%)
  - Cards: ROAD-012, ROAD-010, ROAD-011
- **EPIC-004** — Robustness & tests
  - Summary: Keep the board from failing silently as it becomes load-bearing: API tests, UI error states, migration hardening.
  - Progress: 0 / 3 (0%)
  - Cards: ROAD-013, ROAD-014, ROAD-015
- **EPIC-005** — Epic depth
  - Summary: Deepen the grouping layer with metadata and agent-only management. No target dates; no manual reorder.
  - Progress: 0 / 3 (0%)
  - Cards: ROAD-016, ROAD-017, ROAD-018

## Triage

_No cards._

## Backlog

- **ROAD-013** — Server/API endpoint tests
  - Summary: Add tests for the Express routes in server.js (snapshot, agentUpdate, move, epic create/update, assign). Only model.js is covered today.
  - Epic: EPIC-004
- **ROAD-014** — UI error and offline states
  - Summary: Handle fetch failures in the client: load() ignores res.ok and the 2s poller swallows errors, so a downed server shows a blank board. Add an error/offline banner with retry.
  - Epic: EPIC-004
- **ROAD-015** — Migration and concurrency hardening
  - Summary: Harden the SQLite forward-migration path and guard/document concurrent writers on the single WAL database. Add a migration test for older/partial schemas.
  - Epic: EPIC-004
- **ROAD-016** — Agent epic rename
  - Summary: Expose epic rename via the agent path (updateEpic already supports title/summary); ensure CLI/API and event logging are clean. Browser stays read-only.
  - Epic: EPIC-005
  - Depends on: ROAD-009
- **ROAD-017** — Agent epic reorder
  - Summary: Let agents reorder epics by setting sort_index (updateEpic already accepts it; add a clear reorder command/route). No manual drag in the browser.
  - Epic: EPIC-005
  - Depends on: ROAD-009
- **ROAD-018** — Epic color accents
  - Summary: Give each epic an optional color used on its chips and the progress rail. Add a nullable color field on epics; render in main.jsx/styles.css.
  - Epic: EPIC-005

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
