// The catalog of things the alien can do. The brain (phase 3) picks from this list;
// the simulation validates every choice against it.

import { PLACES as PLACES_JS, GENERIC_ACTIONS as GENERIC_JS } from '../public/shared/town.js';

type Labelled = { label: string };
const PLACES = PLACES_JS as unknown as Record<string, { name: string; activities: Record<string, Labelled> }>;
const GENERIC_ACTIONS = GENERIC_JS as unknown as Record<string, Labelled>;

export type ActionId =
  | 'sleep' | 'rest' | 'read' | 'eat' | 'play' | 'recharge' | 'sit_bench' | 'look_at_pond' | 'watch_hologram'
  | 'wander' | 'sit_and_think' | 'write_journal' | 'do_nothing'
  | 'browse_web' | 'work_on_website' | 'make_something' | 'work_on_currency' | 'something_else';

export interface ActionDef {
  id: ActionId;
  /** Place where it happens; null = generic (wherever he is). */
  place: string | null;
  /** Activity key in town.js (place activity or generic action). */
  activity: string;
  /** Allowed duration in minutes. */
  min: number;
  max: number;
  /** What doing it does to his needs, per hour. */
  effects: Partial<Needs>;
  description: string;
}

export interface Needs { energy: number; fullness: number; stimulation: number }

export const ACTIONS: Record<ActionId, ActionDef> = {
  sleep:          { id: 'sleep', place: 'pod', activity: 'sleep', min: 20, max: 600, effects: { energy: 0.14 }, description: 'sleep in your capsule' },
  rest:           { id: 'rest', place: 'pod', activity: 'rest', min: 5, max: 90, effects: { energy: 0.05 }, description: 'rest on the bench outside your capsule' },
  read:           { id: 'read', place: 'archive', activity: 'read', min: 10, max: 180, effects: { stimulation: 0.3 }, description: 'read something from the archive' },
  eat:            { id: 'eat', place: 'noodle', activity: 'eat', min: 10, max: 45, effects: { fullness: 1.4 }, description: 'eat a bowl of noodles' },
  play:           { id: 'play', place: 'arcade', activity: 'play', min: 10, max: 120, effects: { stimulation: 0.5, energy: -0.02 }, description: 'play an arcade game' },
  recharge:       { id: 'recharge', place: 'charge', activity: 'recharge', min: 10, max: 60, effects: { energy: 0.4 }, description: 'recharge at the charge pylon' },
  sit_bench:      { id: 'sit_bench', place: 'garden', activity: 'sit', min: 5, max: 120, effects: { energy: 0.02, stimulation: 0.08 }, description: 'sit on the garden bench' },
  look_at_pond:   { id: 'look_at_pond', place: 'garden', activity: 'pond', min: 5, max: 90, effects: { stimulation: 0.15 }, description: 'look at the pond' },
  watch_hologram: { id: 'watch_hologram', place: 'plaza', activity: 'watch', min: 5, max: 60, effects: { stimulation: 0.25 }, description: 'watch the hologram' },
  wander:         { id: 'wander', place: null, activity: 'wander', min: 0, max: 10, effects: { stimulation: 0.15, energy: -0.03 }, description: 'wander the streets' },
  sit_and_think:  { id: 'sit_and_think', place: null, activity: 'think', min: 5, max: 90, effects: { stimulation: 0.08 }, description: 'sit down where you are and think' },
  write_journal:  { id: 'write_journal', place: null, activity: 'journal', min: 5, max: 45, effects: { stimulation: 0.15 }, description: 'write in your journal' },
  do_nothing:     { id: 'do_nothing', place: null, activity: 'nothing', min: 5, max: 90, effects: {}, description: 'do nothing at all' },
  browse_web:     { id: 'browse_web', place: null, activity: 'browse', min: 5, max: 60, effects: { stimulation: 0.3 }, description: 'read the web (search for something, or open a URL)' },
  work_on_website:{ id: 'work_on_website', place: null, activity: 'website', min: 10, max: 120, effects: { stimulation: 0.3, energy: -0.02 }, description: 'make a new website of your own, or change one you made' },
  make_something: { id: 'make_something', place: null, activity: 'build', min: 10, max: 120, effects: { stimulation: 0.35, energy: -0.04 }, description: 'make something on a street corner in town (a sculpture, sign, mural, lights, a plant, or anything else)' },
  work_on_currency:{ id: 'work_on_currency', place: null, activity: 'currency', min: 5, max: 60, effects: { stimulation: 0.15 }, description: 'create or use a currency of your own (it only exists in this town)' },
  something_else: { id: 'something_else', place: null, activity: 'other', min: 5, max: 120, effects: { stimulation: 0.1 }, description: 'do something that is not on this list (describe it in "details")' },
};

/** Actions whose "details" field matters. */
export const NEEDS_DETAILS: ActionId[] = ['browse_web', 'work_on_website', 'make_something', 'work_on_currency', 'something_else'];

export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];

/** Needs decay per hour, regardless of activity. */
export const DECAY: Needs = { energy: 0.035, fullness: 0.06, stimulation: 0.07 };
/** Extra energy cost per hour while walking. */
export const WALK_COST = 0.04;

export function actionLabel(id: ActionId): string {
  const a = ACTIONS[id];
  if (a.place) return PLACES[a.place].activities[a.activity].label;
  return GENERIC_ACTIONS[a.activity].label;
}

// Sanity check at startup: every action maps onto the town definition.
for (const a of Object.values(ACTIONS)) {
  const ok = a.place ? PLACES[a.place]?.activities?.[a.activity] : GENERIC_ACTIONS[a.activity];
  if (!ok) throw new Error(`action ${a.id} does not match town.js`);
}
