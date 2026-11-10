// SQLite storage (Node's built-in node:sqlite, so nothing native to compile on the Pi).
// Holds the memory stream, rolling summaries, the full decision log and (phase 4) the journal.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import type { Needs } from './actions.ts';

export type MemoryKind = 'action' | 'thought' | 'observation' | 'reflection';

export interface Memory { id: number; t: number; kind: MemoryKind; text: string }

export interface DecisionRow {
  t: number;
  brain: string;            // e.g. "ollama:qwen3:14b" or "placeholder"
  context: unknown;         // what he saw (structured)
  prompt: string;           // the exact text sent to the model
  raw: string | null;       // raw model output(s), attempts separated
  action: string;
  target: string | null;
  minutes: number;
  thought: string;
  valid: boolean;           // first attempt valid?
  attempts: number;
  fallback: boolean;
  error: string | null;
  latencyMs: number;
  needsBefore: Needs;
}

export interface JournalEntry { date: string; title: string | null; text: string; t: number }
export interface SiteMeta { slug: string; title: string; created: number; updated: number; versions: number; hidden: number }
export interface Creation { id: number; t: number; slot: string; kind: string; title: string; text: string; color: string; shape: string; size: string }
export interface Currency { name: string; symbol: string; description: string; supply: number; created: number }
export interface LedgerEntry { id: number; t: number; op: string; amount: number; counterparty: string; memo: string }

mkdirSync(config.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(config.dataDir, 'alien.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY,
    t INTEGER NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS memories_t ON memories(t);

  CREATE TABLE IF NOT EXISTS summaries (
    id INTEGER PRIMARY KEY,
    t INTEGER NOT NULL,
    upto_memory_id INTEGER NOT NULL,
    brain TEXT NOT NULL,
    text TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY,
    t INTEGER NOT NULL,
    brain TEXT NOT NULL,
    context TEXT NOT NULL,
    prompt TEXT NOT NULL,
    raw TEXT,
    action TEXT NOT NULL,
    target TEXT,
    minutes INTEGER NOT NULL,
    thought TEXT NOT NULL,
    valid INTEGER NOT NULL,
    attempts INTEGER NOT NULL,
    fallback INTEGER NOT NULL,
    error TEXT,
    latency_ms INTEGER NOT NULL,
    needs_before TEXT NOT NULL,
    needs_after TEXT,
    ended_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS decisions_t ON decisions(t);

  CREATE TABLE IF NOT EXISTS journal (
    id INTEGER PRIMARY KEY,
    t INTEGER NOT NULL,
    date TEXT NOT NULL,
    brain TEXT NOT NULL,
    text TEXT NOT NULL
  );

  -- His own list of things he intends to do (full snapshot each time it changes).
  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY,
    t INTEGER NOT NULL,
    items TEXT NOT NULL
  );

  -- Websites he writes. Served sandboxed under /levi/sites/<slug>/.
  CREATE TABLE IF NOT EXISTS sites (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    html TEXT NOT NULL,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    versions INTEGER NOT NULL DEFAULT 1,
    hidden INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS site_versions (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL,
    t INTEGER NOT NULL,
    title TEXT NOT NULL,
    html TEXT NOT NULL
  );

  -- Things he makes in town, one per build slot (a new one replaces the old).
  CREATE TABLE IF NOT EXISTS creations (
    id INTEGER PRIMARY KEY,
    t INTEGER NOT NULL,
    slot TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    color TEXT NOT NULL,
    shape TEXT NOT NULL,
    size TEXT NOT NULL,
    removed INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0
  );

  -- His in-town currency (simulated; no real money).
  CREATE TABLE IF NOT EXISTS currency (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    description TEXT NOT NULL,
    supply REAL NOT NULL DEFAULT 0,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY,
    t INTEGER NOT NULL,
    op TEXT NOT NULL,
    amount REAL NOT NULL,
    counterparty TEXT NOT NULL,
    memo TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0
  );

  -- Every web request he makes.
  CREATE TABLE IF NOT EXISTS web_log (
    id INTEGER PRIMARY KEY,
    t INTEGER NOT NULL,
    kind TEXT NOT NULL,
    input TEXT NOT NULL,
    url TEXT,
    status TEXT NOT NULL,
    excerpt TEXT
  );
`);
// Journal entries can be hidden too (added after the first release of the table).
try { db.exec('ALTER TABLE journal ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0'); } catch { /* already there */ }
try { db.exec('ALTER TABLE journal ADD COLUMN title TEXT'); } catch { /* already there */ }

const q = {
  addMemory: db.prepare('INSERT INTO memories (t, kind, text) VALUES (?, ?, ?)'),
  recent: db.prepare('SELECT id, t, kind, text FROM memories ORDER BY id DESC LIMIT ?'),
  after: db.prepare('SELECT id, t, kind, text FROM memories WHERE id > ? AND id <= ? ORDER BY id'),
  maxId: db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM memories'),
  latestSummary: db.prepare('SELECT upto_memory_id AS upto, text FROM summaries ORDER BY id DESC LIMIT 1'),
  addSummary: db.prepare('INSERT INTO summaries (t, upto_memory_id, brain, text) VALUES (?, ?, ?, ?)'),
  addDecision: db.prepare(`INSERT INTO decisions
    (t, brain, context, prompt, raw, action, target, minutes, thought, valid, attempts, fallback, error, latency_ms, needs_before)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  endDecision: db.prepare('UPDATE decisions SET needs_after = ?, ended_at = ? WHERE id = ? AND needs_after IS NULL'),
  latestJournal: db.prepare('SELECT date, title, text, t FROM journal WHERE hidden = 0 ORDER BY id DESC LIMIT 1'),
  addJournal: db.prepare('INSERT INTO journal (t, date, brain, title, text) VALUES (?, ?, ?, ?, ?)'),
  latestPlans: db.prepare('SELECT items FROM plans ORDER BY id DESC LIMIT 1'),
  addPlans: db.prepare('INSERT INTO plans (t, items) VALUES (?, ?)'),
  sites: db.prepare('SELECT slug, title, created, updated, versions, hidden FROM sites ORDER BY updated DESC'),
  site: db.prepare('SELECT slug, title, html, hidden FROM sites WHERE slug = ?'),
  upsertSite: db.prepare(`INSERT INTO sites (slug, title, html, created, updated) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET title = excluded.title, html = excluded.html, updated = excluded.updated, versions = versions + 1`),
  addSiteVersion: db.prepare('INSERT INTO site_versions (slug, t, title, html) VALUES (?, ?, ?, ?)'),
  creations: db.prepare('SELECT id, t, slot, kind, title, text, color, shape, size FROM creations WHERE removed = 0 AND hidden = 0 ORDER BY id'),
  creationsAll: db.prepare('SELECT id, t, slot, kind, title, text, color, shape, size, removed, hidden FROM creations ORDER BY id DESC'),
  removeInSlot: db.prepare('UPDATE creations SET removed = 1 WHERE slot = ? AND removed = 0'),
  addCreation: db.prepare('INSERT INTO creations (t, slot, kind, title, text, color, shape, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  currency: db.prepare('SELECT name, symbol, description, supply, created FROM currency WHERE id = 1'),
  createCurrency: db.prepare('INSERT INTO currency (id, name, symbol, description, supply, created) VALUES (1, ?, ?, ?, 0, ?)'),
  setSupply: db.prepare('UPDATE currency SET supply = ? WHERE id = 1'),
  addLedger: db.prepare('INSERT INTO ledger (t, op, amount, counterparty, memo) VALUES (?, ?, ?, ?, ?)'),
  ledger: db.prepare('SELECT id, t, op, amount, counterparty, memo FROM ledger WHERE hidden = 0 ORDER BY id DESC LIMIT ?'),
  addWeb: db.prepare('INSERT INTO web_log (t, kind, input, url, status, excerpt) VALUES (?, ?, ?, ?, ?, ?)'),
  webCountSince: db.prepare("SELECT COUNT(*) AS n FROM web_log WHERE t > ? AND kind = 'fetch'"),
  journalList: db.prepare('SELECT id, t, date, title, text FROM journal WHERE hidden = 0 ORDER BY id DESC LIMIT ?'),
};

export const store = {
  addMemory(kind: MemoryKind, text: string, t = Date.now()): void {
    q.addMemory.run(t, kind, text);
  },
  recentMemories(n: number): Memory[] {
    return (q.recent.all(n) as unknown as Memory[]).reverse();
  },
  memoriesBetween(afterId: number, uptoId: number): Memory[] {
    return q.after.all(afterId, uptoId) as unknown as Memory[];
  },
  maxMemoryId(): number {
    return Number((q.maxId.get() as { id: number }).id);
  },
  latestSummary(): { upto: number; text: string } | null {
    return (q.latestSummary.get() as { upto: number; text: string } | undefined) ?? null;
  },
  addSummary(uptoId: number, brain: string, text: string): void {
    q.addSummary.run(Date.now(), uptoId, brain, text);
  },
  addDecision(d: DecisionRow): number {
    const r = q.addDecision.run(
      d.t, d.brain, JSON.stringify(d.context), d.prompt, d.raw, d.action, d.target, d.minutes, d.thought,
      d.valid ? 1 : 0, d.attempts, d.fallback ? 1 : 0, d.error, Math.round(d.latencyMs), JSON.stringify(d.needsBefore),
    );
    return Number(r.lastInsertRowid);
  },
  endDecision(id: number, needsAfter: Needs): void {
    q.endDecision.run(JSON.stringify(needsAfter), Date.now(), id);
  },
  latestJournal(): JournalEntry | null {
    return (q.latestJournal.get() as unknown as JournalEntry | undefined) ?? null;
  },
  addJournal(date: string, brain: string, title: string, text: string): void {
    q.addJournal.run(Date.now(), date, brain, title, text);
  },
  journal(limit = 50): (JournalEntry & { id: number })[] {
    return q.journalList.all(limit) as unknown as (JournalEntry & { id: number })[];
  },
  plans(): string[] {
    const r = q.latestPlans.get() as { items: string } | undefined;
    return r ? (JSON.parse(r.items) as string[]) : [];
  },
  setPlans(items: string[]): void {
    q.addPlans.run(Date.now(), JSON.stringify(items));
  },
  sites(): SiteMeta[] { return q.sites.all() as unknown as SiteMeta[]; },
  site(slug: string): { slug: string; title: string; html: string; hidden: number } | null {
    return (q.site.get(slug) as unknown as { slug: string; title: string; html: string; hidden: number } | undefined) ?? null;
  },
  saveSite(slug: string, title: string, html: string): void {
    const now = Date.now();
    q.upsertSite.run(slug, title, html, now, now);
    q.addSiteVersion.run(slug, now, title, html);
  },
  creations(): Creation[] { return q.creations.all() as unknown as Creation[]; },
  allCreations(): (Creation & { removed: number; hidden: number })[] { return q.creationsAll.all() as unknown as (Creation & { removed: number; hidden: number })[]; },
  addCreation(c: Omit<Creation, 'id' | 't'>): void {
    q.removeInSlot.run(c.slot);
    q.addCreation.run(Date.now(), c.slot, c.kind, c.title, c.text, c.color, c.shape, c.size);
  },
  currency(): Currency | null { return (q.currency.get() as unknown as Currency | undefined) ?? null; },
  createCurrency(name: string, symbol: string, description: string): void { q.createCurrency.run(name, symbol, description, Date.now()); },
  ledgerEntry(op: string, amount: number, counterparty: string, memo: string, newSupply: number | null): void {
    q.addLedger.run(Date.now(), op, amount, counterparty, memo);
    if (newSupply !== null) q.setSupply.run(newSupply);
  },
  ledger(limit = 50): LedgerEntry[] { return q.ledger.all(limit) as unknown as LedgerEntry[]; },
  logWeb(kind: string, input: string, url: string | null, status: string, excerpt: string | null): void {
    q.addWeb.run(Date.now(), kind, input, url, status, excerpt);
  },
  webFetchesSince(t: number): number { return Number((q.webCountSince.get(t) as { n: number }).n); },
  db,
};
