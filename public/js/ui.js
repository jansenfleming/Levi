// Side panel, thought bubble and buttons.
// SECURITY: every piece of state/model text is written with textContent, never innerHTML.
import { locationName } from '../shared/town.js';

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
}
let townTz;
const fmtTime = (t) => {
  try { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: townTz }); }
  catch { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
};
const WEATHER = { clear: 'Clear', overcast: 'Overcast', fog: 'Fog', drizzle: 'Drizzle', rain: 'Rain', downpour: 'Downpour' };

export function createUI({ onFollow, onRain }) {
  const panel = $('panel');
  const logList = $('log');
  const bubble = $('bubble');
  const bubbleText = $('bubble-text');
  const bars = {};
  for (const k of ['energy', 'fullness', 'stimulation']) {
    const row = el('div', 'need');
    const label = el('span', 'need-label', k);
    const track = el('div', 'need-track');
    const fill = el('div', 'need-fill ' + k);
    const val = el('span', 'need-val', '–');
    track.append(fill); row.append(label, track, val);
    $('needs').append(row);
    bars[k] = { fill, val };
  }

  const btn = (id, initial, cb) => {
    const b = $(id);
    let on = initial;
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => { on = !on; b.setAttribute('aria-pressed', String(on)); cb(on); });
  };
  btn('btn-follow', true, onFollow);
  btn('btn-rain', true, onRain);
  btn('btn-panel', !matchMedia('(max-width: 720px)').matches, (on) => panel.classList.toggle('hidden', !on));
  if (matchMedia('(max-width: 720px)').matches) panel.classList.add('hidden');

  let lastThought = '';
  let lastList = '';
  return {
    setState(s, view) {
      const a = s.alien;
      townTz = s.tz;
      $('now').textContent = view.moving ? `Walking to ${locationName(a.loc)}` : a.deciding ? 'Pausing…' : (a.activity?.label || '…');
      $('where').textContent = view.moving ? 'On the streets' : locationName(a.loc);
      $('weather').textContent = s.weather ? (WEATHER[s.weather.kind] || s.weather.kind) : '–';
      const b = $('brain');
      b.textContent = s.brain ? `${s.brain.name.replace(/^ollama:/, '')}${s.brain.online ? '' : ' (offline)'}` : 'scripted';
      b.classList.toggle('offline', !!s.brain && !s.brain.online);
      for (const k in bars) {
        const v = s.needs?.[k] ?? 0;
        bars[k].fill.style.width = `${Math.round(v * 100)}%`;
        bars[k].val.textContent = `${Math.round(v * 100)}`;
        bars[k].fill.classList.toggle('low', v < 0.25);
      }
      if (a.thought !== lastThought) {
        lastThought = a.thought || '';
        bubbleText.textContent = lastThought;
        bubble.classList.toggle('empty', !lastThought);
        bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop');
      }
      const j = s.journal;
      $('journal-date').textContent = j ? j.date : '';
      $('journal-title').textContent = j?.title || '';
      const listKey = JSON.stringify(s.list || []);
      if (listKey !== lastList) {
        lastList = listKey;
        const ul = $('list');
        ul.replaceChildren();
        if (!s.list?.length) ul.append(el('li', 'muted', 'Nothing on it yet.'));
        else for (const item of s.list) ul.append(el('li', null, item));
      }
      $('journal-text').textContent = j ? j.text : 'No journal entries yet.';
    },
    addEvent(e) {
      const li = el('li', 'ev ' + e.kind);
      li.append(el('time', null, fmtTime(e.t)), el('span', null, e.text));
      logList.prepend(li);
      while (logList.children.length > 60) logList.lastChild.remove();
    },
    resetEvents(events) {
      logList.replaceChildren();
      for (const e of events) this.addEvent(e);
    },
    setStatus(st) {
      const tag = $('source');
      tag.textContent = { live: 'live', connecting: 'connecting…', offline: 'reconnecting…', demo: 'demo' }[st] || st;
      tag.dataset.status = st;
    },
    setClock(t) { $('clock').textContent = fmtTime(t); },
    placeBubble(x, y, visible) {
      bubble.style.visibility = visible && lastThought ? 'visible' : 'hidden';
      bubble.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    },
  };
}
