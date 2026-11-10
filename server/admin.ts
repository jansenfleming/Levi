// Private admin tool: list and hide/unhide things Levi has published. Runs locally against
// the SQLite file; there is deliberately no web endpoint for this.
//
//   npm run admin -- list
//   npm run admin -- hide site my-slug
//   npm run admin -- hide creation 12
//   npm run admin -- hide journal 3
//   npm run admin -- hide ledger 7
//   npm run admin -- unhide site my-slug
//
// The running server picks changes up within 30 seconds (websites immediately).

import { store } from './db.ts';

const [cmd, kind, id] = process.argv.slice(2);
const db = store.db;
const TABLES: Record<string, { table: string; key: string }> = {
  site: { table: 'sites', key: 'slug' },
  creation: { table: 'creations', key: 'id' },
  journal: { table: 'journal', key: 'id' },
  ledger: { table: 'ledger', key: 'id' },
};
const when = (t: number) => new Date(t).toLocaleString('en-GB');

if (cmd === 'list') {
  console.log('\nWebsites');
  for (const r of db.prepare('SELECT slug, title, updated, hidden FROM sites ORDER BY updated DESC').all() as any[])
    console.log(`  ${r.hidden ? '[hidden] ' : ''}${r.slug}  "${r.title}"  (${when(r.updated)})`);
  console.log('\nThings in town');
  for (const r of db.prepare('SELECT id, slot, kind, title, text, removed, hidden FROM creations ORDER BY id DESC LIMIT 40').all() as any[])
    console.log(`  ${r.hidden ? '[hidden] ' : ''}${r.removed ? '[replaced] ' : ''}#${r.id} ${r.slot} ${r.kind} "${r.title}" ${r.text ? `text: "${r.text}"` : ''}`);
  console.log('\nJournal');
  for (const r of db.prepare('SELECT id, t, title, hidden FROM journal ORDER BY id DESC LIMIT 20').all() as any[])
    console.log(`  ${r.hidden ? '[hidden] ' : ''}#${r.id} ${when(r.t)} "${r.title ?? ''}"`);
  console.log('\nLedger (latest 20)');
  for (const r of db.prepare('SELECT id, op, amount, counterparty, memo, hidden FROM ledger ORDER BY id DESC LIMIT 20').all() as any[])
    console.log(`  ${r.hidden ? '[hidden] ' : ''}#${r.id} ${r.op} ${r.amount} ${r.counterparty} ${r.memo}`);
  console.log('');
} else if ((cmd === 'hide' || cmd === 'unhide') && TABLES[kind] && id) {
  const { table, key } = TABLES[kind];
  const r = db.prepare(`UPDATE ${table} SET hidden = ? WHERE ${key} = ?`).run(cmd === 'hide' ? 1 : 0, key === 'id' ? Number(id) : id);
  console.log(r.changes ? `${cmd === 'hide' ? 'Hidden' : 'Unhidden'}: ${kind} ${id}` : `No ${kind} with ${key} ${id}`);
} else {
  console.log('Usage: npm run admin -- list | hide|unhide <site|creation|journal|ledger> <slug-or-id>');
  process.exitCode = 1;
}
