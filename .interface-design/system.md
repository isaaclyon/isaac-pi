# Roadmap Board — Interface Design System

The visual + interaction language for the roadmap board UI
(`roadmap-board/src/client/`). Decisions here are made; apply them, don't
re-litigate them.

## Core reframe (read this first)

**The browser UI is read-only.** Every mutation — create, move, claim,
assign epic — flows through *agents* via CLI/API. A human looking at this
board cannot edit it. So this is **not a kanban**; it is a **monitoring +
dispatch control surface**. Two consequences shape everything:

1. The board's job is *legibility at a glance* — who's working on what,
   what's unblocked, where work is stuck. Optimize for scanning, not editing.
2. The only action a human takes is **dispatching an agent**. That action is
   the focal point of the detail modal, not an afterthought.

## Domain vocabulary (use these words in UI + tokens)

- **Claim** — a live agent owning a card (`claimed_by` = session id,
  `claimed_at`, optional note). Shown with a lock icon + short session +
  age + note.
- **Readiness** — derived from the dependency graph, *orthogonal to column*.
  A card is **Ready** (deps complete) or **Waiting** (deps outstanding)
  regardless of which status lane it sits in.
- **Dispatch** — handing a prompt to an agent: Brainstorm / Plan / Execute /
  Review. This is the verb of the product.
- **Epic** — a progress vessel. Cards roll up into `done/total` + percent.
- **Provenance** — every event has an actor: user / agent / system.

## Direction & feel

Calm, technical, legible. A control room you *read*, not a workspace you
poke. Quiet surfaces, one loud signal per card. Inter for UI, ui-monospace
for ids/sessions/paths (anything machine-assigned).

## Depth strategy

**Surface color shifts + hairline borders.** No dramatic shadows. Cards get
only `--shadow-card` (≤0.06 alpha). Hierarchy comes from `--page-bg` →
`--surface-sunk` (columns) → `--surface` (cards) → `--surface-raised`
(modals), each a few percent apart. Borders are low-contrast
(`--border`, `--border-strong` for emphasis). Squint test: structure
survives, nothing jumps.

## Color tokens

Light/dark defined in `:root` / `[data-theme="dark"]`; theme resolved
pre-paint in `index.html` (light/dark/system tri-state).

- **Brand** `--brand` `#1f66d1` (dark `#4d8df0`); `--brand-soft` for meter
  gradient starts; `--brand-tint`/`--accent-line` for quiet fills.
- **Semantic, always tint+line+fg triples** so they work on any surface:
  - Ready → `--ready-*` (green)
  - Waiting/Blocked → `--blocked-*` (amber)
  - Claim → `--claim-*` (violet) — agent ownership has its own hue, distinct
    from status
  - Error → `--error-*` (red)
- **Never hardcode hex in rules.** Backdrops use `rgb(var(--shadow-rgb)/α)`,
  meters use `--brand-soft`→`--brand`. (Three such leaks were removed; don't
  reintroduce them.)

### Status lane hues (column top-border + name)

Active lanes carry color, parked lanes are muted gray — the eye goes to
where work moves.

- up_next `#0ea5e9` · in_progress `#2563eb` · blocked `#f59e0b` ·
  review `#a855f7`
- **Parked** (triage / backlog / completed): `--border-strong` top border,
  `--text-muted` name. No hue.

## Spacing & geometry

- Base unit **4px**; tile internals run tight (5–7px gaps) — this is a dense
  workbench, not a brochure.
- `--radius: 12px` (cards/modals); pills `999px`.
- `--board-column-width: 224px` — deliberately narrow so ~6 lanes show on a
  laptop. **Design tiles against this tight case**, not a comfortable width.

## Component patterns

- **Card tile** — `.card-top` row: `.card-id` (faint mono) + `.epic-ref`
  (quiet brand mono, *not* a filled pill) + one `.state-badge`
  (`.is-ready` / `.is-waiting`, `margin-left:auto`). Row is
  `flex-wrap: wrap` with `white-space: nowrap` on id/ref so a wide badge
  drops to a right-aligned second line instead of breaking a token.
  Then `.card-title` (weight 680), optional `.claim-line` (lock + session +
  age + note), `.card-summary`, `.card-meta` footer (doc count · needs ·
  enables), `.card-blocked-reason`.
- **One loud element rule** — a tile's single high-contrast mark is the
  state badge. Epic ref, id, claim are all quiet. The filled `.epic-chip`
  is reserved for the *detail modal*, never the tile.
- **Epic row** — `auto minmax(0,1fr) 132px auto` grid: id · copy ·
  `.epic-progress` (label `done/total · %` over meter) · Open. No negative
  margins. Mobile reflows via `grid-template-areas`.
- **Card modal footer = the focal point.** `.dispatch` block first
  (uppercase `.dispatch-label` "Dispatch an agent" + four equal-weight
  `flex:1` prompt buttons with accent borders), then a secondary
  `.modal-refine` row (ghost button) for a custom adjustment.
- **Empty states are contextual**, never blank: "Nothing parked here yet.",
  "Nothing waiting on review.", "No triage cards yet — an agent adds them."
- **Icons** — inline stroke SVGs via an `<Icon>` wrapper (currentColor,
  configurable size/stroke). Sun/Moon/Monitor for theme tri-state; Lock for
  claims; Doc for document counts. No emoji.

## Interaction states

Every interactive element: default / hover / active / focus-visible /
disabled. `:hover` guarded with `:not(:disabled)`. `button:disabled` →
`cursor:not-allowed; opacity:.45`. Focus ring = `2px solid var(--brand)`.

## Verify before shipping

Rebuild `dist` (`npm run build`) then screenshot light + dark + mobile (390w)
+ both modals + epic-filter state. The screenshot harness lives in
`/tmp/rmshot/` (seed.mjs + shoot.mjs, puppeteer-core driving installed
Chrome). The 224px column is where layout bugs surface — check it first.
