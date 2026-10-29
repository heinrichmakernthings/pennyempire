import type { Sql } from '../db/sql';
import { loadConfig } from '../engine/config';
import { adReport } from '../engine/ads';
import { bankReport, creditProfile, depositRate, effectiveRate, loansOutstanding, quoteLoan, type LoanRow } from '../engine/bank';
import { centralBank } from '../engine/centralBank';
import { currentMods } from '../engine/economyState';
import { energyReport } from '../engine/energy';
import { listEvents } from '../engine/events';
import { BASKET, latestCpi } from '../engine/inflation';
import { logisticsReport } from '../engine/logistics';
import { activeLease, purchasePrice, rentCharge } from '../engine/property';
import { STATE_PROVIDERS, providerReport, type ServiceKind } from '../engine/stateServices';
import { balance } from '../engine/ledger';
import { PLAYER_ID } from '../seed/bristol';

const tickOf = (db: Sql) => db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
const SERVICES: ServiceKind[] = ['energy', 'advertising', 'logistics', 'property', 'banking', 'exchange'];

/** The state-economy overview: every figure is read from the books (service charges, treasuries, loans, CPI, policy log, event log). */
export function stateOverview(db: Sql) {
  const tick = tickOf(db), cfg = loadConfig(db), cb = centralBank(db), mods = currentMods(db), cpi = latestCpi(db);
  const baseTariff = db.get<{ p: number }>('SELECT reference_price_minor p FROM commodities WHERE id = ?', cfg.energyCommodityId)?.p ?? 0;
  const money = db.get<{ circulating_minor: number; issued_tick_minor: number; destroyed_tick_minor: number; transferred_tick_minor: number; savings_minor: number; credit_issued_tick_minor: number; state_treasury_minor: number; consumer_spend_minor: number; trading_value_minor: number }>('SELECT * FROM monetary_stats ORDER BY tick DESC LIMIT 1');
  const supplyTotals = db.get<{ issued: number; destroyed: number }>("SELECT COALESCE((SELECT SUM(amount_minor) FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.kind = 'issuance' AND p.amount_minor > 0),0) issued, COALESCE((SELECT SUM(p.amount_minor) FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.kind IN ('sink','sink_fee') AND p.account_id = 'acct:burn'),0) destroyed")!;
  return {
    tick,
    myCompanies: db.all<{ id: string; name: string }>("SELECT id, name FROM companies WHERE owner_kind = 'player' AND owner_id = ? AND bankrupt_tick IS NULL ORDER BY name", PLAYER_ID),
    providers: SERVICES.map((s) => providerReport(db, s, tick)).filter(Boolean),
    energy: energyReport(db, cfg, baseTariff),
    logistics: logisticsReport(db, cfg, tick),
    bank: bankReport(db, cfg, tick),
    centralBank: { baseRateBps: cb.base_rate_bps, inflationTargetBps: cb.inflation_target_bps, reserveRequirementBps: cb.reserve_req_bps, stance: cb.stance, ruleEnabled: cb.rule_enabled === 1, lastReviewTick: cb.last_review_tick, nextReviewTick: cb.last_review_tick + cfg.cbReviewEveryTicks, depositRateBps: depositRate(db, cfg), policyLog: db.all('SELECT tick, actor, kind, old_value oldValue, new_value newValue, reason, inflation_bps inflationBps FROM policy_log ORDER BY id DESC LIMIT 20') },
    inflation: {
      method: 'Fixed-weight basket of posted shop prices, the electricity tariff, average rent and wholesale food prices, each relative to its first observation. Money supply is shown separately and never feeds the index.',
      basket: BASKET, indexBps: cpi?.index_bps ?? 10_000, change30dBps: cpi?.change_30d_bps ?? 0, components: cpi ? (JSON.parse(cpi.components_json) as { relative: Record<string, number>; prices: Record<string, number> }) : null,
      history: db.all('SELECT tick, index_bps indexBps, change_30d_bps change30dBps FROM cpi_index ORDER BY tick DESC LIMIT 60').reverse(),
    },
    money: { latest: money ?? null, issuedTotalMinor: supplyTotals.issued, destroyedTotalMinor: supplyTotals.destroyed, loansOutstandingMinor: loansOutstanding(db), monetaryOps: db.all('SELECT tick, kind, amount_minor amountMinor, reason FROM monetary_ops ORDER BY id DESC LIMIT 10'), history: db.all('SELECT tick, circulating_minor circulatingMinor, issued_tick_minor issuedMinor, destroyed_tick_minor destroyedMinor, transferred_tick_minor transferredMinor, consumer_spend_minor consumerSpendMinor, savings_minor savingsMinor, loans_outstanding_minor loansMinor, base_rate_bps baseRateBps, cpi_bps cpiBps FROM monetary_stats ORDER BY tick DESC LIMIT 60').reverse() },
    events: { active: mods.active, modifiers: { ...mods, active: undefined }, list: listEvents(db, 25), log: db.all('SELECT l.tick, l.event_id eventId, l.action, l.detail_json detail FROM eco_event_log l ORDER BY l.id DESC LIMIT 30').map((r: any) => ({ ...r, detail: JSON.parse(r.detail) })) },
  };
}

/** What the player's company pays the state, its premises, advertising and credit position. */
export function companyServices(db: Sql, companyId: string) {
  const c = db.get<{ id: string; name: string; owner_kind: string; owner_id: string; property_minor: number; marketing_minor: number; treasury_account_id: string }>('SELECT id, name, owner_kind, owner_id, property_minor, marketing_minor, treasury_account_id FROM companies WHERE id = ?', companyId);
  if (!c) return null;
  const cfg = loadConfig(db), tick = tickOf(db);
  const spend = (days: number) => db.all<{ service: string; a: number }>('SELECT service, COALESCE(SUM(amount_minor),0) a FROM service_charges WHERE payer_id = ? AND tick > ? GROUP BY service', companyId, tick - days).reduce<Record<string, number>>((m, r) => { m[r.service] = r.a; return m; }, {});
  const lease = activeLease(db, companyId), rent = rentCharge(db, cfg, { id: c.id, owner_kind: c.owner_kind as 'player', property_minor: c.property_minor });
  const loans = db.all<LoanRow>('SELECT * FROM loans WHERE borrower_id = ? ORDER BY start_tick DESC LIMIT 10', companyId).map((l) => ({ ...l, effectiveRateBps: l.status === 'repaid' ? 0 : effectiveRate(db, l) }));
  const profile = creditProfile(db, cfg, companyId, tick);
  return {
    companyId, name: c.name, spend7: spend(7), spend30: spend(30),
    premises: { lease, rent, purchasePriceMinor: lease && lease.kind === 'lease' ? purchasePrice(cfg, lease) : null, history: db.all('SELECT id, kind, tier, base_rent_minor baseRentMinor, service_charge_bps serviceChargeBps, start_tick startTick, end_tick endTick, status, purchase_price_minor purchasePriceMinor, note FROM leases WHERE company_id = ? ORDER BY id DESC LIMIT 10', companyId) },
    advertising: adReport(db, cfg, companyId, tick),
    credit: { profile, loans, deposit: db.get('SELECT balance_minor balanceMinor, interest_paid_minor interestPaidMinor FROM bank_deposits WHERE company_id = ?', companyId) ?? { balanceMinor: 0, interestPaidMinor: 0 }, depositRateBps: depositRate(db, cfg), payments: db.all('SELECT p.tick, p.loan_id loanId, p.due_minor dueMinor, p.principal_minor principalMinor, p.interest_minor interestMinor, p.fee_minor feeMinor, p.status FROM loan_payments p JOIN loans l ON l.id = p.loan_id WHERE l.borrower_id = ? ORDER BY p.id DESC LIMIT 20', companyId) },
    cashMinor: balance(db, c.treasury_account_id), isPlayerOwned: c.owner_kind === 'player' && c.owner_id === PLAYER_ID,
  };
}
export const loanQuote = (db: Sql, companyId: string, amount: number, termDays: number) => quoteLoan(db, loadConfig(db), companyId, amount, termDays, tickOf(db));
export { STATE_PROVIDERS };
