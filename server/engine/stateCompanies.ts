import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { ownerInvestor, registerCapital, security } from './capital';
import { createAccount, issue, type TickCtx } from './ledger';
import { CITY_ID, EXCHANGE_ACCOUNT, companyAccount } from '../seed/bristol';
import { STATE_PROVIDERS } from './stateServices';

const E = (ec: number) => Math.round(ec * 100);
interface NewState { id: string; name: string; industry: string; kind: 'service'; employees: number; cash: number; account?: string; district: string; note: string }
const newState = (): NewState[] => [
  { id: STATE_PROVIDERS.logistics.id, name: 'Penny Logistics', industry: 'logistics', kind: 'service', employees: 2, cash: E(3_000), district: 'dist-harbourside', note: 'delivery and goods movement' },
  { id: STATE_PROVIDERS.banking.id, name: 'National Bank', industry: 'bank', kind: 'service', employees: 2, cash: 0, district: 'dist-redcliffe', note: 'business loans and savings' },
  { id: STATE_PROVIDERS.exchange.id, name: 'Penny Exchange', industry: 'exchange', kind: 'service', employees: 1, cash: 0, account: EXCHANGE_ACCOUNT, district: 'dist-redcliffe', note: 'commodity and share exchange' },
];

/**
 * Brings the six state enterprises into existence, idempotently: Penny Energy, Penny Ads and Central Property already trade (they are renamed), and Penny Logistics, National Bank
 * and Penny Exchange are created as ordinary companies with real treasuries, cap tables and wage bills. Returns the coins issued (opening capital, recorded issuances).
 */
export function ensureStateCompanies(db: Sql, ctx: TickCtx, cfg: EngineConfig): number {
  let issued = 0;
  for (const [id, name] of [['co-bristol-energy', 'Penny Energy'], ['co-bristol-media', 'Penny Ads'], ['co-bristol-estates', 'Central Property']] as const) db.run('UPDATE companies SET name = ? WHERE id = ?', name, id);
  for (const k of ['logistics', 'bank', 'exchange']) db.run("INSERT OR IGNORE INTO industries (id, name, kind) VALUES (?, ?, 'service')", k, k === 'logistics' ? 'Delivery and logistics' : k === 'bank' ? 'Banking' : 'Exchange operator');
  const state = ownerInvestor(db, 'state-bristol', 'state');
  for (const s of newState()) {
    if (db.get('SELECT 1 FROM companies WHERE id = ?', s.id)) continue;
    const acct = s.account ?? companyAccount(s.id);
    if (!db.get('SELECT 1 FROM accounts WHERE id = ?', acct)) createAccount(db, acct, 'company', `${s.name} treasury`);
    db.run(`INSERT INTO companies (id, name, city_id, district_id, plot_id, industry_id, asset_id, owner_kind, owner_id, treasury_account_id, level, status, retail_commodity_id, price_minor, min_price_minor, max_price_minor, quality, employees, max_employees, wage_minor, capacity_batches, storage_cap_units, property_minor, marketing_minor, reputation_bps, created_tick)
      VALUES (?,?,?,?,NULL,?,NULL,'state','state-bristol',?,1,'operating',NULL,100,100,100,'standard',?,?,2000,0,1,0,0,9000,0)`, s.id, s.name, CITY_ID, s.district, s.industry, acct, s.employees, s.employees);
    if (!security(db, s.id)) registerCapital(db, ctx, s.id, state, 0, 'genesis cap table');
    if (s.cash > 0) { issue(db, ctx, `seed:co:${s.id}`, acct, s.cash, `opening capital: ${s.name}`); issued += s.cash; }
  }
  for (const [id, t] of [['co-bristol-media', 'PADS'], ['co-penny-logistics', 'PLOG'], ['co-national-bank', 'NBNK'], ['co-penny-exchange', 'PEXC']] as const) db.run("UPDATE securities SET ticker = ? WHERE company_id = ? AND status = 'unlisted' AND listed_tick IS NULL AND NOT EXISTS (SELECT 1 FROM securities s2 WHERE s2.ticker = ?)", t, id, t);
  // National Bank's lending capital: one recorded issuance, the bank's only source of coins besides deposits, repayments and (rule-bound) central bank liquidity.
  const bank = db.get<{ treasury_account_id: string }>('SELECT treasury_account_id FROM companies WHERE id = ?', STATE_PROVIDERS.banking.id);
  if (bank && !db.get("SELECT 1 FROM ledger_transactions WHERE idempotency_key = 'seed:bank:capital'")) { issue(db, ctx, 'seed:bank:capital', bank.treasury_account_id, cfg.bankSeedMinor, 'opening lending capital: National Bank'); issued += cfg.bankSeedMinor; }
  if (!db.get('SELECT 1 FROM central_bank WHERE id = 1')) db.run('INSERT INTO central_bank (id, base_rate_bps, inflation_target_bps, reserve_req_bps, liquidity_step_minor, drain_step_minor, last_review_tick, stance) VALUES (1,?,?,?,?,?,?,?)', cfg.cbBaseRateBps, cfg.cbTargetBps, cfg.cbReserveReqBps, cfg.cbLiquidityStepMinor, cfg.cbDrainStepMinor, ctx.tick, 'neutral');
  if (!db.get("SELECT 1 FROM energy_sources WHERE id = 'src-penny-energy'")) db.run("INSERT INTO energy_sources (id, company_id, name, capacity_units, active) VALUES ('src-penny-energy', ?, 'Penny Energy grid', 0, 1)", STATE_PROVIDERS.energy.id);
  // Existing businesses keep their current rent: one lease each, no service charge (explicit migration rule), starting when the company did.
  for (const c of db.all<{ id: string; plot_id: string | null; lot_id: string | null; premises_tier: number; property_minor: number; created_tick: number }>("SELECT id, plot_id, lot_id, premises_tier, property_minor, created_tick FROM companies WHERE owner_kind <> 'state' AND bankrupt_tick IS NULL AND NOT EXISTS (SELECT 1 FROM leases l WHERE l.company_id = companies.id)")) {
    db.run("INSERT INTO leases (company_id, plot_id, tier, kind, base_rent_minor, service_charge_bps, index_linked, start_tick, status, note) VALUES (?,?,?,'lease',?,0,1,?,'active','migrated: rent unchanged, no service charge, no retroactive fees')", c.id, c.lot_id ?? c.plot_id, c.premises_tier, c.property_minor, c.created_tick);
  }
  return issued;
}
