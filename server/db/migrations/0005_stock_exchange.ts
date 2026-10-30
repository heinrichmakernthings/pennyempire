/**
 * Migration 0005 — Penny Exchange (shares). Fictional securities in Empire Coins only; nothing here touches the GBP test wallet.
 * The old single-row `ownership` table becomes a real cap table (`share_holdings`) with an immutable journal of every issue, transfer and cancellation.
 * Additive except for retiring `ownership`, whose rows are copied first.
 */
export default `
-- ───────── Who can hold shares ─────────
CREATE TABLE investors (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('player','npc','household','state','company')), name TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),             -- where this holder's coins live; dividends and sale proceeds are paid here
  company_id TEXT REFERENCES companies(id),                     -- kind 'company': the company whose treasury this is (corporate shareholder / treasury shares)
  strategy TEXT, decision_every INTEGER NOT NULL DEFAULT 3, next_decision_tick INTEGER NOT NULL DEFAULT 0, created_tick INTEGER NOT NULL DEFAULT 0
);

-- ───────── Share capital ─────────
CREATE TABLE securities (
  company_id TEXT PRIMARY KEY REFERENCES companies(id), ticker TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'unlisted' CHECK (status IN ('unlisted','open','suspended','delisted')),
  issued_shares INTEGER NOT NULL CHECK (issued_shares >= 0), paid_in_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_in_minor >= 0),
  cancelled_shares INTEGER NOT NULL DEFAULT 0, listed_tick INTEGER, listing_price_minor INTEGER, last_issue_tick INTEGER,
  suspended_reason TEXT, suspended_tick INTEGER, delisted_tick INTEGER
);
CREATE TABLE share_holdings (
  company_id TEXT NOT NULL REFERENCES companies(id), investor_id TEXT NOT NULL REFERENCES investors(id),
  shares INTEGER NOT NULL CHECK (shares >= 0), reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0 AND reserved <= shares),
  cost_basis_minor INTEGER NOT NULL DEFAULT 0 CHECK (cost_basis_minor >= 0),           -- total cost of the shares currently held (average-cost method)
  PRIMARY KEY (company_id, investor_id)
);
CREATE TABLE share_journal (                                                             -- append-only: every share that ever came into being, moved or ceased to exist
  id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, company_id TEXT NOT NULL REFERENCES companies(id),
  kind TEXT NOT NULL CHECK (kind IN ('founder','issue','transfer','cancel','liquidation')),
  from_investor TEXT, to_investor TEXT, qty INTEGER NOT NULL CHECK (qty > 0), price_minor INTEGER NOT NULL DEFAULT 0, ref TEXT, ledger_tx_id INTEGER REFERENCES ledger_transactions(id), note TEXT
);
CREATE INDEX idx_share_journal_co ON share_journal(company_id, id);
CREATE TABLE share_offerings (                                                           -- primary issues: new shares sold FOR THE COMPANY (proceeds go to its treasury)
  id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL REFERENCES companies(id), kind TEXT NOT NULL CHECK (kind IN ('ipo','follow_on')),
  tick INTEGER NOT NULL, shares_offered INTEGER NOT NULL CHECK (shares_offered > 0), price_minor INTEGER NOT NULL CHECK (price_minor > 0),
  shares_sold INTEGER NOT NULL DEFAULT 0, proceeds_minor INTEGER NOT NULL DEFAULT 0, listing_fee_minor INTEGER NOT NULL DEFAULT 0, fee_tx_id INTEGER,
  founder_bps_after INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','withdrawn')), order_id INTEGER, idempotency_key TEXT UNIQUE
);

-- ───────── Order book ─────────
CREATE TABLE share_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL REFERENCES companies(id), investor_id TEXT NOT NULL REFERENCES investors(id),
  side TEXT NOT NULL CHECK (side IN ('buy','sell')), kind TEXT NOT NULL DEFAULT 'limit' CHECK (kind IN ('limit','market')),
  price_minor INTEGER NOT NULL CHECK (price_minor > 0), qty_original INTEGER NOT NULL CHECK (qty_original > 0), qty_remaining INTEGER NOT NULL CHECK (qty_remaining >= 0),
  reserved_funds_minor INTEGER NOT NULL DEFAULT 0 CHECK (reserved_funds_minor >= 0), status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','filled','cancelled')),
  end_reason TEXT CHECK (end_reason IN ('cancelled','expired','unfilled_remainder','suspended','delisted')), created_tick INTEGER NOT NULL, expires_tick INTEGER,
  primary_offering_id INTEGER REFERENCES share_offerings(id), idempotency_key TEXT UNIQUE
);
CREATE INDEX idx_share_orders_book ON share_orders(company_id, side, status, price_minor);
CREATE TABLE share_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, company_id TEXT NOT NULL REFERENCES companies(id), buy_order_id INTEGER NOT NULL, sell_order_id INTEGER NOT NULL,
  buyer_id TEXT NOT NULL REFERENCES investors(id), seller_id TEXT NOT NULL REFERENCES investors(id), qty INTEGER NOT NULL CHECK (qty > 0), price_minor INTEGER NOT NULL,
  fee_minor INTEGER NOT NULL DEFAULT 0, primary_offering_id INTEGER, ledger_tx_id INTEGER REFERENCES ledger_transactions(id), fee_tx_id INTEGER
);
CREATE INDEX idx_share_trades_co ON share_trades(company_id, tick);
CREATE TABLE share_pnl (                                                                 -- realised gain or loss at each disposal (average-cost method); never mixed with unrealised marks
  id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, investor_id TEXT NOT NULL, company_id TEXT NOT NULL, qty INTEGER NOT NULL, proceeds_minor INTEGER NOT NULL, cost_minor INTEGER NOT NULL, pnl_minor INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('sale','liquidation')), ref TEXT
);
CREATE INDEX idx_share_pnl_inv ON share_pnl(investor_id);

-- ───────── Dividends ─────────
CREATE TABLE dividends (
  id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL REFERENCES companies(id), declared_tick INTEGER NOT NULL, record_tick INTEGER NOT NULL, payment_tick INTEGER NOT NULL,
  per_share_minor INTEGER NOT NULL CHECK (per_share_minor > 0), eligible_shares INTEGER NOT NULL, total_minor INTEGER NOT NULL, paid_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'declared' CHECK (status IN ('declared','paid','cancelled')), declared_by TEXT NOT NULL, idempotency_key TEXT UNIQUE
);
CREATE TABLE dividend_entitlements (                                                     -- the record-date snapshot: who was owed what, fixed at declaration
  dividend_id INTEGER NOT NULL REFERENCES dividends(id), investor_id TEXT NOT NULL REFERENCES investors(id), shares INTEGER NOT NULL, amount_minor INTEGER NOT NULL, ledger_tx_id INTEGER,
  PRIMARY KEY (dividend_id, investor_id)
);

-- ───────── Valuation, statistics, index ─────────
CREATE TABLE security_valuations (
  tick INTEGER NOT NULL, company_id TEXT NOT NULL, fair_value_minor INTEGER NOT NULL, equity_minor INTEGER NOT NULL, earnings_value_minor INTEGER NOT NULL, daily_earnings_minor INTEGER NOT NULL,
  growth_bps INTEGER NOT NULL, risk_bps INTEGER NOT NULL, components_json TEXT NOT NULL, PRIMARY KEY (tick, company_id)
);
CREATE TABLE security_stats (
  tick INTEGER NOT NULL, company_id TEXT NOT NULL, open_minor INTEGER, high_minor INTEGER, low_minor INTEGER, close_minor INTEGER, vwap_minor INTEGER, volume INTEGER NOT NULL DEFAULT 0, trades INTEGER NOT NULL DEFAULT 0,
  best_bid_minor INTEGER, best_ask_minor INTEGER, bid_depth INTEGER NOT NULL DEFAULT 0, ask_depth INTEGER NOT NULL DEFAULT 0, ref_minor INTEGER, market_cap_minor INTEGER, status TEXT NOT NULL, PRIMARY KEY (tick, company_id)
);
CREATE TABLE market_index (tick INTEGER PRIMARY KEY, value_bps INTEGER NOT NULL, market_cap_minor INTEGER NOT NULL, listed INTEGER NOT NULL, turnover_minor INTEGER NOT NULL);

-- ───────── Control and corporate actions ─────────
CREATE TABLE control_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, company_id TEXT NOT NULL REFERENCES companies(id), from_owner_kind TEXT, from_owner_id TEXT, to_owner_kind TEXT NOT NULL, to_owner_id TEXT NOT NULL,
  investor_id TEXT NOT NULL, shares INTEGER NOT NULL, outstanding INTEGER NOT NULL, stake_bps INTEGER NOT NULL
);
CREATE TABLE stake_marks (company_id TEXT NOT NULL, investor_id TEXT NOT NULL, class TEXT NOT NULL, PRIMARY KEY (company_id, investor_id));   -- last ownership class announced per holder
CREATE TABLE investor_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, investor_id TEXT NOT NULL, company_id TEXT, action TEXT NOT NULL, reason TEXT NOT NULL, inputs_json TEXT NOT NULL, applied INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_inv_dec ON investor_decisions(investor_id, tick);

-- ───────── Back-fill existing worlds from the old ownership table ─────────
INSERT INTO investors (id, kind, name, account_id, created_tick)
  SELECT o.id, CASE o.kind WHEN 'player' THEN 'player' WHEN 'state' THEN 'state' ELSE 'household' END, o.name,
         CASE o.kind WHEN 'player' THEN (SELECT wallet_account_id FROM players WHERE id = o.id) WHEN 'state' THEN (SELECT treasury_account_id FROM cities LIMIT 1) ELSE (SELECT households_account_id FROM cities LIMIT 1) END, 0
  FROM owners o WHERE (CASE o.kind WHEN 'player' THEN (SELECT wallet_account_id FROM players WHERE id = o.id) WHEN 'state' THEN (SELECT treasury_account_id FROM cities LIMIT 1) ELSE (SELECT households_account_id FROM cities LIMIT 1) END) IS NOT NULL;
INSERT INTO securities (company_id, ticker, status, issued_shares, paid_in_minor)
  SELECT c.id, UPPER(SUBSTR(REPLACE(REPLACE(c.id,'co-',''),'-',''),1,4)) || ROW_NUMBER() OVER (ORDER BY c.id), 'unlisted', COALESCE((SELECT SUM(shares) FROM ownership w WHERE w.company_id = c.id), 0), 0 FROM companies c;
INSERT INTO share_holdings (company_id, investor_id, shares, cost_basis_minor) SELECT w.company_id, w.holder_id, w.shares, 0 FROM ownership w WHERE EXISTS (SELECT 1 FROM investors i WHERE i.id = w.holder_id);
INSERT INTO share_journal (tick, company_id, kind, to_investor, qty, price_minor, ref, note) SELECT 0, w.company_id, 'founder', w.holder_id, w.shares, 0, 'migration:0005', 'opening cap table' FROM ownership w WHERE EXISTS (SELECT 1 FROM investors i WHERE i.id = w.holder_id);
DROP TABLE ownership;
`;
