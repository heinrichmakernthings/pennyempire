import { outstandingDebt } from './bank';
import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { ShareError, companyInvestorId, getInvestor, security } from './capital';
import { available, releaseFunds, reserveFunds, transfer, LedgerError, type TickCtx } from './ledger';
import { logEvent } from './stats';
import type { CompanyRow } from './operations';

export interface DividendRow { id: number; company_id: string; declared_tick: number; record_tick: number; payment_tick: number; per_share_minor: number; eligible_shares: number; total_minor: number; paid_minor: number; status: 'declared' | 'paid' | 'cancelled'; declared_by: string }

const dailyFixed = (c: CompanyRow) => c.employees * c.wage_minor + c.property_minor + c.marketing_minor;
/** Cash a dividend may use: treasury cash that is free, less arrears, outstanding bank debt and a reserve of fixed costs so the company stays able to trade. */
export function dividendCapacity(db: Sql, cfg: EngineConfig, companyId: string): { capacityMinor: number; eligibleShares: number; maxPerShareMinor: number; reserveMinor: number } {
  const c = db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', companyId);
  const eligible = eligibleShares(db, companyId);
  if (!c || c.bankrupt_tick !== null || c.status !== 'operating') return { capacityMinor: 0, eligibleShares: eligible, maxPerShareMinor: 0, reserveMinor: 0 };
  const reserve = cfg.dividendReserveDays * dailyFixed(c) + c.unpaid_minor + outstandingDebt(db, companyId);   // loan covenant: no dividends out of borrowed money
  const cap = Math.max(0, available(db, c.treasury_account_id) - reserve);
  return { capacityMinor: cap, eligibleShares: eligible, maxPerShareMinor: eligible > 0 ? Math.floor(cap / eligible) : 0, reserveMinor: reserve };
}
/** Shares that earn a dividend: everything issued except the company's own treasury shares. */
export const eligibleShares = (db: Sql, companyId: string) => (security(db, companyId)?.issued_shares ?? 0) - (db.get<{ s: number }>('SELECT COALESCE(shares,0) s FROM share_holdings WHERE company_id = ? AND investor_id = ?', companyId, companyInvestorId(companyId))?.s ?? 0);

/**
 * Declares a dividend. The record-date snapshot of holders is taken NOW and fixed: shares bought afterwards earn nothing, shares sold afterwards still do,
 * so moving shares around cannot collect the same dividend twice. The total is earmarked (reserved) on the company treasury at once — no coin is ever minted.
 */
export function declareDividend(db: Sql, ctx: TickCtx, cfg: EngineConfig, key: string, companyId: string, perShareMinor: number, declaredBy: string): DividendRow {
  return db.transaction(() => {
    const prior = db.get<DividendRow>('SELECT * FROM dividends WHERE idempotency_key = ?', key);
    if (prior) { if (prior.company_id !== companyId || prior.per_share_minor !== perShareMinor) throw new ShareError('INVALID', `Idempotency key ${key} was already used for a different dividend`); return prior; }
    const sec = security(db, companyId); const c = db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', companyId);
    if (!sec || !c) throw new ShareError('NOT_FOUND', `Unknown company ${companyId}`);
    if (sec.status === 'delisted' || c.bankrupt_tick !== null) throw new ShareError('RULE', 'A closed company cannot pay dividends');
    if (c.status !== 'operating') throw new ShareError('RULE', 'An insolvent or paused company cannot pay dividends');
    if (!Number.isSafeInteger(perShareMinor) || perShareMinor <= 0) throw new ShareError('INVALID', 'The dividend per share must be a positive whole number of minor units');
    if (db.get("SELECT 1 FROM dividends WHERE company_id = ? AND status = 'declared'", companyId)) throw new ShareError('RULE', 'A dividend is already declared and awaiting payment');
    const last = db.get<{ t: number }>("SELECT MAX(declared_tick) t FROM dividends WHERE company_id = ? AND status <> 'cancelled'", companyId)?.t;
    if (last !== null && last !== undefined && ctx.tick - last < cfg.dividendMinGapTicks) throw new ShareError('RULE', `Dividends must be at least ${cfg.dividendMinGapTicks} days apart`);
    const holders = db.all<{ investor_id: string; shares: number }>('SELECT investor_id, shares FROM share_holdings WHERE company_id = ? AND shares > 0 AND investor_id <> ? ORDER BY investor_id', companyId, companyInvestorId(companyId));
    const eligible = holders.reduce((a, h) => a + h.shares, 0);
    if (eligible === 0) throw new ShareError('RULE', 'There are no shareholders to pay');
    const total = perShareMinor * eligible;
    const cap = dividendCapacity(db, cfg, companyId);
    if (total > cap.capacityMinor) throw new ShareError('RULE', `The company can distribute at most ${(cap.capacityMinor / 100).toFixed(2)} EC now (${(cap.maxPerShareMinor / 100).toFixed(2)} EC a share) while keeping ${cfg.dividendReserveDays} days of costs in reserve; this dividend needs ${(total / 100).toFixed(2)} EC`);
    try { reserveFunds(db, c.treasury_account_id, total); } catch (e) { if (e instanceof LedgerError) throw new ShareError('INSUFFICIENT_FUNDS', e.message); throw e; }
    const id = db.run('INSERT INTO dividends (company_id, declared_tick, record_tick, payment_tick, per_share_minor, eligible_shares, total_minor, status, declared_by, idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?)', companyId, ctx.tick, ctx.tick, ctx.tick + cfg.dividendPayDelayTicks, perShareMinor, eligible, total, 'declared', declaredBy, key).lastInsertRowid;
    for (const h of holders) db.run('INSERT INTO dividend_entitlements (dividend_id, investor_id, shares, amount_minor) VALUES (?,?,?,?)', id, h.investor_id, h.shares, h.shares * perShareMinor);
    logEvent(db, ctx.tick, 'dividend_declared', 'info', companyId, `${c.name} declared a dividend of ${(perShareMinor / 100).toFixed(2)} EC a share (${(total / 100).toFixed(2)} EC in total), paid on day ${ctx.tick + cfg.dividendPayDelayTicks}`, { dividendId: id, perShareMinor, totalMinor: total });
    return db.get<DividendRow>('SELECT * FROM dividends WHERE id = ?', id)!;
  });
}

/** Pays every declared dividend that has reached its payment day: treasury → each recorded shareholder, one ledger transfer per holder. */
export function payDueDividends(db: Sql, ctx: TickCtx): number {
  let paid = 0;
  for (const d of db.all<DividendRow>("SELECT * FROM dividends WHERE status = 'declared' AND payment_tick <= ? ORDER BY id", ctx.tick)) {
    db.transaction(() => {
      const c = db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', d.company_id)!;
      releaseFunds(db, c.treasury_account_id, d.total_minor);
      let sum = 0;
      for (const e of db.all<{ investor_id: string; shares: number; amount_minor: number }>('SELECT * FROM dividend_entitlements WHERE dividend_id = ? ORDER BY investor_id', d.id)) {
        const inv = getInvestor(db, e.investor_id)!;
        const tx = transfer(db, ctx, `div:${d.id}:${e.investor_id}`, c.treasury_account_id, inv.account_id, e.amount_minor, 'transfer', `dividend ${d.id}: ${e.shares} shares of ${c.name} @ ${d.per_share_minor}`);
        db.run('UPDATE dividend_entitlements SET ledger_tx_id = ? WHERE dividend_id = ? AND investor_id = ?', tx.txId, d.id, e.investor_id);
        sum += e.amount_minor;
      }
      db.run("UPDATE dividends SET status = 'paid', paid_minor = ? WHERE id = ?", sum, d.id);
      logEvent(db, ctx.tick, 'dividend_paid', 'info', d.company_id, `${c.name} paid ${(sum / 100).toFixed(2)} EC in dividends to its shareholders`, { dividendId: d.id, totalMinor: sum });
    });
    paid++;
  }
  return paid;
}

/** Withdraws any declared-but-unpaid dividend (company liquidated or suspended into insolvency), releasing the earmark. */
export function cancelOpenDividends(db: Sql, companyId: string) {
  for (const d of db.all<DividendRow>("SELECT * FROM dividends WHERE company_id = ? AND status = 'declared'", companyId)) {
    const c = db.get<CompanyRow>('SELECT treasury_account_id FROM companies WHERE id = ?', companyId)!;
    releaseFunds(db, c.treasury_account_id, d.total_minor);
    db.run("UPDATE dividends SET status = 'cancelled' WHERE id = ?", d.id);
  }
}
