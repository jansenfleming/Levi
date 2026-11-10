// Phase 1 only: a local, scripted stand-in for the server simulation.
// It produces exactly the state/event shape the server will stream in phase 2,
// so the renderer and UI don't change when the real source arrives.
import {
  PLACES, GENERIC_ACTIONS, INTERSECTIONS, WALK_SPEED, findPath, pathLength, locationName,
} from '../shared/town.js';

const LOOP = [
  { place: 'noodle', activity: 'eat', dur: 40 },
  { place: 'garden', activity: 'pond', dur: 30 },
  { place: 'garden', activity: 'sit', dur: 35 },
  { place: 'plaza', activity: 'watch', dur: 30 },
  { place: 'archive', activity: 'read', dur: 40 },
  { generic: 'journal', dur: 25 },
  { place: 'arcade', activity: 'play', dur: 35 },
  { generic: 'wander' },
  { generic: 'think', dur: 25 },
  { place: 'charge', activity: 'recharge', dur: 30 },
  { place: 'pod', activity: 'rest', dur: 25 },
  { generic: 'nothing', dur: 15 },
  { place: 'pod', activity: 'sleep', dur: 30 },
];

const EFFECTS = { // per second while doing it
  sleep: { energy: 0.01 }, rest: { energy: 0.004 }, recharge: { energy: 0.008 },
  eat: { fullness: 0.012 }, read: { stimulation: 0.006 }, play: { stimulation: 0.009 },
  watch: { stimulation: 0.005 }, pond: { stimulation: 0.003 }, journal: { stimulation: 0.003 },
};

export function createScriptedSource({ speed = 1 } = {}) {
  const listeners = { state: [], event: [], status: [], snapshot: [] };
  const emit = (k, v) => listeners[k].forEach((f) => f(v));
  let i = 0;
  const state = {
    source: 'scripted',
    now: Date.now(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    alien: { loc: { place: 'pod', activity: 'rest' }, activity: null, motion: null, thought: '' },
    needs: { energy: 0.7, fullness: 0.45, stimulation: 0.5 },
    weather: { kind: 'rain', rain: 1, fog: 0.3 },
    journal: null,
  };

  const log = (kind, text) => emit('event', { t: Date.now(), kind, text });

  function begin(step) {
    const a = state.alien;
    const now = Date.now();
    let dest, label, actId;
    if (step.generic === 'wander') {
      const n = INTERSECTIONS[Math.floor(Math.random() * INTERSECTIONS.length)];
      dest = { node: n.id }; label = GENERIC_ACTIONS.wander.label; actId = 'wander';
    } else if (step.generic) {
      dest = a.loc.place ? { place: a.loc.place, activity: null } : a.loc;
      label = GENERIC_ACTIONS[step.generic].label; actId = step.generic;
    } else {
      dest = { place: step.place, activity: step.activity };
      label = PLACES[step.place].activities[step.activity].label; actId = step.activity;
    }
    const sameSpot = JSON.stringify(dest) === JSON.stringify(a.loc);
    const path = sameSpot ? null : findPath(a.loc, dest);
    const walkMs = path ? (pathLength(path) / (WALK_SPEED * speed)) * 1000 : 0;
    a.motion = path ? { path, start: now, speed: WALK_SPEED * speed } : null;
    a.loc = dest;
    const dur = (step.dur || 0) * 1000 / speed;
    a.activity = { id: actId, label, startedAt: now + walkMs, endsAt: now + walkMs + dur };
    a.thought = `[scripted loop] ${path ? 'heading to ' + locationName(dest) : label.toLowerCase()}`;
    if (path) log('action', `Walking to ${locationName(dest)}`);
    state.now = now;
    emit('state', structuredClone(state));
    setTimeout(() => {
      if (path) { log('action', `${label} at ${locationName(dest)}`); }
      else log('action', `${label}`);
      a.motion = null;
      a.thought = `[scripted loop] ${label.toLowerCase()}`;
      state.now = Date.now();
      emit('state', structuredClone(state));
    }, walkMs);
    setTimeout(next, walkMs + dur);
  }

  function next() {
    const step = LOOP[i++ % LOOP.length];
    begin(step);
  }

  // needs tick
  setInterval(() => {
    const n = state.needs, act = state.alien.activity?.id;
    n.energy -= 0.0012 * speed; n.fullness -= 0.0015 * speed; n.stimulation -= 0.0018 * speed;
    const e = state.alien.motion ? null : EFFECTS[act];
    if (e) for (const k in e) n[k] += e[k] * speed;
    for (const k in n) n[k] = Math.min(1, Math.max(0, n[k]));
    state.now = Date.now();
    emit('state', structuredClone(state));
  }, 1000);

  return {
    on(k, f) { listeners[k].push(f); },
    start() {
      emit('status', 'demo');
      log('system', 'Demo mode: scripted loop running in your browser');
      emit('state', structuredClone(state));
      setTimeout(next, 1500);
    },
  };
}
