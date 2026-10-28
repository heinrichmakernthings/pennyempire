import type { RunResult, Sql, SqlValue } from './sql';

/** Structural subset of Cloudflare's DurableObjectStorage (SQLite-backed). Kept local so the engine has no workerd dependency. */
export interface DoSqlStorage { exec(query: string, ...bindings: SqlValue[]): { toArray(): unknown[]; rowsWritten: number } }
export interface DoStorage { sql: DoSqlStorage; transactionSync<T>(fn: () => T): T }

/** Durable Object adapter. A DO processes one request at a time and transactionSync is atomic, so writes are serialised. */
export function durableObjectSql(storage: DoStorage): Sql {
  const { sql } = storage;
  return {
    run(q, ...p): RunResult {
      const cur = sql.exec(q, ...p);
      cur.toArray();
      const id = (sql.exec('SELECT last_insert_rowid() AS id').toArray()[0] as { id: number }).id;
      return { changes: cur.rowsWritten, lastInsertRowid: id };
    },
    all<T>(q: string, ...p: SqlValue[]): T[] { return sql.exec(q, ...p).toArray() as T[]; },
    get<T>(q: string, ...p: SqlValue[]): T | undefined { return sql.exec(q, ...p).toArray()[0] as T | undefined; },
    exec(q) { for (const stmt of q.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) sql.exec(stmt); },
    transaction: (fn) => storage.transactionSync(fn),
  };
}
