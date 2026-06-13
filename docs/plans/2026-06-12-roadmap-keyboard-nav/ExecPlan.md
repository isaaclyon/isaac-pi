# Keyboard navigation across cards (ROAD-002)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` should be kept up to date as implementation proceeds.

- **Card:** ROAD-002 — Keyboard navigation across cards
- **Epic:** EPIC-001 — Board UX polish
- **Status at planning:** Backlog
- **Scope:** client-only (`roadmap-board/src/client/main.jsx`; a small `:focus-visible`/scroll touch in `styles.css` if needed)

## Purpose / Big Picture

Today every `.card` is reachable by `Tab` (it's `role="button" tabIndex={0}`) and opens its modal on Enter/Space (main.jsx:224–227). What's missing is **spatial movement**: a keyboard user can't walk the board the way the eye does — down a column, then across to the next. With a real board they'd have to Tab through every card in document order.

The board is a horizontal CSS grid of columns (`grid-auto-flow: column`, styles.css:127), each column a vertical flex stack of cards (`.column-body`, styles.css:143). So the natural mapping is:

- **↑ / ↓** — previous / next card **within the focused column**.
- **← / →** — jump to the **adjacent column**, landing on the card at the same vertical position (clamped).
- **Enter / Space** — open the focused card's modal (already works; unchanged).
- **Home / End** (nice-to-have) — first / last card in the current column.

After this change the board is fully operable by keyboard: Tab to enter the board, arrows to move, Enter to open, Escape to close (ROAD-005), focus returns to the card (ROAD-005).

## Definition of Done

- With focus on a card, ↑/↓ move focus to the adjacent card in the same column; at the ends it's a no-op (no wrap, no error).
- ←/→ move focus to the nearest non-empty column in that direction, landing on the card whose row index matches the current one, clamped to that column's last card. Empty columns and the collapsed Completed column are skipped.
- Arrow keys `preventDefault` so the page/board doesn't also scroll; when the target card is in an off-screen column, it's scrolled into view.
- Enter/Space still open the modal; the ROAD-005 focus-return still lands back on the originating card.
- No regression to `Tab` reachability or to the open modal: arrow keys pressed while a modal is open do **not** move board focus underneath it.
- `npm run build` is clean and `npm test` (server `model.js`) still passes — no server surface touched.

## Design / Approach

### Decision: keep all cards tabbable + layer arrows on top (not roving tabindex)

The ARIA Authoring Practices "grid"/composite-widget pattern uses **roving tabindex** (one card `tabIndex={0}`, the rest `-1`, so Tab enters the grid once and arrows move within). That's the stricter model, but it changes today's behavior (Tab currently steps through every card) and the card text explicitly says *"Build on the existing role=button/tabIndex on .card."* These cards are also independent buttons, not cells of one composite widget. So: **keep every card `tabIndex={0}` and add arrow movement as an enhancement.** Tab-through-all stays; arrows are additive. Roving tabindex is recorded as a possible future a11y refinement (see Out of scope).

### Where the handler lives: the `.board` element, not `window`

Attach a single `onKeyDown` to the `.board` `<section>` (main.jsx:172). Arrow events bubble from the focused card up to `.board`. This is deliberate over a `window` listener:

- It only fires when focus is actually on a card (or its child) inside the board.
- The modals (`CardModal`/`EpicModal`) render as **siblings** of `.board` at the end of `<main>` (main.jsx:200–215), so when a modal is open its keydowns never bubble through `.board`. This keeps arrow nav from moving the board behind an open dialog — and stays clear of the ROAD-005 hook's `window`-level Tab/Escape trap.

### Neighbor computation: DOM + data attributes

Add `data-card-id={card.id}` to the `Card` article (main.jsx:222) so the focused card is identifiable and the logic is testable/robust. Column identity already exists via `.column[data-status]` (styles.css:129–135). The handler reads structure from the live DOM rather than mirroring it in React state — there's no focus state to keep in sync, and the DOM already encodes column order and card order.

```js
// Inside App, memoized so the .board onKeyDown is stable.
function onBoardKeyDown(e) {
  const card = e.target.closest('.card');
  if (!card) return;                                  // header buttons etc. — ignore
  const key = e.key;
  if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(key)) return;

  const body = card.closest('.column-body');
  const cardsInCol = [...body.querySelectorAll('.card')];
  const row = cardsInCol.indexOf(card);

  let target = null;
  if (key === 'ArrowUp')   target = cardsInCol[row - 1];
  else if (key === 'ArrowDown') target = cardsInCol[row + 1];
  else if (key === 'Home')  target = cardsInCol[0];
  else if (key === 'End')   target = cardsInCol[cardsInCol.length - 1];
  else {
    // Horizontal: scan sibling .column elements for the next non-empty one.
    const board = card.closest('.board');
    const columns = [...board.querySelectorAll(':scope > .column')];
    const colEl = card.closest('.column');
    const colIdx = columns.indexOf(colEl);
    const step = key === 'ArrowRight' ? 1 : -1;
    for (let i = colIdx + step; i >= 0 && i < columns.length; i += step) {
      const sibCards = [...columns[i].querySelectorAll('.card')];
      if (sibCards.length === 0) continue;            // skip empty / collapsed-Completed columns
      target = sibCards[Math.min(row, sibCards.length - 1)];  // clamp to last
      break;
    }
  }

  if (target) {
    e.preventDefault();                               // stop the board/page from also scrolling
    target.focus();
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
```

Wire it as `<section className="board" aria-label="Roadmap columns" onKeyDown={onBoardKeyDown}>`. Define `onBoardKeyDown` as a plain function in `App` (or `useCallback` — it closes over nothing stateful, so either is fine).

### Why the collapsed Completed column is handled for free

When `collapsedCompleted` is true, the column body renders a `<p class="empty">` and **no `.card` nodes** (main.jsx:184). The horizontal scan's `sibCards.length === 0` check skips it automatically — no special case. Same for any genuinely empty column and for the epic-focus filter (only rendered cards are queried).

### `Card` change

Single attribute add:

```jsx
<article className="card" data-card-id={card.id} role="button" tabIndex={0}
         onClick={onOpen}
         onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
```

The existing Enter/Space handler stays on the card and runs first; arrow keys fall through it (it only acts on Enter/Space) and are handled by the board delegate. No conflict.

## Edge cases & risks

- **Space scroll:** Space is already `preventDefault`ed by the card's handler (opens modal), so no page-jump there. Arrow `preventDefault` covers the rest.
- **Focused card removed by a poll:** the 2s poll can re-render/replace card nodes. Focus is read live from `e.target` at keypress time, so a stale closure can't misfire; worst case a poll lands mid-navigation and focus falls to body — acceptable and self-correcting on next Tab.
- **`:scope > .column`** is used so nested elements can't be mistaken for columns; supported in all current evergreen browsers (consistent with the build target).
- **RTL:** ←/→ are mapped to physical previous/next column. The board is LTR-only today; if RTL is ever added, swap by `dir`. Noted, not handled.
- **Single column / single card:** all moves resolve to `undefined` target → silent no-op.
- **Interplay with ROAD-005 (shipped):** verified by design — modal is a DOM sibling of `.board`, so arrows don't leak behind it. Re-confirm in manual testing step 5.

## Verification

No client test harness exists (only server-side `tests/model.test.js`; client testing is EPIC-004 / ROAD-013–014). Manual verification via `npm run dev`:

1. **Within column:** Tab to a card in a multi-card column → ↓ moves down card-by-card, ↑ back up; no wrap at the ends; page doesn't scroll on each press.
2. **Across columns:** → lands on the same-row card in the next non-empty column; when that column is shorter, lands on its last card; ← reverses.
3. **Skips:** put focus next to an empty column and to the collapsed Completed column → → jumps over them to the next column with cards.
4. **Off-screen scroll:** narrow the window so right-hand columns are scrolled off → → into them brings the focused card into view.
5. **Modal isolation:** open a card (Enter) → press arrows → the board behind does **not** move; Escape returns focus to the card (ROAD-005), and arrows resume working.
6. `npm run build` clean; `npm test` green.

## Out of scope

- Roving-tabindex / `role="grid"` conversion — a stricter a11y model that changes Tab semantics; future refinement, not this card.
- Type-ahead / search-driven focus — that's ROAD-003 (search & filter bar).
- Drag/reorder, RTL support, touch gestures.
- A client test harness — EPIC-004.

## Progress

_Not started._

## Surprises & Discoveries

- The card is already keyboard-*openable* (Enter/Space shipped); only spatial arrow movement is missing, making this a small additive change.
- Collapsed/empty columns need no special-casing — they render zero `.card` nodes, so the "skip empty column" scan handles them.
- **Focus ring flickered on mid-column cards** during review. Root cause: `.card:focus-visible` relies on a browser heuristic that doesn't reliably match scripted `.focus()`, so the ring showed on the first (Tab-focused) card but not on arrow-navigated ones. Fixed by passing `focus({ focusVisible: true })` to force the keyboard ring; unsupported browsers ignore the dict member and degrade to prior behavior.

## Decision Log

- **Keep all cards `tabIndex={0}` + layer arrows** (not roving tabindex) — matches the card's "build on existing tabIndex" instruction and treats cards as independent buttons; roving tabindex noted as a future option.
- **Handler on `.board`, not `window`** — scopes nav to card focus and avoids firing behind ROAD-005's modal Tab/Escape trap.
- **DOM-driven neighbor lookup via `data-card-id` + existing column structure** — no duplicate focus state to keep in sync with the DOM.

## Outcomes & Retrospective

_Pending implementation._
