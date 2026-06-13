import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const ACTION_LABELS = {
  brainstorm: 'Brainstorm',
  plan: 'Plan',
  execute: 'Execute',
  review: 'Review',
};

function App() {
  const [data, setData] = useState({ columns: [], prompts: {}, cards: [] });
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [message, setMessage] = useState('');
  const [collapsedCompleted, setCollapsedCompleted] = useState(true);
  const [dragId, setDragId] = useState(null);

  async function load() {
    const res = await fetch('/api/roadmap');
    setData(await res.json());
  }
  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    const map = Object.fromEntries(data.columns.map(c => [c.key, []]));
    for (const card of data.cards) map[card.status]?.push(card);
    for (const cards of Object.values(map)) cards.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    return map;
  }, [data]);

  async function addCard(event) {
    event.preventDefault();
    const res = await fetch('/api/cards', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ title, summary }) });
    if (!res.ok) return setMessage((await res.json()).error);
    setTitle('');
    setSummary('');
    setMessage('Added Triage card');
    await load();
  }

  async function updateTriage(card, patch) {
    const res = await fetch(`/api/cards/${card.id}/triage`, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(patch) });
    if (!res.ok) setMessage((await res.json()).error);
    await load();
  }

  async function reorder(overId) {
    if (!dragId || dragId === overId) return;
    const cards = [...(grouped.triage ?? [])];
    const from = cards.findIndex(c => c.id === dragId);
    const to = cards.findIndex(c => c.id === overId);
    if (from < 0 || to < 0) return;
    const [item] = cards.splice(from, 1);
    cards.splice(to, 0, item);
    const res = await fetch('/api/triage/reorder', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ ids: cards.map(c => c.id) }) });
    if (!res.ok) setMessage((await res.json()).error);
    setDragId(null);
    await load();
  }

  async function copyPrompt(action, card) {
    const template = data.prompts[action] ?? '';
    const prompt = template.replaceAll('{{id}}', card.id).replaceAll('{{title}}', card.title).replaceAll('{{status}}', card.status);
    await navigator.clipboard.writeText(prompt);
    setMessage(`Copied ${ACTION_LABELS[action]} prompt for ${card.id}`);
  }

  return <main>
    <header>
      <div>
        <h1>Roadmap Board</h1>
        <p>SQLite-backed local board. ROADMAP.md is generated after every write.</p>
      </div>
      {message && <output>{message}</output>}
    </header>

    <form className="add-card" onSubmit={addCard}>
      <input aria-label="Triage title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Add idea to Triage…" required />
      <input aria-label="Triage summary" value={summary} onChange={e => setSummary(e.target.value)} placeholder="Optional summary" />
      <button>Add to Triage</button>
    </form>

    <section className="board" aria-label="Roadmap columns">
      {data.columns.map(column => {
        const cards = grouped[column.key] ?? [];
        const isCompleted = column.key === 'completed';
        const hidden = isCompleted && collapsedCompleted;
        return <section className="column" key={column.key} aria-label={column.label}>
          <h2>
            {column.label} <span>{cards.length}</span>
            {isCompleted && <button className="collapse" onClick={() => setCollapsedCompleted(!collapsedCompleted)}>{hidden ? 'Show' : 'Hide'}</button>}
          </h2>
          {hidden ? <p className="muted">Completed cards collapsed.</p> : cards.map(card =>
            <Card
              key={card.id}
              card={card}
              editable={column.key === 'triage'}
              draggable={column.key === 'triage'}
              onDragStart={() => setDragId(card.id)}
              onDragOver={event => event.preventDefault()}
              onDrop={() => reorder(card.id)}
              onUpdate={patch => updateTriage(card, patch)}
              onCopy={action => copyPrompt(action, card)}
            />
          )}
        </section>;
      })}
    </section>
  </main>;
}

function Card({ card, editable, draggable, onDragStart, onDragOver, onDrop, onUpdate, onCopy }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [summary, setSummary] = useState(card.summary);
  useEffect(() => { setTitle(card.title); setSummary(card.summary); }, [card.id, card.title, card.summary]);
  return <article className="card" draggable={draggable} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}>
    <div className="card-top"><strong>{card.id}</strong>{draggable && <span className="drag">drag</span>}</div>
    {editing ? <form onSubmit={e => { e.preventDefault(); setEditing(false); onUpdate({ title, summary }); }}>
      <input value={title} onChange={e => setTitle(e.target.value)} required />
      <textarea value={summary} onChange={e => setSummary(e.target.value)} />
      <button>Save</button>
    </form> : <>
      <h3>{card.title}</h3>
      {card.summary && <p>{card.summary}</p>}
    </>}
    {(card.depends_on.length > 0 || card.enables.length > 0 || card.blocked_reason) && <dl>
      {card.depends_on.length > 0 && <><dt>Depends on</dt><dd>{card.depends_on.join(', ')}</dd></>}
      {card.enables.length > 0 && <><dt>Enables</dt><dd>{card.enables.join(', ')}</dd></>}
      {card.blocked_reason && <><dt>Blocked</dt><dd>{card.blocked_reason}</dd></>}
    </dl>}
    <div className="actions">
      {editable && <button onClick={() => setEditing(!editing)}>{editing ? 'Cancel' : 'Edit'}</button>}
      {Object.keys(ACTION_LABELS).map(action => <button key={action} onClick={() => onCopy(action)}>{ACTION_LABELS[action]}</button>)}
    </div>
  </article>;
}

function jsonHeaders() { return { 'Content-Type': 'application/json' }; }

createRoot(document.getElementById('root')).render(<App />);
