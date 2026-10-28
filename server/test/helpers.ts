import { createHash } from 'node:crypto';
import type { Sql } from '../db/sql';
import { openWorld } from '../engine/world';
import type { EngineConfig } from '../engine/config';

export const memWorld = (config: Partial<EngineConfig> = {}) => openWorld(':memory:', config);

/** Order-independent digest of every economic table: two runs are "the same economy" iff this matches. */
export function stateHash(db: Sql): string {
  const h = createHash('sha256');
  for (const t of ['accounts', 'ledger_transactions', 'ledger_postings', 'companies', 'production_lines', 'inventory', 'inventory_movements', 'orders', 'trades', 'company_tick_stats', 'demand_tick_stats', 'supply_snapshots', 'economic_events', 'engine_state']) {
    h.update(t); for (const r of db.all(`SELECT * FROM ${t} ORDER BY 1, 2, 3`)) h.update(JSON.stringify(r));
  }
  return h.digest('hex');
}
export const one = <T>(db: Sql, sql: string, ...p: (string | number)[]) => db.get<T>(sql, ...p)!;
