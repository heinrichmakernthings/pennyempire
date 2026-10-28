import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { currentMods } from './economyState';
import { balance, supply, type TickCtx } from './ledger';
import { depositsTotal, loansOutstanding, baseRate } from './bank';

/**
 * Inflation is measured from PRICES, never inferred from the amount of money. The Penny Basket is a fixed-weight set of what a household and a small business buy:
 *   pizza and café drinks (retail prices posted by operating shops), electricity (the day's tariff), rent (average index-linked rent), wholesale food (7-day trade-weighted
 *   price of wheat, milk, flour and cheese). Each component is expressed relative to its first observation (= 10,000) and the CPI is the weighted average.
 * Money-supply statistics are shown NEXT to the CPI as context, but they never feed it.
 */
export const BASKET: { id: string; label: string; weightBps: number }[] = [
  { id: 'pizza', label: 'Pizza', weightBps: 3_000 }, { id: 'cafe-drink', label: 'Café drinks', weightBps: 2_000 }, { id: 'electricity', label: 'Electricity', weightBps: 1_500 },
  { id: 'rent', label: 'Commercial rent', weightBps: 1_500 }, { id: 'wholesale-food', label: 'Wholesale food', weightBps: 2_000 },
];

const avgPosted = (db: Sql, commodity: string, fallback: number) => Math.round(db.get<{ p: number | null }>("SELECT AVG(price_minor) p FROM companies WHERE retail_commodity_id = ? AND status = 'operating' AND owner_kind <> 'state'", commodity)?.p ?? fallback);
function wholesale(db: Sql, tick: number): number {
  const r = db.get<{ p: number | null }>("SELECT AVG(COALESCE(vwap_minor, close_minor)) p FROM market_stats WHERE tick > ? AND commodity_id IN ('wheat','milk','flour','cheese') AND COALESCE(vwap_minor, close_minor) IS NOT NULL", tick - 7)?.p;
  return Math.round(r ?? db.get<{ p: number }>("SELECT AVG(reference_price_minor) p FROM commodities WHERE id IN ('wheat','milk','flour','cheese')")!.p);
}
export function basketPrices(db: Sql, tick: number): Record<string, number> {
  const ref = (id: string) => db.get<{ p: number }>('SELECT reference_price_minor p FROM commodities WHERE id = ?', id)?.p ?? 1;
  const tariff = db.get<{ t: number }>('SELECT tariff_minor t FROM energy_daily ORDER BY tick DESC LIMIT 1')?.t ?? ref('energy');
  const rentAvg = db.get<{ r: number | null }>("SELECT AVG(base_rent_minor) r FROM leases WHERE status = 'active' AND kind = 'lease'")?.r ?? 1;
  return { pizza: avgPosted(db, 'pizza', ref('pizza')), 'cafe-drink': avgPosted(db, 'cafe-drink', ref('cafe-drink')), electricity: tariff, rent: Math.round(rentAvg * currentMods(db).rentBps / 10_000), 'wholesale-food': wholesale(db, tick) };
}

export function recordCpi(db: Sql, tick: number) {
  const prices = basketPrices(db, tick);
  let baseRow = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'cpi_base'");
  if (!baseRow) { db.run("INSERT INTO meta (key, value) VALUES ('cpi_base', ?)", JSON.stringify(prices)); baseRow = { value: JSON.stringify(prices) }; }
  const base = JSON.parse(baseRow.value) as Record<string, number>;
  const comps: Record<string, number> = {}; let index = 0;
  for (const b of BASKET) { const rel = Math.round((prices[b.id]! * 10_000) / Math.max(1, base[b.id] ?? prices[b.id]!)); comps[b.id] = rel; index += Math.round((rel * b.weightBps) / 10_000); }
  const prior = db.get<{ index_bps: number }>('SELECT index_bps FROM cpi_index WHERE tick <= ? ORDER BY tick DESC LIMIT 1', tick - 30);
  const change = prior ? Math.round(((index - prior.index_bps) * 10_000) / prior.index_bps) : 0;
  db.run('INSERT OR REPLACE INTO cpi_index (tick, index_bps, change_30d_bps, components_json) VALUES (?,?,?,?)', tick, index, change, JSON.stringify({ relative: comps, prices }));
}
export const latestCpi = (db: Sql) => db.get<{ tick: number; index_bps: number; change_30d_bps: number; components_json: string }>('SELECT * FROM cpi_index ORDER BY tick DESC LIMIT 1');
/** 30-day inflation in bps, or 0 until a month of history exists. */
export const inflationBps = (db: Sql) => latestCpi(db)?.change_30d_bps ?? 0;

/** One row of money statistics per day: coin creation, destruction and transfers are reported separately; none of it feeds the CPI. */
export function recordMonetaryStats(db: Sql, ctx: TickCtx, cfg: EngineConfig, extra: { consumerSpend: number; tradeValue: number; creditIssued: number }) {
  void cfg;
  const s = supply(db);
  const day = db.get<{ i: number; d: number; t: number }>("SELECT COALESCE(SUM(CASE WHEN t.kind = 'issuance' THEN p.amount_minor END),0) i, COALESCE(SUM(CASE WHEN t.kind IN ('sink','sink_fee') THEN p.amount_minor END),0) d, COALESCE(SUM(CASE WHEN t.kind NOT IN ('issuance','sink','sink_fee') AND p.amount_minor > 0 THEN p.amount_minor END),0) t FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.tick = ? AND (t.kind = 'issuance' AND p.amount_minor > 0 OR t.kind IN ('sink','sink_fee') AND p.account_id = 'acct:burn' OR t.kind NOT IN ('issuance','sink','sink_fee'))", ctx.tick)!;
  const treasury = db.get<{ treasury_account_id: string }>('SELECT treasury_account_id FROM cities LIMIT 1')!.treasury_account_id;
  const cpi = latestCpi(db);
  db.run('INSERT OR REPLACE INTO monetary_stats (tick, circulating_minor, issued_tick_minor, destroyed_tick_minor, transferred_tick_minor, consumer_spend_minor, savings_minor, trading_value_minor, credit_issued_tick_minor, loans_outstanding_minor, state_treasury_minor, base_rate_bps, cpi_bps, state_revenue_tick_minor) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ctx.tick, s.circulating, day.i, day.d, day.t, extra.consumerSpend, depositsTotal(db), extra.tradeValue, extra.creditIssued, loansOutstanding(db), balance(db, treasury), baseRate(db), cpi?.index_bps ?? 10_000,
    db.get<{ r: number }>('SELECT COALESCE(SUM(amount_minor),0) r FROM service_charges WHERE tick = ?', ctx.tick)!.r);
}
