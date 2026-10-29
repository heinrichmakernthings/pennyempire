/**
 * Migration 0009 — Economic integrity audit. Additive only.
 * - trades.cost_minor: the seller's cost basis of the units sold, so trades placed between ticks can be folded into the next day's
 *   operating statement with exact cost of goods (they settle instantly and were previously missing from revenue and profit).
 * - trades.stat_tick: the day whose operating statement includes the trade (a trade placed between ticks belongs to the next day).
 */
export default `
ALTER TABLE trades ADD COLUMN cost_minor INTEGER;
ALTER TABLE trades ADD COLUMN stat_tick INTEGER;
`;
