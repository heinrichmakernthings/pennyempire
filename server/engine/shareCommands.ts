import type { Sql } from '../db/sql';
import { feeFromBps } from '../../src/domain/money';
import { PLAYER_ID } from '../seed/bristol';
import { loadConfig } from './config';
import { runCommand, type CommandResponse } from './commands';
import { ShareError, companyInvestor, companyInvestorId, getInvestor, holding, outstanding, ownerInvestor, security, THRESHOLDS, wouldCreateCycle } from './capital';
import { declareDividend, dividendCapacity } from './dividends';
import { listCompany, listingQuote, retireTreasuryShares, shareCfg, withdrawOffering, type ListingQuote } from './listing';
import { bestOpposite, cancelShareOrder, marketLimit, orderBook, placeShareOrder, priceBand, type ShareOrderRow } from './shareMarket';
import { available } from './ledger';

const player = { kind: 'player', id: PLAYER_ID } as const;
const err = (code: 'VALIDATION' | 'FORBIDDEN' | 'INSUFFICIENT_FUNDS' | 'INSUFFICIENT_STOCK', message: string): CommandResponse => ({ ok: false, error: { code, message } });
const lastTick = (db: Sql) => db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;

/** The investors the human player may act for: themself, and the companies they control (a company can hold shares of another company). */
export function playerInvestorIds(db: Sql): string[] {
  ownerInvestor(db, PLAYER_ID, 'player');
  return [PLAYER_ID, ...db.all<{ id: string }>("SELECT id FROM companies WHERE owner_kind = 'player' AND owner_id = ? AND bankrupt_tick IS NULL AND status <> 'insolvent' ORDER BY id", PLAYER_ID).map((r) => companyInvestorId(r.id))];
}
function resolveInvestor(db: Sql, id: string | undefined): string | CommandResponse {
  const want = id ?? PLAYER_ID; ownerInvestor(db, PLAYER_ID, 'player');
  if (want.startsWith('co:')) { const co = want.slice(3); if (!db.get('SELECT 1 FROM companies WHERE id = ?', co)) return err('VALIDATION', `Unknown company ${co}`); }
  if (!playerInvestorIds(db).includes(want)) return err('FORBIDDEN', 'You do not control that shareholder.');
  if (want.startsWith('co:')) companyInvestor(db, want.slice(3));
  return want;
}
const code = (e: ShareError): 'VALIDATION' | 'FORBIDDEN' | 'INSUFFICIENT_FUNDS' | 'INSUFFICIENT_STOCK' => (e.code === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : e.code === 'INSUFFICIENT_SHARES' ? 'INSUFFICIENT_STOCK' : e.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'VALIDATION');
const guard = (fn: () => CommandResponse): CommandResponse => { try { return fn(); } catch (e) { if (e instanceof ShareError) return err(code(e), e.message); throw e; } };
const ok = (db: Sql, key: string, screens: string[], data?: unknown): CommandResponse => ({ ok: true, revision: lastTick(db), transactionId: key, refreshScreens: screens, data });

export interface ShareOrderInput { companyId: string; investorId?: string; side: 'buy' | 'sell'; quantity: number; limitPriceMinor?: number; kind?: 'limit' | 'market'; slippageBps?: number; expiresInTicks?: number | null; acknowledgeControlLoss?: boolean }
export function placePlayerShareOrder(db: Sql, key: string, o: ShareOrderInput): CommandResponse {
  return runCommand(db, key, 'share.order', (ctx) => guard(() => {
    const cfg = loadConfig(db); const inv = resolveInvestor(db, o.investorId); if (typeof inv !== 'string') return inv;
    if (o.expiresInTicks !== undefined && o.expiresInTicks !== null && (o.expiresInTicks < 1 || o.expiresInTicks > cfg.shareMaxOrderTicks)) return err('VALIDATION', `An order can last 1–${cfg.shareMaxOrderTicks} days`);
    const r = placeShareOrder(db, ctx, shareCfg(cfg), { company: o.companyId, investor: inv, side: o.side, price: o.limitPriceMinor ?? 0, qty: o.quantity, kind: o.kind, slippageBps: o.slippageBps, key: `${key}:o`, expiresTick: o.expiresInTicks ? ctx.tick + o.expiresInTicks : null, acknowledgeControlLoss: o.acknowledgeControlLoss });
    const filled = r.fills.reduce((a, f) => a + f.qty, 0);
    return ok(db, key, ['stocks', 'portfolio', 'city'], { orderId: r.order.id, status: r.order.status, filled, remaining: r.order.qty_remaining, averagePriceMinor: filled ? Math.round(r.fills.reduce((a, f) => a + f.qty * f.price, 0) / filled) : null, feeMinor: r.fills.reduce((a, f) => a + (f.seller === inv ? f.fee : 0), 0) });
  }));
}
export function cancelPlayerShareOrder(db: Sql, key: string, orderId: number): CommandResponse {
  return runCommand(db, key, 'share.cancel', () => guard(() => {
    const o = db.get<ShareOrderRow>('SELECT * FROM share_orders WHERE id = ?', orderId); if (!o) return err('VALIDATION', `No order ${orderId}`);
    if (!playerInvestorIds(db).includes(o.investor_id)) return err('FORBIDDEN', 'Not your order.');
    cancelShareOrder(db, orderId); return ok(db, key, ['stocks', 'portfolio']);
  }));
}
export function listPlayerCompany(db: Sql, key: string, i: { companyId: string; newShares: number; offerPriceMinor: number; fromTreasury?: boolean }): CommandResponse {
  return runCommand(db, key, 'share.list', (ctx) => guard(() => { const r = listCompany(db, ctx, loadConfig(db), `${key}:l`, i.companyId, i.newShares, i.offerPriceMinor, player, { fromTreasury: i.fromTreasury }); return ok(db, key, ['stocks', 'companies', 'portfolio'], { offeringId: r.offeringId, orderId: r.orderId }); }));
}
export function withdrawPlayerOffering(db: Sql, key: string, offeringId: number): CommandResponse { return runCommand(db, key, 'share.withdraw', () => guard(() => { withdrawOffering(db, offeringId, player); return ok(db, key, ['stocks']); })); }
export function retirePlayerShares(db: Sql, key: string, companyId: string, qty: number): CommandResponse { return runCommand(db, key, 'share.retire', (ctx) => guard(() => { retireTreasuryShares(db, ctx, companyId, qty, player); return ok(db, key, ['stocks', 'companies']); })); }
export function declarePlayerDividend(db: Sql, key: string, companyId: string, perShareMinor: number): CommandResponse {
  return runCommand(db, key, 'dividend.declare', (ctx) => guard(() => {
    const c = db.get<{ owner_kind: string; owner_id: string }>('SELECT owner_kind, owner_id FROM companies WHERE id = ?', companyId);
    if (!c) return err('VALIDATION', `Unknown company ${companyId}`);
    if (c.owner_kind !== 'player' || c.owner_id !== PLAYER_ID) return err('FORBIDDEN', 'Only the controlling owner can declare a dividend.');
    const d = declareDividend(db, ctx, loadConfig(db), `${key}:d`, companyId, perShareMinor, PLAYER_ID);
    return ok(db, key, ['companies', 'portfolio', 'stocks'], { dividendId: d.id, totalMinor: d.total_minor });
  }));
}

/** Read-only preview of an order: what it would reserve, where it would trade, and every rule it might trip. Authoritative checks still happen at placement. */
export interface ShareOrderQuote { ok: boolean; issues: string[]; warnings: string[]; band: { lowMinor: number; highMinor: number; refMinor: number; basis: string } | null; limitPriceMinor: number | null; reserveMinor: number; estimatedFeeMinor: number; bestOppositeMinor: number | null; availableMinor: number; freeShares: number }
export function quoteShareOrder(db: Sql, o: ShareOrderInput): ShareOrderQuote {
  const cfg = loadConfig(db), t = lastTick(db); const issues: string[] = [], warnings: string[] = [];
  const sec = security(db, o.companyId); const inv = getInvestor(db, o.investorId ?? PLAYER_ID) ?? ownerInvestor(db, PLAYER_ID, 'player');
  if (!sec) issues.push('Unknown company.'); else if (sec.status !== 'open') issues.push(sec.status === 'suspended' ? `Trading is suspended${sec.suspended_reason ? `: ${sec.suspended_reason}` : ''}.` : 'This company is not listed.');
  const band = sec ? priceBand(db, cfg, o.companyId, t) : null;
  const best = sec ? bestOpposite(db, o.companyId, o.side, inv.id, t) : null;
  let limit = o.kind === 'market' ? (sec ? marketLimit(db, o.companyId, o.side, inv.id, t, Math.min(o.slippageBps ?? cfg.marketSlippageBps, cfg.maxSlippageBps)) : null) : o.limitPriceMinor ?? null;
  if (o.kind === 'market' && limit === null) issues.push('Nobody is on the other side of the book, so a market order has nothing to protect you against. Use a limit order.');
  if (limit !== null && band) { if (o.kind === 'market') limit = Math.min(Math.max(limit, band.low), band.high); else if (limit < band.low || limit > band.high) issues.push(`Price is outside today's range (${(band.low / 100).toFixed(2)}–${(band.high / 100).toFixed(2)} EC).`); }
  if (!Number.isSafeInteger(o.quantity) || o.quantity <= 0) issues.push('Quantity must be a positive whole number.');
  if (limit !== null && (!Number.isSafeInteger(limit) || limit <= 0)) issues.push('Price must be a positive amount.');
  const reserve = o.side === 'buy' && limit ? limit * o.quantity : 0;
  const avail = available(db, inv.account_id);
  if (o.side === 'buy' && reserve > avail) issues.push(`You need ${(reserve / 100).toFixed(2)} EC available; you have ${(avail / 100).toFixed(2)} EC.`);
  const h = holding(db, o.companyId, inv.id);
  if (o.side === 'sell' && o.quantity > h.shares - h.reserved) issues.push(`You can sell at most ${h.shares - h.reserved} shares.`);
  if (o.side === 'buy' && inv.kind === 'company' && inv.company_id && sec && wouldCreateCycle(db, inv.company_id, o.companyId)) issues.push('That would create circular ownership.');
  const out = outstanding(db, o.companyId);
  if (o.side === 'sell' && out > 0 && h.shares * 10_000 > THRESHOLDS.majorityBps * out && (h.shares - o.quantity) * 10_000 <= THRESHOLDS.majorityBps * out) warnings.push('This sale would give up your majority control of the company.');
  if (o.side === 'buy' && out > 0 && (h.shares + o.quantity) * 10_000 > THRESHOLDS.majorityBps * out) warnings.push('This purchase would give you majority control of the company.');
  const book = sec ? orderBook(db, o.companyId, t) : { bids: [], asks: [] };
  if (o.side === 'buy' && limit && book.asks.length === 0) warnings.push('Nobody is selling right now: your order will rest on the book until someone does.');
  if (o.side === 'sell' && limit && book.bids.length === 0) warnings.push('Nobody is bidding right now: your order will rest on the book until someone does.');
  return { ok: issues.length === 0, issues, warnings, band: band ? { lowMinor: band.low, highMinor: band.high, refMinor: band.ref, basis: band.basis } : null, limitPriceMinor: limit, reserveMinor: reserve, estimatedFeeMinor: o.side === 'sell' && limit ? feeFromBps(limit * o.quantity, cfg.shareFeeBps) : 0, bestOppositeMinor: best, availableMinor: avail, freeShares: h.shares - h.reserved };
}
export { listingQuote, dividendCapacity };
export type { ListingQuote };
