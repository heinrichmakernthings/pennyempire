import type { ApiError } from '../../src/contracts/game-state';
import type { Sql } from '../db/sql';
import { loadConfig } from './config';
import { LedgerError, available, reconcile, transfer, type TickCtx } from './ledger';
import { HOUSEHOLDS } from '../seed/bristol';
import { MarketError, cancelOrder, placeOrder } from './market';
import { gameDate } from './config';
import { logEvent } from './stats';
import { PLAYER_ID, TREASURY } from '../seed/bristol';
import { feeFromBps } from '../../src/domain/money';

export type CommandOk<T = unknown> = { ok: true; revision: number; transactionId: string; refreshScreens: string[]; data?: T };
export type CommandErr = { ok: false; error: ApiError };
export type CommandResponse<T = unknown> = CommandOk<T> | CommandErr;

const err = (code: ApiError['code'], message: string, fieldErrors?: Record<string, string>): CommandErr => ({ ok: false, error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } });
const lastTick = (db: Sql) => db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
const ctxNow = (db: Sql, actor: string): TickCtx => { const t = lastTick(db); return { tick: t, gameDate: gameDate(loadConfig(db), t), actor }; };

/**
 * Exactly-once command execution. The idempotency key is the identity of the user's intent: a retry (timeout, double click, replay)
 * returns the stored response and changes nothing; the same key with a different command is refused.
 */
export function runCommand(db: Sql, key: string, name: string, fn: (ctx: TickCtx) => CommandResponse): CommandResponse {
  if (!key || key.length > 128) return err('VALIDATION', 'A command needs an idempotency key (1–128 chars).');
  return db.transaction(() => {
    const prior = db.get<{ command: string; response_json: string }>('SELECT command, response_json FROM command_log WHERE idempotency_key = ?', key);
    if (prior) return prior.command === name ? (JSON.parse(prior.response_json) as CommandResponse) : err('VALIDATION', `Idempotency key already used for ${prior.command}`);
    const ctx = ctxNow(db, PLAYER_ID);
    let res: CommandResponse;
    try { res = db.transaction(() => fn(ctx)); } catch (e) {
      if (e instanceof LedgerError) res = err(e.code === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : 'VALIDATION', e.message);
      else if (e instanceof MarketError) res = err(e.code === 'INSUFFICIENT_STOCK' ? 'INSUFFICIENT_STOCK' : e.code === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : e.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'VALIDATION', e.message);
      else throw e;
    }
    if (!res.ok) db.run('INSERT INTO failed_transactions (tick, idempotency_key, kind, reason) VALUES (?,?,?,?)', ctx.tick, key, name, res.error.message);
    db.run('INSERT INTO command_log (idempotency_key, command, status, response_json, tick) VALUES (?,?,?,?,?)', key, name, res.ok ? 'ok' : 'rejected', JSON.stringify(res), ctx.tick);
    return res;
  });
}

interface OwnedCompany { bankrupt_tick: number | null; hires_in_tick: number; dismissals_in_tick: number; staff_change_tick: number; id: string; name: string; treasury_account_id: string; revision: number; status: string; owner_kind: string; owner_id: string; employees: number; max_employees: number; capacity_batches: number; min_price_minor: number; max_price_minor: number; wage_minor: number; property_minor: number; marketing_minor: number; unpaid_minor: number; storage_cap_units: number }
const owned = (db: Sql, companyId: string): OwnedCompany | CommandErr => {
  const c = db.get<OwnedCompany>('SELECT * FROM companies WHERE id = ?', companyId);
  if (!c) return err('VALIDATION', `Unknown company ${companyId}`);
  if (c.owner_kind !== 'player' || c.owner_id !== PLAYER_ID) return err('FORBIDDEN', 'You do not own this company.');
  return c;
};
const isErr = (x: unknown): x is CommandErr => typeof x === 'object' && x !== null && (x as CommandErr).ok === false;

export interface ConfigurePatch { priceMinor?: number; employees?: number; quality?: 'basic' | 'standard' | 'premium'; plannedUnitsPerTick?: number; marketingMinorPerTick?: number; askPriceMinor?: number; autoProcure?: boolean }

/** company.configure — validated against the company's own bounds; bumps the revision; optimistic-concurrency checked. */
export function configureCompany(db: Sql, key: string, companyId: string, expectedRevision: number, p: ConfigurePatch): CommandResponse {
  return runCommand(db, key, 'company.configure', (ctx) => {
    const c = owned(db, companyId); if (isErr(c)) return c;
    if (c.bankrupt_tick !== null) return err('FORBIDDEN', 'This company is bankrupt and closed.');
    if (c.revision !== expectedRevision) return err('STALE_REVISION', `Company changed (revision ${c.revision}); refresh and try again.`);
    if (c.status === 'insolvent') return err('VALIDATION', 'An insolvent company cannot be reconfigured.');
    const fe: Record<string, string> = {};
    const isInt = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
    if (p.priceMinor !== undefined && (!isInt(p.priceMinor) || p.priceMinor < c.min_price_minor || p.priceMinor > c.max_price_minor)) fe.priceMinor = 'Price is outside the allowed range.';
    if (p.employees !== undefined && (!isInt(p.employees) || p.employees > c.max_employees)) fe.employees = `Staff must be a whole number from 0 to ${c.max_employees}.`;
    const cfg = loadConfig(db);
    const hires = p.employees !== undefined && isInt(p.employees) ? Math.max(0, p.employees - c.employees) : 0, fires = p.employees !== undefined && isInt(p.employees) ? Math.max(0, c.employees - p.employees) : 0;
    const sameDay = c.staff_change_tick === ctx.tick;
    if (hires > 0 && (sameDay ? c.hires_in_tick : 0) + hires > cfg.staffChangesPerDay) fe.employees = `You can hire at most ${cfg.staffChangesPerDay} people per day (${sameDay ? c.hires_in_tick : 0} already today).`;
    if (fires > 0 && (sameDay ? c.dismissals_in_tick : 0) + fires > cfg.staffChangesPerDay) fe.employees = `You can dismiss at most ${cfg.staffChangesPerDay} people per day (${sameDay ? c.dismissals_in_tick : 0} already today).`;
    if (p.askPriceMinor !== undefined && (!isInt(p.askPriceMinor) || p.askPriceMinor <= 0)) fe.askPriceMinor = 'Wholesale price must be a positive integer.';
    if (p.marketingMinorPerTick !== undefined && !isInt(p.marketingMinorPerTick)) fe.marketingMinorPerTick = 'Marketing must be a non-negative integer.';
    if (p.quality !== undefined && !['basic', 'standard', 'premium'].includes(p.quality)) fe.quality = 'Unknown quality.';
    const lines = db.all<{ recipe_id: string; output_units: number }>('SELECT l.recipe_id, r.output_units FROM production_lines l JOIN recipes r ON r.id = l.recipe_id WHERE l.company_id = ?', companyId);
    let batches: number | undefined;
    if (p.plannedUnitsPerTick !== undefined) {
      if (lines.length !== 1) fe.plannedUnitsPerTick = 'Production planning is only available for single-product companies.';
      else if (!isInt(p.plannedUnitsPerTick)) fe.plannedUnitsPerTick = 'Planned output must be a non-negative integer.';
      else { batches = Math.ceil(p.plannedUnitsPerTick / lines[0]!.output_units); if (batches > c.capacity_batches) fe.plannedUnitsPerTick = `Capacity is ${c.capacity_batches * lines[0]!.output_units} units per tick.`; }
    }
    if (Object.keys(fe).length) return err('VALIDATION', 'Some settings are invalid.', fe);
    const sets: string[] = []; const vals: (string | number)[] = [];
    const add = (col: string, v: string | number | undefined) => { if (v !== undefined) { sets.push(`${col} = ?`); vals.push(v); } };
    add('price_minor', p.priceMinor); add('employees', p.employees); add('quality', p.quality); add('marketing_minor', p.marketingMinorPerTick);
    add('auto_procure', p.autoProcure === undefined ? undefined : p.autoProcure ? 1 : 0);
    // Hiring costs one day's wage as a recruitment fee, dismissal one day's wage as severance; both are paid to households now and recognised in the next day's labour cost.
    const staffFee = (hires + fires) * c.wage_minor;
    if (hires + fires > 0) {
      if (available(db, c.treasury_account_id) < staffFee) return err('INSUFFICIENT_FUNDS', `Changing staff costs ${staffFee / 100} EC (one day's wage each); the company has ${available(db, c.treasury_account_id) / 100} EC.`);
      if (staffFee > 0) transfer(db, ctx, `cmd:${key}:staff`, c.treasury_account_id, HOUSEHOLDS, staffFee, 'operating_cost', `${hires ? 'recruitment' : 'severance'} fees at ${c.name}`);
      add('hires_in_tick', (sameDay ? c.hires_in_tick : 0) + hires); add('dismissals_in_tick', (sameDay ? c.dismissals_in_tick : 0) + fires); add('staff_change_tick', ctx.tick);
      db.run('UPDATE companies SET pending_labour_minor = pending_labour_minor + ? WHERE id = ?', staffFee, companyId);
    }
    if (p.askPriceMinor !== undefined) db.run('UPDATE production_lines SET ask_price_minor = ? WHERE company_id = ?', p.askPriceMinor, companyId);
    if (sets.length) db.run(`UPDATE companies SET ${sets.join(', ')} WHERE id = ?`, ...vals, companyId);
    if (batches !== undefined) db.run('UPDATE production_lines SET planned_batches = ? WHERE company_id = ?', batches, companyId);
    db.run('UPDATE companies SET revision = revision + 1 WHERE id = ?', companyId);
    logEvent(db, lastTick(db), 'company_configured', 'info', companyId, `Player reconfigured ${c.name}`, p);
    return { ok: true, revision: c.revision + 1, transactionId: key, refreshScreens: ['companies', 'city'] };
  });
}

/** Player wallet → own company treasury (a capital injection: coins move, none are created). */
export function fundCompany(db: Sql, key: string, companyId: string, amountMinor: number): CommandResponse {
  return runCommand(db, key, 'company.fund', (ctx) => {
    const c = owned(db, companyId); if (isErr(c)) return c;
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return err('VALIDATION', 'Amount must be a positive whole number of minor units.');
    const wallet = db.get<{ w: string }>('SELECT wallet_account_id w FROM players WHERE id = ?', PLAYER_ID)!.w;
    const tx = transfer(db, ctx, `cmd:${key}`, wallet, c.treasury_account_id, amountMinor, 'capital_injection', `capital injection into ${c.name}`);
    return { ok: true, revision: c.revision, transactionId: String(tx.txId), refreshScreens: ['city', 'companies', 'wallet'] };
  });
}

/** Company treasury → player wallet. The company must keep one tick of fixed costs and may not withdraw while it owes arrears. */
export function withdrawFromCompany(db: Sql, key: string, companyId: string, amountMinor: number): CommandResponse {
  return runCommand(db, key, 'company.withdraw', (ctx) => {
    const c = owned(db, companyId); if (isErr(c)) return c;
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return err('VALIDATION', 'Amount must be a positive whole number of minor units.');
    if (c.unpaid_minor > 0) return err('FORBIDDEN', 'Settle arrears before taking money out of the company.');
    const reserve = c.employees * c.wage_minor + c.property_minor + c.marketing_minor;
    if (available(db, c.treasury_account_id) - amountMinor < reserve) return err('INSUFFICIENT_FUNDS', `The company must keep ${reserve / 100} EC to cover a day of operating costs.`);
    const wallet = db.get<{ w: string }>('SELECT wallet_account_id w FROM players WHERE id = ?', PLAYER_ID)!.w;
    const tx = transfer(db, ctx, `cmd:${key}`, c.treasury_account_id, wallet, amountMinor, 'owner_withdrawal', `owner withdrawal from ${c.name}`);
    return { ok: true, revision: c.revision, transactionId: String(tx.txId), refreshScreens: ['city', 'companies', 'wallet'] };
  });
}

/** Insolvency recovery: arrears are paid to the state treasury (the "administrator"), then the company reopens with a fresh shortfall counter. */
export function reopenCompany(db: Sql, key: string, companyId: string): CommandResponse {
  return runCommand(db, key, 'company.reopen', (ctx) => {
    const c = owned(db, companyId); if (isErr(c)) return c;
    if (c.bankrupt_tick !== null) return err('FORBIDDEN', 'A bankrupt company has been liquidated and cannot be reopened. Start a new company instead.');
    if (c.status !== 'insolvent') return err('VALIDATION', 'Only insolvent companies can be reopened.');
    const need = c.unpaid_minor + c.employees * c.wage_minor + c.property_minor + c.marketing_minor;
    if (available(db, c.treasury_account_id) < need) return err('INSUFFICIENT_FUNDS', `Reopening needs ${need / 100} EC (arrears plus one day of costs).`);
    if (c.unpaid_minor > 0) transfer(db, ctx, `cmd:${key}`, c.treasury_account_id, TREASURY, c.unpaid_minor, 'state_payment', `insolvency administrator: arrears of ${c.name}`);
    db.run("UPDATE companies SET status = 'operating', insolvent_tick = NULL, unpaid_minor = 0, shortfall_ticks = 0, revision = revision + 1 WHERE id = ?", companyId);
    logEvent(db, ctx.tick, 'company_reopened', 'info', companyId, `${c.name} reopened after settling arrears`);
    return { ok: true, revision: c.revision + 1, transactionId: key, refreshScreens: ['companies', 'city'] };
  });
}

export interface QuoteInput { companyId: string; commodityId: string; side: 'buy' | 'sell'; quantity: number; limitPriceMinor: number }
export type QuoteOut = { ok: true; quote: { id: string; tick: number; quantity: number; subtotalMinor: number; feeMinor: number; totalMinor: number; availableUnits: number; revision: number } } | CommandErr;

/** Server-authoritative quote from the live order book. Valid for the current tick only (the book is rebuilt every tick). */
export function quoteOrder(db: Sql, q: QuoteInput): QuoteOut {
  const c = owned(db, q.companyId); if (isErr(c)) return c;
  if (!Number.isSafeInteger(q.quantity) || q.quantity <= 0) return err('VALIDATION', 'Quantity must be a whole number greater than zero.', { quantity: 'Enter a whole number of units greater than zero.' });
  if (!Number.isSafeInteger(q.limitPriceMinor) || q.limitPriceMinor <= 0) return err('VALIDATION', 'Limit price must be positive.', { limitPrice: 'Enter a positive limit price.' });
  const cfg = loadConfig(db); const tick = lastTick(db);
  const book = q.side === 'buy'
    ? db.all<{ price_minor: number; qty_remaining: number }>("SELECT price_minor, qty_remaining FROM orders WHERE commodity_id = ? AND side='sell' AND status='open' AND price_minor <= ? AND company_id <> ? ORDER BY price_minor ASC, id ASC", q.commodityId, q.limitPriceMinor, q.companyId)
    : db.all<{ price_minor: number; qty_remaining: number }>("SELECT price_minor, qty_remaining FROM orders WHERE commodity_id = ? AND side='buy' AND status='open' AND price_minor >= ? AND company_id <> ? ORDER BY price_minor DESC, id ASC", q.commodityId, q.limitPriceMinor, q.companyId);
  let left = q.quantity, subtotal = 0, filled = 0;
  for (const o of book) { if (left <= 0) break; const n = Math.min(left, o.qty_remaining); subtotal += n * o.price_minor; filled += n; left -= n; }
  const fee = q.side === 'sell' ? feeFromBps(subtotal, cfg.exchangeFeeBps) : 0;   // sellers pay the exchange fee; it is destroyed (a sink)
  const id = `q-${tick}-${q.companyId}-${q.commodityId}-${q.side}-${q.quantity}-${q.limitPriceMinor}`;
  db.run('INSERT OR REPLACE INTO quotes (id, company_id, commodity_id, side, qty, limit_minor, subtotal_minor, fee_minor, total_minor, tick) VALUES (?,?,?,?,?,?,?,?,?,?)', id, q.companyId, q.commodityId, q.side, q.quantity, q.limitPriceMinor, subtotal, fee, q.side === 'buy' ? subtotal : subtotal - fee, tick);
  return { ok: true, quote: { id, tick, quantity: q.quantity, subtotalMinor: subtotal, feeMinor: fee, totalMinor: q.side === 'buy' ? subtotal : subtotal - fee, availableUnits: filled, revision: tick } };
}

/** commodity.order — places a real limit order (reserving coins or stock first). Requires a current-tick quote for the same terms. */
export function placePlayerOrder(db: Sql, key: string, o: QuoteInput & { quoteId: string }): CommandResponse<{ orderId: number; filled: number; remaining: number }> {
  return runCommand(db, key, 'commodity.order', (ctx) => {
    const c = owned(db, o.companyId); if (isErr(c)) return c;
    const quote = db.get<{ tick: number; company_id: string; commodity_id: string; side: string; qty: number; limit_minor: number }>('SELECT * FROM quotes WHERE id = ?', o.quoteId);
    if (!quote || quote.tick !== ctx.tick) return err('QUOTE_EXPIRED', 'This quote has expired; request a new quote.');
    if (quote.company_id !== o.companyId || quote.commodity_id !== o.commodityId || quote.side !== o.side || quote.qty !== o.quantity || quote.limit_minor !== o.limitPriceMinor) return err('VALIDATION', 'The order does not match its quote.');
    const cfg = loadConfig(db);
    const r = placeOrder(db, ctx, cfg.exchangeFeeBps, { company: o.companyId, commodity: o.commodityId, side: o.side, price: o.limitPriceMinor, qty: o.quantity, key: `player:${key}` });
    const filled = r.order.qty_original - r.order.qty_remaining;
    return { ok: true, revision: ctx.tick, transactionId: String(r.order.id), refreshScreens: ['commodities', 'city', 'companies'], data: { orderId: r.order.id, filled, remaining: r.order.qty_remaining } };
  }) as CommandResponse<{ orderId: number; filled: number; remaining: number }>;
}

/** order.cancel — releases exactly what the order still reserves (remaining units or remaining reserved coins). */
export function cancelPlayerOrder(db: Sql, key: string, orderId: number): CommandResponse {
  return runCommand(db, key, 'order.cancel', (ctx) => {
    const o = db.get<{ company_id: string }>('SELECT company_id FROM orders WHERE id = ?', orderId);
    if (!o) return err('VALIDATION', `No order ${orderId}`);
    const c = owned(db, o.company_id); if (isErr(c)) return c;
    cancelOrder(db, orderId, o.company_id);
    return { ok: true, revision: ctx.tick, transactionId: String(orderId), refreshScreens: ['commodities'] };
  });
}

/** Developer/test hook: raw reconcile. */
export const audit = (db: Sql) => reconcile(db);
