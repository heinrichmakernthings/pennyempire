import type { Sql } from '../db/sql';
import { CLEARING, EXP, PAYABLE, PRIZE_RESERVE, REV, EQUITY, balanceOf, reconcileGbp } from './gbpLedger';
import { cashPence, freeCashPence, prizeReservePence } from './gbpWallet';

/**
 * Commercial model. Two strictly separate things:
 *  • the LEDGER view — what has actually been recorded (in this build only simulated, developer-entered amounts: no real payment, advertisement or subscription has occurred); and
 *  • the SCENARIO view — a transparent calculation from assumptions the developer sets. It is not a forecast and nothing in it is booked anywhere.
 * Player deposits are liabilities, never revenue.
 */
export interface Assumptions {
  name: string; monthlyActivePlayers: number; adImpressionsPerPlayerMonth: number; adEcpmPence: number;            // eCPM: pence earned per 1,000 display impressions
  rewardedViewsPerPlayerMonth: number; rewardedEcpmPence: number; premiumConversionBps: number; premiumPricePence: number; cosmeticArpuPence: number;
  paymentFeeBps: number; paymentFeeFixedPence: number; rewardAllocationBps: number;                                 // share of NET revenue reserved for player rewards
  withdrawalPlayersBps: number; avgWithdrawalPence: number; hostingFixedPence: number; hostingPerPlayerPence: number; otherOpexPence: number;
}
export const SCENARIOS: Assumptions[] = [
  { name: 'Cautious', monthlyActivePlayers: 500, adImpressionsPerPlayerMonth: 120, adEcpmPence: 120, rewardedViewsPerPlayerMonth: 6, rewardedEcpmPence: 600, premiumConversionBps: 100, premiumPricePence: 299, cosmeticArpuPence: 5, paymentFeeBps: 140, paymentFeeFixedPence: 20, rewardAllocationBps: 1_500, withdrawalPlayersBps: 200, avgWithdrawalPence: 500, hostingFixedPence: 2_500, hostingPerPlayerPence: 1, otherOpexPence: 1_000 },
  { name: 'Base', monthlyActivePlayers: 5_000, adImpressionsPerPlayerMonth: 200, adEcpmPence: 200, rewardedViewsPerPlayerMonth: 10, rewardedEcpmPence: 1_000, premiumConversionBps: 250, premiumPricePence: 299, cosmeticArpuPence: 10, paymentFeeBps: 140, paymentFeeFixedPence: 20, rewardAllocationBps: 2_500, withdrawalPlayersBps: 400, avgWithdrawalPence: 700, hostingFixedPence: 5_000, hostingPerPlayerPence: 1, otherOpexPence: 5_000 },
  { name: 'Optimistic', monthlyActivePlayers: 50_000, adImpressionsPerPlayerMonth: 300, adEcpmPence: 350, rewardedViewsPerPlayerMonth: 15, rewardedEcpmPence: 1_600, premiumConversionBps: 400, premiumPricePence: 299, cosmeticArpuPence: 20, paymentFeeBps: 140, paymentFeeFixedPence: 20, rewardAllocationBps: 3_000, withdrawalPlayersBps: 600, avgWithdrawalPence: 900, hostingFixedPence: 40_000, hostingPerPlayerPence: 1, otherOpexPence: 40_000 },
];
export interface ScenarioResult {
  assumptions: Assumptions; label: 'ASSUMPTION-BASED SCENARIO — NOT A FORECAST, NOTHING BOOKED';
  grossAdPence: number; grossRewardedAdPence: number; grossPremiumPence: number; grossCosmeticPence: number; grossRevenuePence: number; paymentFeesPence: number; netRevenuePence: number;
  hostingPence: number; opexPence: number; operatingProfitPence: number; operatingMarginBps: number; arppuPence: number; arpuPence: number;
  rewardBudgetPence: number; sustainableRewardBudgetPence: number; rewardLiabilityPence: number; cashNeededForWithdrawalsPence: number; withdrawalsCoveredByRewardBudget: boolean; warnings: string[];
}
const r = Math.round;
export function simulate(a: Assumptions): ScenarioResult {
  const warnings: string[] = [];
  const ad = r((a.monthlyActivePlayers * a.adImpressionsPerPlayerMonth * a.adEcpmPence) / 1_000), rewarded = r((a.monthlyActivePlayers * a.rewardedViewsPerPlayerMonth * a.rewardedEcpmPence) / 1_000);
  const subs = r((a.monthlyActivePlayers * a.premiumConversionBps) / 10_000), premium = subs * a.premiumPricePence, cosmetic = a.monthlyActivePlayers * a.cosmeticArpuPence;
  const gross = ad + rewarded + premium + cosmetic;
  const feeOn = premium + cosmetic, fees = r((feeOn * a.paymentFeeBps) / 10_000) + (subs + (a.cosmeticArpuPence > 0 ? r(a.monthlyActivePlayers * 0.05) : 0)) * a.paymentFeeFixedPence;   // card fees apply to paid purchases only
  const net = gross - fees, hosting = a.hostingFixedPence + a.monthlyActivePlayers * a.hostingPerPlayerPence, opex = a.otherOpexPence;
  const profit = net - hosting - opex;
  const rewardBudget = Math.max(0, r((net * a.rewardAllocationBps) / 10_000)), sustainable = Math.max(0, Math.min(rewardBudget, profit));      // never budget more than the operating profit can bear
  const wdPlayers = r((a.monthlyActivePlayers * a.withdrawalPlayersBps) / 10_000), cashNeeded = wdPlayers * a.avgWithdrawalPence;
  if (profit < 0) warnings.push('Operating loss: no reward budget is sustainable.'); if (cashNeeded > sustainable) warnings.push('Expected withdrawals exceed the sustainable reward budget: payouts would need funding from reserves.');
  if (a.rewardedEcpmPence > 2_000 || a.adEcpmPence > 600) warnings.push('eCPM assumptions are high; real figures vary widely by region, format and fill rate.');
  return { assumptions: a, label: 'ASSUMPTION-BASED SCENARIO — NOT A FORECAST, NOTHING BOOKED', grossAdPence: ad, grossRewardedAdPence: rewarded, grossPremiumPence: premium, grossCosmeticPence: cosmetic, grossRevenuePence: gross, paymentFeesPence: fees, netRevenuePence: net, hostingPence: hosting, opexPence: opex, operatingProfitPence: profit,
    operatingMarginBps: gross > 0 ? r((profit * 10_000) / gross) : 0, arppuPence: a.monthlyActivePlayers ? r(net / a.monthlyActivePlayers) : 0, arpuPence: a.monthlyActivePlayers ? r(gross / a.monthlyActivePlayers) : 0,
    rewardBudgetPence: rewardBudget, sustainableRewardBudgetPence: sustainable, rewardLiabilityPence: Math.min(rewardBudget, sustainable), cashNeededForWithdrawalsPence: cashNeeded, withdrawalsCoveredByRewardBudget: cashNeeded <= sustainable, warnings };
}
export const assumptionsFor = (db: Sql): Assumptions[] => { const row = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'commercial_assumptions'"); return row ? (JSON.parse(row.value) as Assumptions[]) : SCENARIOS; };
export const setAssumptions = (db: Sql, list: Assumptions[]) => db.run("INSERT INTO meta (key, value) VALUES ('commercial_assumptions', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(list));

/** What the books actually say. Separates player funds held, business revenue, awarded rewards, outstanding liabilities and operating profit. */
export function treasuryView(db: Sql) {
  const rec = reconcileGbp(db); const b = (a: string) => balanceOf(db, a);
  const revenue = { advertising: 0 - b(REV.advertising), premium: 0 - b(REV.premium), cosmetic: 0 - b(REV.cosmetic) }; const revenueTotal = revenue.advertising + revenue.premium + revenue.cosmetic;
  const expenses = { paymentFees: b(EXP.fees), hosting: b(EXP.hosting) }; const expTotal = expenses.paymentFees + expenses.hosting;
  const sum = (kind: string) => db.get<{ s: number }>("SELECT COALESCE(SUM(p.amount_pence),0) s FROM gbp_postings p JOIN gbp_transactions t ON t.id = p.tx_id WHERE t.kind = ? AND t.status = 'posted' AND p.amount_pence > 0", kind)!.s;
  const wd = db.get<{ n: number; s: number }>("SELECT COUNT(*) n, COALESCE(SUM(amount_pence),0) s FROM gbp_withdrawals WHERE status IN ('requested','approved')")!;
  const imp = db.get<{ s: number }>('SELECT COALESCE(SUM(count),0) s FROM ad_impressions')!.s;
  const programs = db.all<{ id: string; name: string; budget_pence: number; spent_pence: number; funded_pence: number; active: number }>('SELECT id, name, budget_pence, spent_pence, funded_pence, active FROM reward_programs ORDER BY id');
  return {
    mode: 'SIMULATED' as const, reconciles: rec.ok, problems: rec.problems, transactions: rec.transactions,
    playerFunds: { walletLiabilitiesPence: rec.totals.walletLiabilities, pendingWithdrawalsPence: rec.totals.pendingLiabilities, pendingWithdrawalCount: wd.n, note: 'Money owed to players. Not revenue.' },
    cash: { heldPence: cashPence(db), payoutClearingPence: b(CLEARING), businessFreeCashPence: freeCashPence(db), coverageOfPlayerFundsPence: cashPence(db) + b(CLEARING) - rec.totals.walletLiabilities - rec.totals.pendingLiabilities },
    revenue: { ...revenue, totalPence: revenueTotal, note: 'Only simulated, recorded amounts. No real payment, advertisement or subscription has occurred.' },
    expenses: { ...expenses, totalPence: expTotal, owedToProcessorPence: 0 - b(PAYABLE) },
    operatingProfitPence: revenueTotal - expTotal,
    rewards: { issuedPence: sum('reward'), reservePence: prizeReservePence(db), reserveAccountPence: 0 - b(PRIZE_RESERVE), programs: programs.map((p) => ({ id: p.id, name: p.name, budgetPence: p.budget_pence, spentPence: p.spent_pence, fundedPence: p.funded_pence, remainingPence: p.budget_pence - p.spent_pence, active: p.active === 1 })), note: 'Funded from the restricted prize reserve (developer-funded in this simulation), never from player deposits.' },
    ownerEquityPence: 0 - b(EQUITY), depositsTotalPence: db.get<{ s: number }>("SELECT COALESCE(SUM(amount_pence),0) s FROM gbp_deposits WHERE status = 'succeeded'")!.s,
    impressions: { total: imp, estimatedRevenuePence: null, note: 'Simulated placements. No advertising revenue is booked from them; the commercial scenarios below use assumptions instead.' },
    scenarios: assumptionsFor(db).map(simulate),
  };
}
