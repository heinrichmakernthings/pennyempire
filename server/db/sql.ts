/**
 * Minimal synchronous SQL interface the whole engine is written against.
 * Production: Durable Object SQLite storage (single writer, synchronous transactions).
 * Local/dev/tests: node:sqlite. Same SQL, same semantics.
 */
export type SqlValue = string | number | null;
export interface RunResult { changes: number; lastInsertRowid: number }

export interface Sql {
  run(sql: string, ...params: SqlValue[]): RunResult;
  all<T = Record<string, SqlValue>>(sql: string, ...params: SqlValue[]): T[];
  get<T = Record<string, SqlValue>>(sql: string, ...params: SqlValue[]): T | undefined;
  /** Executes one or more statements without parameters (migrations). */
  exec(sql: string): void;
  /** Atomic unit of work. Nested calls become savepoints. Throwing rolls back everything since the outermost begin. */
  transaction<T>(fn: () => T): T;
}
