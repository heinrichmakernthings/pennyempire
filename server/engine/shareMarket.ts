import type { Sql } from '../db/sql';
import { feeFromBps } from '../../src/domain/money';
import { EXCHANGE_ACCOUNT } from '../seed/bristol';
import { LedgerError, available, releaseFunds, reserveFunds, transfer, type TickCtx } from './ledger';
import {
  ShareError, companyInvestorId, freeShares, getInvestor, holding, moveShares, outstanding, refreshControl, security, stakeBps, ultimateOwnerKey, wouldCreateCycle, THRESHOLDS,
  type Investor,
} from './capital';

export interface ShareOrderRow {
  id: number; company_id: string; investor_id: string; side: 'buy' | 'sell'; kind: 'limit' | 'market'; price_minor: number; qty_original: number; qty_remaining: number; reserved_funds_minor: number;
  status: 'open' | 'filled' | 'cancelled'; end_reason: string | null; created_tick: number; expires_tick: number | null; primary_offering_id: number | null; idempotency_key: string | null;
}
export interface ShareFill { tradeId: number; company: string; buyer: string; seller: string; qty: number; price: number; fee: number; primaryOfferingId: number | null }
export interface PlaceShareOrder {
  company: string; investor: string; side: 'buy' | 'sell'; price: number; qty: number; kind?: 'limit' | 'market'; slippageBps?: number; key?: string | null; expiresTick?: number | null;
  /** internal: an offering placed by the company itself for newly issued shares */ offeringId?: number | null;
  /** required to place a sale that would leave the seller without a majority they currently hold */ acknowledgeControlLoss?: boolean;
}

export interface ShareConfig { shareFeeBps: number; shareBandBps: number; shareRefStaleTicks: number; shareMaxOrderTicks: number; marketSlippageBps: number; maxSlippageBps: number }

const hasOpen = (status: string) => status === 'open';
export const tradable = (db: Sql, company: string) => hasOpen(security(db, company)?.status ?? 'unlisted');

/** The day's reference price and permitted band. Reference = the last close before today, else the offer price, else the latest fundamental estimate. Orders outside the band are refused. */
export function priceBand(db: Sql, cfg: Pick<ShareConfig, 'shareBandBps' | 'shareRefStaleTicks'>, company: string, tick: number): { ref: number; low: number; high: number; basis: 'close' | 'offer' | 'fundamental' } | null {
  const last = db.get<{ tick: number; close_minor: number }>('SELECT tick, close_minor FROM security_stats WHERE company_id = ? AND close_minor IS NOT NULL AND tick < ? ORDER BY tick DESC LIMIT 1', company, tick);
  let ref: number | null = null, basis: 'close' | 'offer' | 'fundamental' = 'close';
  if (last && tick - last.tick <= cfg.shareRefStaleTicks) ref = last.close_minor;
  if (ref === null) {
    const sec = security(db, company);
    // never traded (or stale): the offer price for a fresh listing, otherwise what the fundamentals say
    const fv = db.get<{ v: number }>('SELECT fair_value_minor v FROM security_valuations WHERE company_id = ? AND tick <= ? ORDER BY tick DESC LIMIT 1', company, tick)?.v ?? null;
    if (last && fv !== null) { ref = fv; basis = 'fundamental'; }
    else if (sec?.listing_price_minor && !last && sec.listed_tick !== null && tick - sec.listed_tick <= cfg.shareRefStaleTicks) { ref = sec.listing_price_minor; basis = 'offer'; }
    else if (fv !== null) { ref = fv; basis = 'fundamental'; }
    else if (last) { ref = last.close_minor; }
  }
  if (ref === null || ref <= 0) return null;
  return { ref, low: Math.max(1, Math.ceil((ref * (10_000 - cfg.shareBandBps)) / 10_000)), high: Math.floor((ref * (10_000 + cfg.shareBandBps)) / 10_000), basis };
}

const blocked = (db: Sql, a: Investor, b: Investor) => a.id === b.id || a.account_id === b.account_id || ultimateOwnerKey(db, a.id) === ultimateOwnerKey(db, b.id);

const liveSql = "status = 'open' AND qty_remaining > 0 AND (expires_tick IS NULL OR expires_tick > ?)";
function candidates(db: Sql, me: ShareOrderRow, tick: number): ShareOrderRow[] {
  return me.side === 'buy'
    ? db.all<ShareOrderRow>(`SELECT * FROM share_orders WHERE company_id = ? AND side = 'sell' AND price_minor <= ? AND ${liveSql} ORDER BY price_minor ASC, id ASC LIMIT 100`, me.company_id, me.price_minor, tick)
    : db.all<ShareOrderRow>(`SELECT * FROM share_orders WHERE company_id = ? AND side = 'buy' AND price_minor >= ? AND ${liveSql} ORDER BY price_minor DESC, id ASC LIMIT 100`, me.company_id, me.price_minor, tick);
}
/** The best resting price `investor` could actually trade against (self- and related-account orders are invisible to them). */
export function bestOpposite(db: Sql, company: string, side: 'buy' | 'sell', investor: string, tick: number): number | null {
  const me = getInvestor(db, investor); if (!me) return null;
  const rows = side === 'buy'
    ? db.all<ShareOrderRow>(`SELECT * FROM share_orders WHERE company_id = ? AND side = 'sell' AND ${liveSql} ORDER BY price_minor ASC, id ASC LIMIT 100`, company, tick)
    : db.all<ShareOrderRow>(`SELECT * FROM share_orders WHERE company_id = ? AND side = 'buy' AND ${liveSql} ORDER BY price_minor DESC, id ASC LIMIT 100`, company, tick);
  for (const r of rows) { const o = getInvestor(db, r.investor_id)!; if (!blocked(db, me, o)) return r.price_minor; }
  return null;
}

export function marketLimit(db: Sql, company: string, side: 'buy' | 'sell', investor: string, tick: number, slippageBps: number): number | null {
  const best = bestOpposite(db, company, side, investor, tick); if (best === null) return null;
  return side === 'buy' ? Math.ceil((best * (10_000 + slippageBps)) / 10_000) : Math.max(1, Math.floor((best * (10_000 - slippageBps)) / 10_000));
}

/**
 * Places a limit (or slippage-protected market) order. Reserves what it needs first — the buyer's coins at the limit price, or the seller's shares — then matches by
 * price-time priority, all in one transaction: a failure leaves no reservation, no partial fill, no trade. Same idempotency key = same order back.
 */
export function placeShareOrder(db: Sql, ctx: TickCtx, cfg: ShareConfig, o: PlaceShareOrder, onFill?: (f: ShareFill) => void): { order: ShareOrderRow; fills: ShareFill[]; duplicate: boolean } {
  return db.transaction(() => {
    if (o.key) {
      const prior = db.get<ShareOrderRow>('SELECT * FROM share_orders WHERE idempotency_key = ?', o.key);
      if (prior) {
        if (prior.company_id !== o.company || prior.investor_id !== o.investor || prior.side !== o.side || prior.qty_original !== o.qty || (prior.kind === 'limit' && (o.kind ?? 'limit') === 'limit' && prior.price_minor !== o.price)) throw new ShareError('INVALID', `Idempotency key ${o.key} was already used for a different order`);
        return { order: prior, fills: [], duplicate: true };
      }
    }
    const sec = security(db, o.company);
    if (!sec) throw new ShareError('NOT_FOUND', `Unknown company ${o.company}`);
    if (sec.status !== 'open') throw new ShareError('NOT_TRADABLE', sec.status === 'suspended' ? `Trading in ${sec.ticker} is suspended${sec.suspended_reason ? `: ${sec.suspended_reason}` : ''}` : `${sec.ticker} is not listed for trading`);
    const inv = getInvestor(db, o.investor); if (!inv) throw new ShareError('NOT_FOUND', `Unknown investor ${o.investor}`);
    const kind = o.kind ?? 'limit';
    let price = o.price;
    if (kind === 'market') {
      const lim = marketLimit(db, o.company, o.side, o.investor, ctx.tick, Math.min(o.slippageBps ?? cfg.marketSlippageBps, cfg.maxSlippageBps));
      if (lim === null) throw new ShareError('INVALID', `Nobody is ${o.side === 'buy' ? 'selling' : 'buying'} ${sec.ticker} right now, so a market order has nothing to protect you against. Place a limit order instead.`);
      price = lim;
    }
    if (!Number.isSafeInteger(price) || price <= 0 || !Number.isSafeInteger(o.qty) || o.qty <= 0) throw new ShareError('INVALID', 'Price and quantity must be positive whole numbers');
    if (o.expiresTick !== undefined && o.expiresTick !== null && (!Number.isSafeInteger(o.expiresTick) || o.expiresTick <= ctx.tick)) throw new ShareError('INVALID', 'An order must expire in the future');
    const band = priceBand(db, cfg, o.company, ctx.tick);
    if (band) {
      if (kind === 'market') price = Math.min(Math.max(price, band.low), band.high);
      else if (price < band.low || price > band.high) throw new ShareError('RULE', `${(price / 100).toFixed(2)} EC is outside today's allowed range for ${sec.ticker} (${(band.low / 100).toFixed(2)}–${(band.high / 100).toFixed(2)} EC, ±${cfg.shareBandBps / 100}% of ${(band.ref / 100).toFixed(2)} EC)`);
    }
    if (o.side === 'buy') {
      if (inv.kind === 'company' && inv.company_id && wouldCreateCycle(db, inv.company_id, o.company)) throw new ShareError('CIRCULAR', `${inv.name} cannot buy shares of ${sec.ticker}: that would create circular ownership`);
      if (inv.id === companyInvestorId(o.company)) throw new ShareError('RULE', 'A company cannot buy its own shares on the exchange');
      try { reserveFunds(db, inv.account_id, price * o.qty); } catch (e) { if (e instanceof LedgerError) throw new ShareError('INSUFFICIENT_FUNDS', e.message); throw e; }
    } else {
      const h = holding(db, o.company, o.investor);
      if (h.shares - h.reserved < o.qty) throw new ShareError('INSUFFICIENT_SHARES', `${inv.name} has ${h.shares - h.reserved} free shares of ${sec.ticker}; cannot sell ${o.qty}`);
      const out = outstanding(db, o.company);
      const isController = out > 0 && h.shares * 10_000 > THRESHOLDS.majorityBps * out && !o.offeringId;
      if (isController && (h.shares - o.qty) * 10_000 <= THRESHOLDS.majorityBps * out && !o.acknowledgeControlLoss) throw new ShareError('RULE', `Selling ${o.qty} shares would drop ${inv.name} to ${(((h.shares - o.qty) * 100) / out).toFixed(1)}%, giving up majority control of ${sec.ticker}. Confirm to proceed.`);
      db.run('UPDATE share_holdings SET reserved = reserved + ? WHERE company_id = ? AND investor_id = ?', o.qty, o.company, o.investor);
    }
    const ins = db.run("INSERT INTO share_orders (company_id, investor_id, side, kind, price_minor, qty_original, qty_remaining, reserved_funds_minor, status, created_tick, expires_tick, primary_offering_id, idempotency_key) VALUES (?,?,?,?,?,?,?,?, 'open', ?,?,?,?)",
      o.company, o.investor, o.side, kind, price, o.qty, o.qty, o.side === 'buy' ? price * o.qty : 0, ctx.tick, o.expiresTick ?? null, o.offeringId ?? null, o.key ?? null);
    const id = ins.lastInsertRowid;
    const fills = matchOrder(db, ctx, cfg, id, onFill);
    if (kind === 'market') endOrder(db, id, 'unfilled_remainder');
    return { order: db.get<ShareOrderRow>('SELECT * FROM share_orders WHERE id = ?', id)!, fills, duplicate: false };
  });
}

/** Releases exactly what an open order still reserves and closes it. */
export function endOrder(db: Sql, id: number, reason: 'cancelled' | 'expired' | 'unfilled_remainder' | 'suspended' | 'delisted') {
  const o = db.get<ShareOrderRow>('SELECT * FROM share_orders WHERE id = ?', id)!;
  if (o.status !== 'open') return;
  if (o.side === 'buy') releaseFunds(db, getInvestor(db, o.investor_id)!.account_id, o.reserved_funds_minor);
  else if (o.qty_remaining > 0) db.run('UPDATE share_holdings SET reserved = reserved - ? WHERE company_id = ? AND investor_id = ?', o.qty_remaining, o.company_id, o.investor_id);
  db.run("UPDATE share_orders SET status = 'cancelled', reserved_funds_minor = 0, end_reason = ? WHERE id = ?", reason, id);
  if (o.primary_offering_id) db.run("UPDATE share_offerings SET status = CASE WHEN shares_sold >= shares_offered THEN 'closed' ELSE 'withdrawn' END WHERE id = ? AND status = 'open'", o.primary_offering_id);
}

export function cancelShareOrder(db: Sql, orderId: number, byInvestor?: string) {
  return db.transaction(() => {
    const o = db.get<ShareOrderRow>('SELECT * FROM share_orders WHERE id = ?', orderId);
    if (!o) throw new ShareError('NOT_FOUND', `No order ${orderId}`);
    if (byInvestor && o.investor_id !== byInvestor) throw new ShareError('FORBIDDEN', 'Not your order');
    if (o.status !== 'open') throw new ShareError('INVALID', `Order ${orderId} is already ${o.status}`);
    endOrder(db, orderId, 'cancelled');
    return db.get<ShareOrderRow>('SELECT * FROM share_orders WHERE id = ?', orderId)!;
  });
}
export const cancelAllOrders = (db: Sql, company: string, reason: 'suspended' | 'delisted') => { for (const o of db.all<{ id: number }>("SELECT id FROM share_orders WHERE company_id = ? AND status = 'open' ORDER BY id", company)) endOrder(db, o.id, reason); };

export function expireShareOrders(db: Sql, tick: number): number {
  return db.transaction(() => { const ids = db.all<{ id: number }>("SELECT id FROM share_orders WHERE status = 'open' AND expires_tick IS NOT NULL AND expires_tick <= ? ORDER BY id", tick); for (const r of ids) endOrder(db, r.id, 'expired'); return ids.length; });
}

function matchOrder(db: Sql, ctx: TickCtx, cfg: ShareConfig, id: number, onFill?: (f: ShareFill) => void): ShareFill[] {
  const fills: ShareFill[] = [];
  for (;;) {
    const me = db.get<ShareOrderRow>('SELECT * FROM share_orders WHERE id = ?', id)!;
    if (me.status !== 'open' || me.qty_remaining === 0) break;
    if (security(db, me.company_id)?.status !== 'open') break;
    const meInv = getInvestor(db, me.investor_id)!;
    let other: ShareOrderRow | undefined;
    for (const c of candidates(db, me, ctx.tick)) { if (!blocked(db, meInv, getInvestor(db, c.investor_id)!)) { other = c; break; } }
    if (!other) break;
    const buy = me.side === 'buy' ? me : other, sell = me.side === 'sell' ? me : other;
    const resting = me.id < other.id ? me : other;
    const qty = Math.min(me.qty_remaining, other.qty_remaining);
    const f = settle(db, ctx, cfg, buy, sell, qty, resting.price_minor);
    fills.push(f); onFill?.(f);
  }
  return fills;
}

/** Re-runs matching for open orders of a company (after a suspension ends). */
export function matchCompany(db: Sql, ctx: TickCtx, cfg: ShareConfig, company: string): ShareFill[] {
  return db.transaction(() => { const out: ShareFill[] = []; for (const b of db.all<{ id: number }>("SELECT id FROM share_orders WHERE company_id = ? AND side = 'buy' AND status = 'open' ORDER BY price_minor DESC, id ASC", company)) out.push(...matchOrder(db, ctx, cfg, b.id)); return out; });
}

/** Atomic settlement of one fill: coins and shares move together, the seller's fee goes to the Penny Exchange, reservations shrink by exactly what was used. */
function settle(db: Sql, ctx: TickCtx, cfg: ShareConfig, buy: ShareOrderRow, sell: ShareOrderRow, qty: number, price: number): ShareFill {
  const buyer = getInvestor(db, buy.investor_id)!, seller = getInvestor(db, sell.investor_id)!;
  const primary = sell.primary_offering_id;
  const gross = price * qty, fee = primary ? 0 : feeFromBps(gross, cfg.shareFeeBps);
  const slice = buy.price_minor * qty;
  releaseFunds(db, buyer.account_id, slice);
  db.run('UPDATE share_orders SET reserved_funds_minor = reserved_funds_minor - ? WHERE id = ?', slice, buy.id);
  const trade = db.run('INSERT INTO share_trades (tick, company_id, buy_order_id, sell_order_id, buyer_id, seller_id, qty, price_minor, fee_minor, primary_offering_id) VALUES (?,?,?,?,?,?,?,?,?,?)', ctx.tick, buy.company_id, buy.id, sell.id, buyer.id, seller.id, qty, price, fee, primary).lastInsertRowid;
  const tx = transfer(db, ctx, `strade:${trade}:settle`, buyer.account_id, seller.account_id, gross, 'trade_settlement', primary ? `${qty} ${buy.company_id} shares @ ${price} (new issue)` : `${qty} ${buy.company_id} shares @ ${price}`);
  let feeTx: number | null = null;
  if (fee > 0) feeTx = transfer(db, ctx, `strade:${trade}:fee`, seller.account_id, EXCHANGE_ACCOUNT, fee, 'state_payment', `share exchange fee on trade ${trade}`).txId;
  const moved = moveShares(db, ctx, buy.company_id, seller.id, buyer.id, qty, price, `strade:${trade}`, { fromReserved: true, ledgerTx: tx.txId });
  if (!primary) db.run("INSERT INTO share_pnl (tick, investor_id, company_id, qty, proceeds_minor, cost_minor, pnl_minor, kind, ref) VALUES (?,?,?,?,?,?,?, 'sale', ?)", ctx.tick, seller.id, buy.company_id, qty, gross - fee, moved.costRemoved, gross - fee - moved.costRemoved, `strade:${trade}`);
  for (const o of [buy, sell]) db.run("UPDATE share_orders SET qty_remaining = qty_remaining - ?, status = CASE WHEN qty_remaining - ? = 0 THEN 'filled' ELSE 'open' END WHERE id = ?", qty, qty, o.id);
  if (primary) {
    db.run("UPDATE share_offerings SET shares_sold = shares_sold + ?, proceeds_minor = proceeds_minor + ?, status = CASE WHEN shares_sold + ? >= shares_offered THEN 'closed' ELSE status END WHERE id = ?", qty, gross, qty, primary);
    db.run('UPDATE securities SET paid_in_minor = paid_in_minor + ? WHERE company_id = ?', gross, buy.company_id);
  }
  db.run('UPDATE share_trades SET ledger_tx_id = ?, fee_tx_id = ? WHERE id = ?', tx.txId, feeTx, trade);
  recordTradeStat(db, ctx.tick, buy.company_id, price, qty);
  const left = db.get<ShareOrderRow>('SELECT * FROM share_orders WHERE id = ?', buy.id)!;
  if (left.status === 'filled' && left.reserved_funds_minor !== 0) throw new ShareError('INVALID', 'filled buy order still holds a reservation');
  refreshControl(db, ctx, buy.company_id);
  return { tradeId: trade, company: buy.company_id, buyer: buyer.id, seller: seller.id, qty, price, fee, primaryOfferingId: primary };
}

/** Running daily statistics, updated trade by trade so trades made between ticks are never missed. */
function recordTradeStat(db: Sql, tick: number, company: string, price: number, qty: number) {
  const s = db.get<{ open_minor: number | null; high_minor: number; low_minor: number; volume: number; vwap_minor: number }>('SELECT open_minor, high_minor, low_minor, volume, vwap_minor FROM security_stats WHERE tick = ? AND company_id = ?', tick, company);
  if (!s) { db.run("INSERT INTO security_stats (tick, company_id, open_minor, high_minor, low_minor, close_minor, vwap_minor, volume, trades, status) VALUES (?,?,?,?,?,?,?,?,1,'open')", tick, company, price, price, price, price, price, qty); return; }
  const vol = s.volume + qty;
  db.run('UPDATE security_stats SET high_minor = MAX(high_minor, ?), low_minor = MIN(low_minor, ?), close_minor = ?, vwap_minor = ?, volume = ?, trades = trades + 1 WHERE tick = ? AND company_id = ?', price, price, price, Math.floor((s.vwap_minor * s.volume + price * qty) / vol), vol, tick, company);
}

export interface BookLevel { priceMinor: number; shares: number; orders: number }
export function orderBook(db: Sql, company: string, tick: number): { bids: BookLevel[]; asks: BookLevel[] } {
  const lv = (side: 'buy' | 'sell') => db.all<{ p: number; q: number; n: number }>(`SELECT price_minor p, SUM(qty_remaining) q, COUNT(*) n FROM share_orders WHERE company_id = ? AND side = ? AND ${liveSql} GROUP BY price_minor ORDER BY price_minor ${side === 'buy' ? 'DESC' : 'ASC'} LIMIT 12`, company, side, tick).map((r) => ({ priceMinor: r.p, shares: r.q, orders: r.n }));
  return { bids: lv('buy'), asks: lv('sell') };
}

export { stakeBps, freeShares, available };
