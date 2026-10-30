import type { Sql } from '../db/sql';
import { BURN, ISSUANCE, supply } from './ledger';

export function takeSnapshot(db: Sql, tick: number) {
  const s = supply(db);
  const issuedTick = db.get<{ s: number }>("SELECT COALESCE(SUM(p.amount_minor),0) s FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.tick = ? AND t.kind = 'issuance' AND p.account_id <> ?", tick, ISSUANCE)!.s;
  const destroyedTick = db.get<{ s: number }>("SELECT COALESCE(SUM(p.amount_minor),0) s FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.tick = ? AND t.kind IN ('sink','sink_fee') AND p.account_id = ?", tick, BURN)!.s;
  const sum = (where: string) => db.get<{ s: number }>(`SELECT COALESCE(SUM(a.balance_minor),0) s FROM accounts a ${where}`)!.s;
  const state = sum("WHERE a.kind = 'state_treasury' OR a.id IN (SELECT treasury_account_id FROM companies WHERE owner_kind = 'state')");
  const companies = sum("WHERE a.kind = 'company' AND a.id NOT IN (SELECT treasury_account_id FROM companies WHERE owner_kind = 'state')");
  const goods = db.get<{ s: number }>('SELECT COALESCE(SUM(value_minor),0) s FROM inventory')!.s;
  db.run('INSERT OR REPLACE INTO supply_snapshots (tick, issued_total_minor, destroyed_total_minor, circulating_minor, issued_tick_minor, destroyed_tick_minor, households_minor, state_minor, companies_minor, players_minor, goods_value_minor) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    tick, s.issued, s.destroyed, s.circulating, issuedTick, destroyedTick, sum("WHERE a.kind = 'households'"), state, companies, sum("WHERE a.kind = 'player'"), goods);
}

export function logEvent(db: Sql, tick: number, kind: string, severity: 'info' | 'warning' | 'error', subject: string | null, message: string, data?: unknown) {
  db.run('INSERT INTO economic_events (tick, kind, severity, subject, message, data_json) VALUES (?,?,?,?,?,?)', tick, kind, severity, subject, message, data === undefined ? null : JSON.stringify(data));
}
export function logFailure(db: Sql, tick: number, kind: string, reason: string, key: string | null, detail?: unknown) {
  db.run('INSERT INTO failed_transactions (tick, idempotency_key, kind, reason, detail) VALUES (?,?,?,?,?)', tick, key, kind, reason, detail === undefined ? null : JSON.stringify(detail));
}
