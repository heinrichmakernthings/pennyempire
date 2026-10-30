import type { Sql } from '../db/sql';
import { balance, reconcile, supply } from '../engine/ledger';
import { loadConfig } from '../engine/config';
import { loansOutstanding, depositsTotal } from '../engine/bank';
import { stateOverview } from './stateApi';
import { STATE_PROVIDERS } from '../engine/stateServices';
import { TREASURY } from '../seed/bristol';

/** Developer economic control panel: every number is read from the ledger and the state-service books. */
export function stateDashboard(db: Sql) {
  const o = stateOverview(db), tick = o.tick, cfg = loadConfig(db);
  const sum = (sql: string, ...a: (string | number)[]) => db.get<{ v: number }>(sql, ...a)!.v;
  const rev30 = (service: string) => sum('SELECT COALESCE(SUM(amount_minor),0) v FROM service_charges WHERE service = ? AND tick > ?', service, tick - 30);
  const s = supply(db), rec = reconcile(db);
  const treasuries = Object.values(STATE_PROVIDERS).map((p) => ({ id: p.id, name: p.name, balanceMinor: db.get<{ b: number }>('SELECT COALESCE((SELECT balance_minor FROM accounts WHERE id = c.treasury_account_id),0) b FROM companies c WHERE c.id = ?', p.id)?.b ?? 0 }));
  const failures = sum("SELECT COUNT(*) v FROM companies WHERE owner_kind <> 'state' AND bankrupt_tick IS NOT NULL");
  const failures30 = sum("SELECT COUNT(*) v FROM companies WHERE owner_kind <> 'state' AND bankrupt_tick IS NOT NULL AND bankrupt_tick > ?", tick - 30);
  const stability = db.get<{ gini_bps: number; company_count: number; households_minor: number }>('SELECT gini_bps, company_count, households_minor FROM stability_stats ORDER BY tick DESC LIMIT 1');
  const ledgerOps = (kind: string) => sum("SELECT COALESCE(SUM(p.amount_minor),0) v FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.kind = ? AND p.amount_minor > 0 AND t.tick > ?", kind, tick - 30);
  return {
    tick, ledger: { reconciles: rec.ok, problems: rec.problems.slice(0, 5) },
    currency: { circulatingMinor: s.circulating, issuedTotalMinor: s.issued, destroyedTotalMinor: s.destroyed, issued30Minor: ledgerOps('issuance'), destroyed30Minor: sum("SELECT COALESCE(SUM(p.amount_minor),0) v FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.kind IN ('sink','sink_fee') AND p.account_id = 'acct:burn' AND t.tick > ?", tick - 30), transferred30Minor: ledgerOps('operating_cost') + ledgerOps('transfer') + ledgerOps('state_payment') + ledgerOps('trade_settlement'), note: 'Transfers are never sinks: coins are destroyed only by explicit burns (sinks) and created only by recorded issuance.' },
    inflation: { indexBps: o.inflation.indexBps, change30dBps: o.inflation.change30dBps, components: o.inflation.components?.relative ?? null, targetBps: o.centralBank.inflationTargetBps },
    centralBank: { baseRateBps: o.centralBank.baseRateBps, stance: o.centralBank.stance, ruleEnabled: o.centralBank.ruleEnabled, nextReviewTick: o.centralBank.nextReviewTick, recent: o.centralBank.policyLog.slice(0, 8), liquidityOps: o.money.monetaryOps },
    stateCompanies: { treasuries, revenue30Minor: { energy: rev30('energy'), advertising: rev30('advertising'), logistics: rev30('logistics'), property: rev30('property'), banking: rev30('banking'), exchange: rev30('exchange') }, stateTreasuryMinor: balance(db, TREASURY), providers: o.providers },
    banking: { loansOutstandingMinor: loansOutstanding(db), depositsMinor: depositsTotal(db), businessDebtMinor: sum("SELECT COALESCE(SUM(outstanding_minor),0) v FROM loans WHERE status IN ('active','defaulted')"), defaulted: sum("SELECT COUNT(*) v FROM loans WHERE status = 'defaulted'"), writeOffs30Minor: sum('SELECT COALESCE(SUM(written_off_minor),0) v FROM credit_defaults WHERE tick > ?', tick - 30), bank: o.bank },
    energy: o.energy, logistics: o.logistics,
    advertising: { spend7Minor: sum('SELECT COALESCE(SUM(spend_minor),0) v FROM ad_daily WHERE tick > ?', tick - 7), spend30Minor: sum('SELECT COALESCE(SUM(spend_minor),0) v FROM ad_daily WHERE tick > ?', tick - 30), activeCampaigns: sum("SELECT COUNT(*) v FROM ad_campaigns WHERE status = 'active'") },
    property: { revenue30Minor: rev30('property'), activeLeases: sum("SELECT COUNT(*) v FROM leases WHERE status = 'active' AND kind = 'lease'"), owned: sum("SELECT COUNT(*) v FROM leases WHERE status = 'active' AND kind = 'owned'") },
    events: { active: o.events.active, list: o.events.list.slice(0, 12) },
    stability: { bankruptciesTotal: failures, bankruptcies30: failures30, operatingCompanies: stability?.company_count ?? null, giniBps: stability?.gini_bps ?? null, householdCashMinor: stability?.households_minor ?? null, failedTransactions: sum('SELECT COUNT(*) v FROM failed_transactions') },
    config: { exchangeFeeBps: cfg.exchangeFeeBps, exchangeBurnBps: cfg.exchangeBurnBps, stateServiceBurnBps: cfg.stateServiceBurnBps, eventsEnabled: cfg.eventsEnabled },
  };
}
