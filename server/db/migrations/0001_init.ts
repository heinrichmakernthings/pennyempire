/** Migration 0001 — see docs/ECONOMIC-ENGINE.md for the model. Plain TS string so every runtime (Node, Worker, Vitest) loads it identically. */
export default `
-- Penny Empire economic engine, schema v1. All money is INTEGER minor units (100 = 1 EC). All quantities are INTEGER.

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE engine_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_tick INTEGER NOT NULL DEFAULT 0 CHECK (last_tick >= 0),
  lock_owner TEXT,
  lock_until_ms INTEGER NOT NULL DEFAULT 0,
  clock_anchor_ms INTEGER                 -- wall-clock ms of tick 0; NULL until the first run anchors the clock
);

CREATE TABLE cities (id TEXT PRIMARY KEY, name TEXT NOT NULL, population INTEGER NOT NULL CHECK (population >= 0), households_account_id TEXT NOT NULL, treasury_account_id TEXT NOT NULL);
CREATE TABLE districts (id TEXT PRIMARY KEY, city_id TEXT NOT NULL REFERENCES cities(id), name TEXT NOT NULL, property_index_bps INTEGER NOT NULL CHECK (property_index_bps > 0));
CREATE TABLE plots (
  id TEXT PRIMARY KEY, city_id TEXT NOT NULL REFERENCES cities(id), district_id TEXT REFERENCES districts(id),
  col INTEGER NOT NULL, row INTEGER NOT NULL, width INTEGER NOT NULL CHECK (width > 0), depth INTEGER NOT NULL CHECK (depth > 0),
  terrain TEXT NOT NULL CHECK (terrain IN ('paving','grass','water','road')), road_mask INTEGER NOT NULL DEFAULT 0, quay_mask INTEGER NOT NULL DEFAULT 0,
  asset_id TEXT, company_id TEXT
);

CREATE TABLE industries (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('primary','manufacturing','retail','service','utility','property','media','wholesale')));
CREATE TABLE commodities (id TEXT PRIMARY KEY, name TEXT NOT NULL, unit_label TEXT NOT NULL, reference_price_minor INTEGER NOT NULL CHECK (reference_price_minor > 0));
CREATE TABLE recipes (
  id TEXT PRIMARY KEY, industry_id TEXT NOT NULL REFERENCES industries(id), output_commodity_id TEXT NOT NULL REFERENCES commodities(id),
  output_units INTEGER NOT NULL CHECK (output_units > 0), energy_units INTEGER NOT NULL CHECK (energy_units >= 0)
);
CREATE TABLE recipe_inputs (recipe_id TEXT NOT NULL REFERENCES recipes(id), commodity_id TEXT NOT NULL REFERENCES commodities(id), units INTEGER NOT NULL CHECK (units > 0), PRIMARY KEY (recipe_id, commodity_id));

-- ───────── Ledger ─────────
-- 'issuance' is the mint (always <= 0, = -total issued). 'destroyed' collects burnt coins (always >= 0).
-- Every other account is non-negative and may not reserve more than it holds. The database itself refuses violations.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('issuance','destroyed','player','company','state_treasury','households')),
  label TEXT NOT NULL,
  balance_minor INTEGER NOT NULL DEFAULT 0,
  reserved_minor INTEGER NOT NULL DEFAULT 0,
  CHECK (reserved_minor >= 0),
  CHECK (kind = 'issuance' OR balance_minor >= 0),
  CHECK (kind = 'issuance' OR reserved_minor <= balance_minor)
);
CREATE TABLE ledger_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('issuance','transfer','state_payment','sink','sink_fee','operating_cost','consumer_sale','trade_settlement','capital_injection','owner_withdrawal')),
  tick INTEGER NOT NULL,
  memo TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE ledger_postings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_id INTEGER NOT NULL REFERENCES ledger_transactions(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0)
);
CREATE INDEX idx_postings_tx ON ledger_postings(tx_id);
CREATE INDEX idx_postings_account ON ledger_postings(account_id);
CREATE INDEX idx_ledger_tick ON ledger_transactions(tick);
CREATE TRIGGER ledger_tx_immutable_u BEFORE UPDATE ON ledger_transactions BEGIN SELECT RAISE(ABORT, 'ledger is immutable'); END;
CREATE TRIGGER ledger_tx_immutable_d BEFORE DELETE ON ledger_transactions BEGIN SELECT RAISE(ABORT, 'ledger is immutable'); END;
CREATE TRIGGER ledger_post_immutable_u BEFORE UPDATE ON ledger_postings BEGIN SELECT RAISE(ABORT, 'ledger is immutable'); END;
CREATE TRIGGER ledger_post_immutable_d BEFORE DELETE ON ledger_postings BEGIN SELECT RAISE(ABORT, 'ledger is immutable'); END;

-- ───────── Players, companies, ownership ─────────
CREATE TABLE owners (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('player','npc','state')), name TEXT NOT NULL);
CREATE TABLE players (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, city_id TEXT NOT NULL REFERENCES cities(id), wallet_account_id TEXT NOT NULL REFERENCES accounts(id));
CREATE TABLE companies (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, city_id TEXT NOT NULL REFERENCES cities(id), district_id TEXT REFERENCES districts(id), plot_id TEXT,
  industry_id TEXT NOT NULL REFERENCES industries(id), asset_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('player','npc','state')), owner_id TEXT NOT NULL,
  treasury_account_id TEXT NOT NULL REFERENCES accounts(id),
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  status TEXT NOT NULL DEFAULT 'operating' CHECK (status IN ('operating','paused','insolvent')),
  retail_commodity_id TEXT REFERENCES commodities(id),
  price_minor INTEGER NOT NULL CHECK (price_minor > 0), min_price_minor INTEGER NOT NULL CHECK (min_price_minor > 0), max_price_minor INTEGER NOT NULL,
  quality TEXT NOT NULL CHECK (quality IN ('basic','standard','premium')),
  employees INTEGER NOT NULL CHECK (employees >= 0), max_employees INTEGER NOT NULL CHECK (max_employees >= employees),
  wage_minor INTEGER NOT NULL CHECK (wage_minor >= 0),            -- per employee per tick
  capacity_batches INTEGER NOT NULL CHECK (capacity_batches >= 0), -- at full staffing
  storage_cap_units INTEGER NOT NULL CHECK (storage_cap_units > 0), -- per commodity
  property_minor INTEGER NOT NULL CHECK (property_minor >= 0),    -- rent per tick
  marketing_minor INTEGER NOT NULL DEFAULT 0 CHECK (marketing_minor >= 0),
  reputation_bps INTEGER NOT NULL DEFAULT 5000 CHECK (reputation_bps BETWEEN 0 AND 10000),
  unpaid_minor INTEGER NOT NULL DEFAULT 0 CHECK (unpaid_minor >= 0),
  shortfall_ticks INTEGER NOT NULL DEFAULT 0 CHECK (shortfall_ticks >= 0),
  revision INTEGER NOT NULL DEFAULT 1,
  created_tick INTEGER NOT NULL DEFAULT 0,
  CHECK (max_price_minor >= min_price_minor), CHECK (price_minor BETWEEN min_price_minor AND max_price_minor)
);
CREATE TABLE production_lines (company_id TEXT NOT NULL REFERENCES companies(id), recipe_id TEXT NOT NULL REFERENCES recipes(id), planned_batches INTEGER NOT NULL CHECK (planned_batches >= 0), ask_price_minor INTEGER NOT NULL CHECK (ask_price_minor > 0), PRIMARY KEY (company_id, recipe_id));
CREATE TABLE ownership (company_id TEXT NOT NULL REFERENCES companies(id), holder_kind TEXT NOT NULL CHECK (holder_kind IN ('player','npc','state')), holder_id TEXT NOT NULL, shares INTEGER NOT NULL CHECK (shares > 0), PRIMARY KEY (company_id, holder_kind, holder_id));

-- ───────── Inventory (with an immutable movement log so stock can be reconciled) ─────────
CREATE TABLE inventory (
  company_id TEXT NOT NULL REFERENCES companies(id), commodity_id TEXT NOT NULL REFERENCES commodities(id),
  qty INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0), reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  value_minor INTEGER NOT NULL DEFAULT 0 CHECK (value_minor >= 0),   -- cost basis of the units held
  PRIMARY KEY (company_id, commodity_id), CHECK (reserved <= qty), CHECK (qty > 0 OR value_minor = 0)
);
CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, company_id TEXT NOT NULL, commodity_id TEXT NOT NULL,
  delta INTEGER NOT NULL CHECK (delta <> 0),
  reason TEXT NOT NULL CHECK (reason IN ('production_output','production_input','consumer_purchase','public_works','state_supply','trade_in','trade_out','seed')),
  ref TEXT
);
CREATE INDEX idx_invmov ON inventory_movements(company_id, commodity_id);
CREATE TRIGGER invmov_immutable_u BEFORE UPDATE ON inventory_movements BEGIN SELECT RAISE(ABORT, 'inventory log is immutable'); END;
CREATE TRIGGER invmov_immutable_d BEFORE DELETE ON inventory_movements BEGIN SELECT RAISE(ABORT, 'inventory log is immutable'); END;

-- ───────── Market foundations ─────────
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL REFERENCES companies(id), commodity_id TEXT NOT NULL REFERENCES commodities(id),
  side TEXT NOT NULL CHECK (side IN ('buy','sell')), price_minor INTEGER NOT NULL CHECK (price_minor > 0),
  qty_original INTEGER NOT NULL CHECK (qty_original > 0), qty_remaining INTEGER NOT NULL CHECK (qty_remaining >= 0),
  reserved_funds_minor INTEGER NOT NULL DEFAULT 0 CHECK (reserved_funds_minor >= 0),   -- buy orders only; held on the buyer's account
  status TEXT NOT NULL CHECK (status IN ('open','filled','cancelled')),
  created_tick INTEGER NOT NULL, idempotency_key TEXT UNIQUE,
  CHECK (qty_remaining <= qty_original)
);
CREATE INDEX idx_orders_book ON orders(commodity_id, side, status, price_minor, id);
CREATE TABLE trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, commodity_id TEXT NOT NULL, buy_order_id INTEGER NOT NULL, sell_order_id INTEGER NOT NULL,
  buyer_company_id TEXT NOT NULL, seller_company_id TEXT NOT NULL, qty INTEGER NOT NULL CHECK (qty > 0), price_minor INTEGER NOT NULL, fee_minor INTEGER NOT NULL, ledger_tx_id INTEGER REFERENCES ledger_transactions(id)
);
CREATE INDEX idx_trades_tick ON trades(tick);

-- ───────── Consumer demand ─────────
-- Every rule names the account that actually funds it. mode 'pool_share': basis points of the funder's balance at tick start. mode 'fixed': a fixed amount, capped by the funder's balance.
CREATE TABLE demand_rules (
  id TEXT PRIMARY KEY, city_id TEXT NOT NULL REFERENCES cities(id), commodity_id TEXT NOT NULL REFERENCES commodities(id), label TEXT NOT NULL,
  funder_account_id TEXT NOT NULL REFERENCES accounts(id), mode TEXT NOT NULL CHECK (mode IN ('pool_share','fixed')), amount INTEGER NOT NULL CHECK (amount >= 0),
  payment_kind TEXT NOT NULL CHECK (payment_kind IN ('consumer_sale','state_payment')), goods_reason TEXT NOT NULL CHECK (goods_reason IN ('consumer_purchase','public_works')),
  price_sensitivity INTEGER NOT NULL DEFAULT 2 CHECK (price_sensitivity BETWEEN 0 AND 4)
);

-- ───────── Time, history, events ─────────
CREATE TABLE ticks (tick INTEGER PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('running','complete','failed')), game_date TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, duration_ms INTEGER, summary_json TEXT, error TEXT);
CREATE TABLE company_tick_stats (
  tick INTEGER NOT NULL, company_id TEXT NOT NULL,
  revenue_minor INTEGER NOT NULL, cogs_minor INTEGER NOT NULL, labour_minor INTEGER NOT NULL, property_minor INTEGER NOT NULL, marketing_minor INTEGER NOT NULL, fees_minor INTEGER NOT NULL, tax_minor INTEGER NOT NULL DEFAULT 0,
  energy_paid_minor INTEGER NOT NULL, input_purchases_minor INTEGER NOT NULL,
  gross_profit_minor INTEGER NOT NULL, net_profit_minor INTEGER NOT NULL, cash_end_minor INTEGER NOT NULL, inventory_value_minor INTEGER NOT NULL,
  units_produced INTEGER NOT NULL, units_sold INTEGER NOT NULL, unpaid_end_minor INTEGER NOT NULL, status TEXT NOT NULL,
  PRIMARY KEY (tick, company_id)
);
CREATE TABLE demand_tick_stats (tick INTEGER NOT NULL, rule_id TEXT NOT NULL, budget_minor INTEGER NOT NULL, spent_minor INTEGER NOT NULL, units_wanted INTEGER NOT NULL, units_sold INTEGER NOT NULL, unmet_units INTEGER NOT NULL, PRIMARY KEY (tick, rule_id));
CREATE TABLE supply_snapshots (
  tick INTEGER PRIMARY KEY, issued_total_minor INTEGER NOT NULL, destroyed_total_minor INTEGER NOT NULL, circulating_minor INTEGER NOT NULL,
  issued_tick_minor INTEGER NOT NULL, destroyed_tick_minor INTEGER NOT NULL, households_minor INTEGER NOT NULL, state_minor INTEGER NOT NULL, companies_minor INTEGER NOT NULL, players_minor INTEGER NOT NULL, goods_value_minor INTEGER NOT NULL
);
CREATE TABLE economic_events (id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, kind TEXT NOT NULL, severity TEXT NOT NULL CHECK (severity IN ('info','warning','error')), subject TEXT, message TEXT NOT NULL, data_json TEXT);
CREATE INDEX idx_events_tick ON economic_events(tick);
CREATE TABLE quotes (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, commodity_id TEXT NOT NULL, side TEXT NOT NULL, qty INTEGER NOT NULL, limit_minor INTEGER NOT NULL, subtotal_minor INTEGER NOT NULL, fee_minor INTEGER NOT NULL, total_minor INTEGER NOT NULL, tick INTEGER NOT NULL);
CREATE TABLE command_log (idempotency_key TEXT PRIMARY KEY, command TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('ok','rejected')), response_json TEXT NOT NULL, tick INTEGER NOT NULL);
CREATE TABLE failed_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, idempotency_key TEXT, kind TEXT NOT NULL, reason TEXT NOT NULL, detail TEXT);
`;
