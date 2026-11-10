// The /levi page. SECURITY: everything Levi wrote is inserted with textContent only.
import { SLOTS, slotDescription } from '../shared/town.js';

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
}
const when = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const empty = (msg) => el('p', 'muted', msg);

async function load() {
  const r = await fetch('/api/levi', { cache: 'no-store' });
  const d = await r.json();

  $('brain').textContent = d.brain ? `Brain: ${d.brain.name.replace(/^ollama:/, '')}${d.brain.online ? '' : ' (offline)'}.` : '';

  const list = $('list');
  list.replaceChildren(...(d.list.length ? d.list.map((x) => el('li', null, x)) : [el('li', 'muted', 'Nothing on it yet.')]));

  const sites = $('site-list');
  sites.replaceChildren();
  if (!d.sites.length) sites.append(empty('No websites yet.'));
  for (const s of d.sites) {
    const li = el('li', 'card');
    const a = el('a', null, s.title);
    a.href = `/levi/sites/${encodeURIComponent(s.slug)}/`;
    a.rel = 'noopener';
    li.append(a, el('p', 'muted', `/${s.slug} · updated ${when(s.updated)} · ${s.versions} version${s.versions === 1 ? '' : 's'}`));
    sites.append(li);
  }

  const cr = $('creations');
  cr.replaceChildren();
  if (!d.creations.length) cr.append(empty('Nothing yet.'));
  for (const c of [...d.creations].reverse()) {
    const li = el('li', 'card');
    const sw = el('span', 'swatch');
    if (/^#[0-9a-f]{6}$/i.test(c.color)) sw.style.background = c.color;
    const h = el('strong', null, c.title);
    const slot = SLOTS.find((s) => s.id === c.slot);
    li.append(sw, h, el('p', 'muted', `A ${c.size} ${c.kind} (${c.shape}) at ${slot ? slotDescription(slot) : c.slot} · ${when(c.t)}`));
    if (c.text) li.append(el('p', 'quote', `“${c.text}”`));
    cr.append(li);
  }

  const cur = $('currency');
  cur.replaceChildren();
  if (!d.currency) cur.append(empty('He has not created one.'));
  else {
    const c = d.currency;
    cur.append(el('p', 'big', `${c.name} (${c.symbol})`), el('p', null, c.description || ''),
      el('p', 'muted', `In existence: ${c.supply} · held by Levi: ${c.held} · created ${when(c.created)} · no real money, it only exists in town`));
    const ul = el('ul', 'ledger');
    for (const e of c.ledger) {
      const li = el('li');
      li.append(el('time', null, when(e.t)), el('span', 'op', e.op), el('span', null, `${e.amount ? `${e.amount} ${c.symbol} ` : ''}${e.counterparty ? `→ ${e.counterparty} ` : ''}${e.memo}`));
      ul.append(li);
    }
    cur.append(ul);
  }

  const j = $('journal');
  j.replaceChildren();
  if (!d.journal.length) j.append(empty('No entries yet.'));
  for (const e of d.journal) {
    const art = el('article', 'entry');
    art.append(el('h3', null, e.title || 'Untitled'), el('p', 'muted', when(e.t)), el('p', 'journal-body', e.text));
    j.append(art);
  }
}

load().catch(() => { $('list').replaceChildren(el('li', 'muted', 'Could not load.')); });
setInterval(() => load().catch(() => {}), 30_000);
