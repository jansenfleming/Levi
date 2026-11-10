// The world simulation: the alien's location, activity, movement and needs, plus the weather.
// Real time, one tick per second. He decides when an activity ends, or early when something
// changes around him (weather while outdoors, the brain coming back online).

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  PLACES, INTERSECTIONS, WALK_SPEED, findPath, pathLength, locationName,
} from '../public/shared/town.js';
import { ACTIONS, ACTION_IDS, DECAY, WALK_COST, actionLabel, type ActionId, type Needs } from './actions.ts';
import { makeWeather, stepWeather, describeWeather, type Weather } from './weather.ts';
import { BrainOffline, fallbackDecision, type ActionOption, type Brain, type Decision, type DecisionContext } from './decider.ts';
import { MemoryStream, formatWhen } from './memory.ts';
import { store, type Creation } from './db.ts';
import * as work from './work.ts';
import { config } from './config.ts';

export type Loc = { place: string; activity: string | null } | { node: string } | { slot: string };

export interface Activity {
  id: string;          // town.js activity key (drives the pose in the browser)
  action: ActionId;
  label: string;
  startedAt: number;   // when he arrives and starts doing it
  endsAt: number;
  offline?: boolean;   // filler activity while the brain is unreachable
  build?: work.BuildPlan; // what he will make when he gets to the corner
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
  brain: { name: string; online: boolean };
  journal: { date: string; title: string | null; text: string } | null;
  list: string[];
  creations: Creation[];
}

export interface SimEvent { t: number; kind: 'action' | 'thought' | 'system'; text: string }

type Listener = { state: (s: WorldState) => void; event: (e: SimEvent) => void };

const PLACE_TABLE = PLACES as unknown as Record<string, { name: string }>;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const INDOOR_ACTIONS: ActionId[] = ['sleep', 'read', 'play']; // weather doesn't reach him here

/** Option descriptions address him as "you"; memories are in his own voice. */
function firstPerson(s: string) {
  return s.replace(/\byou are\b/g, 'I am').replace(/\byour\b/g, 'my').replace(/\byou\b/g, 'I');
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

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
  private brain: Brain;
  private memory: MemoryStream;
  private currentDecisionId: number | null = null;
  private offlineSince: number | null = null;
  private healthTimer: NodeJS.Timeout | null = null;

  constructor(brain: Brain) {
    this.brain = brain;
    this.memory = new MemoryStream(brain);
    this.saveFile = path.join(config.dataDir, 'state.json');
    const now = Date.now();
    this.state = {
      now, tz: config.townTz,
      alien: { loc: { place: 'pod', activity: 'rest' }, activity: null, motion: null, thought: '', deciding: false },
      needs: { energy: 0.8, fullness: 0.6, stimulation: 0.5 },
      weather: makeWeather('rain', now, config.simSpeed),
      brain: { name: brain.name, online: true },
      journal: null,
      list: [],
      creations: [],
    };
    this.load();
    const j = store.latestJournal();
    this.state.journal = j ? { date: j.date, title: j.title, text: j.text } : null;
    this.state.list = store.plans();
    this.state.creations = store.creations();
    this.state.brain = { name: brain.name, online: true };
  }

  on(l: Listener) { this.listeners.push(l); }

  start() {
    this.log('system', `Simulation started (brain: ${this.brain.name}${config.simSpeed > 1 ? `, dev speed ×${config.simSpeed}` : ''})`);
    if (store.maxMemoryId() === 0) this.memory.add('observation', 'I arrived in this town.');
    const a = this.state.alien;
    if (!a.activity || a.deciding || a.activity.offline || Date.now() >= a.activity.endsAt) void this.decide();
    this.timer = setInterval(() => this.tick(), 1000);
    setInterval(() => this.save(), 30_000).unref();
    // Pick up admin hides (and anything else changed directly in the database).
    setInterval(() => this.refreshFromStore(), 30_000).unref();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.save(); }

  snapshot(): WorldState { this.state.now = Date.now(); return this.state; }

  // ------------------------------------------------------------------
  private tick() {
    const now = Date.now();
    const dtHours = ((now - this.lastTick) / 3_600_000) * config.simSpeed;
    this.lastTick = now;
    const s = this.state, a = s.alien;

    const walking = !!a.motion && now < (a.activity?.startedAt ?? 0);
    const effects = !walking && a.activity && now >= a.activity.startedAt ? ACTIONS[a.activity.action].effects : {};
    for (const k of ['energy', 'fullness', 'stimulation'] as const) {
      let d = -DECAY[k] + (effects[k] ?? 0);
      if (walking && k === 'energy') d -= WALK_COST;
      s.needs[k] = clamp01(s.needs[k] + d * dtHours);
    }

    if (a.motion && a.activity && now >= a.activity.startedAt) {
      a.motion = null;
      this.log('action', `${a.activity.label} at ${locationName(a.loc)}`);
      this.changed();
    }
    if (a.activity?.build && !a.motion && now >= a.activity.startedAt) {
      const plan = a.activity.build;
      a.activity.build = undefined;
      this.publish(work.finishBuild(plan));
    }

    if (!a.deciding && a.activity && now >= a.activity.endsAt) void this.decide();

    const w = stepWeather(s.weather, now, config.simSpeed);
    if (w) {
      const before = s.weather.kind;
      s.weather = w;
      if (w.kind !== before) {
        const text = `The weather changed to ${describeWeather(w)}.`;
        this.log('system', `Weather: ${describeWeather(w)}`);
        this.memory.add('observation', text);
        this.pendingNotice = text;
        this.maybeInterrupt();
      }
      this.changed();
    }

    if (now - this.lastBroadcast > 5000) this.changed();
  }

  /** Something changed: let him reconsider, unless he's asleep, walking, inside, or just started. */
  private maybeInterrupt() {
    const a = this.state.alien, now = Date.now();
    if (a.deciding || !a.activity || a.activity.offline || a.motion) return;
    if (INDOOR_ACTIONS.includes(a.activity.action)) return;
    const ranMs = (now - a.activity.startedAt) * config.simSpeed;
    if (ranMs < 3 * 60_000) return;
    void this.decide(true);
  }

  // ------------------------------------------------------------------
  private context(interrupted: boolean): DecisionContext {
    const s = this.state, a = s.alien;
    const now = Date.now();
    const place = 'place' in a.loc ? a.loc.place : null;
    const options: ActionOption[] = ACTION_IDS.map((id) => {
      const def = ACTIONS[id];
      let walkSeconds = 0;
      if (def.place && def.place !== place) {
        walkSeconds = Math.round(pathLength(findPath(a.loc, { place: def.place, activity: def.activity })) / WALK_SPEED);
      }
      return {
        id, description: def.description, place: def.place,
        placeName: def.place ? PLACE_TABLE[def.place].name : null,
        walkSeconds, min: def.min, max: def.max,
      };
    });
    const hour = Number(new Date(now).toLocaleString('en-GB', { timeZone: s.tz, hour: '2-digit', hourCycle: 'h23' }));
    const partOfDay = hour < 5 ? 'late night' : hour < 8 ? 'early morning' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
    const mem = this.memory.forPrompt(now);
    const current = interrupted && a.activity
      ? `${a.activity.label.toLowerCase()} (${Math.round(((now - a.activity.startedAt) * config.simSpeed) / 60_000)} min so far)` : undefined;
    return {
      now,
      townTime: new Date(now).toLocaleString('en-GB', { timeZone: s.tz, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
      partOfDay,
      weather: describeWeather(s.weather),
      location: locationName(a.loc),
      place,
      options: shuffle(options),
      places: Object.entries(PLACE_TABLE).map(([id, p]) => ({ id, name: p.name })),
      needs: { ...s.needs },
      summary: mem.summary,
      recent: mem.recent,
      notice: this.pendingNotice ?? undefined,
      current,
      world: this.worldInfo(),
    };
  }

  private worldInfo() {
    const cur = store.currency();
    return {
      list: [...this.state.list],
      sites: store.sites().filter((x) => !x.hidden).map((x) => ({ slug: x.slug, title: x.title })),
      creations: store.creations().map((c) => ({ title: c.title, kind: c.kind, where: locationName({ slot: c.slot }) })),
      currency: cur ? { name: cur.name, symbol: cur.symbol, supply: cur.supply } : null,
      journalCount: store.journal(10_000).length,
    };
  }

  private workCtx() {
    const now = Date.now();
    const mem = this.memory.forPrompt(now);
    return {
      townTime: new Date(now).toLocaleString('en-GB', { timeZone: this.state.tz, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
      location: locationName(this.state.alien.loc),
      summary: mem.summary, recent: mem.recent, world: this.worldInfo(),
    };
  }

  private refreshFromStore() {
    this.state.creations = store.creations();
    const j = store.latestJournal();
    this.state.journal = j ? { date: j.date, title: j.title, text: j.text } : null;
    this.changed();
  }

  /** Make the result of a piece of work public: event log, memory, state. */
  private publish(r: work.WorkResult) {
    this.log('action', r.event);
    this.memory.add('action', r.memory);
    if (r.thought) { this.state.alien.thought = r.thought; this.log('thought', r.thought); this.memory.add('thought', r.thought); }
    this.refreshFromStore();
  }

  /** Long-running work happens while he sits/reads; results are published when ready. */
  private startWork(d: Decision) {
    const ctx = this.workCtx();
    const dateLabel = new Date().toLocaleDateString('en-CA', { timeZone: this.state.tz });
    let job: Promise<work.WorkResult> | null = null;
    switch (d.action) {
      case 'write_journal': job = work.writeJournal(this.brain, ctx, dateLabel); break;
      case 'work_on_website': job = work.workOnWebsite(this.brain, ctx, d.details); break;
      case 'work_on_currency': job = work.workOnCurrency(this.brain, ctx, d.details); break;
      case 'browse_web': job = work.browseWeb(this.brain, ctx, d.details); break;
    }
    job?.then((r) => this.publish(r)).catch((err: Error) => {
      this.log('system', `${actionLabel(d.action)} didn't work out: ${err.message}`);
      this.memory.add('observation', `I tried to ${firstPerson(ACTIONS[d.action].description)}, but it didn't work out (${err.message}).`);
    });
  }

  async decide(interrupted = false) {
    const seq = ++this.decisionSeq;
    const a = this.state.alien;
    if (this.currentDecisionId !== null) { store.endDecision(this.currentDecisionId, this.state.needs); this.currentDecisionId = null; }
    a.deciding = true;
    this.changed();
    const ctx = this.context(interrupted);
    const notice = this.pendingNotice;
    this.pendingNotice = null;
    const needsBefore = { ...this.state.needs };

    let d: Decision;
    try {
      d = await this.brain.decide(ctx);
    } catch (err) {
      if (seq !== this.decisionSeq) return;
      if (err instanceof BrainOffline) return this.goOffline(err.message, notice);
      this.log('system', `Brain error: ${(err as Error).message}`);
      d = fallbackDecision({ brain: this.brain.name, error: (err as Error).message });
    }
    if (seq !== this.decisionSeq) return;
    if (!this.state.brain.online) this.backOnline();

    d = this.validate(d);
    this.currentDecisionId = store.addDecision({
      t: ctx.now, brain: d.brain, context: { ...ctx, prompt: undefined }, prompt: d.prompt, raw: d.raw,
      action: d.action, target: d.target, minutes: d.minutes, thought: d.thought,
      valid: d.valid, attempts: d.attempts, fallback: d.fallback, error: d.error, latencyMs: d.latencyMs, needsBefore,
    });
    if (d.fallback) this.log('system', `Brain output unusable after ${d.attempts} attempts (${d.error}); falling back to sitting and thinking`);
    if (d.list && JSON.stringify(d.list) !== JSON.stringify(this.state.list)) {
      this.state.list = d.list;
      store.setPlans(d.list);
      this.log('system', 'Levi updated his list');
    }
    let build: work.BuildPlan | undefined;
    if (d.action === 'make_something') {
      try {
        build = await work.planBuild(this.brain, this.workCtx(), d.details);
      } catch (err) {
        if (err instanceof BrainOffline) return this.goOffline(err.message, notice);
        this.log('system', `Couldn't work out what to make: ${(err as Error).message}`);
        d = { ...d, action: 'sit_and_think', fallback: true };
      }
      if (seq !== this.decisionSeq) return;
    }
    this.begin(d, { build });
    this.startWork(d);
    this.memory.maybeSummarize((msg) => this.log('system', msg));
  }

  /** Last line of defence, whatever the brain implementation does. */
  private validate(d: Decision): Decision {
    if (!ACTION_IDS.includes(d.action)) d = { ...d, action: 'sit_and_think', fallback: true };
    const def = ACTIONS[d.action];
    const minutes = Number.isFinite(d.minutes) ? Math.min(def.max, Math.max(def.min, Math.round(d.minutes))) : def.min;
    const thought = typeof d.thought === 'string' ? d.thought.slice(0, 280) : '';
    return { ...d, minutes, thought };
  }

  private begin(d: Decision, opts: { label?: string; offline?: boolean; build?: work.BuildPlan } = {}) {
    const now = Date.now();
    const a = this.state.alien;
    const def = ACTIONS[d.action];
    const from = locationName(a.loc);
    const prevLoc = a.loc;
    let dest: Loc;
    if (d.action === 'wander') {
      if (d.target && PLACE_TABLE[d.target]) dest = { place: d.target, activity: null };
      else {
        const here = 'node' in a.loc ? a.loc.node : null;
        const options = INTERSECTIONS.filter((n: { id: string }) => n.id !== here);
        dest = { node: options[Math.floor(Math.random() * options.length)].id };
      }
    } else if (opts.build) {
      dest = { slot: opts.build.slot };
    } else if (def.place) {
      dest = { place: def.place, activity: def.activity };
    } else {
      dest = 'place' in a.loc ? { place: a.loc.place, activity: null } : a.loc;
    }

    const continuing = a.activity?.action === d.action && JSON.stringify(dest) === JSON.stringify(a.loc);
    const pathPts = JSON.stringify(dest) === JSON.stringify(a.loc) ? null : findPath(a.loc, dest);
    const speed = WALK_SPEED * config.simSpeed;
    const walkMs = pathPts ? (pathLength(pathPts) / speed) * 1000 : 0;
    const own = d.details && d.details !== 'none' ? d.details : '';
    const label = opts.label
      ?? (d.action === 'something_else' && own ? own.charAt(0).toUpperCase() + own.slice(1, 80)
        : opts.build ? `Making something: ${opts.build.title}` : actionLabel(d.action));

    a.motion = pathPts ? { path: pathPts, start: now, speed } : null;
    a.loc = dest;
    a.activity = {
      id: def.activity, action: d.action, label,
      startedAt: now + walkMs,
      endsAt: now + walkMs + (d.minutes * 60_000) / config.simSpeed,
      offline: opts.offline,
      build: opts.build,
    };
    a.deciding = false;
    a.thought = d.thought;

    if (d.thought) { this.log('thought', d.thought); this.memory.add('thought', d.thought); }
    const to = locationName(dest);
    const moved = !!pathPts && (from !== to || ('node' in prevLoc && 'node' in dest));
    if (!opts.offline) {
      const desc = d.action === 'something_else' && own ? own : own && d.action !== 'write_journal' ? `${firstPerson(def.description)}: ${own}` : firstPerson(def.description);
      const did = continuing ? `I kept going: ${desc}`
        : d.action === 'wander' && pathPts ? `I wandered the streets from ${from} to ${from === to ? 'another street corner' : to}`
        : moved ? `I walked from ${from} to ${to} to ${desc}` : `I chose to ${desc}`;
      this.memory.add('action', `${did} (planned ${d.minutes} min).`);
    }
    if (moved) this.log('action', `Walking to ${to} (to ${firstPerson(def.description).replace(/\bmy\b/g, 'his').replace(/\bI am\b/g, 'he is')})`);
    else this.log('action', continuing ? `Keeps ${label.toLowerCase()}` : label);
    this.changed();
  }

  // ------------------------------------------------------------------
  // Brain offline: he dozes or daydreams where he is; we poll until the brain is back.
  private goOffline(reason: string, notice: string | null) {
    const first = this.offlineSince === null;
    if (first) {
      this.offlineSince = Date.now();
      this.state.brain.online = false;
      this.log('system', `Brain offline: ${reason}`);
      console.warn('[brain] offline:', reason);
    }
    if (notice) this.pendingNotice = notice;
    const atPod = 'place' in this.state.alien.loc && this.state.alien.loc.place === 'pod';
    const dozing = this.state.needs.energy < 0.5;
    const d = fallbackDecision({ brain: 'offline', minutes: 10, action: atPod ? 'rest' : 'sit_and_think' });
    this.begin(d, { label: dozing ? 'Dozing (brain offline)' : 'Daydreaming (brain offline)', offline: true });
    this.state.alien.thought = '…';
    if (!this.healthTimer) {
      this.healthTimer = setInterval(async () => {
        if (await this.brain.healthy()) {
          clearInterval(this.healthTimer!); this.healthTimer = null;
          if (!this.state.alien.deciding) void this.decide();
        }
      }, 20_000);
    }
  }

  private backOnline() {
    const since = this.offlineSince;
    this.offlineSince = null;
    this.state.brain.online = true;
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
    this.log('system', 'Brain back online');
    console.log('[brain] back online');
    if (since) this.memory.add('observation', `There is a gap in my memory from ${formatWhen(since)} to ${formatWhen(Date.now())}.`);
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
  private save() {
    try {
      mkdirSync(config.dataDir, { recursive: true });
      const tmp = this.saveFile + '.tmp';
      writeFileSync(tmp, JSON.stringify({ v: 1, state: this.state, events: this.events.slice(-100), decisionId: this.currentDecisionId }));
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
      this.state = { ...this.state, ...st };
      this.events = Array.isArray(data.events) ? data.events : [];
      this.currentDecisionId = typeof data.decisionId === 'number' ? data.decisionId : null;
      console.log('[sim] resumed from saved state');
    } catch (err) {
      console.error('[sim] could not load saved state, starting fresh', err);
    }
  }
}
