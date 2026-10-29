/**
 * Notifications are derived from what actually happened in the shared world — nothing is invented to pull players back:
 * events about the player's own companies, their commodity fills, their share trades and dividends, and city-wide economic events.
 */
import type { Sql } from '../db/sql';

export interface Notification { key: string; tick: number; kind: string; severity: 'info' | 'warning' | 'error' | 'success'; message: string; link?: string }
const CITY_KINDS = ['eco_event_start', 'eco_event_end', 'rate_decision', 'market_crash', 'trading_suspended', 'trading_resumed', 'stimulus_paid'];

export function notifications(db: Sql, playerId: string, limit = 30) {
  const n = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 30));
  const mine = db.all<{ id: string; name: string }>("SELECT id, name FROM companies WHERE owner_kind = 'player' AND owner_id = ?", playerId);
  const ids = mine.map((c) => c.id); const name = new Map(mine.map((c) => [c.id, c.name]));
  const ph = ids.map(() => '?').join(',') || "''";
  const out: Notification[] = [];
  for (const e of db.all<{ id: number; tick: number; kind: string; severity: 'info' | 'warning' | 'error'; subject: string | null; message: string }>(
    `SELECT id, tick, kind, severity, subject, message FROM economic_events WHERE (subject IN (${ph}) OR subject = ? OR kind IN (${CITY_KINDS.map(() => '?').join(',')})) AND kind NOT IN ('company_configured','failed_transaction') ORDER BY id DESC LIMIT ?`, ...ids, playerId, ...CITY_KINDS, n))
    out.push({ key: `ev:${e.id}`, tick: e.tick, kind: e.kind, severity: e.severity, message: e.message, link: e.subject && name.has(e.subject) ? `/companies/${e.subject}` : CITY_KINDS.includes(e.kind) ? '/state' : undefined });
  if (ids.length) for (const t of db.all<{ tick: number; commodity_id: string; side: string; company: string; qty: number; value: number }>(
    `SELECT tick, commodity_id, side, company, SUM(qty) qty, SUM(qty * price_minor) value FROM (
       SELECT tick, commodity_id, 'sold' side, seller_company_id company, qty, price_minor FROM trades WHERE seller_company_id IN (${ph}) AND buyer_company_id <> seller_company_id
       UNION ALL SELECT tick, commodity_id, 'bought' side, buyer_company_id company, qty, price_minor FROM trades WHERE buyer_company_id IN (${ph}) AND buyer_company_id <> seller_company_id)
     GROUP BY tick, commodity_id, side, company ORDER BY tick DESC LIMIT ?`, ...ids, ...ids, n))
    out.push({ key: `tr:${t.tick}:${t.company}:${t.commodity_id}:${t.side}`, tick: t.tick, kind: 'commodity_fill', severity: 'success', message: `${name.get(t.company)} ${t.side} ${t.qty} ${t.commodity_id} for ${(t.value / 100).toFixed(2)} EC`, link: `/commodities/${t.commodity_id}` });
  const investors = [playerId, ...ids.map((id) => `co:${id}`)]; const iph = investors.map(() => '?').join(',');
  for (const t of db.all<{ id: number; tick: number; company_id: string; qty: number; price_minor: number; side: string }>(
    `SELECT id, tick, company_id, qty, price_minor, CASE WHEN buyer_id IN (${iph}) THEN 'bought' ELSE 'sold' END side FROM share_trades WHERE (buyer_id IN (${iph}) OR seller_id IN (${iph})) AND buyer_id <> seller_id ORDER BY id DESC LIMIT ?`, ...investors, ...investors, ...investors, n))
    out.push({ key: `st:${t.id}`, tick: t.tick, kind: 'share_fill', severity: 'success', message: `You ${t.side} ${t.qty} shares of ${t.company_id} at ${(t.price_minor / 100).toFixed(2)} EC`, link: `/exchange/${t.company_id}` });
  for (const d of db.all<{ tick: number; company_id: string; amount_minor: number; dividend_id: number }>(
    `SELECT v.payment_tick tick, v.company_id, e.amount_minor, e.dividend_id FROM dividend_entitlements e JOIN dividends v ON v.id = e.dividend_id WHERE e.investor_id IN (${iph}) AND v.status = 'paid' ORDER BY v.id DESC LIMIT ?`, ...investors, n))
    out.push({ key: `dv:${d.dividend_id}`, tick: d.tick, kind: 'dividend_received', severity: 'success', message: `Dividend received from ${d.company_id}: ${(d.amount_minor / 100).toFixed(2)} EC`, link: '/portfolio' });
  out.sort((a, b) => b.tick - a.tick || a.key.localeCompare(b.key));
  const seen = db.get<{ t: number }>('SELECT last_seen_tick t FROM notification_reads WHERE player_id = ?', playerId)?.t ?? -1;
  const items = out.slice(0, n).map((x) => ({ ...x, unread: x.tick > seen }));
  return { items, unread: items.filter((x) => x.unread).length, lastSeenTick: seen };
}
export function markNotificationsRead(db: Sql, playerId: string, upToTick: number) {
  if (!Number.isSafeInteger(upToTick) || upToTick < 0) return;
  db.run('INSERT INTO notification_reads (player_id, last_seen_tick) VALUES (?,?) ON CONFLICT(player_id) DO UPDATE SET last_seen_tick = MAX(last_seen_tick, excluded.last_seen_tick)', playerId, upToTick);
}
