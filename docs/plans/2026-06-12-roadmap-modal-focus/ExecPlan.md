# Modal focus management and trap (ROAD-005)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` should be kept up to date as implementation proceeds.

- **Card:** ROAD-005 — Modal focus management and trap
- **Epic:** EPIC-001 — Board UX polish
- **Status at planning:** Backlog
- **Scope:** client-only (`roadmap-board/src/client/main.jsx`; possibly a one-line CSS guard in `styles.css`)

## Purpose / Big Picture

The board has two dialogs — `CardModal` (main.jsx:343) and `EpicModal` (main.jsx:297). Both share the same shell: a `.modal-backdrop` that closes on click, a `.modal` panel with `role="dialog" aria-modal="true" tabIndex={-1}`, and one `useEffect` that adds an Escape-to-close `keydown` listener and focuses the panel on open.

Two accessibility gaps remain, and they are exactly what `aria-modal="true"` *promises* but the code does not yet deliver:

1. **No focus restoration.** When a modal closes, focus is lost to `document.body`. A keyboard user who opened a card with Enter is dumped to the top of the document and must Tab all the way back. Correct behavior: return focus to the element that opened the dialog (the originating card / epic row).
2. **No focus trap.** `aria-modal="true"` tells assistive tech that the rest of the page is inert, but `Tab` still walks into the board behind the dialog. Correct behavior: `Tab`/`Shift+Tab` cycle only within the dialog.

After this change both modals behave like a proper modal dialog: open → focus moves in, Tab is trapped, Escape/close/backdrop dismisses, and focus returns to the trigger.

## Definition of Done

- Opening a card via keyboard (Enter/Space on a `.card`) and then closing it (Escape, the × button, or backdrop click) returns focus to **that same card**. Same for `EpicRow` → `EpicModal`.
- While a modal is open, `Tab` from the last focusable element wraps to the first, and `Shift+Tab` from the first wraps to the last. Focus never escapes to the board behind the dialog.
- On open, focus lands inside the dialog (panel, preserving today's behavior) and never gets stolen back by the 2s poll re-render.
- Behavior is identical for both `CardModal` and `EpicModal` (shared implementation, no drift).
- The epic→card swap path (`onOpenCard`, main.jsx:204) still works: choosing a child card closes the epic modal and opens the card modal with focus inside it.
- `npm test` (server `model.js` tests) still passes unchanged — this card touches no server code.
- No visual regression; the existing global `:focus-visible` ring (styles.css:114/150) still shows on the restored card.

## Design / Approach

### Shared hook: `useDialogA11y(panelRef, onClose)`

Both modals currently hand-roll the same effect. Replace the two copies with one hook defined near the top of `main.jsx`. It owns three concerns: capture-the-opener, focus-on-open, and the keydown handler (Escape + Tab trap).

```js
// Accessibility plumbing shared by CardModal and EpicModal: move focus into the
// dialog on open, trap Tab within it, and return focus to the opener on close.
function useDialogA11y(panelRef, onClose) {
  // Capture the trigger ONCE on mount. Empty deps matter: the keydown effect below
  // depends on `onClose` (which App recreates on every poll-driven re-render), and we
  // must not re-capture the opener — by then activeElement is the panel itself.
  const openerRef = useRef(null);
  useEffect(() => {
    openerRef.current = document.activeElement;
    panelRef.current?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    function onKey(e) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !panel) return;
      const focusables = panel.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) { e.preventDefault(); panel.focus(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}
```

Why split into two effects:
- The **opener capture / focus-restore** effect has `[]` deps so it runs exactly once per mount/unmount. This fixes a latent bug in today's code: the current single effect depends on `[onClose]`, so each poll re-render re-runs `panelRef.current?.focus()` and would steal focus back from the refine input mid-typing. Moving focus-on-open into the once-only effect removes that theft too.
- The **keydown** effect keeps `[onClose]` so the handler always closes via the current `onClose`. Re-subscribing the listener is cheap and side-effect-free (no focus motion).

### `CardModal` (main.jsx:343)

- Remove the existing `useEffect` that wires Escape + `panelRef.current?.focus()` (lines 348–353).
- Add `useDialogA11y(panelRef, onClose);` after the `panelRef` declaration.
- Keep the unrelated `useEffect(() => { setDirection(''); }, [card.id])` (line 347).
- No JSX changes — the panel already has `ref={panelRef}` and `tabIndex={-1}`.

### `EpicModal` (main.jsx:297)

- Remove the existing Escape/focus `useEffect` (lines 299–304).
- Add `useDialogA11y(panelRef, onClose);`.
- No JSX changes.

### Focusable query rationale

The selector targets the elements actually present in these dialogs: the × close button, the `.modal-refine` input + submit, the prompt-group buttons (CardModal), and the child-card `<button>`s (EpicModal). Querying live on each Tab — rather than caching a list at mount — is intentional: CardModal's submit button toggles `disabled` as the refine input fills, and `:disabled` buttons must drop out of the cycle.

## Edge cases & risks

- **Mouse-opened modals.** Clicking a `.card` (a `div` with `tabIndex={0}`) focuses it in all current browsers, so `document.activeElement` at mount is the card and restore-on-close still works. If a browser were not to focus it, restore is a harmless no-op (focus falls to body, same as today).
- **Epic → card swap.** `onOpenCard` sets `openEpicId=null` then `openId=id`: `EpicModal` unmounts (restores focus to its `EpicRow`), then `CardModal` mounts (focuses its panel) — net result is focus inside the card modal, correct. When that card modal later closes, its captured opener was the now-unmounted epic-modal panel; the `document.contains(opener)` guard makes restore a safe no-op, so focus falls to body. Acceptable; noted rather than over-engineered. (A future improvement could thread the original `EpicRow` through, but it is out of scope here.)
- **`document.contains` guard.** Prevents calling `.focus()` on a detached node (e.g. if the originating card scrolled out / re-rendered with a new identity during the 2s poll). Without it, focus could throw or land nowhere.
- **Two dialogs are never open at once** in current state logic (`openId`/`openEpicId` are set/cleared in tandem), so a single window-level keydown listener per mounted modal will not collide in practice. If that invariant ever changes, the trap should move to a panel-scoped `onKeyDown` — noted for ROAD-002 (keyboard nav) which touches the same area.
- **Interaction with ROAD-002.** Arrow-key card navigation will add its own keydown handling on `.card`s. This hook only intercepts Tab/Escape while a modal is mounted, so the two are orthogonal, but both touch focus — land whichever ships first and re-verify the other.

## Verification

No client-side test harness exists today (only `tests/model.test.js`, server-side `node --test`). Introducing jsdom + Testing Library is deliberately **out of scope** — automated UI testing is EPIC-004 territory (ROAD-013/014). Verification for this card is manual, via `npm run dev`:

1. **Restore (keyboard):** Tab to a card → Enter to open → Escape → focus ring is back on that card. Repeat closing via the × button and via backdrop click.
2. **Restore (epic):** Tab to an epic row → Enter? (no — epic rows open on double-click / the Open button). Tab to a row's "Open" button → Enter → Escape → focus returns to that Open button.
3. **Trap:** Open a card modal → Tab repeatedly → focus cycles ×-button → refine input → submit (only when enabled) → prompt buttons → back to ×, never reaching the board. `Shift+Tab` cycles backward and wraps.
4. **No theft:** Open a card modal, start typing in the refine input, and wait ≥2s (a poll cycle) — caret/focus stays in the input (verifies the once-only focus effect).
5. **Swap:** Open an epic modal → click a child card → card modal opens with focus inside it.
6. `npm test` still green.

## Out of scope

- Any server/model/CLI change.
- A client test harness (jsdom/Testing Library) — EPIC-004.
- Arrow-key navigation between cards — ROAD-002.
- Threading the true originating element through the epic→card swap (minor; documented above).

## Progress

_Not started._

## Surprises & Discoveries

- The card has no `detail` column in `roadmap.sqlite`; the ROADMAP.md summary is the full spec.
- Found a latent focus-theft bug: the current modal effects depend on `[onClose]` and re-run `panel.focus()` on every poll-driven `App` re-render. This plan's split-effect structure fixes it as a side effect.

## Decision Log

- **Shared hook over per-modal duplication** — both modals already share the shell verbatim; one `useDialogA11y` keeps the two from drifting.
- **Live focusable query per Tab, not cached** — CardModal's submit button toggles `disabled`; a cached list would keep a disabled button in the cycle.
- **Manual verification, no test harness** — matches the repo (server-only tests today); client test infra is explicitly EPIC-004.

## Outcomes & Retrospective

_Pending implementation._
