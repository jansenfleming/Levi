// The world simulation: the alien's location, activity, movement and needs, plus the weather.
// Real time. One tick per second. Decisions only happen when an activity ends.

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  INTERSECTIONS, WALK_SPEED, findPath, pathLength, locationName,
} from '../public/shared/town.js';
import { ACTIONS, ACTION_IDS, DECAY, WALK_COST, actionLabel, type ActionId, type Needs } from './actions.ts';
import { makeWeather, stepWeather, describeWeather, type Weather } from './weather.ts';
import type { Decider, Decision, DecisionContext } from './decider.ts';
import { config } from './config.ts';

export type Loc = { place: string; activity: string | null } | { node: string };

export interface Activity {
  id: string;          // town.js activity key (drives the pose in the browser)
  action: ActionId;
  label: string;
  startedAt: number;   // when he arrives and starts doing it
  endsAt: number;
}

export interface WorldState {
  now: number;
  tz: string;
  alien: {
    loc: Loc;
    activity: Activity | null;
    motion: { path: [number, number][]; start: number; speed: number } | null;
    thought: string;
    deciding: boolean;
  };
  needs: Needs;
  weather: Weather;
  journal: { date: string; text: string } | null;
}

export interface SimEvent { t: number; kind: 'action' | 'thought' | 'system'; text: string }

type Listener = { state: (s: WorldState) => void; event: (e: SimEvent) => void };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export class Simulation {
  state: WorldState;
  events: SimEvent[] = [];
  private listeners: Listener[] = [];
  private lastTick = Date.now();
  private decisionSeq = 0;
  private pendingNotice: string | null = null;
  private saveFile: string;
  private timer: NodeJS.Timeout | null = null;
  private lastBroadcast = 0;
  private decider: Decider;

  constructor(decider: Decider) {
    this.decider = decider;
    this.saveFile = path.join(config.dataDir, 'state.json');
    const now = Date.now();
    this.state = {
      now, tz: config.townTz,
      alien: { loc: { place: 'pod', activity: 'rest' }, activity: null, motion: null, thought: '', deciding: false },
      needs: { energy: 0.8, fullness: 0.6, stimulation: 0.5 },
      weather: makeWeather('rain', now, config.simSpeed),
      journal: null,
    };
    this.load();
  }

  on(l: Listener) { this.listeners.push(l); }

  start() {
    this.log('system', `Simulation started (decider: ${this.decider.name}${config.simSpeed > 1 ? `, dev speed ×${config.simSpeed}` : ''})`);
    // Resume: decide now if he had nothing going on when the server stopped.
    const a = this.state.alien;
    if (!a.activity || a.deciding || Date.now() >= a.activity.endsAt) void this.decide();
    this.timer = setInterval(() => this.tick(), 1000);
    setInterval(() => this.save(), 30_000).unref();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.save(); }

  snapshot(): WorldState { this.state.now = Date.now(); return this.state; }

  // ------------------------------------------------------------------
  private tick() {
    const now = Date.now();
    const dtHours = ((now - this.lastTick) / 3_600_000) * config.simSpeed;
    this.lastTick = now;
    const s = this.state, a = s.alien;

    // needs
    const walking = !!a.motion && now < (a.activity?.startedAt ?? 0);
    const effects = !walking && a.activity && now >= a.activity.startedAt ? ACTIONS[a.activity.action].effects : {};
    for (const k of ['energy', 'fullness', 'stimulation'] as const) {
      let d = -DECAY[k] + (effects[k] ?? 0);
      if (walking && k === 'energy') d -= WALK_COST;
      s.needs[k] = clamp01(s.needs[k] + d * dtHours);
    }

    // arrival
    if (a.motion && a.activity && now >= a.activity.startedAt) {
      a.motion = null;
      this.log('action', `${a.activity.label} at ${locationName(a.loc)}`);
      this.changed();
    }

    // activity over -> decide what's next
    if (!a.deciding && a.activity && now >= a.activity.endsAt) void this.decide();

    // weather
    const w = stepWeather(s.weather, now, config.simSpeed);
    if (w) {
      const before = s.weather.kind;
      s.weather = w;
      if (w.kind !== before) {
        this.log('system', `Weather: ${describeWeather(w)}`);
        this.pendingNotice = `The weather changed to ${describeWeather(w)}.`;
      }
      this.changed();
    }

    // periodic state push so needs bars stay current
    if (now - this.lastBroadcast > 5000) this.changed();
  }

  private context(): DecisionContext {
    const s = this.state, a = s.alien;
    const place = 'place' in a.loc ? a.loc.place : null;
    return {
      now: Date.now(),
      townTime: new Date().toLocaleString('en-GB', { timeZone: s.tz, weekday: 'long', hour: '2-digit', minute: '2-digit' }),
      weather: s.weather,
      location: locationName(a.loc),
      place,
      available: [...ACTION_IDS],
      needs: { ...s.needs },
      recent: this.events.filter((e) => e.kind !== 'system').slice(-10).map((e) => ({ t: e.t, text: e.text })),
      notice: this.pendingNotice ?? undefined,
    };
  }

  async decide() {
    const seq = ++this.decisionSeq;
    const a = this.state.alien;
    a.deciding = true;
    this.changed();
    const ctx = this.context();
    this.pendingNotice = null;
    let d: Decision;
    try {
      d = await this.decider.decide(ctx);
    } catch (err) {
      this.log('system', `Decider failed: ${(err as Error).message}`);
      d = { action: 'sit_and_think', minutes: 10, thought: '', source: 'fallback' };
    }
    if (seq !== this.decisionSeq) return; // superseded
    this.begin(this.validate(d));
  }

  /** Last line of defence: the action must exist and the duration must be within limits. */
  private validate(d: Decision): Decision {
    if (!ACTION_IDS.includes(d.action)) d = { ...d, action: 'sit_and_think', source: 'fallback' };
    const def = ACTIONS[d.action];
    const minutes = Number.isFinite(d.minutes) ? Math.min(def.max, Math.max(def.min, Math.round(d.minutes))) : def.min;
    const thought = typeof d.thought === 'string' ? d.thought.slice(0, 280) : '';
    return { ...d, minutes, thought };
  }

  private begin(d: Decision) {
    const now = Date.now();
    const a = this.state.alien;
    const def = ACTIONS[d.action];
    let dest: Loc;
    if (d.action === 'wander') {
      const here = 'node' in a.loc ? a.loc.node : null;
      const options = INTERSECTIONS.filter((n: { id: string }) => n.id !== here);
      dest = { node: options[Math.floor(Math.random() * options.length)].id };
    } else if (def.place) {
      dest = { place: def.place, activity: def.activity };
    } else {
      dest = 'place' in a.loc ? { place: a.loc.place, activity: null } : a.loc;
    }

    const same = JSON.stringify(dest) === JSON.stringify(a.loc);
    const pathPts = same ? null : findPath(a.loc, dest);
    const speed = WALK_SPEED * config.simSpeed;
    const walkMs = pathPts ? (pathLength(pathPts) / speed) * 1000 : 0;
    const label = actionLabel(d.action);

    a.motion = pathPts ? { path: pathPts, start: now, speed } : null;
    a.loc = dest;
    a.activity = {
      id: def.activity, action: d.action, label,
      startedAt: now + walkMs,
      endsAt: now + walkMs + (d.minutes * 60_000) / config.simSpeed,
    };
    a.deciding = false;
    a.thought = d.thought;
    if (d.thought) this.log('thought', d.thought);
    if (pathPts) this.log('action', `Walking to ${locationName(dest)} (to ${def.description})`);
    else this.log('action', `${label}`);
    this.changed();
  }

  // ------------------------------------------------------------------
  log(kind: SimEvent['kind'], text: string) {
    const e = { t: Date.now(), kind, text };
    this.events.push(e);
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
    for (const l of this.listeners) l.event(e);
  }

  private changed() {
    this.lastBroadcast = Date.now();
    const s = this.snapshot();
    for (const l of this.listeners) l.state(s);
  }

  // ------------------------------------------------------------------
  // Persistence (JSON for now; SQLite arrives with the brain in phase 3).
  private save() {
    try {
      mkdirSync(config.dataDir, { recursive: true });
      const tmp = this.saveFile + '.tmp';
      writeFileSync(tmp, JSON.stringify({ v: 1, state: this.state, events: this.events.slice(-100) }));
      renameSync(tmp, this.saveFile);
    } catch (err) {
      console.error('[sim] save failed', err);
    }
  }

  private load() {
    if (!existsSync(this.saveFile)) return;
    try {
      const data = JSON.parse(readFileSync(this.saveFile, 'utf8'));
      if (data?.v !== 1 || !data.state?.alien) return;
      const st = data.state as WorldState;
      st.tz = config.townTz;
      st.alien.deciding = false;
      this.state = st;
      this.events = Array.isArray(data.events) ? data.events : [];
      console.log('[sim] resumed from saved state');
    } catch (err) {
      console.error('[sim] could not load saved state, starting fresh', err);
    }
  }
}
