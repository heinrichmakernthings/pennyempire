/**
 * Migration 0006 — State economy: shared state-service charge ledger, energy capacity, advertising campaigns, shipments, leases, National Bank loans and deposits,
 * Penny Central Bank policy and monetary operations, the CPI basket, economic events and the admin audit log. Additive only.
 */
export default `
-- production_log gains two production-limiting reasons (energy shortage, disruption by an economic event). SQLite cannot alter a CHECK: rebuild and copy.
CREATE TABLE production_log_new (
  tick INTEGER NOT NULL, company_id TEXT NOT NULL, recipe_id TEXT NOT NULL, planned_batches INTEGER NOT NULL, produced_batches INTEGER NOT NULL,
  limited_by TEXT NOT NULL CHECK (limited_by IN ('plan','staff','storage','inputs','cash','supply','condition','closed','energy','disruption')), output_units INTEGER NOT NULL, inputs_json TEXT NOT NULL,
  PRIMARY KEY (tick, company_id, recipe_id)
);
INSERT INTO production_log_new SELECT * FROM production_log;
DROP TABLE production_log;
ALTER TABLE production_log_new RENAME TO production_log;

-- ───────── Shared state-service interface ─────────
CREATE TABLE service_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, service TEXT NOT NULL CHECK (service IN ('energy','advertising','logistics','property','banking','exchange','works')),
  provider_id TEXT NOT NULL REFERENCES companies(id), payer_id TEXT REFERENCES companies(id), quantity INTEGER NOT NULL DEFAULT 1, unit_price_minor INTEGER NOT NULL DEFAULT 0,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0), ref TEXT, ledger_tx_id INTEGER REFERENCES ledger_transactions(id), idempotency_key TEXT UNIQUE
);
CREATE INDEX idx_service_provider ON service_charges(provider_id, tick);
CREATE INDEX idx_service_payer ON service_charges(payer_id, tick);

-- ───────── Economic modifiers, events, admin audit ─────────
CREATE TABLE economy_mods (tick INTEGER PRIMARY KEY, mods_json TEXT NOT NULL);
CREATE TABLE eco_events (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, location_id TEXT NOT NULL, industries_json TEXT NOT NULL, severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 3),
  start_tick INTEGER NOT NULL, end_tick INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('active','ended','cancelled')), trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('random','admin','scheduled')),
  roll INTEGER, effects_json TEXT NOT NULL, headline TEXT NOT NULL, created_tick INTEGER NOT NULL, one_shot_done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE eco_event_log (id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, event_id TEXT NOT NULL REFERENCES eco_events(id), action TEXT NOT NULL CHECK (action IN ('start','end','one_shot','cancel')), detail_json TEXT NOT NULL, ledger_tx_id INTEGER);
CREATE TABLE admin_log (id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail_json TEXT NOT NULL, ok INTEGER NOT NULL);

-- ───────── Energy ─────────
CREATE TABLE energy_sources (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), name TEXT NOT NULL, capacity_units INTEGER NOT NULL CHECK (capacity_units >= 0), active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE energy_daily (tick INTEGER PRIMARY KEY, capacity_units INTEGER NOT NULL, demand_units INTEGER NOT NULL, supplied_units INTEGER NOT NULL, utilisation_bps INTEGER NOT NULL, tariff_minor INTEGER NOT NULL, shortage_units INTEGER NOT NULL);

-- ───────── Advertising ─────────
CREATE TABLE ad_campaigns (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), kind TEXT NOT NULL CHECK (kind IN ('local','billboard','digital','industry','contract')), tier INTEGER NOT NULL DEFAULT 1,
  target_industry TEXT, district_id TEXT, start_tick INTEGER NOT NULL, end_tick INTEGER NOT NULL, daily_cost_minor INTEGER NOT NULL CHECK (daily_cost_minor > 0), total_paid_minor INTEGER NOT NULL DEFAULT 0,
  reach_bps INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('active','finished','cancelled')), idempotency_key TEXT UNIQUE
);
CREATE INDEX idx_ad_company ON ad_campaigns(company_id, status);
CREATE TABLE ad_daily (tick INTEGER NOT NULL, campaign_id TEXT NOT NULL, company_id TEXT NOT NULL, spend_minor INTEGER NOT NULL, effective_spend_minor INTEGER NOT NULL, dilution_bps INTEGER NOT NULL, PRIMARY KEY (tick, campaign_id));

-- ───────── Logistics ─────────
CREATE TABLE shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL, from_company_id TEXT NOT NULL REFERENCES companies(id), to_company_id TEXT NOT NULL REFERENCES companies(id), commodity_id TEXT NOT NULL REFERENCES commodities(id),
  qty INTEGER NOT NULL CHECK (qty > 0), cost_basis_minor INTEGER NOT NULL DEFAULT 0, distance_tiles INTEGER NOT NULL DEFAULT 0, mode TEXT NOT NULL DEFAULT 'van', origin_city_id TEXT NOT NULL, dest_city_id TEXT NOT NULL,
  fee_minor INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK (status IN ('in_transit','delivered','delayed','cancelled')), depart_tick INTEGER NOT NULL, due_tick INTEGER NOT NULL, delivered_tick INTEGER, delay_reason TEXT, fee_tx_id INTEGER,
  UNIQUE (ref, commodity_id)
);
CREATE INDEX idx_shipments_status ON shipments(status, due_tick);

-- ───────── Property ─────────
CREATE TABLE leases (
  id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL REFERENCES companies(id), plot_id TEXT, tier INTEGER NOT NULL DEFAULT 1, kind TEXT NOT NULL CHECK (kind IN ('lease','owned')),
  base_rent_minor INTEGER NOT NULL CHECK (base_rent_minor >= 0), service_charge_bps INTEGER NOT NULL DEFAULT 0, index_linked INTEGER NOT NULL DEFAULT 1, start_tick INTEGER NOT NULL, end_tick INTEGER,
  status TEXT NOT NULL CHECK (status IN ('active','ended')), purchase_price_minor INTEGER, note TEXT
);
CREATE INDEX idx_leases_company ON leases(company_id, status);

-- ───────── Central bank ─────────
CREATE TABLE central_bank (
  id INTEGER PRIMARY KEY CHECK (id = 1), base_rate_bps INTEGER NOT NULL CHECK (base_rate_bps BETWEEN 0 AND 5000), inflation_target_bps INTEGER NOT NULL, reserve_req_bps INTEGER NOT NULL CHECK (reserve_req_bps BETWEEN 0 AND 10000),
  liquidity_step_minor INTEGER NOT NULL, drain_step_minor INTEGER NOT NULL, last_review_tick INTEGER NOT NULL DEFAULT 0, stance TEXT NOT NULL DEFAULT 'neutral', rule_enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE policy_log (id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, old_value INTEGER, new_value INTEGER, reason TEXT NOT NULL, inflation_bps INTEGER, data_json TEXT);
CREATE TABLE monetary_ops (id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('liquidity_issue','liquidity_drain')), amount_minor INTEGER NOT NULL, counterparty TEXT NOT NULL, ledger_tx_id INTEGER REFERENCES ledger_transactions(id), reason TEXT NOT NULL);

-- ───────── National Bank ─────────
CREATE TABLE loans (
  id TEXT PRIMARY KEY, borrower_id TEXT NOT NULL REFERENCES companies(id), principal_minor INTEGER NOT NULL CHECK (principal_minor > 0), outstanding_minor INTEGER NOT NULL CHECK (outstanding_minor >= 0),
  rate_bps INTEGER NOT NULL, term_days INTEGER NOT NULL, start_tick INTEGER NOT NULL, daily_principal_minor INTEGER NOT NULL, grade TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active','repaid','defaulted')),
  missed INTEGER NOT NULL DEFAULT 0, interest_paid_minor INTEGER NOT NULL DEFAULT 0, fees_paid_minor INTEGER NOT NULL DEFAULT 0, written_off_minor INTEGER NOT NULL DEFAULT 0, origination_fee_minor INTEGER NOT NULL DEFAULT 0,
  disbursement_tx_id INTEGER, purpose TEXT, idempotency_key TEXT UNIQUE, closed_tick INTEGER
);
CREATE INDEX idx_loans_borrower ON loans(borrower_id, status);
CREATE TABLE loan_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, loan_id TEXT NOT NULL REFERENCES loans(id), tick INTEGER NOT NULL, due_minor INTEGER NOT NULL, principal_minor INTEGER NOT NULL, interest_minor INTEGER NOT NULL, fee_minor INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK (status IN ('paid','partial','missed','prepaid')), ledger_tx_id INTEGER, UNIQUE (loan_id, tick, status));
CREATE TABLE bank_deposits (company_id TEXT PRIMARY KEY REFERENCES companies(id), balance_minor INTEGER NOT NULL DEFAULT 0 CHECK (balance_minor >= 0), interest_paid_minor INTEGER NOT NULL DEFAULT 0, opened_tick INTEGER NOT NULL);
CREATE TABLE credit_defaults (id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, loan_id TEXT NOT NULL, borrower_id TEXT NOT NULL, written_off_minor INTEGER NOT NULL, reason TEXT NOT NULL);

-- ───────── Inflation and money statistics ─────────
CREATE TABLE cpi_index (tick INTEGER PRIMARY KEY, index_bps INTEGER NOT NULL, change_30d_bps INTEGER NOT NULL, components_json TEXT NOT NULL);
CREATE TABLE monetary_stats (
  tick INTEGER PRIMARY KEY, circulating_minor INTEGER NOT NULL, issued_tick_minor INTEGER NOT NULL, destroyed_tick_minor INTEGER NOT NULL, transferred_tick_minor INTEGER NOT NULL, consumer_spend_minor INTEGER NOT NULL,
  savings_minor INTEGER NOT NULL, trading_value_minor INTEGER NOT NULL, credit_issued_tick_minor INTEGER NOT NULL, loans_outstanding_minor INTEGER NOT NULL, state_treasury_minor INTEGER NOT NULL, base_rate_bps INTEGER NOT NULL, cpi_bps INTEGER NOT NULL,
  state_revenue_tick_minor INTEGER NOT NULL
);
`;
