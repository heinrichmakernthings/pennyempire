import type { Sql } from '../db/sql';

/**
 * Sales between companies with the same owner ("related parties"). Allowed — vertical integration is gameplay — but the price is whatever the
 * owner chooses, so it says nothing about a company's earning power. Valuation, listing tests and rankings use arm's-length figures:
 * revenue and margin from related-party sales are taken out per tick. Margin uses the recorded cost basis of the units sold.
 */
export function relatedPartyByTick(db: Sql, companyId: string, fromTick: number, toTick: number): Map<number, { revenue: number; margin: number }> {
  const out = new Map<number, { revenue: number; margin: number }>();
  for (const r of db.all<{ tick: number; revenue: number; margin: number }>(
    `SELECT COALESCE(t.stat_tick, t.tick) tick, SUM(t.qty * t.price_minor) revenue, SUM(t.qty * t.price_minor - COALESCE(t.cost_minor, t.qty * t.price_minor)) margin
       FROM trades t JOIN companies b ON b.id = t.buyer_company_id JOIN companies s ON s.id = t.seller_company_id
      WHERE t.seller_company_id = ? AND COALESCE(t.stat_tick, t.tick) > ? AND COALESCE(t.stat_tick, t.tick) <= ? AND b.owner_kind = s.owner_kind AND b.owner_id = s.owner_id GROUP BY 1`, companyId, fromTick, toTick)) out.set(r.tick, { revenue: r.revenue, margin: r.margin });
  return out;
}
export const relatedPartyRevenue = (db: Sql, companyId: string, fromTick: number, toTick: number) => [...relatedPartyByTick(db, companyId, fromTick, toTick).values()].reduce((a, r) => a + r.revenue, 0);
