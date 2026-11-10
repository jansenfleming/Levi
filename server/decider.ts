// The swappable brain interface. The simulation only talks to this; implementations live in server/brain/.

import { ACTIONS, type ActionId, type Needs } from './actions.ts';

export interface ActionOption {
  id: ActionId;
  description: string;
  place: string | null;      // place id where it happens (null = wherever he is)
  placeName: string | null;
  walkSeconds: number;       // from where he is now (0 = here)
  min: number;
  max: number;
}

/** What he has made so far and his list; shown in every prompt. */
export interface WorldInfo {
  list: string[];
  sites: { slug: string; title: string }[];
  creations: { title: string; kind: string; where: string }[];
  currency: { name: string; symbol: string; supply: number } | null;
  journalCount: number;
}

export interface DecisionContext {
  now: number;
  townTime: string;          // "Monday 21:43"
  partOfDay: string;         // "night", "morning", ...
  weather: string;
  location: string;
  place: string | null;
  options: ActionOption[];   // order is shuffled per decision to avoid position bias
  places: { id: string; name: string }[];
  needs: Needs;
  summary: string | null;    // summary of older memories
  recent: string[];          // recent memories, formatted, oldest first
  notice?: string;           // why he is deciding early, if he is
  current?: string;          // what he was in the middle of, if interrupted
  world: WorldInfo;
}

export interface Decision {
  action: ActionId;
  target: string | null;
  minutes: number;
  thought: string;
  details: string;           // free text for open-ended actions ("none" otherwise)
  list: string[] | null;     // his updated list (null = unchanged / not provided)
  // Diagnostics for the decision log.
  brain: string;
  prompt: string;
  raw: string | null;
  valid: boolean;            // first attempt passed validation
  attempts: number;
  fallback: boolean;
  error: string | null;
  latencyMs: number;
}

/** Thrown when the model can't be reached at all (network down, Ollama stopped, model missing). */
export class BrainOffline extends Error {}

export interface Brain {
  readonly name: string;
  decide(ctx: DecisionContext): Promise<Decision>;
  /** Fold older memories into a short summary. */
  summarize(previous: string | null, memories: string[]): Promise<string>;
  /** Cheap reachability check used while offline. */
  healthy(): Promise<boolean>;
  /** Free-form structured generation for follow-up work (journal, websites, building...). */
  generate(system: string, user: string, schema: object, opts?: { maxTokens?: number }): Promise<{ raw: string; value: Record<string, unknown> }>;
}

/** The safe default when the brain answers but its output can't be used. */
export function fallbackDecision(base: Partial<Decision>): Decision {
  return {
    action: 'sit_and_think', target: null, minutes: 15, thought: '', details: 'none', list: null,
    brain: 'fallback', prompt: '', raw: null, valid: false, attempts: 0, fallback: true, error: null, latencyMs: 0,
    ...base,
  };
}

/** For development without a model: picks uniformly at random, no preferences. */
export class PlaceholderBrain implements Brain {
  readonly name = 'placeholder';
  async decide(ctx: DecisionContext): Promise<Decision> {
    const o = ctx.options[Math.floor(Math.random() * ctx.options.length)];
    const def = ACTIONS[o.id];
    return {
      action: o.id, target: o.id === 'wander' ? 'anywhere' : o.place,
      minutes: Math.round(def.min + Math.random() * (def.max - def.min) * 0.3),
      thought: '[placeholder brain: random pick]', details: 'something', list: null, brain: this.name, prompt: '', raw: null,
      valid: true, attempts: 1, fallback: false, error: null, latencyMs: 0,
    };
  }
  async summarize(previous: string | null, memories: string[]) {
    return [previous, `(${memories.length} more memories)`].filter(Boolean).join(' ');
  }
  async healthy() { return true; }
  async generate(): Promise<{ raw: string; value: Record<string, unknown> }> {
    throw new Error('the placeholder brain cannot make things');
  }
}
