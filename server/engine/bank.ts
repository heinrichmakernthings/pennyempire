import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { currentMods } from './economyState';
import { LedgerError, available, transfer, type TickCtx } from './ledger';
import { logEvent } from './stats';
import { STATE_PROVIDERS, chargeService, providerOf, recordPaidService } from './stateServices';

/**
 * National Bank. A real company with a real treasury: it lends ONLY coins it holds. There is no minting on request — a loan moves coins bank → borrower (a transfer),
 * repayments move principal and interest back, deposits are coins sitting in the bank's treasury with a matching liability. The central bank may add or drain liquidity,
 * but only under its published rule (see centralBank.ts), never because someone asked for a loan.
 *
 * Rates are FLOATING: effective rate = central bank base rate + the loan's credit spread (+ any credit-crunch event spread). A "Penny year" is 100 days, so a 6% rate costs
 * 0.06% of the outstanding balance a day. Repayment is equal principal instalments + daily interest on the outstanding balance, so principal and interest are always separate.
 */
export const GAME_YEAR_DAYS = 100;
export type Grade = 'A' | 'B' | 'C' | 'D';
export interface LoanRow { id: string; borrower_id: string; principal_minor: number; outstanding_minor: number; rate_bps: number; term_days: number; start_tick: number; daily_principal_minor: number; grade: Grade; status: 'active' | 'repaid' | 'defaulted'; missed: number; interest_paid_minor: number; fees_paid_minor: number; written_off_minor: number; origination_fee_minor: number; purpose: string | null; closed_tick: number | null }

export const baseRate = (db: Sql) => db.get<{ r: number }>('SELECT base_rate_bps r FROM central_bank WHERE id = 1')?.r ?? 0;
const spreadOf = (cfg: EngineConfig, g: Grade) => ({ A: cfg.creditSpreadABps, B: cfg.creditSpreadBBps, C: cfg.creditSpreadCBps, D: cfg.creditSpreadCBps * 2 })[g];
/** The rate a loan is paying today: floating, so a central bank rise reaches every existing borrower. */
export const effectiveRate = (db: Sql, loan: Pick<LoanRow, 'rate_bps'>) => baseRate(db) + loan.rate_bps + currentMods(db).creditSpreadBps;
export const depositRate = (db: Sql, cfg: EngineConfig) => Math.max(0, baseRate(db) - cfg.depositSpreadBps);
export const interestFor = (outstanding: number, rateBps: number) => Math.round((outstanding * rateBps) / (10_000 * GAME_YEAR_DAYS));
const bankAcct = (db: Sql) => providerOf(db, 'banking')!.treasury;
export const depositsTotal = (db: Sql) => db.get<{ d: number }>('SELECT COALESCE(SUM(balance_minor),0) d FROM bank_deposits')!.d;
export const loansOutstanding = (db: Sql) => db.get<{ l: number }>("SELECT COALESCE(SUM(outstanding_minor),0) l FROM loans WHERE status IN ('active','defaulted')")!.l;
/** Coins the bank may lend today: its cash minus the central bank's reserve requirement on deposits. */
export const lendable = (db: Sql, cfg: EngineConfig) => Math.max(0, available(db, bankAcct(db)) - Math.floor((depositsTotal(db) * cfg.cbReserveReqBps) / 10_000));

export interface CreditProfile { grade: Grade; score: number; meanProfitMinor: number; limitMinor: number; availableMinor: number; outstandingMinor: number; spreadBps: number; rateBps: number; dailyServiceMinor: number; reasons: string[] }
/** Creditworthiness read from the company's real books: age, profit history, arrears, past defaults and missed instalments. */
export function creditProfile(db: Sql, cfg: EngineConfig, companyId: string, tick: number): CreditProfile {
  const c = db.get<{ status: string; unpaid_minor: number; shortfall_ticks: number; created_tick: number; owner_kind: string; bankrupt_tick: number | null }>('SELECT status, unpaid_minor, shortfall_ticks, created_tick, owner_kind, bankrupt_tick FROM companies WHERE id = ?', companyId);
  const reasons: string[] = [];
  const out = db.get<{ o: number; d: number }>("SELECT COALESCE(SUM(outstanding_minor),0) o, COALESCE(SUM(daily_principal_minor),0) d FROM loans WHERE borrower_id = ? AND status IN ('active','defaulted')", companyId)!;
  const rows = db.all<{ net: number }>('SELECT net_profit_minor net FROM company_tick_stats WHERE company_id = ? AND tick > 0 AND tick <= ? ORDER BY tick DESC LIMIT 14', companyId, tick);
  const mean = rows.length ? Math.round(rows.reduce((a, r) => a + r.net, 0) / rows.length) : 0;
  const age = c ? tick - c.created_tick : 0;
  const defaulted = db.get<{ n: number }>("SELECT COUNT(*) n FROM loans WHERE borrower_id = ? AND (status = 'defaulted' OR (written_off_minor > 0))", companyId)!.n;
  const recentMiss = db.get<{ n: number }>("SELECT COUNT(*) n FROM loan_payments p JOIN loans l ON l.id = p.loan_id WHERE l.borrower_id = ? AND p.status IN ('missed','partial') AND p.tick > ?", companyId, tick - 30)!.n;
  let grade: Grade = 'C';
  if (!c || c.owner_kind === 'state') { grade = 'D'; reasons.push('State enterprises do not borrow from the National Bank.'); }
  else {
    if (c.status !== 'operating' || c.bankrupt_tick !== null) { grade = 'D'; reasons.push('The company is not operating.'); }
    if (c.unpaid_minor > 0 || c.shortfall_ticks > 0) { grade = 'D'; reasons.push('The company has unpaid bills.'); }
    if (defaulted > 0) { grade = 'D'; reasons.push('A previous loan defaulted.'); }
    if (rows.length < 7) { grade = 'D'; reasons.push('Fewer than 7 days of trading history.'); }
    else if (mean <= 0) { grade = 'D'; reasons.push('Average daily profit over the last 14 days is not positive.'); }
    if (grade !== 'D') {
      if (age >= 30 && recentMiss === 0 && rows.length >= 14) { grade = 'A'; reasons.push('Established (30+ days), profitable, no missed repayments.'); }
      else if (age >= 14 && recentMiss === 0) { grade = 'B'; reasons.push('Profitable for two weeks or more.'); }
      else { grade = 'C'; reasons.push(recentMiss > 0 ? 'A repayment was missed in the last 30 days.' : 'A young but profitable business.'); }
    }
  }
  const mult = grade === 'A' ? cfg.creditMultipleA : grade === 'B' ? cfg.creditMultipleB : grade === 'C' ? cfg.creditMultipleC : 0;
  const raw = Math.min(cfg.loanMaxMinor, mean * mult), limit = Math.max(0, Math.floor((raw * currentMods(db).creditLimitBps) / 10_000));
  const spread = spreadOf(cfg, grade), rate = baseRate(db) + spread + currentMods(db).creditSpreadBps;
  const service = out.d + interestFor(out.o, rate);
  return { grade, score: ({ A: 800, B: 650, C: 500, D: 300 })[grade] + Math.max(-100, Math.min(100, Math.round(mean / 100))), meanProfitMinor: mean, limitMinor: limit, availableMinor: grade === 'D' ? 0 : Math.max(0, limit - out.o), outstandingMinor: out.o, spreadBps: spread, rateBps: rate, dailyServiceMinor: service, reasons };
}

export interface LoanQuote { amountMinor: number; termDays: number; rateBps: number; dailyPrincipalMinor: number; firstDayInterestMinor: number; originationFeeMinor: number; totalInterestEstimateMinor: number; grade: Grade }
export function quoteLoan(db: Sql, cfg: EngineConfig, companyId: string, amount: number, termDays: number, tick: number): LoanQuote & { refusal: string | null } {
  const p = creditProfile(db, cfg, companyId, tick);
  const dailyPrincipal = Math.ceil(amount / Math.max(1, termDays));
  const fee = Math.ceil((amount * cfg.loanOriginationFeeBps) / 10_000);
  let refusal: string | null = null;
  if (!Number.isInteger(amount) || amount <= 0) refusal = 'Enter a loan amount.';
  else if (!Number.isInteger(termDays) || termDays < 7 || termDays > cfg.loanMaxTermDays) refusal = `Loans run for 7–${cfg.loanMaxTermDays} days.`;
  else if (p.grade === 'D') refusal = `The National Bank declined: ${p.reasons.join(' ')}`;
  else if (db.get<{ n: number }>("SELECT COUNT(*) n FROM loans WHERE borrower_id = ? AND status IN ('active','defaulted')", companyId)!.n >= cfg.loanMaxActive) refusal = `A company can hold at most ${cfg.loanMaxActive} loans at once.`;
  else if (amount > p.availableMinor) refusal = `Your credit limit allows ${(p.availableMinor / 100).toFixed(2)} EC more (grade ${p.grade}, based on ${(p.meanProfitMinor / 100).toFixed(2)} EC average daily profit).`;
  else if (p.dailyServiceMinor + dailyPrincipal + interestFor(amount, p.rateBps) > p.meanProfitMinor) refusal = 'Repayments would exceed your average daily profit: the bank will not lend more than you can service.';
  else if (amount > lendable(db, cfg)) refusal = 'The National Bank has no lending capacity today. Try again later.';
  return { amountMinor: amount, termDays, rateBps: p.rateBps, dailyPrincipalMinor: dailyPrincipal, firstDayInterestMinor: interestFor(amount, p.rateBps), originationFeeMinor: fee, totalInterestEstimateMinor: Math.round(interestFor(amount, p.rateBps) * termDays / 2), grade: p.grade, refusal };
}

export function takeLoan(db: Sql, ctx: TickCtx, cfg: EngineConfig, a: { companyId: string; amountMinor: number; termDays: number; key: string; purpose?: string }): { loanId: string; duplicate: boolean } {
  const dup = db.get<{ id: string }>('SELECT id FROM loans WHERE idempotency_key = ?', a.key); if (dup) return { loanId: dup.id, duplicate: true };
  const q = quoteLoan(db, cfg, a.companyId, a.amountMinor, a.termDays, ctx.tick);
  if (q.refusal) throw new LedgerError('FORBIDDEN', q.refusal);
  const c = db.get<{ name: string; treasury_account_id: string }>('SELECT name, treasury_account_id FROM companies WHERE id = ?', a.companyId)!;
  const prof = creditProfile(db, cfg, a.companyId, ctx.tick);
  const id = `loan-${ctx.tick}-${db.get<{ n: number }>('SELECT COUNT(*) n FROM loans')!.n + 1}`;
  const tx = transfer(db, ctx, `loan:${id}:disburse`, bankAcct(db), c.treasury_account_id, a.amountMinor, 'transfer', `National Bank loan to ${c.name}`);
  db.run("INSERT INTO loans (id, borrower_id, principal_minor, outstanding_minor, rate_bps, term_days, start_tick, daily_principal_minor, grade, status, origination_fee_minor, disbursement_tx_id, purpose, idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,'active',?,?,?,?)",
    id, a.companyId, a.amountMinor, a.amountMinor, prof.spreadBps, a.termDays, ctx.tick, q.dailyPrincipalMinor, prof.grade, q.originationFeeMinor, tx.txId, a.purpose ?? null, a.key);
  if (q.originationFeeMinor > 0) chargeService(db, ctx, { service: 'banking', payerAccount: c.treasury_account_id, payerCompanyId: a.companyId, amount: q.originationFeeMinor, ref: `loan:${id}:fee`, key: `loan:${id}:fee`, memo: `loan origination fee: ${c.name}` });
  logEvent(db, ctx.tick, 'loan_made', 'info', a.companyId, `${c.name} borrowed ${(a.amountMinor / 100).toFixed(2)} EC from the National Bank for ${a.termDays} days at ${(q.rateBps / 100).toFixed(2)}% (grade ${prof.grade})`, { loanId: id, amountMinor: a.amountMinor });
  return { loanId: id, duplicate: false };
}

/** Voluntary early repayment of principal (interest is paid daily, so there is nothing else to settle). */
export function repayLoan(db: Sql, ctx: TickCtx, a: { loanId: string; companyId: string; amountMinor: number; key: string }): { paidMinor: number; outstandingMinor: number; duplicate: boolean } {
  const loan = db.get<LoanRow>('SELECT * FROM loans WHERE id = ? AND borrower_id = ?', a.loanId, a.companyId); if (!loan) throw new LedgerError('FORBIDDEN', 'No such loan.');
  const k = `loan:${loan.id}:prepay:${a.key}`;
  if (db.get('SELECT 1 FROM ledger_transactions WHERE idempotency_key = ?', k)) return { paidMinor: 0, outstandingMinor: loan.outstanding_minor, duplicate: true };
  if (loan.status === 'repaid') throw new LedgerError('FORBIDDEN', 'This loan is already repaid.');
  if (!Number.isInteger(a.amountMinor) || a.amountMinor <= 0) throw new LedgerError('INVALID_AMOUNT', 'Enter an amount to repay.');
  const c = db.get<{ treasury_account_id: string; name: string }>('SELECT treasury_account_id, name FROM companies WHERE id = ?', a.companyId)!;
  const pay = Math.min(a.amountMinor, loan.outstanding_minor);
  if (available(db, c.treasury_account_id) < pay) throw new LedgerError('INSUFFICIENT_FUNDS', `The company has ${(available(db, c.treasury_account_id) / 100).toFixed(2)} EC.`);
  const tx = transfer(db, ctx, k, c.treasury_account_id, bankAcct(db), pay, 'transfer', `loan prepayment of ${loan.id}: ${c.name}`);
  const left = loan.outstanding_minor - pay;
  const remaining = Math.max(1, loan.term_days - (ctx.tick - loan.start_tick));
  db.run("UPDATE loans SET outstanding_minor = ?, status = ?, closed_tick = ?, daily_principal_minor = ? WHERE id = ?", left, left === 0 ? 'repaid' : loan.status, left === 0 ? ctx.tick : null, Math.ceil(left / remaining), loan.id);
  db.run("INSERT INTO loan_payments (loan_id, tick, due_minor, principal_minor, interest_minor, fee_minor, status, ledger_tx_id) VALUES (?,?,?,?,0,0,'prepaid',?)", loan.id, ctx.tick, pay, pay, tx.txId);
  return { paidMinor: pay, outstandingMinor: left, duplicate: false };
}

export interface BankHooks { onInterest?: (borrower: string, amount: number) => void; onBankCost?: (amount: number) => void }
/** Daily instalments, interest, late fees and defaults. Runs after wages, energy and rent have taken their share of the borrower's cash. */
export function runLoans(db: Sql, ctx: TickCtx, cfg: EngineConfig, hooks: BankHooks = {}): { interest: number; principal: number; missed: number; defaults: number } {
  const out = { interest: 0, principal: 0, missed: 0, defaults: 0 };
  for (const l of db.all<LoanRow>("SELECT * FROM loans WHERE status IN ('active','defaulted') AND start_tick < ? ORDER BY id", ctx.tick)) {
    if (db.get('SELECT 1 FROM loan_payments WHERE loan_id = ? AND tick = ? AND status <> \'prepaid\'', l.id, ctx.tick)) continue;   // one settlement per loan per day
    const b = db.get<{ treasury_account_id: string; status: string; name: string }>('SELECT treasury_account_id, status, name FROM companies WHERE id = ?', l.borrower_id)!;
    if (b.status === 'insolvent') continue;                                   // under administration: the liquidation pays the bank
    const rate = effectiveRate(db, l);
    const interest = interestFor(l.outstanding_minor, rate);
    const final = ctx.tick - l.start_tick >= l.term_days;
    const principalDue = final ? l.outstanding_minor : Math.min(l.outstanding_minor, l.daily_principal_minor);
    const due = interest + principalDue;
    const cash = available(db, b.treasury_account_id);
    const paid = Math.min(due, cash);
    const interestPaid = Math.min(interest, paid), principalPaid = paid - interestPaid;
    let txId: number | null = null;
    if (interestPaid > 0) { const r = chargeService(db, ctx, { service: 'banking', payerAccount: b.treasury_account_id, payerCompanyId: l.borrower_id, amount: interestPaid, ref: `interest:${l.id}`, key: `t${ctx.tick}:interest:${l.id}`, memo: `loan interest: ${b.name}` }); txId = r.txId; hooks.onInterest?.(l.borrower_id, r.charged); out.interest += r.charged; }
    if (principalPaid > 0) { const t = transfer(db, ctx, `t${ctx.tick}:principal:${l.id}`, b.treasury_account_id, bankAcct(db), principalPaid, 'transfer', `loan principal repayment: ${b.name}`); txId = t.txId; out.principal += principalPaid; }
    let outstanding = l.outstanding_minor - principalPaid, missed = 0, fee = 0, status = l.status;
    if (paid < due) {
      // Unpaid interest and a late fee are added to the balance (the bank never creates coins by doing so: it is a claim, not cash).
      const shortfall = due - paid; fee = Math.ceil((shortfall * cfg.loanLateFeeBps) / 10_000);
      outstanding += Math.max(0, interest - interestPaid) + fee; missed = l.missed + 1; out.missed++;
      if (missed >= cfg.loanDefaultAfterMisses && status !== 'defaulted') {
        status = 'defaulted'; out.defaults++;
        db.run('INSERT INTO credit_defaults (tick, loan_id, borrower_id, written_off_minor, reason) VALUES (?,?,?,0,?)', ctx.tick, l.id, l.borrower_id, `${missed} consecutive missed instalments`);
        logEvent(db, ctx.tick, 'loan_default', 'error', l.borrower_id, `${b.name} defaulted on its National Bank loan after ${missed} missed repayments (${(outstanding / 100).toFixed(2)} EC outstanding)`, { loanId: l.id, outstandingMinor: outstanding });
      }
    }
    if (outstanding <= 0) status = 'repaid';
    db.run("UPDATE loans SET outstanding_minor = ?, missed = ?, status = ?, interest_paid_minor = interest_paid_minor + ?, fees_paid_minor = fees_paid_minor + ?, closed_tick = ? WHERE id = ?", Math.max(0, outstanding), missed, status, interestPaid, fee, status === 'repaid' ? ctx.tick : null, l.id);
    db.run("INSERT INTO loan_payments (loan_id, tick, due_minor, principal_minor, interest_minor, fee_minor, status, ledger_tx_id) VALUES (?,?,?,?,?,?,?,?)", l.id, ctx.tick, due, principalPaid, interestPaid, fee, paid >= due ? 'paid' : paid > 0 ? 'partial' : 'missed', txId);
  }
  return out;
}

/** Deposits earn the deposit rate, paid from the bank's own treasury (a transfer). The bank pays only what it holds: if it cannot, interest is skipped and logged. */
export function depositFunds(db: Sql, ctx: TickCtx, a: { companyId: string; amountMinor: number; key: string }) {
  const k = `deposit:${a.key}`; if (db.get('SELECT 1 FROM ledger_transactions WHERE idempotency_key = ?', k)) return { duplicate: true };
  if (!Number.isInteger(a.amountMinor) || a.amountMinor <= 0) throw new LedgerError('INVALID_AMOUNT', 'Enter an amount to deposit.');
  const c = db.get<{ treasury_account_id: string; owner_kind: string; bankrupt_tick: number | null }>('SELECT treasury_account_id, owner_kind, bankrupt_tick FROM companies WHERE id = ?', a.companyId); if (!c || c.owner_kind === 'state') throw new LedgerError('FORBIDDEN', 'Only player and NPC companies can save with the National Bank.');
  if (c.bankrupt_tick !== null) throw new LedgerError('FORBIDDEN', 'A liquidated company cannot open savings.');
  transfer(db, ctx, k, c.treasury_account_id, bankAcct(db), a.amountMinor, 'transfer', 'savings deposit with the National Bank');
  db.run('INSERT INTO bank_deposits (company_id, balance_minor, opened_tick) VALUES (?,?,?) ON CONFLICT(company_id) DO UPDATE SET balance_minor = balance_minor + excluded.balance_minor', a.companyId, a.amountMinor, ctx.tick);
  return { duplicate: false };
}
export function withdrawFunds(db: Sql, ctx: TickCtx, a: { companyId: string; amountMinor: number; key: string }) {
  const k = `withdraw:${a.key}`; if (db.get('SELECT 1 FROM ledger_transactions WHERE idempotency_key = ?', k)) return { duplicate: true };
  const d = db.get<{ balance_minor: number }>('SELECT balance_minor FROM bank_deposits WHERE company_id = ?', a.companyId);
  if (!Number.isInteger(a.amountMinor) || a.amountMinor <= 0) throw new LedgerError('INVALID_AMOUNT', 'Enter an amount to withdraw.');
  if (!d || d.balance_minor < a.amountMinor) throw new LedgerError('INSUFFICIENT_FUNDS', 'That is more than your savings balance.');
  if (available(db, bankAcct(db)) < a.amountMinor) throw new LedgerError('INSUFFICIENT_FUNDS', 'The National Bank cannot pay that out today (it has lent the money out). Try a smaller amount or later.');
  const c = db.get<{ treasury_account_id: string }>('SELECT treasury_account_id FROM companies WHERE id = ?', a.companyId)!;
  transfer(db, ctx, k, bankAcct(db), c.treasury_account_id, a.amountMinor, 'transfer', 'savings withdrawal from the National Bank');
  db.run('UPDATE bank_deposits SET balance_minor = balance_minor - ? WHERE company_id = ?', a.amountMinor, a.companyId);
  return { duplicate: false };
}
export function payDepositInterest(db: Sql, ctx: TickCtx, cfg: EngineConfig, hooks: BankHooks = {}): number {
  let total = 0; const rate = depositRate(db, cfg);
  for (const d of db.all<{ company_id: string; balance_minor: number }>('SELECT d.company_id, d.balance_minor FROM bank_deposits d JOIN companies c ON c.id = d.company_id WHERE d.balance_minor > 0 AND c.bankrupt_tick IS NULL ORDER BY d.company_id')) {
    const interest = Math.min(interestFor(d.balance_minor, rate), Math.max(0, available(db, bankAcct(db)) - 1));
    if (interest <= 0) continue;
    const c = db.get<{ treasury_account_id: string }>('SELECT treasury_account_id FROM companies WHERE id = ?', d.company_id)!;
    transfer(db, ctx, `t${ctx.tick}:depint:${d.company_id}`, bankAcct(db), c.treasury_account_id, interest, 'transfer', 'savings interest from the National Bank');
    db.run('UPDATE bank_deposits SET interest_paid_minor = interest_paid_minor + ? WHERE company_id = ?', interest, d.company_id);
    hooks.onBankCost?.(interest); total += interest;
  }
  return total;
}

/**
 * At liquidation the administrator withdraws the company's savings into its treasury so they reach its creditors and shareholders. If the bank
 * cannot pay all of it out (it has lent the money), the shortfall is a recorded claim the bank keeps: no coin is created to cover it.
 */
export function recallDepositsAtLiquidation(db: Sql, ctx: TickCtx, companyId: string, treasury: string): { recalled: number; unpaid: number } {
  const d = db.get<{ balance_minor: number }>('SELECT balance_minor FROM bank_deposits WHERE company_id = ?', companyId);
  if (!d || d.balance_minor <= 0) return { recalled: 0, unpaid: 0 };
  const pay = Math.min(d.balance_minor, Math.max(0, available(db, bankAcct(db))));
  if (pay > 0) transfer(db, ctx, `liq:${companyId}:savings`, bankAcct(db), treasury, pay, 'transfer', 'administrator withdraws savings from the National Bank');
  db.run('UPDATE bank_deposits SET balance_minor = 0 WHERE company_id = ?', companyId);
  if (d.balance_minor > pay) logEvent(db, ctx.tick, 'loan_loss', 'error', companyId, `The National Bank could not repay ${((d.balance_minor - pay) / 100).toFixed(2)} EC of savings to a liquidated company`, { unpaidMinor: d.balance_minor - pay });
  return { recalled: pay, unpaid: d.balance_minor - pay };
}

/** At liquidation the bank is a senior creditor: it is repaid from the company's cash before the state's arrears and before shareholders. Any shortfall is a loss to the bank. */
export function settleLoansAtLiquidation(db: Sql, ctx: TickCtx, companyId: string, treasury: string): { recovered: number; lost: number } {
  let recovered = 0, lost = 0;
  for (const l of db.all<LoanRow>("SELECT * FROM loans WHERE borrower_id = ? AND status IN ('active','defaulted') ORDER BY id", companyId)) {
    const pay = Math.min(l.outstanding_minor, Math.max(0, available(db, treasury)));
    if (pay > 0) { transfer(db, ctx, `liq:${companyId}:loan:${l.id}`, treasury, bankAcct(db), pay, 'transfer', `administrator repays the National Bank: ${l.id}`); recovered += pay; }
    const loss = l.outstanding_minor - pay; lost += loss;
    db.run("UPDATE loans SET outstanding_minor = 0, status = 'repaid', written_off_minor = ?, closed_tick = ? WHERE id = ?", loss, ctx.tick, l.id);
    if (loss > 0) { db.run('INSERT INTO credit_defaults (tick, loan_id, borrower_id, written_off_minor, reason) VALUES (?,?,?,?,?)', ctx.tick, l.id, companyId, loss, 'borrower liquidated: loss written off by the bank'); logEvent(db, ctx.tick, 'loan_loss', 'error', companyId, `The National Bank wrote off ${(loss / 100).toFixed(2)} EC of a loan to a bankrupt company`, { loanId: l.id, lossMinor: loss }); }
  }
  return { recovered, lost };
}

export interface BankReport { id: string; name: string; treasuryMinor: number; depositsMinor: number; loansOutstandingMinor: number; lendableMinor: number; reserveRequirementBps: number; baseRateBps: number; depositRateBps: number; activeLoans: number; defaultedLoans: number; interestIncome7Minor: number; depositInterest7Minor: number; writeOffs30Minor: number; capitalMinor: number; creditSpreadBps: number }
export function bankReport(db: Sql, cfg: EngineConfig, tick: number): BankReport {
  const p = providerOf(db, 'banking')!; const treasury = available(db, p.treasury);
  const income = db.get<{ i: number }>("SELECT COALESCE(SUM(amount_minor),0) i FROM service_charges WHERE provider_id = ? AND tick > ?", STATE_PROVIDERS.banking.id, tick - 7)!.i;
  const dep = db.get<{ i: number }>("SELECT COALESCE(SUM(p.amount_minor),0) i FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.memo = 'savings interest from the National Bank' AND p.amount_minor > 0 AND t.tick > ?", tick - 7)!.i;
  const deposits = depositsTotal(db), loans = loansOutstanding(db);
  return {
    id: STATE_PROVIDERS.banking.id, name: 'National Bank', treasuryMinor: treasury, depositsMinor: deposits, loansOutstandingMinor: loans, lendableMinor: lendable(db, cfg), reserveRequirementBps: cfg.cbReserveReqBps, baseRateBps: baseRate(db), depositRateBps: depositRate(db, cfg),
    activeLoans: db.get<{ n: number }>("SELECT COUNT(*) n FROM loans WHERE status = 'active'")!.n, defaultedLoans: db.get<{ n: number }>("SELECT COUNT(*) n FROM loans WHERE status = 'defaulted'")!.n,
    interestIncome7Minor: income, depositInterest7Minor: dep, writeOffs30Minor: db.get<{ w: number }>('SELECT COALESCE(SUM(written_off_minor),0) w FROM credit_defaults WHERE tick > ?', tick - 30)!.w, capitalMinor: treasury + loans - deposits, creditSpreadBps: currentMods(db).creditSpreadBps,
  };
}

/** NPC firms borrow to cover thin cash cover when the bank will lend, and pay down debt when cash is plentiful: the same rules and limits as a player. */
export function runNpcCredit(db: Sql, ctx: TickCtx, cfg: EngineConfig, safe: (kind: string, subject: string, fn: () => void) => void) {
  if (ctx.tick % 7 !== 0) return;
  for (const c of db.all<{ id: string; employees: number; wage_minor: number; property_minor: number; marketing_minor: number; treasury_account_id: string }>("SELECT id, employees, wage_minor, property_minor, marketing_minor, treasury_account_id FROM companies WHERE owner_kind = 'npc' AND status = 'operating' ORDER BY id")) {
    const fixed = Math.max(1, c.employees * c.wage_minor + c.property_minor + c.marketing_minor), cash = available(db, c.treasury_account_id);
    const loans = db.all<LoanRow>("SELECT * FROM loans WHERE borrower_id = ? AND status = 'active'", c.id);
    if (cash > 40 * fixed && loans.length) { for (const l of loans) safe('npc_prepay', c.id, () => { repayLoan(db, ctx, { loanId: l.id, companyId: c.id, amountMinor: Math.min(l.outstanding_minor, cash - 30 * fixed), key: `npc:${ctx.tick}` }); }); continue; }
    if (cash < 15 * fixed && loans.length === 0) safe('npc_borrow', c.id, () => {
      const prof = creditProfile(db, cfg, c.id, ctx.tick); if (prof.grade === 'D') return;
      const want = Math.min(prof.availableMinor, 12 * fixed); if (want < fixed) return;
      const q = quoteLoan(db, cfg, c.id, want, 30, ctx.tick); if (q.refusal) return;
      takeLoan(db, ctx, cfg, { companyId: c.id, amountMinor: want, termDays: 30, key: `npc:${ctx.tick}:${c.id}`, purpose: 'working capital' });
    });
  }
}
export { recordPaidService };
