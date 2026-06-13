# Roadmap Board

A per-project planning surface that lets a user capture rough ideas while an agent maintains the structured roadmap and generated markdown.

## Language

**Roadmap Board**:
A per-project board of cards that represents proposed, planned, active, blocked, and completed work.
_Avoid_: Global board, project manager

**Roadmap Card**:
A durable unit of proposed or planned work with a stable identifier and structured fields.
_Avoid_: Ticket, issue, task

**Epic**:
A broader roadmap grouping that collects related **Roadmap Cards** and exposes derived progress.
_Avoid_: Project, release, theme tag

**Card ID**:
A human-readable immutable identifier for a Roadmap Card, formatted like ROAD-001.
_Avoid_: Slug, database row ID

**Epic ID**:
A human-readable immutable identifier for an **Epic**, formatted like EPIC-001.
_Avoid_: Slug, database row ID

**Triage**:
The only user-editable intake column for unsorted ideas and requests.
_Avoid_: Inbox, scratchpad

**Generated Roadmap**:
A markdown rendering of the Roadmap Board intended for reading and sharing, not editing.
_Avoid_: Source document, editable mirror

**Agent-Managed Workflow**:
The rule that users capture and prioritize ideas in Triage while agents move cards through the remaining columns.
_Avoid_: Permissions, security model

**Review**:
A workflow column for work that has been executed but still needs assessment before completion.
_Avoid_: QA, approval

**Dependency**:
A structured relationship where one Roadmap Card should not proceed until another Roadmap Card is addressed.
_Avoid_: Free-text prerequisite

**Blocked Reason**:
A short explanation of why a Roadmap Card is currently blocked.
_Avoid_: Dependency, status note

**Enablement**:
A structured relationship where completing one Roadmap Card makes another Roadmap Card easier or possible.
_Avoid_: Benefit, unlock

**Epic Progress**:
The derived `done / total` and percentage for an **Epic**, based only on its child **Roadmap Cards**.
_Avoid_: Manual slider value, estimate

**Prompt Action**:
A copyable instruction template for asking an agent to work with a specific Roadmap Card.
_Avoid_: Button, command

**Brainstorm**:
A Prompt Action that sharpens a rough Roadmap Card into a clearer idea without planning or executing it.
_Avoid_: Flesh out, scope

**Agent Command**:
A validated command-line operation that lets an agent read or update the Roadmap Board.
_Avoid_: Direct database edit

**Roadmap Event**:
A minimal timestamped record of a meaningful change to the Roadmap Board, attributed to user, agent, or system.
_Avoid_: Full audit log, changelog

## Relationships

- A **Roadmap Board** belongs to exactly one project or workspace.
- A **Roadmap Board** contains many **Roadmap Cards**.
- A **Roadmap Board** contains many **Epics**.
- Each **Roadmap Card** has exactly one immutable **Card ID**.
- Each **Epic** has exactly one immutable **Epic ID**.
- A **Roadmap Card** may belong to zero or one **Epic**.
- A **Dependency** or **Enablement** links one **Roadmap Card** to another by **Card ID**.
- **Epic Progress** is derived from child **Roadmap Cards**, not edited directly.
- **Epics** are ordered by a stable manual sort index rather than by dependency links.
- A **Roadmap Card** in Blocked must have a **Blocked Reason**.
- A **Prompt Action** includes the target **Card ID** when copied.
- **Brainstorm** is a **Prompt Action** for sharpening an idea before planning.
- **Brainstorm** refines a **Triage** card in place rather than promoting it to another column.
- The fixed **Prompt Actions** are Brainstorm, Plan, Execute, and Review, with configurable template text.
- Agents update the **Roadmap Board** through **Agent Commands** rather than direct storage edits.
- **Agent Commands** validate column names but do not enforce a strict status transition graph.
- The local database records minimal **Roadmap Events** for creates, updates, moves, reorders, and exports.
- Each **Roadmap Event** records only an actor type: user, agent, or system.
- A **Roadmap Card** may start in **Triage** before an agent moves it into the planned workflow.
- A **Roadmap Card** created in **Triage** requires only a title; users may edit its title and summary while it remains in **Triage**.
- A **Generated Roadmap** reflects the current **Roadmap Board** but is not the board's source of truth.
- A **Generated Roadmap** uses compact card details: Card ID, title, summary, dependencies, enablements, and blocked reason when present.
- A **Generated Roadmap** includes an **Epics** section with each **Epic's** progress and child card list.
- A **Generated Roadmap** shows a card's **Epic ID** when the card belongs to an **Epic**.
- The **Generated Roadmap** is refreshed after every validated write to the **Roadmap Board**.
- The **Generated Roadmap** is intended to be committed; the board's local storage is not.
- A fresh clone without local board storage treats the **Generated Roadmap** as a read-only snapshot, not a source to rehydrate from.
- An **Agent-Managed Workflow** lets users edit **Triage** while agents manage non-triage status changes.
- Users can reorder **Triage** cards to express priority, but cannot drag cards across columns.
- The **Roadmap Board** uses seven fixed columns: **Triage**, Backlog, Up next, In progress, Blocked, **Review**, and Completed.
- Completed cards remain on the **Roadmap Board** but are collapsed by default in the UI.

## Example dialogue

> **Dev:** "Can I add a rough idea directly to the board?"
> **Domain expert:** "Yes, but only in **Triage**. The agent turns it into a structured **Roadmap Card** before moving it forward."

## Flagged ambiguities

- "Where the board lives" was resolved as per-project rather than global or standalone.
- "ROADMAP.md" was resolved as a **Generated Roadmap**, not an editable mirror.
- "Locked by the agent" was resolved as workflow enforcement through the app/API, not a security boundary.
- The MVP column set was resolved as seven fixed columns, including **Review** before Completed.
- Immutable card identifiers were resolved as human-readable sequential **Card IDs** such as ROAD-001.
- "Depends on" and "enables" were resolved as **Card ID** links only, not free text.
- Prompt templates were resolved as project configuration rather than database content.
- "Brainstorm" was accepted as the term for sharpening a rough idea.
- Prompt actions were resolved as a fixed action set with editable template text.
- User-created **Triage** cards require only a title.
- The MVP **Roadmap Card** schema excludes plan notes, review notes, and history fields.
- **Epics** were resolved as first-class records rather than card subtypes or free-form labels.
- **Epic Progress** was resolved as derived from child card completion rather than manually edited.
- **Epics** were resolved to use stable manual ordering, with no epic-level dependency graph in the MVP.
- SQLite history was resolved as minimal **Roadmap Events**, not full audit diffs.
- Event attribution was resolved as actor type only, not full identity.
- Agent status movement was resolved as loose valid-column moves rather than strict transitions.
- Blocked cards must include a **Blocked Reason**; blocking dependencies remain structured Card ID links only.
- Completed cards were resolved as visible but collapsed by default.
- Markdown card rendering was resolved as compact domain details, excluding implementation metadata.
- User drag-and-drop was resolved as reorder-within-**Triage** only.
- Agent updates were resolved as validated CLI-style **Agent Commands**.
- Markdown export was resolved as automatic after every validated write.
- Version control scope was resolved as committed markdown and prompt configuration, with local board storage ignored.
- Fresh clones without local storage start with an empty editable board while retaining the committed **Generated Roadmap** as a snapshot.
- Project roadmap artifacts were resolved to live under `.pi/roadmap/`, tying the MVP to Pi project conventions.
- Git ignore rules should ignore local SQLite state under `.pi/roadmap/` while allowing shared prompt configuration to be committed.
- User editing in **Triage** was resolved as title and summary only; dependencies, enables, and status are agent-managed.
- **Brainstorm** was resolved as in-place refinement, not promotion or execution.
