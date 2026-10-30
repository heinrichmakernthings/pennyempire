import { migrate } from '../db/migrate';
import { openNodeSqlite } from '../db/nodeSqlite';
import type { Sql } from '../db/sql';
import { seedBristol, type StartingProfile } from '../seed/bristol';
import type { EngineConfig } from './config';
import { runTick, type TickResult } from './tick';

/** Opens (or creates) a world: migrate → seed (idempotent). Used by the dev server, the sim CLI and tests. */
export function openWorld(path: string, overrides: Partial<EngineConfig> = {}, profile: StartingProfile = 'demo'): Sql & { close(): void; path: string } {
  const db = openNodeSqlite(path);
  migrate(db);
  seedBristol(db, overrides, profile);
  return db;
}
export const lastTick = (db: Sql) => db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
export function advance(db: Sql, ticks: number): TickResult[] {
  const out: TickResult[] = [];
  for (let i = 0; i < ticks; i++) out.push(runTick(db, lastTick(db) + 1));
  return out;
}
