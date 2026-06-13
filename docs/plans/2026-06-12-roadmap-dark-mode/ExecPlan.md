# Dark mode with auto toggle (ROAD-001)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` should be kept up to date as implementation proceeds.

- **Card:** ROAD-001 — Dark mode with auto toggle
- **Epic:** EPIC-001 — Board UX polish
- **Status at planning:** Up next
- **Scope:** client-only (`roadmap-board/src/client/`, `roadmap-board/index.html`)

## Purpose / Big Picture

The Roadmap Board renders in a single fixed light theme. Its colors are already expressed largely as CSS custom properties on `:root` (`--surface`, `--text`, `--border`, …), but a dozen literal colors are also hardcoded throughout the rules.

After this change the board should:
- Respect the OS `prefers-color-scheme` on first load (no flash of the wrong theme).
- Offer a manual **tri-state** toggle — **Light → Dark → System** — persisted to `localStorage`. Light/Dark pin the theme; System follows the OS live.
- Theme purely by overriding CSS custom properties under a `[data-theme]` attribute on `<html>`, so no component markup changes shape.

This stays consistent with the board's existing token-based styling and the EPIC-001 goal of read-only UI polish (theming, keyboard nav, search, a11y).

## Definition of Done

- First load with no stored preference matches the OS appearance, with **no flash** of the wrong theme.
- A header control cycles **Light → Dark → System** and persists the chosen *preference* (not just the resolved theme) to `localStorage` under key `roadmap-theme`.
- `System` keeps following the OS live (responds to OS appearance changes while the tab is open); `Light`/`Dark` pin and override the OS.
- The applied theme is driven entirely by `[data-theme="light"|"dark"]` on `<html>`; CSS only ever sees two resolved values.
- Every surface reads correctly in dark mode — cards, modal + footer, toast, epic rail + progress meter, empty/collapsed hints, focus rings — with no light-colored artifacts.
- `color-scheme` is set per theme so native controls/scrollbars/focus render correctly.
- `npm run build && npm run serve` shows the same behavior as `npm run dev` (no flash in the production/`dist` path).
- `npm test` (server `model.js` tests) still passes unchanged.

## Design / Approach

### State model (tri-state)
Separate **preference** (3 states) from **applied theme** (2 states):

- `preference ∈ {'light','dark','system'}` — what the user chose; persisted to `localStorage['roadmap-theme']`. Default `'system'`.
- `resolved ∈ {'light','dark'}` — what actually paints. `resolved = preference === 'system' ? osTheme : preference`.
- `document.documentElement.dataset.theme` is **always** the resolved value, so CSS stays two-valued.

### 1. `roadmap-board/index.html` — FOUC guard
`index.html` flows through Vite in both dev and `vite build` → `dist/` (served by Express in `server.js`), so one inline `<head>` script (placed before the module load) sets the resolved theme synchronously before first paint:

```html
<script>
  (function () {
    try {
      var p = localStorage.getItem('roadmap-theme');           // 'light' | 'dark' | 'system' | null
      var os = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.dataset.theme =
        (p === 'light' || p === 'dark') ? p : os;
    } catch (e) {}
  })();
</script>
```

### 2. `roadmap-board/src/client/styles.css` — tokenize + dark overrides

**(a)** Extract the remaining hardcoded literals into tokens on `:root` and add a page-background token:

| New token | Light value | Replaces (current line) |
|---|---|---|
| `--page-bg` | `#f6f7fb` | `:root` `background` (3) |
| `--text-summary` | `#4a5365` | `.card-summary` (106); also `.modal-summary` `#3c4453` (133) |
| `--text-faint` | `#9aa3b5` | `.empty` (92), `.column` border fallback (84) |
| `--accent-line` | `#d3e2ff` | epic active inset (50), `.epic-clear` border/hover (52,53), `.epic-chip` border (103) |
| `--track-bg` | `#e8ebf3` | `.epic-meter` track (54) |
| `--divider` | `#f0f2f7` | `.epic-row` border (47), `.modal-props` border-top (128) |
| `--surface-raised` | `#fafbfd` | `.modal-actions` footer bg (138) |
| `--toast-bg` | `#172033` | `.toast` background (145) |
| `--toast-fg` | `#ffffff` | `.toast` color (145) |
| `--shadow-rgb` | `15 23 42` | thread through every `rgb(15 23 42 / …)` shadow (16,72,96,118,119,145) |

Then replace those literals with `var(--…)`, and set:
`:root { color: var(--text); background: var(--page-bg); color-scheme: light; }`

**(b)** Add the dark override block (palette is a starting point — tune for contrast during execution):

```css
[data-theme="dark"] {
  --page-bg: #0e131f;
  --surface: #161d2b;
  --surface-sunk: #111825;
  --surface-raised: #1b2335;
  --border: #2a3344;
  --border-strong: #3a4458;
  --text: #e6eaf2;
  --text-muted: #9aa6bd;
  --text-summary: #c3ccdc;
  --text-faint: #5d6678;
  --brand: #5b9bff;
  --brand-dark: #4684f0;
  --brand-tint: #1a2542;
  --accent-line: #2d406b;
  --track-bg: #232c3e;
  --divider: #222b3b;
  --toast-bg: #e6eaf2;   /* invert: light toast on dark page */
  --toast-fg: #0e131f;
  --shadow-rgb: 0 0 0;
  color-scheme: dark;
}
```

**(c)** Review the 7 `[data-status]` accent hues (lines 77–83) for contrast on dark surfaces — most hold; lighten only if a column header reads muddy. Toast `--toast-success` / `--toast-error` tones (146–147) may need lighter variants in dark.

**(d)** Optional: a subtle `transition: background-color .15s ease, color .15s ease` on themed surfaces for a smooth flip — already covered by the existing `prefers-reduced-motion` guard (line 161), so no extra a11y work.

### 3. `roadmap-board/src/client/main.jsx` — state + toggle UI

```js
const ORDER = ['light', 'dark', 'system'];

const [pref, setPref] = useState(() => {
  try { const p = localStorage.getItem('roadmap-theme'); if (ORDER.includes(p)) return p; } catch {}
  return 'system';
});

// Apply resolved theme + persist preference.
useEffect(() => {
  const apply = () => {
    const os = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = pref === 'system' ? os : pref;
  };
  apply();
  try { localStorage.setItem('roadmap-theme', pref); } catch {}
  if (pref !== 'system') return;
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', apply);
  return () => mq.removeEventListener('change', apply);
}, [pref]);
```

Toggle in `<header>` — wrap `h1`/`lede` in a left block, place a `button.ghost` on the right that cycles the preference:

```jsx
const NEXT = { light: 'dark', dark: 'system', system: 'light' };
const ICON = { light: '☀︎', dark: '☾', system: '🖥' };
const LABEL = { light: 'Light', dark: 'Dark', system: 'System' };
// ...
<button type="button" className="ghost theme-toggle"
  aria-label={`Theme: ${LABEL[pref]}. Switch to ${LABEL[NEXT[pref]]}.`}
  onClick={() => setPref(NEXT[pref])}>
  {ICON[pref]} {LABEL[pref]}
</button>
```

Small CSS addition: `.header-bar { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }` and minor `.theme-toggle` sizing.

## Edge cases & risks

- **Missed literal → light artifact in dark mode.** After the refactor, run `grep -nE '#[0-9a-fA-F]{3,6}|rgb\(' roadmap-board/src/client/styles.css` and confirm every remaining literal is intentional (status hues, toast tones).
- **`localStorage` blocked (private mode):** all access is `try/catch`-wrapped; falls back to OS, just doesn't persist.
- **Preference vs resolved confusion:** persist the *preference* (`system` included), never the resolved value — otherwise `System` silently degrades to a pinned theme on reload.
- **Flicker on switch:** optional transition is guarded by the existing reduced-motion rule.
- **No SSR/hydration concerns** — pure client render; FOUC handled by the head script.

## Verification

Client has no test runner (`npm test` only covers `model.js`), so verify manually:

1. `cd roadmap-board && npm run dev`, open the UI.
2. With no stored preference: OS dark → loads dark, **no white flash**; OS light → loads light. (Toggle macOS appearance to check.)
3. Cycle the button Light → Dark → System; confirm each persists across reload and that `System` re-follows a live OS appearance change.
4. In dark, scan every surface: cards, open a modal (+ footer), trigger a toast via a copy-prompt action, epic rail + progress meter, collapsed-completed hint, all focus rings.
5. `npm run build && npm run serve` → confirm the inline script survives the production build and there is still no flash.
6. `npm test` still passes (untouched).

## Out of scope

Server-side theme persistence, per-card theming, high-contrast mode, board/model/server changes.

## Progress

- 2026-06-12 — Plan drafted; tri-state model chosen. Not yet implemented.

## Surprises & Discoveries

- `:root` mixes page-level `color`/`background` with token definitions, and ~12 colors are hardcoded outside the token set — these must be tokenized for a coherent dark theme.
- `index.html` is the only reliable place to kill FOUC across both dev and `dist` serving paths.

## Decision Log

- 2026-06-12 — **Tri-state Light/Dark/System** toggle (over two-state), per user direction. Requires separating persisted *preference* from resolved *theme*.
- 2026-06-12 — Persist *preference* (incl. `system`) to `localStorage['roadmap-theme']`; `<html data-theme>` always carries the resolved value so CSS stays two-valued.

## Outcomes & Retrospective

_To be filled in after implementation._
