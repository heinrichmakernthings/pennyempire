/** Migration 0004 — Living Bristol: consumer segments and budgets, loyalty, NPC strategy profiles and decision log, leaderboards and titles, the Penny Post, config versions. Additive only. */
export default `
-- ───────── Consumer economy ─────────
CREATE TABLE consumer_segments (
  id TEXT PRIMARY KEY, city_id TEXT NOT NULL REFERENCES cities(id), district_id TEXT REFERENCES districts(id), name TEXT NOT NULL,
  population_bps INTEGER NOT NULL CHECK (population_bps > 0), income_bps INTEGER NOT NULL CHECK (income_bps > 0),
  price_sens_delta INTEGER NOT NULL DEFAULT 0 CHECK (price_sens_delta BETWEEN -2 AND 2), quality_pref_bps INTEGER NOT NULL CHECK (quality_pref_bps BETWEEN 0 AND 10000),
  loyalty_trait_bps INTEGER NOT NULL CHECK (loyalty_trait_bps BETWEEN 0 AND 10000), center_col INTEGER NOT NULL, center_row INTEGER NOT NULL
);
ALTER TABLE demand_rules ADD COLUMN per_thousand_minor INTEGER NOT NULL DEFAULT 0 CHECK (per_thousand_minor >= 0);   -- minor units per 1,000 residents per day (0 = fixed 'amount')
ALTER TABLE demand_rules ADD COLUMN confidence_exposure_bps INTEGER NOT NULL DEFAULT 0 CHECK (confidence_exposure_bps BETWEEN 0 AND 10000);
ALTER TABLE demand_rules ADD COLUMN seasonality TEXT;                                                                 -- JSON array of 12 monthly factors (bps), normalised to mean 10000
ALTER TABLE demand_rules ADD COLUMN segmented INTEGER NOT NULL DEFAULT 0 CHECK (segmented IN (0,1));
CREATE TABLE consumer_state (tick INTEGER PRIMARY KEY, households_minor INTEGER NOT NULL, households_avg_minor INTEGER NOT NULL, confidence_bps INTEGER NOT NULL, shock_bps INTEGER NOT NULL);
CREATE TABLE consumer_budget_log (
  tick INTEGER NOT NULL, rule_id TEXT NOT NULL, potential_minor INTEGER NOT NULL, funded_minor INTEGER NOT NULL, spent_minor INTEGER NOT NULL,
  units_wanted INTEGER NOT NULL, units_sold INTEGER NOT NULL, confidence_bps INTEGER NOT NULL, season_bps INTEGER NOT NULL, PRIMARY KEY (tick, rule_id)
);
CREATE TABLE segment_sales (
  tick INTEGER NOT NULL, segment_id TEXT NOT NULL, rule_id TEXT NOT NULL, company_id TEXT NOT NULL, units INTEGER NOT NULL, spend_minor INTEGER NOT NULL, budget_minor INTEGER NOT NULL,
  PRIMARY KEY (tick, segment_id, rule_id, company_id)
);
CREATE INDEX idx_segment_sales_company ON segment_sales(company_id, tick);
CREATE TABLE customer_loyalty (company_id TEXT NOT NULL REFERENCES companies(id), segment_id TEXT NOT NULL REFERENCES consumer_segments(id), loyalty_bps INTEGER NOT NULL CHECK (loyalty_bps BETWEEN 0 AND 10000), PRIMARY KEY (company_id, segment_id));

-- ───────── NPC strategies, decisions, entry ─────────
CREATE TABLE npc_profiles (
  company_id TEXT PRIMARY KEY REFERENCES companies(id), strategy TEXT NOT NULL CHECK (strategy IN ('budget','premium','growth','conservative','opportunistic','struggling')),
  previous_strategy TEXT, strategy_since_tick INTEGER NOT NULL, decision_every INTEGER NOT NULL CHECK (decision_every >= 1), next_decision_tick INTEGER NOT NULL,
  last_decision_tick INTEGER, markup_bps INTEGER NOT NULL, target_quality TEXT NOT NULL CHECK (target_quality IN ('basic','standard','premium')), marketing_minor INTEGER NOT NULL DEFAULT 0,
  reserve_days INTEGER NOT NULL, losing_decisions INTEGER NOT NULL DEFAULT 0, profitable_decisions INTEGER NOT NULL DEFAULT 0, created_tick INTEGER NOT NULL
);
CREATE TABLE npc_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, company_id TEXT NOT NULL, strategy TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, inputs_json TEXT NOT NULL, applied INTEGER NOT NULL CHECK (applied IN (0,1)), public INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_npc_decisions ON npc_decisions(company_id, tick);
CREATE TABLE npc_entry_log (tick INTEGER NOT NULL, industry_id TEXT NOT NULL, outcome TEXT NOT NULL, reason TEXT NOT NULL, company_id TEXT, score INTEGER, PRIMARY KEY (tick, industry_id));

-- ───────── Leaderboards and titles ─────────
CREATE TABLE leaderboard (
  tick INTEGER NOT NULL, board TEXT NOT NULL, scope TEXT NOT NULL, rank INTEGER NOT NULL, company_id TEXT NOT NULL, value REAL NOT NULL, PRIMARY KEY (tick, board, scope, rank)
);
CREATE TABLE titles (title_key TEXT PRIMARY KEY, label TEXT NOT NULL, holder_company_id TEXT NOT NULL, since_tick INTEGER NOT NULL, value REAL NOT NULL, industry_id TEXT, board TEXT NOT NULL);
CREATE TABLE title_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, title_key TEXT NOT NULL, label TEXT NOT NULL, old_company_id TEXT, new_company_id TEXT NOT NULL, new_value REAL NOT NULL, old_value REAL);

-- ───────── The Penny Post ─────────
CREATE TABLE news_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, kind TEXT NOT NULL, headline TEXT NOT NULL, body TEXT NOT NULL, importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 3),
  subject_company_id TEXT, industry_id TEXT, commodity_id TEXT, event_id INTEGER UNIQUE, data_json TEXT NOT NULL
);
CREATE INDEX idx_news_tick ON news_articles(tick);

-- ───────── Stability, config versions ─────────
CREATE TABLE stability_stats (
  tick INTEGER PRIMARY KEY, circulating_minor INTEGER NOT NULL, households_minor INTEGER NOT NULL, npc_cash_minor INTEGER NOT NULL, player_cash_minor INTEGER NOT NULL, state_minor INTEGER NOT NULL,
  consumer_spend_minor INTEGER NOT NULL, npc_spend_minor INTEGER NOT NULL, units_produced INTEGER NOT NULL, gini_bps INTEGER NOT NULL, company_count INTEGER NOT NULL, failures_cum INTEGER NOT NULL
);
CREATE TABLE config_versions (version INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, note TEXT NOT NULL, config_json TEXT NOT NULL);
`;
