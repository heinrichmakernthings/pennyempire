import { DatabaseSync } from 'node:sqlite';
import type { RunResult, Sql, SqlValue } from './sql';

/** node:sqlite adapter (file or :memory:). Foreign keys on, WAL for file DBs, busy timeout for multi-connection safety. */
export function openNodeSqlite(path: string): Sql & { close(): void; path: string } {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
  let depth = 0;
  return {
    path,
    run(sql, ...params): RunResult {
      const r = db.prepare(sql).run(...(params as SqlValue[]));
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    all<T>(sql: string, ...params: SqlValue[]): T[] { return db.prepare(sql).all(...params) as T[]; },
    get<T>(sql: string, ...params: SqlValue[]): T | undefined { return db.prepare(sql).get(...params) as T | undefined; },
    exec(sql) { db.exec(sql); },
    transaction<T>(fn: () => T): T {
      const outer = depth === 0;
      const sp = `sp_${depth}`;
      db.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
      depth++;
      try {
        const out = fn();
        depth--;
        db.exec(outer ? 'COMMIT' : `RELEASE ${sp}`);
        return out;
      } catch (e) {
        depth--;
        db.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      }
    },
    close() { db.close(); },
  };
}
