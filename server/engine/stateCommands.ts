import { cancelCampaign, startCampaign, type AdKind } from './ads';
import { depositFunds, repayLoan, takeLoan, withdrawFunds } from './bank';
import { buyPremises } from './property';
import { loadConfig } from './config';
import { err, isErr, owned, runCommand, type CommandResponse } from './commands';
import type { Sql } from '../db/sql';

/** Player commands for the state services. Every one goes through runCommand (idempotency key, one transaction, rejection log) and the shared engine functions the NPCs use. */
const ok = (revision: number, data: Record<string, unknown> = {}): CommandResponse => ({ ok: true, revision, transactionId: '', refreshScreens: ['city', 'companies', 'wallet'], data });

export function startAd(db: Sql, key: string, a: { companyId: string; kind: AdKind; tier: number; days: number }): CommandResponse {
  return runCommand(db, key, 'ad.start', (ctx) => { const c = owned(db, a.companyId); if (isErr(c)) return c; const r = startCampaign(db, ctx, loadConfig(db), { ...a, key: `cmd:${key}` }); return ok(c.revision, { campaignId: r.id, dailyMinor: r.dailyMinor }); });
}
export function cancelAd(db: Sql, key: string, companyId: string, campaignId: string): CommandResponse {
  return runCommand(db, key, 'ad.cancel', (ctx) => { const c = owned(db, companyId); if (isErr(c)) return c; cancelCampaign(db, ctx, companyId, campaignId); return ok(c.revision); });
}
export function takeBankLoan(db: Sql, key: string, a: { companyId: string; amountMinor: number; termDays: number }): CommandResponse {
  return runCommand(db, key, 'loan.take', (ctx) => { const c = owned(db, a.companyId); if (isErr(c)) return c; const r = takeLoan(db, ctx, loadConfig(db), { ...a, key: `cmd:${key}`, purpose: 'player loan' }); return ok(c.revision, { loanId: r.loanId }); });
}
export function repayBankLoan(db: Sql, key: string, a: { companyId: string; loanId: string; amountMinor: number }): CommandResponse {
  return runCommand(db, key, 'loan.repay', (ctx) => { const c = owned(db, a.companyId); if (isErr(c)) return c; const r = repayLoan(db, ctx, { ...a, key }); return ok(c.revision, { paidMinor: r.paidMinor, outstandingMinor: r.outstandingMinor }); });
}
export function bankDeposit(db: Sql, key: string, a: { companyId: string; amountMinor: number }): CommandResponse {
  return runCommand(db, key, 'bank.deposit', (ctx) => { const c = owned(db, a.companyId); if (isErr(c)) return c; depositFunds(db, ctx, { ...a, key }); return ok(c.revision); });
}
export function bankWithdraw(db: Sql, key: string, a: { companyId: string; amountMinor: number }): CommandResponse {
  return runCommand(db, key, 'bank.withdraw', (ctx) => { const c = owned(db, a.companyId); if (isErr(c)) return c; withdrawFunds(db, ctx, { ...a, key }); return ok(c.revision); });
}
export function buyPremisesCmd(db: Sql, key: string, companyId: string): CommandResponse {
  return runCommand(db, key, 'property.buy', (ctx) => { const c = owned(db, companyId); if (isErr(c)) return c; const r = buyPremises(db, ctx, loadConfig(db), companyId, `cmd:${key}`); return ok(c.revision, { priceMinor: r.priceMinor }); });
}
export { err };
