// Ollama brain: structured JSON output via `format` (JSON schema), thinking disabled,
// strict validation, one retry, then the safe fallback.

import { ACTIONS, NEEDS_DETAILS, type ActionId } from '../actions.ts';
import { BrainOffline, fallbackDecision, type Brain, type Decision, type DecisionContext } from '../decider.ts';
import { SYSTEM_PROMPT, buildUserPrompt, summaryPrompt } from './prompt.ts';

type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

export interface OllamaOptions {
  url: string;
  model: string;
  temperature?: number;
  numCtx?: number;
  timeoutMs?: number;
}

export class OllamaBrain implements Brain {
  readonly name: string;
  private url: string;
  private model: string;
  private temperature: number;
  private numCtx: number;
  private timeoutMs: number;
  private sendThink = true; // some models reject the `think` field entirely

  constructor(o: OllamaOptions) {
    this.url = o.url.replace(/\/+$/, '');
    this.model = o.model;
    this.temperature = o.temperature ?? 0.8;
    this.numCtx = o.numCtx ?? 8192;
    this.timeoutMs = o.timeoutMs ?? 180_000;
    this.name = `ollama:${o.model}`;
  }

  async healthy(): Promise<boolean> {
    try {
      const r = await fetch(`${this.url}/api/tags`, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return false;
      const j = (await r.json()) as { models?: { name: string }[] };
      return !!j.models?.some((m) => m.name === this.model || m.name === `${this.model}:latest`);
    } catch {
      return false;
    }
  }

  private async chat(messages: Msg[], schema: object, maxTokens?: number): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model, messages, stream: false, format: schema, keep_alive: '1h',
      options: { temperature: this.temperature, num_ctx: this.numCtx, ...(maxTokens ? { num_predict: maxTokens } : {}) },
    };
    if (this.sendThink) body.think = false;
    let r: Response;
    try {
      r = await fetch(`${this.url}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new BrainOffline(`cannot reach Ollama at ${this.url}: ${(err as Error).message}`);
    }
    const text = await r.text();
    if (!r.ok) {
      if (r.status === 400 && /think/i.test(text) && this.sendThink) { this.sendThink = false; return this.chat(messages, schema, maxTokens); }
      if (r.status === 404) throw new BrainOffline(`model ${this.model} not found in Ollama`);
      if (r.status >= 500) throw new BrainOffline(`Ollama error ${r.status}: ${text.slice(0, 200)}`);
      throw new Error(`Ollama ${r.status}: ${text.slice(0, 200)}`);
    }
    const j = JSON.parse(text) as { message?: { content?: string } };
    return j.message?.content ?? '';
  }

  async decide(ctx: DecisionContext): Promise<Decision> {
    const ids = ctx.options.map((o) => o.id);
    const placeIds = ctx.places.map((p) => p.id);
    const schema = {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ids },
        target: { type: 'string', enum: [...placeIds, 'anywhere', 'none'] },
        minutes: { type: 'integer', minimum: 0, maximum: 600 },
        details: { type: 'string' },
        thought: { type: 'string' },
        list: { type: 'array', items: { type: 'string' }, maxItems: 10 },
      },
      required: ['action', 'target', 'minutes', 'details', 'thought', 'list'],
    };
    const prompt = buildUserPrompt(ctx);
    const messages: Msg[] = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }];
    const raws: string[] = [];
    const t0 = performance.now();
    let firstError: string | null = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const raw = await this.chat(messages, schema); // BrainOffline propagates
      raws.push(raw);
      const v = validate(raw, ids, placeIds);
      if (v.ok) {
        return {
          ...v.value, brain: this.name, prompt, raw: raws.join('\n---retry---\n'),
          valid: attempt === 1, attempts: attempt, fallback: false, error: firstError, latencyMs: performance.now() - t0,
        };
      }
      firstError ??= v.error;
      messages.push({ role: 'assistant', content: raw });
      messages.push({ role: 'user', content: `That answer was not usable (${v.error}). Answer again with only the JSON object.` });
    }
    return fallbackDecision({
      brain: this.name, prompt, raw: raws.join('\n---retry---\n'), attempts: 2,
      error: firstError, latencyMs: performance.now() - t0,
    });
  }

  async generate(system: string, user: string, schema: object, opts: { maxTokens?: number } = {}) {
    const raw = await this.chat([{ role: 'system', content: system }, { role: 'user', content: user }], schema, opts.maxTokens);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error('not valid JSON'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not a JSON object');
    return { raw, value: value as Record<string, unknown> };
  }

  async summarize(previous: string | null, memories: string[]): Promise<string> {
    const raw = await this.chat([
      { role: 'system', content: 'Your name is Levi. You are an alien who has arrived in this small town. Answer only with a JSON object: {"summary": "..."}' },
      { role: 'user', content: summaryPrompt(previous, memories) },
    ], { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] });
    const j = JSON.parse(raw) as { summary?: unknown };
    if (typeof j.summary !== 'string' || !j.summary.trim()) throw new Error('empty summary');
    return clean(j.summary, 1200);
  }
}

/** Strip control characters, collapse whitespace, cap length. Output is shown publicly (via textContent). */
export function clean(s: string, max: number): string {
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

type Valid = { ok: true; value: { action: ActionId; target: string | null; minutes: number; thought: string; details: string; list: string[] | null } } | { ok: false; error: string };

export function validate(raw: string, ids: ActionId[], placeIds: string[]): Valid {
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return { ok: false, error: 'not valid JSON' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, error: 'not a JSON object' };
  const o = j as Record<string, unknown>;
  if (typeof o.action !== 'string' || !ids.includes(o.action as ActionId)) return { ok: false, error: `"action" must be one of: ${ids.join(', ')}` };
  const action = o.action as ActionId;
  const def = ACTIONS[action];
  const m = typeof o.minutes === 'string' ? Number(o.minutes) : o.minutes;
  if (typeof m !== 'number' || !Number.isFinite(m)) return { ok: false, error: '"minutes" must be a number' };
  if (typeof o.thought !== 'string' || !o.thought.trim()) return { ok: false, error: '"thought" must be a non-empty string' };
  // Durations outside the action's range are clamped rather than rejected.
  const minutes = Math.min(def.max, Math.max(def.min, Math.round(m)));
  let target: string | null = def.place;
  if (action === 'wander') {
    const t = typeof o.target === 'string' ? o.target : 'anywhere';
    target = placeIds.includes(t) ? t : 'anywhere';
  }
  const details = typeof o.details === 'string' ? clean(o.details, 400) : '';
  if (NEEDS_DETAILS.includes(action) && (!details || details.toLowerCase() === 'none')) return { ok: false, error: `"details" must describe what you want to do for ${action}` };
  const list = Array.isArray(o.list)
    ? o.list.filter((x): x is string => typeof x === 'string').map((x) => clean(x, 120)).filter(Boolean).slice(0, 10)
    : null;
  return { ok: true, value: { action, target, minutes, thought: clean(o.thought, 280), details: details || 'none', list } };
}
