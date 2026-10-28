import type { Sql } from '../db/sql';
import { addStock, freeStock, releaseStock, removeStock, reserveStock } from './inventory';
import { LedgerError, available, releaseFunds, reserveFunds, transfer, type TickCtx } from './ledger';
import { EXCHANGE_ACCOUNT } from '../seed/bristol';
import { feeFromBps } from '../../src/domain/money';

export interface OrderRow { id: number; company_id: string; commodity_id: string; side: 'buy' | 'sell'; price_minor: number; qty_original: number; qty_remaining: number; reserved_funds_minor: number; status: 'open' | 'filled' | 'cancelled'; created_tick: number; kind: 'limit' | 'market'; expires_tick: number | null; end_reason: 'cancelled' | 'expired' | 'unfilled_remainder' | null; city_id: string }
export type MarketErrorCode = 'INVALID_ORDER' | 'INSUFFICIENT_FUNDS' | 'INSUFFICIENT_STOCK' | 'NOT_FOUND' | 'FORBIDDEN' | 'NOT_OPEN';
export class MarketError extends Error { constructor(public readonly code: MarketErrorCode, message: string) { super(message); this.name = 'MarketError'; } }

export interface FillEvent { tradeId: number; commodityId: string; buyer: string; seller: string; qty: number; price: number; fee: number; cost: number }
export type TradeSink = (f: FillEvent) => void;

const treasuryOf = (db: Sql, company: string): string => {
  const r = db.get<{ a: string }>('SELECT treasury_account_id a FROM companies WHERE id = ?', company);
  if (!r) throw new MarketError('NOT_FOUND', `Unknown company ${company}`);
  return r.a;
};

export interface PlaceOrder {
  company: string; commodity: string; side: 'buy' | 'sell'; price: number; qty: number;
  /** immediate-or-cancel: whatever cannot fill now is cancelled */ ioc?: boolean; key?: string | null;
  /** 'market' orders ignore `price`: the limit is derived from the best opposite price ± slippage, and the order is always immediate-or-cancel. */
  kind?: 'limit' | 'market'; slippageBps?: number;
  /** the order stops being matchable at the start of this tick and is then cancelled with its reservation released */ expiresTick?: number | null;
  cityId?: string;
}

/** Companies a company may not trade with. Only itself: a player's different companies may trade (vertical integration is gameplay), paying the same fees. */
const blockedSet = (_db: Sql, company: string): string[] => [company];
const notIn = (ids: string[]) => ids.map(() => '?').join(',');

/** Best price on the other side of the book that `company` is allowed to trade against right now. */
export function bestOpposite(db: Sql, commodity: string, side: 'buy' | 'sell', company: string, tick: number): number | null {
  const blocked = blockedSet(db, company);
  const r = db.get<{ p: number | null }>(side === 'buy'
    ? `SELECT MIN(price_minor) p FROM orders WHERE commodity_id = ? AND side = 'sell' AND status = 'open' AND qty_remaining > 0 AND (expires_tick IS NULL OR expires_tick > ?) AND company_id NOT IN (${notIn(blocked)})`
    : `SELECT MAX(price_minor) p FROM orders WHERE commodity_id = ? AND side = 'buy' AND status = 'open' AND qty_remaining > 0 AND (expires_tick IS NULL OR expires_tick > ?) AND company_id NOT IN (${notIn(blocked)})`, commodity, tick, ...blocked);
  return r?.p ?? null;
}

/** The limit price a protected market order would carry (null = no liquidity to protect against). */
export function marketLimit(db: Sql, commodity: string, side: 'buy' | 'sell', company: string, tick: number, slippageBps: number): number | null {
  const best = bestOpposite(db, commodity, side, company, tick); if (best === null) return null;
  return side === 'buy' ? Math.ceil((best * (10_000 + slippageBps)) / 10_000) : Math.max(1, Math.floor((best * (10_000 - slippageBps)) / 10_000));
}

/**
 * Places a limit order, reserving what it needs first (buyer coins at the limit price, seller units), then matches by price-time
 * priority. Everything happens in one transaction: a failure leaves no reservation, no partial fill, no trade.
 * Same idempotency key twice returns the original order unchanged.
 */
export function placeOrder(db: Sql, ctx: TickCtx, feeBps: number, o: PlaceOrder, onFill?: TradeSink): { order: OrderRow; fills: FillEvent[]; duplicate: boolean } {
  return db.transaction(() => {
    if (o.key) {
      const prior = db.get<OrderRow>('SELECT * FROM orders WHERE idempotency_key = ?', o.key);
      if (prior) {
        if (prior.company_id !== o.company || prior.commodity_id !== o.commodity || prior.side !== o.side || (prior.kind === 'limit' && prior.price_minor !== o.price) || prior.qty_original !== o.qty) throw new MarketError('INVALID_ORDER', 'Idempotency key reused for a different order');
        return { order: prior, fills: [], duplicate: true };
      }
    }
    const kind = o.kind ?? 'limit';
    let price = o.price;
    if (kind === 'market') {
      const lim = marketLimit(db, o.commodity, o.side, o.company, ctx.tick, o.slippageBps ?? 500);
      if (lim === null) throw new MarketError('INVALID_ORDER', `Nobody is ${o.side === 'buy' ? 'selling' : 'buying'} ${o.commodity} right now, so a market order has nothing to protect you against. Place a limit order instead.`);
      price = lim;
    }
    if (!Number.isSafeInteger(price) || price <= 0 || !Number.isSafeInteger(o.qty) || o.qty <= 0) throw new MarketError('INVALID_ORDER', 'Price and quantity must be positive integers');
    if (o.expiresTick !== undefined && o.expiresTick !== null && (!Number.isSafeInteger(o.expiresTick) || o.expiresTick <= ctx.tick)) throw new MarketError('INVALID_ORDER', 'An order must expire in the future');
    if (!db.get('SELECT 1 FROM commodities WHERE id = ?', o.commodity)) throw new MarketError('INVALID_ORDER', `Unknown commodity ${o.commodity}`);
    const acct = treasuryOf(db, o.company);
    const reserve = o.side === 'buy' ? price * o.qty : 0;
    try {
      if (o.side === 'buy') reserveFunds(db, acct, reserve); else reserveStock(db, o.company, o.commodity, o.qty);
    } catch (e) {
      if (e instanceof LedgerError) throw new MarketError('INSUFFICIENT_FUNDS', e.message);
      throw new MarketError('INSUFFICIENT_STOCK', (e as Error).message);
    }
    const ins = db.run("INSERT INTO orders (company_id, commodity_id, side, price_minor, qty_original, qty_remaining, reserved_funds_minor, status, created_tick, idempotency_key, kind, expires_tick, city_id) VALUES (?,?,?,?,?,?,?, 'open', ?, ?, ?, ?, ?)", o.company, o.commodity, o.side, price, o.qty, o.qty, reserve, ctx.tick, o.key ?? null, kind, o.expiresTick ?? null, o.cityId ?? 'city-bristol');
    const id = ins.lastInsertRowid;
    const fills = matchOrder(db, ctx, feeBps, id, onFill);
    if (o.ioc || kind === 'market') cancelIfOpen(db, id, 'unfilled_remainder');
    return { order: db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', id)!, fills, duplicate: false };
  });
}

function cancelIfOpen(db: Sql, id: number, reason: 'cancelled' | 'expired' | 'unfilled_remainder' = 'cancelled') {
  const o = db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', id)!;
  if (o.status !== 'open') return;
  if (o.side === 'buy') { releaseFunds(db, treasuryOf(db, o.company_id), o.reserved_funds_minor); } else if (o.qty_remaining > 0) releaseStock(db, o.company_id, o.commodity_id, o.qty_remaining);
  db.run("UPDATE orders SET status = 'cancelled', reserved_funds_minor = 0, end_reason = ? WHERE id = ?", reason, id);
}

/** Cancels the remaining quantity of an open order and releases exactly what it still reserves. Owner check is the caller's job (api layer). */
export function cancelOrder(db: Sql, orderId: number, byCompany?: string) {
  return db.transaction(() => {
    const o = db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', orderId);
    if (!o) throw new MarketError('NOT_FOUND', `No order ${orderId}`);
    if (byCompany && o.company_id !== byCompany) throw new MarketError('FORBIDDEN', 'Not your order');
    if (o.status !== 'open') throw new MarketError('NOT_OPEN', `Order ${orderId} is ${o.status}`);
    cancelIfOpen(db, orderId);
    return db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', orderId)!;
  });
}

/** Start-of-tick sweep: orders whose expiry has arrived stop trading and give back exactly what they still reserve. Returns the ids expired. */
export function expireOrders(db: Sql, tick: number): number[] {
  return db.transaction(() => {
    const ids = db.all<{ id: number }>("SELECT id FROM orders WHERE status = 'open' AND expires_tick IS NOT NULL AND expires_tick <= ? ORDER BY id", tick).map((r) => r.id);
    for (const id of ids) cancelIfOpen(db, id, 'expired');
    return ids;
  });
}

/** Matches one order against the opposite side (price-time priority). Execution price is the resting (earlier) order's price. */
function matchOrder(db: Sql, ctx: TickCtx, feeBps: number, id: number, onFill?: TradeSink): FillEvent[] {
  const fills: FillEvent[] = [];
  for (;;) {
    const me = db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', id)!;
    if (me.status !== 'open' || me.qty_remaining === 0) break;
    const blocked = blockedSet(db, me.company_id);
    const live = `status = 'open' AND qty_remaining > 0 AND (expires_tick IS NULL OR expires_tick > ?) AND company_id NOT IN (${notIn(blocked)})`;
    const other = me.side === 'buy'
      ? db.get<OrderRow>(`SELECT * FROM orders WHERE commodity_id = ? AND side = 'sell' AND price_minor <= ? AND ${live} ORDER BY price_minor ASC, id ASC LIMIT 1`, me.commodity_id, me.price_minor, ctx.tick, ...blocked)
      : db.get<OrderRow>(`SELECT * FROM orders WHERE commodity_id = ? AND side = 'buy' AND price_minor >= ? AND ${live} ORDER BY price_minor DESC, id ASC LIMIT 1`, me.commodity_id, me.price_minor, ctx.tick, ...blocked);
    if (!other) break;
    const buy = me.side === 'buy' ? me : other, sell = me.side === 'sell' ? me : other;
    const resting = me.id < other.id ? me : other;
    const qty = Math.min(me.qty_remaining, other.qty_remaining);
    fills.push(settle(db, ctx, feeBps, buy, sell, qty, resting.price_minor, onFill));
  }
  return fills;
}

/** Re-runs matching for every open order of a commodity (used after new asks are posted so resting bids can cross). */
export function matchBook(db: Sql, ctx: TickCtx, feeBps: number, commodity: string, onFill?: TradeSink): FillEvent[] {
  return db.transaction(() => {
    const fills: FillEvent[] = [];
    for (const b of db.all<{ id: number }>("SELECT id FROM orders WHERE commodity_id = ? AND side = 'buy' AND status = 'open' AND (expires_tick IS NULL OR expires_tick > ?) ORDER BY price_minor DESC, id ASC", commodity, ctx.tick)) fills.push(...matchOrder(db, ctx, feeBps, b.id, onFill));
    return fills;
  });
}

/** Atomic settlement of one fill: goods and coins move together, the fee goes to the Penny Exchange, reservations shrink by exactly what was used. */
function settle(db: Sql, ctx: TickCtx, feeBps: number, buy: OrderRow, sell: OrderRow, qty: number, price: number, onFill?: TradeSink): FillEvent {
  const buyerAcct = treasuryOf(db, buy.company_id), sellerAcct = treasuryOf(db, sell.company_id);
  const gross = price * qty, fee = feeFromBps(gross, feeBps);
  // 1. buyer's reservation for this slice (at ITS limit) is released, then the actual price is paid
  const slice = buy.price_minor * qty;
  releaseFunds(db, buyerAcct, slice);
  db.run('UPDATE orders SET reserved_funds_minor = reserved_funds_minor - ? WHERE id = ?', slice, buy.id);
  const trade = db.run('INSERT INTO trades (tick, commodity_id, buy_order_id, sell_order_id, buyer_company_id, seller_company_id, qty, price_minor, fee_minor, ledger_tx_id) VALUES (?,?,?,?,?,?,?,?,?,NULL)', ctx.tick, buy.commodity_id, buy.id, sell.id, buy.company_id, sell.company_id, qty, price, fee).lastInsertRowid;
  const tx = transfer(db, ctx, `trade:${trade}:settle`, buyerAcct, sellerAcct, gross, 'trade_settlement', `${qty} ${buy.commodity_id} @ ${price}`);
  // The fee is a TRANSFER to the Penny Exchange. Coins leave the economy only through the exchange's separate, explicit per-tick burn.
  if (fee > 0) { const f = transfer(db, ctx, `trade:${trade}:fee`, sellerAcct, EXCHANGE_ACCOUNT, fee, 'state_payment', `exchange fee on trade ${trade}`); db.run('UPDATE trades SET fee_tx_id = ? WHERE id = ?', f.txId, trade); }
  // 2. goods
  const cost = removeStock(db, ctx, sell.company_id, sell.commodity_id, qty, 'trade_out', `trade:${trade}`, { fromReserved: true });
  addStock(db, ctx, buy.company_id, buy.commodity_id, qty, gross, 'trade_in', `trade:${trade}`);
  // 3. order bookkeeping
  for (const o of [buy, sell]) {
    db.run("UPDATE orders SET qty_remaining = qty_remaining - ?, status = CASE WHEN qty_remaining - ? = 0 THEN 'filled' ELSE 'open' END WHERE id = ?", qty, qty, o.id);
  }
  db.run('UPDATE trades SET ledger_tx_id = ? WHERE id = ?', tx.txId, trade);
  const ev: FillEvent = { tradeId: trade, commodityId: buy.commodity_id, buyer: buy.company_id, seller: sell.company_id, qty, price, fee, cost };
  onFill?.(ev);
  // a fully filled buy order may have leftover reservation only if it was priced above execution; it was already released slice-by-slice
  const left = db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', buy.id)!;
  if (left.status === 'filled' && left.reserved_funds_minor !== 0) throw new MarketError('INVALID_ORDER', 'filled buy order still holds a reservation');
  return ev;
}

/** The live orders `company` could trade against, best price first (price-time order). `take` is the side being consumed. */
export function liveBook(db: Sql, company: string, commodity: string, take: 'buy' | 'sell', limitPrice: number, tick: number): OrderRow[] {
  const blocked = blockedSet(db, company);
  const base = `commodity_id = ? AND side = ? AND status = 'open' AND qty_remaining > 0 AND (expires_tick IS NULL OR expires_tick > ?) AND company_id NOT IN (${notIn(blocked)})`;
  return take === 'sell'
    ? db.all<OrderRow>(`SELECT * FROM orders WHERE ${base} AND price_minor <= ? ORDER BY price_minor ASC, id ASC`, commodity, 'sell', tick, ...blocked, limitPrice)
    : db.all<OrderRow>(`SELECT * FROM orders WHERE ${base} AND price_minor >= ? ORDER BY price_minor DESC, id ASC`, commodity, 'buy', tick, ...blocked, limitPrice);
}

/** Cheapest asks that a buyer could take right now (for sizing procurement and quoting). */
export function depth(db: Sql, commodity: string, limit: number, excludeCompany: string, maxQty: number, tick = Number.MAX_SAFE_INTEGER - 1): { qty: number; cost: number } {
  let need = maxQty, cost = 0, got = 0;
  for (const a of liveBook(db, excludeCompany, commodity, 'sell', limit, tick)) {
    if (need <= 0) break;
    const q = Math.min(need, a.qty_remaining); cost += q * a.price_minor; got += q; need -= q;
  }
  return { qty: got, cost };
}

export { available, freeStock };
