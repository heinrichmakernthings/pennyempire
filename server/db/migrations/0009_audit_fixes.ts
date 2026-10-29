/**
 * Migration 0009 — Economic integrity audit. Additive only.
 * - trades.cost_minor: the seller's cost basis of the units sold, so trades placed between ticks can be folded into the next day's
 *   operating statement with exact cost of goods (they settle instantly and were previously missing from revenue and profit).
 * - Indexes for per-company history lookups (the hot queries filter by company and order by tick; the primary keys lead with tick,
 *   so they scanned all history and ticks slowed as the world aged).
 * - trades.stat_tick: the day whose operating statement includes the trade (a trade placed between ticks belongs to the next day).
 */
export default `
ALTER TABLE trades ADD COLUMN cost_minor INTEGER;
ALTER TABLE trades ADD COLUMN stat_tick INTEGER;
CREATE INDEX idx_security_stats_co ON security_stats(company_id, tick);
CREATE INDEX idx_security_valuations_co ON security_valuations(company_id, tick);
CREATE INDEX idx_company_tick_stats_co ON company_tick_stats(company_id, tick);
CREATE INDEX idx_production_log_co ON production_log(company_id, tick);
CREATE INDEX idx_trades_seller ON trades(seller_company_id, tick);
CREATE INDEX idx_trades_buyer ON trades(buyer_company_id, tick);
CREATE INDEX idx_invmov_tick ON inventory_movements(company_id, commodity_id, tick);
`;
