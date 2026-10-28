import type { Sql } from './sql';
import { MIGRATIONS } from './migrations/index';

/** Applies pending migrations in order, each in its own transaction. Safe to run on every start. */
export function migrate(db: Sql): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(db.all<{ id: string }>('SELECT id FROM schema_migrations').map((r) => r.id));
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.transaction(() => { db.exec(m.sql); db.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', m.id, 'migration'); });
    applied.push(m.id);
  }
  return applied;
}
