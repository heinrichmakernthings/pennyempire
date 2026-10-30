/**
 * "While you were away": what the player's businesses did since their last visit, in one card. Every number is read from the day
 * statements and the ledger — nothing is estimated or invented to pull a player back. The last day a player acknowledged is kept per
 * player in `meta` (`away_seen:<player>`); a player with no record has just arrived and sees nothing until a day has passed. The card is
 * only worth showing after a real absence (at least `AWAY_MIN_MS` of wall-clock time), not every time a day ticks over mid-session.
 */
export const AWAY_MIN_MS = 30 * 60_000;
import type { Sql } from '../db/sql';
import { actingPlayer } from '../engine/actor';
import { gameDate, loadConfig } from '../engine/config';

export interface AwayCompany { id: string; name: string; industry: string; status: string; revenueMinor: number; profitMinor: number; unitsSold: number; coveredMinor: number }
export interface AwaySummary { sinceTick: number; nowTick: number; days: number; sinceDate: string; companies: AwayCompany[]; totals: { revenueMinor: number; profitMinor: number; unitsSold: number; coveredMinor: number }; headlines: string[]; show: boolean }

const key = (playerId: string) => `away_seen:${playerId}`;
const nowTick = (db: Sql) => db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;

export function awaySummary(db: Sql, playerId = actingPlayer()): AwaySummary {
  const now = nowTick(db);
  const row = db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key(playerId));
  if (!row) markAwaySeen(db, now, playerId);
  const since = Math.min(now, row ? Number(row.value) : now);
  const companies = db.all<{ id: string; name: string; industry_id: string; status: string; bankrupt_tick: number | null; treasury_account_id: string }>(
    "SELECT id, name, industry_id, status, bankrupt_tick, treasury_account_id FROM companies WHERE owner_kind = 'player' AND owner_id = ? ORDER BY created_tick, id", playerId,
  ).map((c) => {
    const s = db.get<{ r: number; p: number; u: number }>('SELECT COALESCE(SUM(revenue_minor),0) r, COALESCE(SUM(net_profit_minor),0) p, COALESCE(SUM(units_sold),0) u FROM company_tick_stats WHERE company_id = ? AND tick > ? AND tick <= ?', c.id, since, now)!;
    const covered = db.get<{ a: number }>("SELECT COALESCE(SUM(p.amount_minor),0) a FROM ledger_transactions t JOIN ledger_postings p ON p.tx_id = t.id WHERE t.kind = 'capital_injection' AND t.memo LIKE 'owner cover:%' AND t.tick > ? AND t.tick <= ? AND p.account_id = ?", since, now, c.treasury_account_id)!.a;
    return { id: c.id, name: c.name, industry: c.industry_id, status: c.bankrupt_tick !== null ? 'bankrupt' : c.status, revenueMinor: s.r, profitMinor: s.p, unitsSold: s.u, coveredMinor: covered };
  });
  const totals = companies.reduce((a, c) => ({ revenueMinor: a.revenueMinor + c.revenueMinor, profitMinor: a.profitMinor + c.profitMinor, unitsSold: a.unitsSold + c.unitsSold, coveredMinor: a.coveredMinor + c.coveredMinor }), { revenueMinor: 0, profitMinor: 0, unitsSold: 0, coveredMinor: 0 });
  const headlines = db.all<{ message: string }>("SELECT message FROM economic_events WHERE kind = 'eco_event_start' AND tick > ? AND tick <= ? ORDER BY id LIMIT 3", since, now).map((e) => e.message);
  const cfg = loadConfig(db), days = now - since;
  return { sinceTick: since, nowTick: now, days, sinceDate: gameDate(cfg, since), companies, totals, headlines, show: days >= 1 && companies.length > 0 && days * cfg.realMsPerTick >= AWAY_MIN_MS };
}

export function markAwaySeen(db: Sql, upTo: number, playerId = actingPlayer()) {
  if (!Number.isSafeInteger(upTo) || upTo < 0) return;
  const t = Math.min(upTo, nowTick(db));
  db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = CAST(MAX(CAST(value AS INTEGER), CAST(excluded.value AS INTEGER)) AS TEXT)', key(playerId), String(t));
}
