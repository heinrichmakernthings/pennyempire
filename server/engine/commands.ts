import { actingPlayer } from './actor';
import { GbpError } from './gbpLedger';
import type { ApiError } from '../../src/contracts/game-state';
import type { Sql } from '../db/sql';
import { loadConfig } from './config';
import { LedgerError, available, reconcile, transfer, type TickCtx } from './ledger';
import { applyStaffChange } from './staffing';
import { MarketError, cancelOrder, liveBook, marketLimit, placeOrder } from './market';
import { gameDate } from './config';
import { ShareError } from './capital';
import { logEvent } from './stats';
import { TREASURY } from '../seed/bristol';
import { feeFromBps } from '../../src/domain/money';
import { outstandingDebt } from './bank';
import { settingWarnings } from './advice';

export type CommandOk<T = unknown> = { ok: true; revision: number; transactionId: string; refreshScreens: string[]; data?: T };
export type CommandErr = { ok: false; error: ApiError };
export type CommandResponse<T = unknown> = CommandOk<T> | CommandErr;

export const err = (code: ApiError['code'], message: string, fieldErrors?: Record<string, string>): CommandErr => ({ ok: false, error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } });
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
    const ctx = ctxNow(db, actingPlayer());
    let res: CommandResponse;
    try { res = db.transaction(() => fn(ctx)); } catch (e) {
      if (e instanceof LedgerError) res = err(e.code === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : 'VALIDATION', e.message);
      else if (e instanceof GbpError) res = err(e.code === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : e.code === 'FORBIDDEN' || e.code === 'LIMIT' || e.code === 'INVALID_STATE' ? 'FORBIDDEN' : 'VALIDATION', e.message);
      else if (e instanceof MarketError) res = err(e.code === 'INSUFFICIENT_STOCK' ? 'INSUFFICIENT_STOCK' : e.code === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : e.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'VALIDATION', e.message);
      else if (e instanceof ShareError) res = err(e.code === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : e.code === 'INSUFFICIENT_SHARES' ? 'INSUFFICIENT_STOCK' : e.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'VALIDATION', e.message);
      else throw e;
    }
    if (!res.ok) db.run('INSERT INTO failed_transactions (tick, idempotency_key, kind, reason) VALUES (?,?,?,?)', ctx.tick, key, name, res.error.message);
    db.run('INSERT INTO command_log (idempotency_key, command, status, response_json, tick) VALUES (?,?,?,?,?)', key, name, res.ok ? 'ok' : 'rejected', JSON.stringify(res), ctx.tick);
    return res;
  });
}

interface OwnedCompany { retail_commodity_id: string | null; bankrupt_tick: number | null; hires_in_tick: number; dismissals_in_tick: number; staff_change_tick: number; id: string; name: string; treasury_account_id: string; revision: number; status: string; owner_kind: string; owner_id: string; employees: number; max_employees: number; capacity_batches: number; min_price_minor: number; max_price_minor: number; wage_minor: number; property_minor: number; marketing_minor: number; unpaid_minor: number; storage_cap_units: number }
export const owned = (db: Sql, companyId: string): OwnedCompany | CommandErr => {
  const c = db.get<OwnedCompany>('SELECT * FROM companies WHERE id = ?', companyId);
  if (!c) return err('VALIDATION', `Unknown company ${companyId}`);
  if (c.owner_kind !== 'player' || c.owner_id !== actingPlayer()) return err('FORBIDDEN', 'You do not own this company.');
  return c;
};
export const isErr = (x: unknown): x is CommandErr => typeof x === 'object' && x !== null && (x as CommandErr).ok === false;

export interface ConfigurePatch { priceMinor?: number; employees?: number; quality?: 'basic' | 'standard' | 'premium'; plannedUnitsPerTick?: number; marketingMinorPerTick?: number; askPriceMinor?: number; autoProcure?: boolean; ownerCover?: boolean }

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
    if (p.askPriceMinor !== undefined && (!isInt(p.askPriceMinor) || p.askPriceMinor < c.min_price_minor || p.askPriceMinor > c.max_price_minor)) fe.askPriceMinor = 'Wholesale price is outside the allowed range.';
    if (p.marketingMinorPerTick !== undefined && !isInt(p.marketingMinorPerTick)) fe.marketingMinorPerTick = 'Marketing must be a non-negative integer.';
    // Advertising builds awareness among households; a wholesale producer's buyers are businesses on the exchange, so the spend would win nothing.
    else if (p.marketingMinorPerTick !== undefined && p.marketingMinorPerTick > 0 && c.retail_commodity_id === null) fe.marketingMinorPerTick = 'Your customers are businesses buying on the exchange. Advertising only reaches households, so it would cost money and win no sales.';
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
    add('price_minor', p.priceMinor); add('quality', p.quality); add('marketing_minor', p.marketingMinorPerTick);
    add('auto_procure', p.autoProcure === undefined ? undefined : p.autoProcure ? 1 : 0);
    add('owner_cover', p.ownerCover === undefined ? undefined : p.ownerCover ? 1 : 0);
    if (hires + fires > 0) {
      try { applyStaffChange(db, ctx, cfg, c as never, p.employees!, `cmd:${key}`); } catch (e) { if (e instanceof LedgerError) return err('INSUFFICIENT_FUNDS', e.message); throw e; }
    }
    // Wholesale companies (no retail commodity) sell at their ask price, so the "price" setting is the ask price for them.
    const ask = p.askPriceMinor ?? (c.retail_commodity_id === null ? p.priceMinor : undefined);
    if (ask !== undefined) db.run('UPDATE production_lines SET ask_price_minor = ? WHERE company_id = ?', ask, companyId);
    if (sets.length) db.run(`UPDATE companies SET ${sets.join(', ')} WHERE id = ?`, ...vals, companyId);
    if (batches !== undefined) db.run('UPDATE production_lines SET planned_batches = ? WHERE company_id = ?', batches, companyId);
    db.run('UPDATE companies SET revision = revision + 1 WHERE id = ?', companyId);
    logEvent(db, lastTick(db), 'company_configured', 'info', companyId, `Player reconfigured ${c.name}`, p);
    return { ok: true, revision: c.revision + 1, transactionId: key, refreshScreens: ['companies', 'city'], data: { warnings: settingWarnings(db, cfg, companyId) } };
  });
}

/** Player wallet → own company treasury (a capital injection: coins move, none are created). */
export function fundCompany(db: Sql, key: string, companyId: string, amountMinor: number): CommandResponse {
  return runCommand(db, key, 'company.fund', (ctx) => {
    const c = owned(db, companyId); if (isErr(c)) return c;
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return err('VALIDATION', 'Amount must be a positive whole number of minor units.');
    const wallet = db.get<{ w: string }>('SELECT wallet_account_id w FROM players WHERE id = ?', actingPlayer())!.w;
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
    // Loan covenant: while the company owes the National Bank, the borrowed coins stay in the business. Owners can take out only cash above
    // the outstanding debt (otherwise a player could borrow, withdraw the loan to their wallet and let the company fail, leaving the bank the loss).
    const debt = outstandingDebt(db, companyId);
    const reserve = c.employees * c.wage_minor + c.property_minor + c.marketing_minor + debt;
    if (available(db, c.treasury_account_id) - amountMinor < reserve) return err('INSUFFICIENT_FUNDS', debt > 0 ? `While it owes the National Bank ${(debt / 100).toFixed(2)} EC, the company must keep that much plus a day of operating costs (${(reserve / 100).toFixed(2)} EC in total).` : `The company must keep ${reserve / 100} EC to cover a day of operating costs.`);
    const wallet = db.get<{ w: string }>('SELECT wallet_account_id w FROM players WHERE id = ?', actingPlayer())!.w;
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

export interface QuoteInput { companyId: string; commodityId: string; side: 'buy' | 'sell'; quantity: number; limitPriceMinor: number; kind?: 'limit' | 'market' | 'direct'; slippageBps?: number; expiresInTicks?: number | null; fromCompanyId?: string }
export type QuoteOut = { ok: true; quote: { id: string; tick: number; quantity: number; subtotalMinor: number; feeMinor: number; totalMinor: number; availableUnits: number; revision: number; kind: 'limit' | 'market' | 'direct'; limitPriceMinor: number; reserveMinor: number; slippageBps: number | null } } | CommandErr;

/** Server-authoritative quote from the live order book. Valid for the current tick only (the book is rebuilt every tick). */
export function quoteOrder(db: Sql, q: QuoteInput): QuoteOut {
  const c = owned(db, q.companyId); if (isErr(c)) return c;
  if (!Number.isSafeInteger(q.quantity) || q.quantity <= 0) return err('VALIDATION', 'Quantity must be a whole number greater than zero.', { quantity: 'Enter a whole number of units greater than zero.' });
  const cfg = loadConfig(db); const tick = lastTick(db);
  const kind = q.kind ?? 'limit';
  const slip = kind === 'market' ? (q.slippageBps ?? cfg.marketSlippageBps) : null;
  if (slip !== null && (!Number.isSafeInteger(slip) || slip < 0 || slip > cfg.maxSlippageBps)) return err('VALIDATION', `Price protection must be between 0% and ${cfg.maxSlippageBps / 100}%.`, { slippage: `Choose 0–${cfg.maxSlippageBps / 100}%.` });
  if (q.expiresInTicks !== undefined && q.expiresInTicks !== null && (!Number.isSafeInteger(q.expiresInTicks) || q.expiresInTicks < 1 || q.expiresInTicks > cfg.maxOrderTicks)) return err('VALIDATION', `An order can last 1 to ${cfg.maxOrderTicks} days.`, { expiresInTicks: `Choose 1–${cfg.maxOrderTicks} days.` });
  if (!db.get('SELECT 1 FROM commodities WHERE id = ?', q.commodityId)) return err('VALIDATION', `Unknown commodity ${q.commodityId}`);
  if (kind === 'direct') {
    if (q.side !== 'buy' || !q.fromCompanyId) return err('VALIDATION', 'A direct purchase buys from one chosen supplier.');
    const sup = db.get<{ id: string }>("SELECT id FROM companies WHERE id = ? AND bankrupt_tick IS NULL", q.fromCompanyId);
    if (!sup || q.fromCompanyId === q.companyId) return err('VALIDATION', 'That supplier cannot be used.');
  }
  let limitPrice = q.limitPriceMinor;
  if (kind === 'market') {
    const lim = marketLimit(db, q.commodityId, q.side, q.companyId, tick, slip!);
    if (lim === null) return err('VALIDATION', `Nobody is ${q.side === 'buy' ? 'selling' : 'buying'} ${q.commodityId} right now, so a market order has no price to protect. Place a limit order instead.`);
    limitPrice = lim;
  }
  if (!Number.isSafeInteger(limitPrice) || limitPrice <= 0) return err('VALIDATION', 'Limit price must be positive.', { limitPrice: 'Enter a positive limit price.' });
  // Fat-finger / manipulation guard: a limit price more than 10× away from the reference price is refused (market orders are already bounded by their protection band).
  const refPrice = db.get<{ p: number }>('SELECT reference_price_minor p FROM commodities WHERE id = ?', q.commodityId)!.p;
  if (kind !== 'market' && (limitPrice > refPrice * 10 || limitPrice * 10 < refPrice)) return err('VALIDATION', `Price must be within 10× of the ${(refPrice / 100).toFixed(2)} EC reference price (0.1× to 10×).`, { limitPrice: 'This price is far outside the normal range; check the decimal point.' });
  const book = liveBook(db, q.companyId, q.commodityId, q.side === 'buy' ? 'sell' : 'buy', limitPrice, tick, kind === 'direct' ? q.fromCompanyId : undefined);
  let left = q.quantity, subtotal = 0, filled = 0;
  for (const o of book) { if (left <= 0) break; const n = Math.min(left, o.qty_remaining); subtotal += n * o.price_minor; filled += n; left -= n; }
  const fee = q.side === 'sell' ? feeFromBps(subtotal, cfg.exchangeFeeBps) : 0;   // sellers pay the exchange fee; it is destroyed (a sink)
  const id = `q-${tick}-${q.companyId}-${q.commodityId}-${q.side}-${q.quantity}-${kind === 'market' ? `market-${slip}` : kind === 'direct' ? `${limitPrice}-direct-${q.fromCompanyId}` : limitPrice}`;
  db.run('INSERT OR REPLACE INTO quotes (id, company_id, commodity_id, side, qty, limit_minor, subtotal_minor, fee_minor, total_minor, tick) VALUES (?,?,?,?,?,?,?,?,?,?)', id, q.companyId, q.commodityId, q.side, q.quantity, limitPrice, subtotal, fee, q.side === 'buy' ? subtotal : subtotal - fee, tick);
  return { ok: true, quote: { id, tick, quantity: q.quantity, subtotalMinor: subtotal, feeMinor: fee, totalMinor: q.side === 'buy' ? subtotal : subtotal - fee, availableUnits: filled, revision: tick, kind, limitPriceMinor: limitPrice, reserveMinor: q.side === 'buy' ? limitPrice * q.quantity : 0, slippageBps: slip } };
}

/** commodity.order — places a real limit order (reserving coins or stock first). Requires a current-tick quote for the same terms. */
export function placePlayerOrder(db: Sql, key: string, o: QuoteInput & { quoteId: string }): CommandResponse<{ orderId: number; filled: number; remaining: number; status: string }> {
  return runCommand(db, key, 'commodity.order', (ctx) => {
    const c = owned(db, o.companyId); if (isErr(c)) return c;
    const quote = db.get<{ tick: number; company_id: string; commodity_id: string; side: string; qty: number; limit_minor: number }>('SELECT * FROM quotes WHERE id = ?', o.quoteId);
    if (!quote || quote.tick !== ctx.tick) return err('QUOTE_EXPIRED', 'This quote has expired; request a new quote.');
    const kind = o.kind ?? 'limit';
    if (quote.company_id !== o.companyId || quote.commodity_id !== o.commodityId || quote.side !== o.side || quote.qty !== o.quantity || (kind !== 'market' && quote.limit_minor !== o.limitPriceMinor) || o.quoteId.includes('-market-') !== (kind === 'market') || o.quoteId.includes('-direct-') !== (kind === 'direct') || (kind === 'direct' && !o.quoteId.endsWith(`-direct-${o.fromCompanyId}`))) return err('VALIDATION', 'The order does not match its quote.');
    const cfg = loadConfig(db);
    const slip = kind === 'market' ? Number(/-market-(\d+)$/.exec(o.quoteId)?.[1] ?? cfg.marketSlippageBps) : undefined;
    const expiresIn = kind !== 'limit' ? null : o.expiresInTicks === undefined ? 30 : o.expiresInTicks;
    if (expiresIn !== null && (!Number.isSafeInteger(expiresIn) || expiresIn < 1 || expiresIn > cfg.maxOrderTicks)) return err('VALIDATION', `An order can last 1 to ${cfg.maxOrderTicks} days.`);
    if (o.side === 'buy') {
      // Storage is physical: goods bought must fit in the warehouse, counting what is already held and what open buy orders may still bring in.
      const held = db.get<{ q: number }>('SELECT COALESCE(SUM(qty),0) q FROM inventory WHERE company_id = ?', o.companyId)!.q;
      const onOrder = db.get<{ q: number }>("SELECT COALESCE(SUM(qty_remaining),0) q FROM orders WHERE company_id = ? AND side = 'buy' AND status = 'open'", o.companyId)!.q;
      const room = c.storage_cap_units - held - onOrder;
      if (o.quantity > room) return err('VALIDATION', `${c.name} has room for ${Math.max(0, room)} more units (storage ${c.storage_cap_units}, holding ${held}, ${onOrder} already on order).`, { quantity: 'Not enough storage room' });
    }
    const r = placeOrder(db, ctx, cfg.exchangeFeeBps, { company: o.companyId, commodity: o.commodityId, side: o.side, price: kind === 'market' ? quote.limit_minor : o.limitPriceMinor, qty: o.quantity, key: `player:${key}`, kind, slippageBps: slip, expiresTick: expiresIn === null ? null : ctx.tick + expiresIn, onlyFrom: kind === 'direct' ? o.fromCompanyId : undefined });
    const filled = r.order.qty_original - r.order.qty_remaining;
    return { ok: true, revision: ctx.tick, transactionId: String(r.order.id), refreshScreens: ['commodities', 'city', 'companies'], data: { orderId: r.order.id, filled, remaining: r.order.qty_remaining, status: r.order.status === 'cancelled' && filled > 0 ? 'partially_filled_remainder_cancelled' : r.order.status } };
  }) as CommandResponse<{ orderId: number; filled: number; remaining: number; status: string }>;
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

