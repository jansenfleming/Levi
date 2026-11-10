// The decision interface. Phase 3 plugs the Ollama brain in here; the simulation
// doesn't care which implementation it talks to.

import { ACTIONS, ACTION_IDS, type ActionId, type Needs } from './actions.ts';
import type { Weather } from './weather.ts';

export interface DecisionContext {
  now: number;
  townTime: string;          // e.g. "Tuesday 21:43"
  weather: Weather;
  location: string;          // human-readable
  place: string | null;      // place id or null on the streets
  available: ActionId[];     // everything he may choose from
  needs: Needs;
  recent: { t: number; text: string }[]; // recent memories (phase 3)
  notice?: string;           // something that changed, if that's why he's deciding
}

export interface Decision {
  action: ActionId;
  minutes: number;
  thought: string;
  /** Diagnostic fields for the decision log (phase 3). */
  raw?: string;
  source: string;            // which decider produced it, e.g. "placeholder", "ollama:qwen3:14b", "fallback"
}

export interface Decider {
  readonly name: string;
  decide(ctx: DecisionContext): Promise<Decision>;
}

/**
 * Phase 2 stand-in: picks uniformly at random. Deliberately has no preferences
 * so it can't be mistaken for behaviour. Replaced by the Ollama brain in phase 3.
 */
export class PlaceholderDecider implements Decider {
  readonly name = 'placeholder';
  async decide(ctx: DecisionContext): Promise<Decision> {
    const action = ctx.available[Math.floor(Math.random() * ctx.available.length)];
    const def = ACTIONS[action];
    const minutes = Math.round(def.min + Math.random() * (def.max - def.min) * 0.3);
    return { action, minutes, thought: '[placeholder decider: random pick, no brain yet]', source: this.name };
  }
}

export function allActions(): ActionId[] { return [...ACTION_IDS]; }
