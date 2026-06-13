import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const ACTION_LABELS = {
  brainstorm: 'Brainstorm',
  plan: 'Plan',
  execute: 'Execute',
  review: 'Review',
};

// Theme is tri-state: the persisted *preference* is one of these; the resolved
// 'light'/'dark' lives on <html data-theme> (set pre-paint by the inline script in index.html).
const THEME_KEY = 'roadmap-theme';
const THEME_ORDER = ['light', 'dark', 'system'];
const THEME_NEXT = { light: 'dark', dark: 'system', system: 'light' };
const THEME_ICON = { light: '☀︎', dark: '☾', system: '🖥' };
const THEME_LABEL = { light: 'Light', dark: 'Dark', system: 'System' };

function readThemePref() {
  try { const p = localStorage.getItem(THEME_KEY); if (THEME_ORDER.includes(p)) return p; } catch {}
  return 'system';
}

const EMPTY_HINTS = {
  triage: 'No triage cards yet — an agent adds them.',
  backlog: 'Nothing parked here yet.',
  up_next: 'Nothing queued up next.',
  in_progress: 'No cards in flight.',
  blocked: 'Nothing blocked — nice.',
  review: 'Nothing waiting on review.',
  completed: 'No completed cards yet.',
};

function App() {
  const [data, setData] = useState({ columns: [], prompts: {}, epics: [], cards: [] });
  const [toast, setToast] = useState(null);
  const [collapsedCompleted, setCollapsedCompleted] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [openEpicId, setOpenEpicId] = useState(null);
  const [focusEpicId, setFocusEpicId] = useState(null);
  const [readyOnly, setReadyOnly] = useState(false);
  const [themePref, setThemePref] = useState(readThemePref);
  // Connection health: null = healthy. A non-null string is the banner message. `loaded` flips true
  // after the first successful fetch and never back — it's how we tell "never reached the server"
  // (full error state) apart from "had the board, then lost the connection" (stale board + banner).
  const [connError, setConnError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const toastTimer = useRef(null);
  const lastSnapshotRef = useRef(null);

  // Apply the resolved theme to <html>, persist the preference, and — while on 'system' —
  // keep following the OS appearance live.
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = themePref === 'system' ? (mq.matches ? 'dark' : 'light') : themePref;
    };
    apply();
    try { localStorage.setItem(THEME_KEY, themePref); } catch {}
    if (themePref !== 'system') return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [themePref]);

  function notify(text, tone = 'info') {
    setToast({ text, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }

  // One fetch path for both the initial load and the 2s poll, so res.ok and network rejections are
  // handled identically. Returns the raw snapshot text; throws on any non-OK response.
  async function fetchSnapshot() {
    const res = await fetch('/api/roadmap');
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    return res.text();
  }

  // Apply a freshly fetched snapshot, skipping the re-render when nothing changed. Centralised so the
  // load and poll paths agree on the diff check and on clearing the error/loaded flags on success.
  function applySnapshot(text) {
    if (text !== lastSnapshotRef.current) {
      lastSnapshotRef.current = text;
      setData(JSON.parse(text));
    }
    setLoaded(true);
    setConnError(null);
  }

  // Network errors carry no useful HTTP status, so lean on navigator.onLine to phrase the banner.
  function connMessage() {
    return navigator.onLine ? "Can't reach the roadmap server." : 'You appear to be offline.';
  }

  // Initial load and the manual Retry share this. On failure the existing `data` is left in place —
  // a stale board beats a blank one — and the banner explains why.
  async function load() {
    try { applySnapshot(await fetchSnapshot()); }
    catch { setConnError(connMessage()); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Pick up out-of-band changes (e.g. an agent moving a card via the CLI) without a manual refresh.
  // Doubles as the auto-recovery loop: a failed poll raises the banner, the next good one clears it,
  // so a downed-then-restored server heals within one interval with no user action.
  useEffect(() => {
    const timer = setInterval(async () => {
      try { applySnapshot(await fetchSnapshot()); }
      catch { setConnError(connMessage()); }
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  // Instant feedback on connectivity flips: surface the banner the moment the OS reports offline, and
  // trigger an immediate refresh on reconnect rather than waiting up to 2s for the next poll.
  useEffect(() => {
    const onOnline = () => load();
    const onOffline = () => setConnError('You appear to be offline.');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const grouped = useMemo(() => {
    const map = Object.fromEntries(data.columns.map(c => [c.key, []]));
    for (const card of data.cards) map[card.status]?.push(card);
    for (const cards of Object.values(map)) cards.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    return map;
  }, [data]);

  // Board filters compose (AND): the epic focus and the ready-next toggle each narrow the
  // same grouped view. Skip the work entirely when neither is active.
  const view = useMemo(() => {
    if (!focusEpicId && !readyOnly) return grouped;
    const out = {};
    for (const [key, cards] of Object.entries(grouped)) {
      out[key] = cards.filter(c => (!focusEpicId || c.epic_id === focusEpicId) && (!readyOnly || c.ready));
    }
    return out;
  }, [grouped, focusEpicId, readyOnly]);

  const readyCount = useMemo(() => data.cards.filter(c => c.ready).length, [data.cards]);

  const epicsById = useMemo(() => Object.fromEntries(data.epics.map(epic => [epic.id, epic])), [data.epics]);
  const statusLabels = useMemo(() => Object.fromEntries(data.columns.map(c => [c.key, c.label])), [data.columns]);
  const openCard = useMemo(() => data.cards.find(c => c.id === openId) ?? null, [data.cards, openId]);
  const openEpic = useMemo(() => data.epics.find(e => e.id === openEpicId) ?? null, [data.epics, openEpicId]);
  const openEpicCards = useMemo(() => {
    if (!openEpicId) return [];
    const order = Object.fromEntries(data.columns.map((c, i) => [c.key, i]));
    return data.cards
      .filter(c => c.epic_id === openEpicId)
      .sort((a, b) => (order[a.status] ?? 0) - (order[b.status] ?? 0) || a.position - b.position || a.id.localeCompare(b.id));
  }, [data.cards, data.columns, openEpicId]);

  async function copyPrompt(action, card) {
    const template = data.prompts[action] ?? '';
    const prompt = template.replaceAll('{{id}}', card.id).replaceAll('{{title}}', card.title).replaceAll('{{status}}', card.status);
    await navigator.clipboard.writeText(prompt);
    notify(`Copied ${ACTION_LABELS[action]} prompt for ${card.id}`, 'success');
  }

  async function copyRefine(card, direction) {
    const template = data.prompts.refine ?? '';
    const prompt = template
      .replaceAll('{{id}}', card.id)
      .replaceAll('{{title}}', card.title)
      .replaceAll('{{status}}', card.status)
      .replaceAll('{{direction}}', direction.trim());
    await navigator.clipboard.writeText(prompt);
    notify(`Copied refine prompt for ${card.id}`, 'success');
  }

  // Arrow-key spatial navigation across cards. Delegated on .board (not window) so it only fires
  // when a card is focused and never reaches behind an open modal, which renders as a sibling of
  // .board. ↑/↓ move within a column; ←/→ jump to the nearest non-empty column, same row (clamped).
  // Structure is read live from the DOM, so empty/collapsed columns (zero .card nodes) are skipped
  // for free and there's no focus state to keep in sync.
  function onBoardKeyDown(e) {
    const card = e.target.closest('.card');
    if (!card) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;

    const cardsInCol = [...card.closest('.column-body').querySelectorAll('.card')];
    const row = cardsInCol.indexOf(card);
    let target = null;

    if (e.key === 'ArrowUp') target = cardsInCol[row - 1];
    else if (e.key === 'ArrowDown') target = cardsInCol[row + 1];
    else if (e.key === 'Home') target = cardsInCol[0];
    else if (e.key === 'End') target = cardsInCol[cardsInCol.length - 1];
    else {
      const columns = [...card.closest('.board').querySelectorAll(':scope > .column')];
      const colIdx = columns.indexOf(card.closest('.column'));
      const step = e.key === 'ArrowRight' ? 1 : -1;
      for (let i = colIdx + step; i >= 0 && i < columns.length; i += step) {
        const sibCards = [...columns[i].querySelectorAll('.card')];
        if (sibCards.length === 0) continue;
        target = sibCards[Math.min(row, sibCards.length - 1)];
        break;
      }
    }

    if (target) {
      e.preventDefault();
      // focusVisible: true forces the keyboard focus ring. Without it the :focus-visible heuristic
      // is unreliable for scripted .focus(), so the outline flickers/vanishes on mid-column cards.
      // Unsupported browsers ignore the option and fall back to the heuristic — no worse than before.
      target.focus({ focusVisible: true });
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  return <main>
    <header>
      <div className="header-bar">
        <div>
          <h1>Roadmap Board</h1>
          <p className="lede">Local planning board for shaping and shipping work.</p>
        </div>
        <div className="header-controls">
          <button
            type="button"
            className={`ghost ready-toggle${readyOnly ? ' is-active' : ''}`}
            aria-pressed={readyOnly}
            title="Show only cards whose dependencies are all completed"
            onClick={() => setReadyOnly(v => !v)}
          >
            Ready next
            <span className="count">{readyCount}</span>
          </button>
          <button
            type="button"
            className="ghost theme-toggle"
            aria-label={`Theme: ${THEME_LABEL[themePref]}. Switch to ${THEME_LABEL[THEME_NEXT[themePref]]}.`}
            title={`Theme: ${THEME_LABEL[themePref]}`}
            onClick={() => setThemePref(p => THEME_NEXT[p])}
          >
            <span className="theme-icon" aria-hidden="true">{THEME_ICON[themePref]}</span>
            {THEME_LABEL[themePref]}
          </button>
        </div>
      </div>
    </header>

    {connError && loaded && <ConnBanner message={connError} onRetry={load} />}

    {connError && !loaded ? <ConnBanner message={connError} onRetry={load} full /> : <>
    <section className="epic-rail" aria-label="Epic progress">
      <div className="epic-rail-head">
        <h2>Epics</h2>
        <span className="count">{data.epics.length}</span>
        {focusEpicId && <button type="button" className="epic-clear" onClick={() => setFocusEpicId(null)}>Showing {focusEpicId} · clear</button>}
      </div>
      {data.epics.length === 0 ? <p className="muted">No epics yet.</p> : data.epics.map(epic =>
        <EpicRow
          key={epic.id}
          epic={epic}
          active={focusEpicId === epic.id}
          dimmed={!!focusEpicId && focusEpicId !== epic.id}
          onSelect={() => setFocusEpicId(id => id === epic.id ? null : epic.id)}
          onOpen={() => setOpenEpicId(epic.id)}
        />
      )}
    </section>

    <div className="board-scroll">
      <section className="board" aria-label="Roadmap columns" onKeyDown={onBoardKeyDown}>
        {data.columns.map(column => {
          const cards = view[column.key] ?? [];
          const isCompleted = column.key === 'completed';
          const hidden = isCompleted && collapsedCompleted;
          return <section className="column" data-status={column.key} key={column.key} aria-label={column.label}>
            <h2>
              <span className="column-name">{column.label}</span>
              <span className="count">{cards.length}</span>
              {isCompleted && cards.length > 0 && <button type="button" className="collapse" onClick={() => setCollapsedCompleted(!collapsedCompleted)}>{hidden ? 'Show' : 'Hide'}</button>}
            </h2>
            <div className="column-body">
              {hidden ? <p className="empty">{cards.length} completed card{cards.length === 1 ? '' : 's'} hidden.</p>
                : cards.length === 0 ? <p className="empty">{EMPTY_HINTS[column.key] ?? 'Nothing here yet.'}</p>
                  : cards.map(card =>
                    <Card
                      key={card.id}
                      card={card}
                      epic={epicsById[card.epic_id] ?? null}
                      onOpen={() => setOpenId(card.id)}
                    />
                  )}
            </div>
          </section>;
        })}
      </section>
    </div>
    </>}

    {openEpic && <EpicModal
      epic={openEpic}
      cards={openEpicCards}
      statusLabels={statusLabels}
      onOpenCard={id => { setOpenEpicId(null); setOpenId(id); }}
      onClose={() => setOpenEpicId(null)}
    />}

    {openCard && <CardModal
      card={openCard}
      epic={epicsById[openCard.epic_id] ?? null}
      statusLabel={statusLabels[openCard.status] ?? openCard.status}
      statusLabels={statusLabels}
      onCopy={action => copyPrompt(action, openCard)}
      onRefine={direction => copyRefine(openCard, direction)}
      onClose={() => setOpenId(null)}
    />}

    {toast && <div className={`toast toast-${toast.tone}`} role="status" aria-live="polite">{toast.text}</div>}
  </main>;
}

// Connection failure surface. Two shapes off one component: inline (a strip above a still-rendered,
// now-stale board) and `full` (a centred panel that stands in for the board when we never reached the
// server). role="alert" + assertive so the failure is announced the moment it appears; the Retry
// button calls load() directly, though the 2s poll also clears the banner on its own once the server
// returns.
function ConnBanner({ message, onRetry, full = false }) {
  return <div className={`conn-banner${full ? ' conn-banner-full' : ''}`} role="alert" aria-live="assertive">
    <div className="conn-banner-copy">
      <strong>{full ? "Couldn't load the roadmap" : 'Connection lost'}</strong>
      <span>{message}{!full && ' Showing the last loaded board.'}</span>
    </div>
    <button type="button" className="primary" onClick={onRetry}>Retry</button>
  </div>;
}

function Card({ card, epic, onOpen }) {
  return <article
    className="card"
    data-card-id={card.id}
    role="button"
    tabIndex={0}
    onClick={onOpen}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
  >
    <div className="card-top">
      <div className="card-top-left">
        <span className="card-id">{card.id}</span>
        {epic && <span className="epic-chip" title={epic.title}>{epic.id}</span>}
      </div>
      {card.ready && <span className="ready-chip" title="All dependencies completed">Ready</span>}
      {card.dependency_blocked && <span className="blocked-chip" title="Waiting on incomplete dependencies">Waiting</span>}
    </div>
    <h3 className="card-title">{card.title}</h3>
    {card.summary && <p className="card-summary">{card.summary}</p>}
    {(card.depends_on.length > 0 || card.enables.length > 0 || card.blocked_reason) && <dl>
      {card.depends_on.length > 0 && <><dt>Depends on</dt><dd>{card.depends_on.join(', ')}</dd></>}
      {card.enables.length > 0 && <><dt>Enables</dt><dd>{card.enables.join(', ')}</dd></>}
      {card.blocked_reason && <><dt>Blocked</dt><dd>{card.blocked_reason}</dd></>}
    </dl>}
  </article>;
}

// Two-gesture epic row: a single click selects (toggles the board filter), a double click
// opens the detail view. Because the browser fires a `click` for each click of a double-click,
// the select action is deferred ~220ms and cancelled when a double-click arrives. The explicit
// Open button gives keyboard and touch users a first-class path that double-click can't.
function EpicRow({ epic, active, dimmed, onSelect, onOpen }) {
  const clickTimer = useRef(null);
  useEffect(() => () => clearTimeout(clickTimer.current), []);

  function handleClick() {
    if (clickTimer.current) return;
    clickTimer.current = setTimeout(() => { clickTimer.current = null; onSelect(); }, 220);
  }
  function handleDoubleClick() {
    clearTimeout(clickTimer.current);
    clickTimer.current = null;
    onOpen();
  }

  return <article
    className={`epic-row${active ? ' is-active' : ''}${dimmed ? ' is-dimmed' : ''}`}
    role="button"
    tabIndex={0}
    aria-pressed={active}
    title="Click to filter the board · double-click to open"
    onClick={handleClick}
    onDoubleClick={handleDoubleClick}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
  >
    <div className="epic-meter" role="progressbar" aria-valuenow={epic.percent_complete} aria-valuemin={0} aria-valuemax={100} aria-label={`${epic.title} progress`}>
      <span style={{ width: `${epic.percent_complete}%` }} />
    </div>
    <span className="id-tag">{epic.id}</span>
    <div className="epic-copy">
      <h3>{epic.title}</h3>
      {epic.summary && <p>{epic.summary}</p>}
    </div>
    <div className="epic-progress-copy">
      <strong>{epic.done_count} / {epic.total_count}</strong>
      <span>{epic.percent_complete}%</span>
    </div>
    <button
      type="button"
      className="epic-open"
      aria-label={`Open ${epic.id} detail`}
      onClick={e => { e.stopPropagation(); onOpen(); }}
    >Open</button>
  </article>;
}

// Accessibility plumbing shared by CardModal and EpicModal: move focus into the dialog on open,
// trap Tab within it, and return focus to the opener on close. `aria-modal="true"` promises the
// rest of the page is inert — this is what makes that true for keyboard users.
function useDialogA11y(panelRef, onClose) {
  // Capture the trigger and focus the panel exactly ONCE per mount. Empty deps are deliberate: the
  // keydown effect below re-subscribes whenever App recreates `onClose` (every 2s poll), and we must
  // not re-capture the opener or re-focus the panel then — that would steal focus mid-interaction.
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
      // Query live each press: CardModal's submit button toggles `disabled` as the input fills, so a
      // cached list would keep a non-focusable button in the cycle.
      const focusables = panel.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) { e.preventDefault(); panel.focus(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

// Epic detail view. Mirrors CardModal's shell (backdrop close, Escape, focus-on-open). Shows the
// full unclamped summary, derived progress, and child cards; selecting a child swaps this modal
// for that card's CardModal.
function EpicModal({ epic, cards, statusLabels, onOpenCard, onClose }) {
  const panelRef = useRef(null);
  useDialogA11y(panelRef, onClose);

  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal" role="dialog" aria-modal="true" aria-label={`${epic.id}: ${epic.title}`} tabIndex={-1} ref={panelRef} onClick={e => e.stopPropagation()}>
      <header className="modal-head">
        <div className="modal-head-left">
          <span className="id-tag">{epic.id}</span>
          <span className="count">{epic.done_count} / {epic.total_count} done</span>
        </div>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button>
      </header>

      <div className="modal-body">
        <h2 className="modal-title">{epic.title}</h2>

        <div className="epic-modal-meter" role="progressbar" aria-valuenow={epic.percent_complete} aria-valuemin={0} aria-valuemax={100} aria-label={`${epic.title} progress`}>
          <span style={{ width: `${epic.percent_complete}%` }} />
        </div>

        <p className="modal-section-label">Description</p>
        {epic.summary ? <p className="modal-summary">{epic.summary}</p> : <p className="empty">No description yet.</p>}

        <p className="modal-section-label">Cards ({cards.length})</p>
        {cards.length === 0 ? <p className="empty">No cards assigned to this epic yet.</p> : <ul className="epic-modal-cards">
          {cards.map(card =>
            <li key={card.id}>
              <button type="button" onClick={() => onOpenCard(card.id)} aria-label={`Open ${card.id}: ${card.title}`}>
                <span className="card-id">{card.id}</span>
                <span className="status-pill" data-status={card.status}>{statusLabels[card.status] ?? card.status}</span>
                <span className="epic-modal-card-title">{card.title}</span>
              </button>
            </li>
          )}
        </ul>}
      </div>
    </div>
  </div>;
}

// Turn a raw event row into a human sentence. Payload is left raw by the model so the client can
// resolve status keys through the same statusLabels map the board uses; unknown shapes fall back to
// the event_type so a new event kind degrades to something readable rather than blank.
function describeEvent(event, statusLabels) {
  const label = key => statusLabels[key] ?? key;
  const p = event.payload ?? {};
  switch (event.event_type) {
    case 'card_created': return `Created in ${label(p.status)}`;
    case 'card_moved': return `Moved from ${label(p.from)} to ${label(p.to)}`;
    case 'card_deleted': return `Deleted from ${label(p.status)}`;
    case 'card_updated': {
      const fields = p.fields ?? [];
      if (fields.length === 1 && fields[0] === 'epic_id') {
        if (p.epic_id) return `Assigned to ${p.epic_id}`;
        if (p.unassigned_epic) return `Removed from ${p.unassigned_epic}`;
        return 'Removed from epic';
      }
      if (p.unlinked) return `Unlinked ${p.unlinked}`;
      return fields.length ? `Updated ${fields.join(', ')}` : 'Updated';
    }
    default: return event.event_type.replace(/_/g, ' ');
  }
}

// Absolute, locale-formatted timestamp; full ISO is kept on the <time> title for exact ordering.
function formatEventTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function CardModal({ card, epic, statusLabel, statusLabels, onCopy, onRefine, onClose }) {
  const [direction, setDirection] = useState('');
  const [events, setEvents] = useState(null); // null = loading, 'error' = fetch failed, [] = none, [...] = loaded
  const panelRef = useRef(null);

  useEffect(() => { setDirection(''); }, [card.id]);

  // Lazy-load history when the card changes. Kept off the snapshot so the 2s board poll stays cheap
  // as the events table grows. A fetch failure flags 'error' so the body can say so explicitly rather
  // than masquerading as an empty history.
  useEffect(() => {
    let alive = true;
    setEvents(null);
    fetch(`/api/cards/${card.id}/events`)
      .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
      .then(rows => { if (alive) setEvents(rows); })
      .catch(() => { if (alive) setEvents('error'); });
    return () => { alive = false; };
  }, [card.id]);

  useDialogA11y(panelRef, onClose);

  function refine(e) {
    e.preventDefault();
    if (!direction.trim()) return;
    onRefine(direction);
    setDirection('');
  }

  const hasProps = epic || card.ready || card.dependency_blocked || card.depends_on.length > 0 || card.enables.length > 0 || card.blocked_reason;

  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal" role="dialog" aria-modal="true" aria-label={`${card.id}: ${card.title}`} tabIndex={-1} ref={panelRef} onClick={e => e.stopPropagation()}>
      <header className="modal-head">
        <div className="modal-head-left">
          <span className="card-id">{card.id}</span>
          <span className="status-pill" data-status={card.status}>{statusLabel}</span>
        </div>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button>
      </header>

      <div className="modal-body">
        <h2 className="modal-title">{card.title}</h2>

        {hasProps && <dl className="modal-props">
          {epic && <><dt>Epic</dt><dd><span className="epic-chip" title={epic.title}>{epic.id}</span><span className="prop-text">{epic.title}</span></dd></>}
          {card.ready && <><dt>Ready</dt><dd><span className="ready-chip">Ready</span><span className="prop-text">All dependencies completed</span></dd></>}
          {card.dependency_blocked && <><dt>Waiting</dt><dd><span className="blocked-chip">Waiting</span><span className="prop-text">Waiting on incomplete dependencies</span></dd></>}
          {card.depends_on.length > 0 && <><dt>Depends on</dt><dd className="prop-text">{card.depends_on.join(', ')}</dd></>}
          {card.enables.length > 0 && <><dt>Enables</dt><dd className="prop-text">{card.enables.join(', ')}</dd></>}
          {card.blocked_reason && <><dt>Blocked</dt><dd className="prop-text">{card.blocked_reason}</dd></>}
        </dl>}

        <p className="modal-section-label">Description</p>
        {card.summary ? <p className="modal-summary">{card.summary}</p> : <p className="empty">No description yet.</p>}

        <p className="modal-section-label">History</p>
        {events === null ? <p className="empty">Loading history…</p>
          : events === 'error' ? <p className="empty">History unavailable — couldn't reach the server.</p>
            : events.length === 0 ? <p className="empty">No history yet.</p>
              : <ul className="card-history">
              {events.map(event =>
                <li key={event.id}>
                  <span className={`history-actor actor-${event.actor_type}`}>{event.actor_type}</span>
                  <span className="history-text">{describeEvent(event, statusLabels)}</span>
                  <time className="history-time" dateTime={event.created_at} title={event.created_at}>{formatEventTime(event.created_at)}</time>
                </li>
              )}
            </ul>}
      </div>

      <footer className="modal-actions">
        <form className="modal-refine" onSubmit={refine}>
          <input value={direction} onChange={e => setDirection(e.target.value)} placeholder="Tell the agent a specific adjustment…" aria-label="Refine direction" />
          <button type="submit" className="primary" disabled={!direction.trim()}>Copy refine prompt</button>
        </form>
        <div className="prompt-group">
          <span className="prompt-group-label">Copy prompt</span>
          <div className="prompt-actions" role="group" aria-label="Copy agent prompt">
            {Object.keys(ACTION_LABELS).map(action =>
              <button type="button" key={action} aria-label={`Copy ${ACTION_LABELS[action]} prompt for ${card.id}`} onClick={() => onCopy(action)}>{ACTION_LABELS[action]}</button>
            )}
          </div>
        </div>
      </footer>
    </div>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
