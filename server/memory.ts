// The memory stream: timestamped memories in SQLite, a rolling summary of older ones,
// and the recent window that goes into every decision.

import { store, type Memory, type MemoryKind } from './db.ts';
import type { Brain } from './decider.ts';
import { config } from './config.ts';

const RECENT_MIN = 12;  // always shown verbatim
const RECENT_MAX = 40;  // once more than this are unsummarized, fold the oldest into the summary

function dayKey(t: number, tz: string) {
  return new Date(t).toLocaleDateString('en-CA', { timeZone: tz });
}

/** "21:43" for today, "yesterday 21:43", or "Mon 3 Nov 21:43". */
export function formatWhen(t: number, now = Date.now(), tz = config.townTz): string {
  const time = new Date(t).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const d = dayKey(t, tz), today = dayKey(now, tz), yesterday = dayKey(now - 86_400_000, tz);
  if (d === today) return time;
  if (d === yesterday) return `yesterday ${time}`;
  return `${new Date(t).toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

const fmt = (m: Memory, now: number) => `${formatWhen(m.t, now)} ${m.text}`;

export class MemoryStream {
  private summarizing = false;
  private brain: Brain;
  constructor(brain: Brain) { this.brain = brain; }

  add(kind: MemoryKind, text: string) { store.addMemory(kind, text); }

  /** Summary of older memories + every memory after it (at least RECENT_MIN). */
  forPrompt(now = Date.now()): { summary: string | null; recent: string[] } {
    const s = store.latestSummary();
    const max = store.maxMemoryId();
    const after = s ? store.memoriesBetween(s.upto, max) : store.recentMemories(RECENT_MAX);
    const recent = after.length >= RECENT_MIN ? after : store.recentMemories(RECENT_MIN);
    return { summary: s?.text ?? null, recent: recent.slice(-RECENT_MAX).map((m) => fmt(m, now)) };
  }

  /** Called after each decision; folds old memories into the summary in the background. */
  maybeSummarize(onError: (msg: string) => void) {
    if (this.summarizing) return;
    const s = store.latestSummary();
    const max = store.maxMemoryId();
    const pending = store.memoriesBetween(s?.upto ?? 0, max);
    if (pending.length <= RECENT_MAX) return;
    const fold = pending.slice(0, pending.length - RECENT_MIN);
    const upto = fold[fold.length - 1].id;
    this.summarizing = true;
    const now = Date.now();
    this.brain.summarize(s?.text ?? null, fold.map((m) => fmt(m, now)))
      .then((text) => store.addSummary(upto, this.brain.name, text))
      .catch((err) => onError(`summary failed: ${(err as Error).message}`))
      .finally(() => { this.summarizing = false; });
  }
}
