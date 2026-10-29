/**
 * Migration 0007 — Prestige economy, simulated GBP wallet (its own double-entry ledger, integer pence), boosts, rewarded ads, reward programmes, coin lotteries and the
 * mock premium membership. Additive only. GBP_TEST never touches the Empire Coin ledger: there is no table, column or account shared between the two.
 */
export default `
-- ───────── GBP_TEST double-entry ledger (debit positive, credit negative, every transaction sums to zero) ─────────
CREATE TABLE gbp_accounts (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('asset','liability','revenue','expense','equity')), label TEXT NOT NULL, owner_id TEXT,
  balance_pence INTEGER NOT NULL DEFAULT 0,
  CHECK (kind <> 'asset' OR balance_pence >= 0),          -- cash can never be overdrawn
  CHECK (kind <> 'liability' OR balance_pence <= 0)       -- a liability is a credit balance: the game can never owe a negative amount
);
CREATE TABLE gbp_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, idempotency_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('posted','reversed')),
  memo TEXT NOT NULL, actor TEXT NOT NULL, tick INTEGER NOT NULL, created_ms INTEGER NOT NULL, reverses_tx INTEGER REFERENCES gbp_transactions(id), ref TEXT, simulated INTEGER NOT NULL DEFAULT 1 CHECK (simulated = 1)
);
CREATE TABLE gbp_postings (id INTEGER PRIMARY KEY AUTOINCREMENT, tx_id INTEGER NOT NULL REFERENCES gbp_transactions(id), account_id TEXT NOT NULL REFERENCES gbp_accounts(id), amount_pence INTEGER NOT NULL CHECK (amount_pence <> 0));
CREATE INDEX idx_gbp_postings_tx ON gbp_postings(tx_id); CREATE INDEX idx_gbp_postings_acct ON gbp_postings(account_id);
-- history is immutable: postings can never be edited or deleted; a transaction row may only change status posted → reversed
CREATE TRIGGER gbp_postings_no_update BEFORE UPDATE ON gbp_postings BEGIN SELECT RAISE(ABORT, 'gbp postings are immutable'); END;
CREATE TRIGGER gbp_postings_no_delete BEFORE DELETE ON gbp_postings BEGIN SELECT RAISE(ABORT, 'gbp postings are immutable'); END;
CREATE TRIGGER gbp_tx_no_delete BEFORE DELETE ON gbp_transactions BEGIN SELECT RAISE(ABORT, 'gbp transactions are immutable'); END;
CREATE TRIGGER gbp_tx_limited_update BEFORE UPDATE ON gbp_transactions WHEN NEW.idempotency_key <> OLD.idempotency_key OR NEW.kind <> OLD.kind OR NEW.memo <> OLD.memo OR NEW.created_ms <> OLD.created_ms OR NEW.status NOT IN ('posted','reversed') BEGIN SELECT RAISE(ABORT, 'gbp transactions are immutable'); END;

CREATE TABLE gbp_deposits (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, amount_pence INTEGER NOT NULL CHECK (amount_pence > 0), status TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed','cancelled')),
  provider TEXT NOT NULL, provider_ref TEXT NOT NULL UNIQUE, idempotency_key TEXT NOT NULL UNIQUE, fee_pence INTEGER NOT NULL DEFAULT 0, ledger_tx_id INTEGER, failure_reason TEXT, created_ms INTEGER NOT NULL, settled_ms INTEGER
);
CREATE TABLE gbp_withdrawals (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, amount_pence INTEGER NOT NULL CHECK (amount_pence > 0), status TEXT NOT NULL CHECK (status IN ('requested','approved','paid','rejected','failed','cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE, reserve_tx_id INTEGER, final_tx_id INTEGER, payout_ref TEXT, reason TEXT, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL
);
CREATE TABLE gbp_provider_events (provider_event_id TEXT PRIMARY KEY, provider TEXT NOT NULL, kind TEXT NOT NULL, subject_id TEXT NOT NULL, received_ms INTEGER NOT NULL, outcome TEXT NOT NULL);
CREATE TABLE gbp_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ms INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, subject TEXT, detail_json TEXT NOT NULL, ok INTEGER NOT NULL);

-- ───────── Rewards, prizes, rewarded ads ─────────
CREATE TABLE reward_programs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('achievement','city_competition','weekly_leaderboard','promotion','prize_draw','developer')),
  eligibility_json TEXT NOT NULL, award_pence INTEGER NOT NULL CHECK (award_pence > 0), budget_pence INTEGER NOT NULL CHECK (budget_pence >= 0), spent_pence INTEGER NOT NULL DEFAULT 0 CHECK (spent_pence >= 0 AND spent_pence <= budget_pence),
  per_player_max INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, created_ms INTEGER NOT NULL, funded_pence INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE reward_awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT, program_id TEXT NOT NULL REFERENCES reward_programs(id), player_id TEXT NOT NULL, amount_pence INTEGER NOT NULL, ledger_tx_id INTEGER NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
  issued_ms INTEGER NOT NULL, audit_json TEXT NOT NULL
);
CREATE TABLE prize_draws (id TEXT PRIMARY KEY, program_id TEXT NOT NULL REFERENCES reward_programs(id), name TEXT NOT NULL, closes_tick INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('open','drawn','cancelled')), winner_id TEXT, drawn_ms INTEGER, entries_hash TEXT);
CREATE TABLE prize_draw_entries (draw_id TEXT NOT NULL REFERENCES prize_draws(id), player_id TEXT NOT NULL, entered_ms INTEGER NOT NULL, PRIMARY KEY (draw_id, player_id));

CREATE TABLE ad_view_sessions (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, reward_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('started','verified','expired','rejected')), nonce TEXT NOT NULL, started_ms INTEGER NOT NULL, min_ms INTEGER NOT NULL,
  completed_ms INTEGER, tick INTEGER NOT NULL, provider TEXT NOT NULL, fraud_reason TEXT
);
CREATE TABLE ad_rewards_granted (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL UNIQUE REFERENCES ad_view_sessions(id), player_id TEXT NOT NULL, reward_id TEXT NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL, tick INTEGER NOT NULL, ledger_tx_id INTEGER, boost_id INTEGER);
CREATE TABLE ad_impressions (day INTEGER NOT NULL, slot TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, slot));

-- ───────── Prestige ─────────
CREATE TABLE prestige_items (
  id TEXT PRIMARY KEY, category TEXT NOT NULL CHECK (category IN ('vehicle','property','corporate','luxury')), name TEXT NOT NULL, description TEXT NOT NULL, rarity TEXT NOT NULL CHECK (rarity IN ('common','uncommon','rare','epic','legendary')),
  price_minor INTEGER NOT NULL CHECK (price_minor > 0), currency TEXT NOT NULL CHECK (currency = 'EC'), asset TEXT, supply_cap INTEGER, minted INTEGER NOT NULL DEFAULT 0, tradeable INTEGER NOT NULL DEFAULT 0, unique_per_owner INTEGER NOT NULL DEFAULT 1,
  prestige_points INTEGER NOT NULL, placement TEXT NOT NULL CHECK (placement IN ('forecourt','roof','profile','landmark','quay')), effect_json TEXT, available INTEGER NOT NULL DEFAULT 1, unavailable_reason TEXT,
  CHECK (supply_cap IS NULL OR minted <= supply_cap)
);
CREATE TABLE prestige_owned (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES prestige_items(id), owner_id TEXT NOT NULL, serial INTEGER NOT NULL, acquired_tick INTEGER NOT NULL, acquired_how TEXT NOT NULL CHECK (acquired_how IN ('purchase','trade','reward')), price_paid_minor INTEGER NOT NULL,
  listed INTEGER NOT NULL DEFAULT 0, UNIQUE (item_id, serial)
);
CREATE INDEX idx_owned_owner ON prestige_owned(owner_id);
CREATE TABLE prestige_history (id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, owned_id TEXT NOT NULL REFERENCES prestige_owned(id), item_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('purchase','list','unlist','trade','reward')), from_owner TEXT, to_owner TEXT, price_minor INTEGER NOT NULL DEFAULT 0, fee_minor INTEGER NOT NULL DEFAULT 0, ledger_tx_id INTEGER);
CREATE TABLE prestige_listings (id TEXT PRIMARY KEY, owned_id TEXT NOT NULL UNIQUE REFERENCES prestige_owned(id), seller_id TEXT NOT NULL, ask_minor INTEGER NOT NULL CHECK (ask_minor > 0), status TEXT NOT NULL CHECK (status IN ('open','sold','cancelled')), created_tick INTEGER NOT NULL, closed_tick INTEGER, buyer_id TEXT, idempotency_key TEXT UNIQUE);
CREATE TABLE prestige_scores (tick INTEGER NOT NULL, owner_id TEXT NOT NULL, score INTEGER NOT NULL, breakdown_json TEXT NOT NULL, PRIMARY KEY (tick, owner_id));

-- ───────── Boosts and membership ─────────
CREATE TABLE boosts (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('production','marketing')), bps INTEGER NOT NULL CHECK (bps > 0), start_tick INTEGER NOT NULL, end_tick INTEGER NOT NULL, source TEXT NOT NULL CHECK (source IN ('purchase','rewarded_ad','membership')), price_minor INTEGER NOT NULL DEFAULT 0, carry INTEGER NOT NULL DEFAULT 0, idempotency_key TEXT UNIQUE);
CREATE INDEX idx_boosts_owner ON boosts(owner_id, kind, end_tick);
CREATE TABLE memberships (owner_id TEXT PRIMARY KEY, plan TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active','cancelled','expired')), started_tick INTEGER NOT NULL, period_end_tick INTEGER NOT NULL, auto_renew INTEGER NOT NULL DEFAULT 1, price_pence INTEGER NOT NULL, periods_paid INTEGER NOT NULL DEFAULT 0);
CREATE TABLE membership_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, period INTEGER NOT NULL, amount_pence INTEGER NOT NULL, ledger_tx_id INTEGER, tick INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('paid','failed')), provider_ref TEXT NOT NULL UNIQUE, UNIQUE (owner_id, period));

-- ───────── Coin lotteries (Empire Coins only; never redeemable) ─────────
CREATE TABLE lotteries (id TEXT PRIMARY KEY, name TEXT NOT NULL, ticket_price_minor INTEGER NOT NULL CHECK (ticket_price_minor > 0), draw_tick INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('open','drawn','cancelled')), pool_account TEXT NOT NULL, max_per_player INTEGER NOT NULL, rake_bps INTEGER NOT NULL, prizes_json TEXT NOT NULL, tickets_sold INTEGER NOT NULL DEFAULT 0, drawn_tick INTEGER, draw_commit TEXT);
CREATE TABLE lottery_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, lottery_id TEXT NOT NULL REFERENCES lotteries(id), owner_id TEXT NOT NULL, number INTEGER NOT NULL, ledger_tx_id INTEGER NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, UNIQUE (lottery_id, number));
CREATE TABLE lottery_results (id INTEGER PRIMARY KEY AUTOINCREMENT, lottery_id TEXT NOT NULL REFERENCES lotteries(id), place INTEGER NOT NULL, ticket_number INTEGER NOT NULL, owner_id TEXT NOT NULL, prize_minor INTEGER NOT NULL, ledger_tx_id INTEGER, UNIQUE (lottery_id, place));
`;
