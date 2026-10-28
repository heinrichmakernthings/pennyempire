import type { Sql } from '../db/sql';
import { addStock, freeStock, releaseStock, removeStock, reserveStock } from './inventory';
import { LedgerError, available, destroy, releaseFunds, reserveFunds, transfer, type TickCtx } from './ledger';
import { feeFromBps } from '../../src/domain/money';

export interface OrderRow { id: number; company_id: string; commodity_id: string; side: 'buy' | 'sell'; price_minor: number; qty_original: number; qty_remaining: number; reserved_funds_minor: number; status: 'open' | 'filled' | 'cancelled'; created_tick: number }
export type MarketErrorCode = 'INVALID_ORDER' | 'INSUFFICIENT_FUNDS' | 'INSUFFICIENT_STOCK' | 'NOT_FOUND' | 'FORBIDDEN' | 'NOT_OPEN';
export class MarketError extends Error { constructor(public readonly code: MarketErrorCode, message: string) { super(message); this.name = 'MarketError'; } }

export interface FillEvent { tradeId: number; commodityId: string; buyer: string; seller: string; qty: number; price: number; fee: number; cost: number }
export type TradeSink = (f: FillEvent) => void;

const treasuryOf = (db: Sql, company: string): string => {
  const r = db.get<{ a: string }>('SELECT treasury_account_id a FROM companies WHERE id = ?', company);
  if (!r) throw new MarketError('NOT_FOUND', `Unknown company ${company}`);
  return r.a;
};

export interface PlaceOrder { company: string; commodity: string; side: 'buy' | 'sell'; price: number; qty: number; /** immediate-or-cancel: whatever cannot fill now is cancelled */ ioc?: boolean; key?: string | null }

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
        if (prior.company_id !== o.company || prior.commodity_id !== o.commodity || prior.side !== o.side || prior.price_minor !== o.price || prior.qty_original !== o.qty) throw new MarketError('INVALID_ORDER', 'Idempotency key reused for a different order');
        return { order: prior, fills: [], duplicate: true };
      }
    }
    if (!Number.isSafeInteger(o.price) || o.price <= 0 || !Number.isSafeInteger(o.qty) || o.qty <= 0) throw new MarketError('INVALID_ORDER', 'Price and quantity must be positive integers');
    if (!db.get('SELECT 1 FROM commodities WHERE id = ?', o.commodity)) throw new MarketError('INVALID_ORDER', `Unknown commodity ${o.commodity}`);
    const acct = treasuryOf(db, o.company);
    const reserve = o.side === 'buy' ? o.price * o.qty : 0;
    try {
      if (o.side === 'buy') reserveFunds(db, acct, reserve); else reserveStock(db, o.company, o.commodity, o.qty);
    } catch (e) {
      if (e instanceof LedgerError) throw new MarketError('INSUFFICIENT_FUNDS', e.message);
      throw new MarketError('INSUFFICIENT_STOCK', (e as Error).message);
    }
    const ins = db.run("INSERT INTO orders (company_id, commodity_id, side, price_minor, qty_original, qty_remaining, reserved_funds_minor, status, created_tick, idempotency_key) VALUES (?,?,?,?,?,?,?, 'open', ?, ?)", o.company, o.commodity, o.side, o.price, o.qty, o.qty, reserve, ctx.tick, o.key ?? null);
    const id = ins.lastInsertRowid;
    const fills = matchOrder(db, ctx, feeBps, id, onFill);
    if (o.ioc) cancelIfOpen(db, id);
    return { order: db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', id)!, fills, duplicate: false };
  });
}

function cancelIfOpen(db: Sql, id: number) {
  const o = db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', id)!;
  if (o.status !== 'open') return;
  if (o.side === 'buy') { releaseFunds(db, treasuryOf(db, o.company_id), o.reserved_funds_minor); } else if (o.qty_remaining > 0) releaseStock(db, o.company_id, o.commodity_id, o.qty_remaining);
  db.run("UPDATE orders SET status = 'cancelled', reserved_funds_minor = 0 WHERE id = ?", id);
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

/** Matches one order against the opposite side (price-time priority). Execution price is the resting (earlier) order's price. */
function matchOrder(db: Sql, ctx: TickCtx, feeBps: number, id: number, onFill?: TradeSink): FillEvent[] {
  const fills: FillEvent[] = [];
  for (;;) {
    const me = db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', id)!;
    if (me.status !== 'open' || me.qty_remaining === 0) break;
    const other = me.side === 'buy'
      ? db.get<OrderRow>("SELECT * FROM orders WHERE commodity_id = ? AND side = 'sell' AND status = 'open' AND price_minor <= ? AND company_id <> ? AND qty_remaining > 0 ORDER BY price_minor ASC, id ASC LIMIT 1", me.commodity_id, me.price_minor, me.company_id)
      : db.get<OrderRow>("SELECT * FROM orders WHERE commodity_id = ? AND side = 'buy' AND status = 'open' AND price_minor >= ? AND company_id <> ? AND qty_remaining > 0 ORDER BY price_minor DESC, id ASC LIMIT 1", me.commodity_id, me.price_minor, me.company_id);
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
    for (const b of db.all<{ id: number }>("SELECT id FROM orders WHERE commodity_id = ? AND side = 'buy' AND status = 'open' ORDER BY price_minor DESC, id ASC", commodity)) fills.push(...matchOrder(db, ctx, feeBps, b.id, onFill));
    return fills;
  });
}

/** Atomic settlement of one fill: goods and coins move together, the fee is destroyed, reservations shrink by exactly what was used. */
function settle(db: Sql, ctx: TickCtx, feeBps: number, buy: OrderRow, sell: OrderRow, qty: number, price: number, onFill?: TradeSink): FillEvent {
  const buyerAcct = treasuryOf(db, buy.company_id), sellerAcct = treasuryOf(db, sell.company_id);
  const gross = price * qty, fee = feeFromBps(gross, feeBps);
  // 1. buyer's reservation for this slice (at ITS limit) is released, then the actual price is paid
  const slice = buy.price_minor * qty;
  releaseFunds(db, buyerAcct, slice);
  db.run('UPDATE orders SET reserved_funds_minor = reserved_funds_minor - ? WHERE id = ?', slice, buy.id);
  const trade = db.run('INSERT INTO trades (tick, commodity_id, buy_order_id, sell_order_id, buyer_company_id, seller_company_id, qty, price_minor, fee_minor, ledger_tx_id) VALUES (?,?,?,?,?,?,?,?,?,NULL)', ctx.tick, buy.commodity_id, buy.id, sell.id, buy.company_id, sell.company_id, qty, price, fee).lastInsertRowid;
  const tx = transfer(db, ctx, `trade:${trade}:settle`, buyerAcct, sellerAcct, gross, 'trade_settlement', `${qty} ${buy.commodity_id} @ ${price}`);
  if (fee > 0) destroy(db, ctx, `trade:${trade}:fee`, sellerAcct, fee, `exchange fee on trade ${trade}`, 'sink_fee');
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

/** Cheapest asks that a buyer could take right now (for sizing procurement and quoting). */
export function depth(db: Sql, commodity: string, limit: number, excludeCompany: string, maxQty: number): { qty: number; cost: number } {
  let need = maxQty, cost = 0, got = 0;
  for (const a of db.all<OrderRow>("SELECT * FROM orders WHERE commodity_id = ? AND side='sell' AND status='open' AND price_minor <= ? AND company_id <> ? ORDER BY price_minor ASC, id ASC", commodity, limit, excludeCompany)) {
    if (need <= 0) break;
    const q = Math.min(need, a.qty_remaining); cost += q * a.price_minor; got += q; need -= q;
  }
  return { qty: got, cost };
}

export { available, freeStock };
