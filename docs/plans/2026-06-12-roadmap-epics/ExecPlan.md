# Add first-class epics to the Roadmap Board

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` should be kept up to date as implementation proceeds.

## Purpose / Big Picture

The Roadmap Board currently tracks individual Roadmap Cards, their workflow status, and card-to-card sequencing, but it cannot express broader milestones or thematic groupings. Users can see what work exists, yet they cannot quickly answer "how far along are we on this bigger area of work?" or "which cards belong together?"

After this change, the Roadmap Board should support first-class Epics as durable grouping records for Roadmap Cards. Each Epic should render as a compact progress rail with a derived completion percentage from child cards, while cards continue to live in the existing status columns. This keeps the board card-first while adding a higher-level roadmap view.

## Definition of Done

This work is complete when the roadmap model, API/CLI, generated markdown, and React UI all support first-class Epics with the following behavior:

- Epics are stored separately from Roadmap Cards and have stable immutable IDs such as `EPIC-001`.
- A Roadmap Card can belong to zero or one Epic through an optional `epic_id`.
- Epic progress is derived only from child cards: `done / total`, percentage, and completed-state fill.
- Epic ordering is stable via `sort_index` by default; there are no Epic-level `depends_on` or `enables` fields in this pass.
- The UI shows an Epic rail with one horizontal progress row per Epic and shows Epic chips on cards.
- The generated `ROADMAP.md` includes an `Epics` section and shows a card's Epic when present.
- Existing local SQLite databases migrate forward without losing cards.
- Focused tests prove Epic persistence, assignment, ordering, and derived progress.

## Progress

- [x] (2026-06-12) Re-read the current roadmap domain context, generated markdown format, README, and implementation in `roadmap-board/src/server/` and `roadmap-board/src/client/`.
- [x] (2026-06-12) Confirmed the intended product direction with the user: first-class Epics, derived progress rails, default manual ordering via `sort_index`, and no Epic dependency graph in this pass.
- [x] (2026-06-12) Wrote this implementation plan into `docs/plans/2026-06-12-roadmap-epics/ExecPlan.md`.
- [x] (2026-06-12) Added focused tests for Epic creation, assignment, export, and forward migration in `roadmap-board/tests/model.test.js`.
- [x] (2026-06-12) Implemented SQLite migration plus model methods for Epics and `cards.epic_id` in `roadmap-board/src/server/model.js`.
- [x] (2026-06-12) Extended CLI/API snapshot shape for Epic creation, update, assignment, and rendering in `roadmap-board/src/server/cli.js` and `roadmap-board/src/server/server.js`.
- [x] (2026-06-12) Added the Epic rail and card Epic chips in the React UI via `roadmap-board/src/client/main.jsx` and `roadmap-board/src/client/styles.css`.
- [x] (2026-06-12) Updated domain docs and README, regenerated `ROADMAP.md`, and ran targeted validation (`npm test`, `npm run build`, CLI export, browser smoke).

## Surprises & Discoveries

- Observation: the current board already treats sequencing as a separate concern (`depends_on` / `enables`), so Epics can stay focused on grouping and progress without inheriting dependency semantics.
  Evidence: `roadmap-board/src/server/model.js` stores card links only on `cards`, and `CONTEXT.md` defines Dependency and Enablement strictly as card-to-card relationships.

- Observation: the local project already has a live roadmap SQLite file under `.pi/roadmap/`, so adding Epics requires a real forward migration rather than a schema reset.
  Evidence: `.pi/roadmap/roadmap.sqlite` exists in the repo root and `ROADMAP.md` is generated from it.

## Decision Log

- Decision: model Epics as a first-class table instead of a card subtype or free-form tag.
  Rationale: grouping records need stable rename-safe identity, their own metadata, and clean future room for derived progress and milestone support.
  Date/Author: 2026-06-12 / coding agent.

- Decision: derive Epic progress from child card completion rather than store editable progress.
  Rationale: a draggable or manually-entered percentage would drift from the actual card state and weaken the roadmap as a source of truth.
  Date/Author: 2026-06-12 / coding agent.

- Decision: order Epics by `sort_index` then ID in this pass.
  Rationale: roadmap order should stay stable and narrative by default; pure progress sorting would reshuffle the board constantly.
  Date/Author: 2026-06-12 / coding agent.

- Decision: exclude Epic-level `depends_on` and `enables` fields from this pass.
  Rationale: card-level sequencing already exists, and duplicating it one level up would add complexity before there is real evidence it is needed.
  Date/Author: 2026-06-12 / coding agent.

## Outcomes & Retrospective

Implementation landed across the roadmap model, CLI/API, markdown export, and React UI.

Delivered pieces:

- `roadmap-board/src/server/model.js` now creates and migrates an `epics` table, adds nullable `cards.epic_id`, derives Epic progress from child cards, and exports an `Epics` section in `ROADMAP.md`.
- `roadmap-board/src/server/cli.js` and `roadmap-board/src/server/server.js` now support Epic create/update and card-to-Epic assignment flows.
- `roadmap-board/src/client/main.jsx` and `roadmap-board/src/client/styles.css` now render an Epic progress rail plus Epic chips on cards without changing the existing card-column workflow.
- `CONTEXT.md`, `roadmap-board/README.md`, and the generated root `ROADMAP.md` now describe and reflect the Epic model.
- `roadmap-board/tests/model.test.js` now covers Epic IDs, ordering, progress derivation, export behavior, and forward migration of older SQLite files.

Validation completed:

- `cd roadmap-board && npm test`
- `cd roadmap-board && npm run build`
- `node roadmap-board/src/server/cli.js export`
- Browser smoke via the served app at `http://127.0.0.1:4177`, verifying the Epic rail renders in the UI.

## Context and Orientation

Relevant files for this slice:

- `CONTEXT.md`
- `ROADMAP.md`
- `roadmap-board/README.md`
- `roadmap-board/src/server/model.js`
- `roadmap-board/src/server/cli.js`
- `roadmap-board/src/server/server.js`
- `roadmap-board/src/client/main.jsx`
- `roadmap-board/src/client/styles.css`
- `roadmap-board/tests/model.test.js`

The current model keeps cards in a single `cards` table with workflow status, links, and generated markdown export. The UI renders fixed workflow columns and prompt-copy actions, but no grouping surface above cards.

## Plan of Work

First, extend the tests to define the Epic behavior. Add coverage for forward migration, Epic ID generation, stable ordering by `sort_index`, optional card-to-Epic assignment, and markdown export of the new `Epics` section plus per-card Epic labels.

Second, add the schema and model changes in `roadmap-board/src/server/model.js`. Introduce an `epics` table with immutable Epic IDs, title, summary, `sort_index`, and timestamps. Add `cards.epic_id` as a nullable field, migrate older databases safely, expose Epic CRUD and assignment methods, and compute derived progress (`done`, `total`, `percent`, child card IDs) from card state.

Third, extend the server interfaces. The roadmap snapshot should include `epics` alongside `columns`, `prompts`, and `cards`. The CLI and Express API should support creating and updating Epics plus assigning or clearing `card.epic_id`, even if the first UI pass only renders rather than edits them interactively.

Fourth, add the Epic rail to the client UI. Render one row per Epic above the board with title, summary, `done / total`, and a horizontal progress bar. Render Epic chips on cards and preserve the existing board interactions.

Fifth, update the written artifacts. Add Epic terminology to `CONTEXT.md`, document the feature in `roadmap-board/README.md`, and regenerate the root `ROADMAP.md` with the new `Epics` section.

## Validation and Acceptance

Targeted validation for this change should include at least:

```sh
cd roadmap-board && npm test
cd roadmap-board && npm run build
cd .. && node roadmap-board/src/server/cli.js export
```

Acceptance evidence should show:

- tests passing for Epic creation, assignment, and export;
- a successful production build for the React UI;
- regenerated `ROADMAP.md` containing the new `Epics` section;
- no regression in existing card workflows.

## Idempotence and Recovery

The SQLite migration must be safe to run repeatedly against both fresh and existing local databases. If an existing database lacks the `epics` table or `cards.epic_id` column, initialization should add them in place without resetting `cards`, `meta`, or `events`.

Epic progress must remain purely derived so recovery is simple: if card state is correct, Epic progress recomputes on every snapshot/export without repair logic.

## Interfaces and Dependencies

The model layer should expose a shape roughly like:

```js
store.epics()
store.createEpic({ title, summary, sort_index })
store.updateEpic(epicId, patch)
store.assignEpic(cardId, epicIdOrNull)
```

The roadmap snapshot should include derived Epic summaries:

```js
{
  id,
  title,
  summary,
  sort_index,
  card_ids,
  done_count,
  total_count,
  percent_complete
}
```

The UI should treat the progress bar as read-only derived output, not a direct editing control.
