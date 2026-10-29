/** Migration 0003 — Penny Exchange: order kinds + expiry, local-market keys, per-day market statistics, recurring supply contracts. Additive only. */
export default `
ALTER TABLE orders ADD COLUMN kind TEXT NOT NULL DEFAULT 'limit' CHECK (kind IN ('limit','market','direct'));
ALTER TABLE orders ADD COLUMN only_company_id TEXT;   -- direct purchases trade against one chosen supplier only
ALTER TABLE orders ADD COLUMN expires_tick INTEGER;
ALTER TABLE orders ADD COLUMN end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('cancelled','expired','unfilled_remainder'));
ALTER TABLE orders ADD COLUMN city_id TEXT NOT NULL DEFAULT 'city-bristol';
ALTER TABLE trades ADD COLUMN city_id TEXT NOT NULL DEFAULT 'city-bristol';
ALTER TABLE trades ADD COLUMN fee_tx_id INTEGER;
CREATE INDEX idx_orders_company ON orders(company_id, status);
CREATE INDEX idx_trades_commodity ON trades(commodity_id, tick);

-- One row per city, commodity and day. Everything is derived from executed trades, contract deliveries and the book at the close of the tick.
CREATE TABLE market_stats (
  tick INTEGER NOT NULL, city_id TEXT NOT NULL, commodity_id TEXT NOT NULL,
  trades INTEGER NOT NULL, volume INTEGER NOT NULL, value_minor INTEGER NOT NULL, fees_minor INTEGER NOT NULL,
  open_minor INTEGER, high_minor INTEGER, low_minor INTEGER, close_minor INTEGER, vwap_minor INTEGER,
  best_bid_minor INTEGER, best_ask_minor INTEGER, listed_units INTEGER NOT NULL, bid_units INTEGER NOT NULL,
  demand_units INTEGER NOT NULL, consumer_units INTEGER NOT NULL, contract_units INTEGER NOT NULL,
  PRIMARY KEY (tick, city_id, commodity_id)
);

-- Recurring supply contracts. Money and goods move only through the ledger and inventory modules, at delivery time.
CREATE TABLE supply_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, city_id TEXT NOT NULL DEFAULT 'city-bristol',
  buyer_company_id TEXT NOT NULL REFERENCES companies(id), supplier_company_id TEXT NOT NULL REFERENCES companies(id), commodity_id TEXT NOT NULL REFERENCES commodities(id),
  qty_per_delivery INTEGER NOT NULL CHECK (qty_per_delivery > 0), price_minor INTEGER NOT NULL CHECK (price_minor > 0),
  every_ticks INTEGER NOT NULL CHECK (every_ticks BETWEEN 1 AND 30), start_tick INTEGER NOT NULL, end_tick INTEGER NOT NULL CHECK (end_tick >= start_tick),
  status TEXT NOT NULL CHECK (status IN ('pending','active','declined','cancelled','completed','failed')),
  proposed_by TEXT NOT NULL CHECK (proposed_by IN ('buyer','supplier')), decision_reason TEXT,
  notice_ticks INTEGER NOT NULL, cancel_requested_tick INTEGER, cancel_effective_tick INTEGER, cancelled_by TEXT,
  consecutive_misses INTEGER NOT NULL DEFAULT 0, max_misses INTEGER NOT NULL,
  created_tick INTEGER NOT NULL, idempotency_key TEXT UNIQUE, ended_tick INTEGER,
  CHECK (buyer_company_id <> supplier_company_id)
);
CREATE INDEX idx_contracts_status ON supply_contracts(status, buyer_company_id, supplier_company_id);
CREATE TABLE contract_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, contract_id INTEGER NOT NULL REFERENCES supply_contracts(id), due_tick INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled','delivered','missed_stock','missed_funds','missed_storage','cancelled')),
  qty INTEGER NOT NULL, price_minor INTEGER NOT NULL, gross_minor INTEGER NOT NULL DEFAULT 0, fee_minor INTEGER NOT NULL DEFAULT 0,
  ledger_tx_id INTEGER, settled_tick INTEGER, UNIQUE (contract_id, due_tick)
);
CREATE INDEX idx_deliveries_due ON contract_deliveries(status, due_tick);
`;
