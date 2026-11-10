// Prompt construction. Kept neutral: who he is, what the world allows, and the answer format.
// Nothing suggests what he should want, value or do.

import type { DecisionContext, WorldInfo } from '../decider.ts';

export const IDENTITY = [
  'Your name is Levi. You are an alien who has arrived in this small town. You have no obligations and no one will tell you what to do.',
  '',
  'Besides the places in town, you can write in your journal, make things on street corners around the town,',
  'make websites of your own (they are published on the internet), read the web, and keep a currency of your own',
  'that only exists in this town. You keep your own list of things you intend to do.',
].join('\n');

export const SYSTEM_PROMPT = [
  IDENTITY,
  '',
  'Whenever you finish something, you choose what to do next.',
  'Answer only with a JSON object with these fields:',
  '- "action": one of the listed action ids',
  '- "target": for "wander", a place id to wander toward or "anywhere"; otherwise "none"',
  '- "minutes": how long you will do it, within the listed range',
  '- "details": for browse_web a search query or a URL; for work_on_website, make_something, work_on_currency and something_else, what you want to do, in your own words; otherwise "none"',
  '- "thought": a short private thought, in the first person, in English',
  '- "list": your list of things you intend to do, as it should be now (up to 10 short items; it can stay the same, change, or be empty)',
].join('\n');

const pct = (v: number) => `${Math.round(v * 100)}/100`;
const walk = (s: number) => (s < 90 ? `${Math.max(10, Math.round(s / 10) * 10)} s walk` : `${Math.round(s / 60)} min walk`);

export function worldLines(w: WorldInfo): string[] {
  const lines: string[] = [];
  lines.push('Your list:');
  lines.push(...(w.list.length ? w.list.map((x) => `- ${x}`) : ['(empty)']));
  lines.push('');
  lines.push('Things you have made:');
  lines.push(`- Websites: ${w.sites.length ? w.sites.map((s) => `"${s.title}" (/${s.slug})`).join(', ') : 'none yet'}`);
  lines.push(`- Things in town: ${w.creations.length ? w.creations.map((c) => `${c.title} (${c.kind}, ${c.where})`).join('; ') : 'none yet'}`);
  lines.push(`- Currency: ${w.currency ? `${w.currency.name} (${w.currency.symbol}), ${w.currency.supply} in existence` : 'none yet'}`);
  lines.push(`- Journal entries: ${w.journalCount}`);
  return lines;
}

export function buildUserPrompt(ctx: DecisionContext): string {
  const lines: string[] = [];
  lines.push(`It is ${ctx.townTime} (${ctx.partOfDay}). Weather: ${ctx.weather}.`);
  lines.push(`You are at: ${ctx.location}.`);
  lines.push(`Your body: energy ${pct(ctx.needs.energy)}, fullness ${pct(ctx.needs.fullness)}, stimulation ${pct(ctx.needs.stimulation)}.`);
  lines.push('');
  lines.push('What you remember from earlier:');
  lines.push(ctx.summary || '(nothing yet)');
  lines.push('');
  lines.push('Recent memories, oldest first:');
  lines.push(...(ctx.recent.length ? ctx.recent.map((m) => `- ${m}`) : ['(none)']));
  lines.push('');
  lines.push(...worldLines(ctx.world));
  lines.push('');
  lines.push('Things you can do:');
  for (const o of ctx.options) {
    const where = o.place ? `at ${o.placeName}, ${o.walkSeconds ? walk(o.walkSeconds) : 'here'}` : 'where you are';
    const range = o.id === 'wander' ? `stay ${o.min}-${o.max} min where you end up` : `${o.min}-${o.max} min`;
    lines.push(`- ${o.id}: ${o.description} (${where}; ${range})`);
  }
  lines.push(`Place ids: ${ctx.places.map((p) => `${p.id} (${p.name})`).join(', ')}.`);
  if (ctx.notice) {
    lines.push('');
    lines.push(ctx.notice);
    if (ctx.current) lines.push(`You are in the middle of: ${ctx.current}. You may keep doing it by choosing it again.`);
  }
  lines.push('');
  lines.push('What do you do next?');
  return lines.join('\n');
}

/** Shared context block for follow-up "work" prompts (journal, websites, making things...). */
export function workContext(ctx: { townTime: string; location: string; summary: string | null; recent: string[]; world: WorldInfo }): string {
  return [
    `It is ${ctx.townTime}. You are at: ${ctx.location}.`,
    '',
    'What you remember from earlier:',
    ctx.summary || '(nothing yet)',
    '',
    'Recent memories, oldest first:',
    ...(ctx.recent.length ? ctx.recent.map((m) => `- ${m}`) : ['(none)']),
    '',
    ...worldLines(ctx.world),
  ].join('\n');
}

export function summaryPrompt(previous: string | null, memories: string[]): string {
  return [
    'Here is a summary of your older memories, followed by memories that came after it.',
    'Write a new summary that combines both, in the first person, in at most 150 words.',
    '',
    'Older summary:',
    previous || '(none)',
    '',
    'Memories after that:',
    ...memories.map((m) => `- ${m}`),
  ].join('\n');
}
