
import type { Sql } from '../db/sql';
import { feeFromBps } from '../../src/domain/money';
import { EXCHANGE_ACCOUNT, PLAYER_ID } from '../seed/bristol';
import { relatedPartyRevenue } from './relatedParty';
import type { EngineConfig } from './config';
import { ShareError, cancelShares, companyInvestor, companyInvestorId, holding, issueShares, outstanding, security, treasuryShares, type SecurityRow } from './capital';
import { available, transfer, type TickCtx } from './ledger';
import type { CompanyRow } from './operations';
import { cancelShareOrder, placeShareOrder, type ShareConfig } from './shareMarket';
import { computeValuation, type Valuation } from './valuation';
import { logEvent } from './stats';

export interface ListingCheck { id: string; ok: boolean; label: string; detail: string }
export interface ListingQuote {
  companyId: string; kind: 'ipo' | 'follow_on'; eligible: boolean; checks: ListingCheck[];
  newShares: number; offerPriceMinor: number; offeringValueMinor: number; listingFeeMinor: number;
  priceRange: { lowMinor: number; highMinor: number; fairValueMinor: number };
  dilution: { issuedBefore: number; issuedAfter: number; outstandingBefore: number; outstandingAfter: number; controllerStakeBeforeBps: number; controllerStakeAfterBps: number; newInvestorsBps: number };
  valuation: Valuation | null;
}

const isController = (c: CompanyRow, owner: { kind: string; id: string }) => c.owner_kind === owner.kind && c.owner_id === owner.id;

/** Everything a company must satisfy to list or to issue more shares, and exactly what it would cost and dilute. Pure read: the same function guards the real action. */
export function listingQuote(db: Sql, cfg: EngineConfig, companyId: string, newShares: number, offerPriceMinor: number, tick: number, actor: { kind: string; id: string }, opts: { fromTreasury?: boolean } = {}): ListingQuote {
  const c = db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', companyId);
  const sec = security(db, companyId);
  if (!c || !sec) throw new ShareError('NOT_FOUND', `Unknown company ${companyId}`);
  const kind: 'ipo' | 'follow_on' = sec.status === 'unlisted' ? 'ipo' : 'follow_on';
  const val = computeValuation(db, cfg, companyId, tick);
  const fair = val?.fairValuePerShareMinor ?? 0;
  const low = Math.max(1, Math.ceil((fair * cfg.listingPriceLowBps) / 10_000)), high = Math.floor((fair * cfg.listingPriceHighBps) / 10_000);
  const fromTreasury = opts.fromTreasury === true;
  const issuedBefore = sec.issued_shares, out0 = outstanding(db, companyId);
  const issueQty = fromTreasury ? 0 : newShares;
  const offered = newShares;
  const topRow = db.get<{ investor_id: string; shares: number }>('SELECT investor_id, shares FROM share_holdings WHERE company_id = ? AND investor_id <> ? ORDER BY shares DESC LIMIT 1', companyId, companyInvestorId(companyId));
  const ctrlShares = topRow?.shares ?? 0;
  const outAfterFull = out0 + offered;
  const ctrlAfter = outAfterFull > 0 ? Math.floor((ctrlShares * 10_000) / outAfterFull) : 0;
  const value = offered * offerPriceMinor;
  const fee = cfg.listingBaseFeeMinor + feeFromBps(value, cfg.listingFeeBps);
  const rev7 = db.get<{ r: number }>('SELECT COALESCE(SUM(revenue_minor),0) r FROM company_tick_stats WHERE company_id = ? AND tick > ? AND tick <= ?', companyId, tick - 7, tick)!.r - relatedPartyRevenue(db, companyId, tick - 7, tick);   // arm's-length revenue only
  const age = tick - (db.get<{ t: number }>('SELECT created_tick t FROM companies WHERE id = ?', companyId)?.t ?? 0);
  const lastOffer = db.get<{ t: number }>('SELECT MAX(tick) t FROM share_offerings WHERE company_id = ?', companyId)?.t;
  const checks: ListingCheck[] = [
    { id: 'control', ok: isController(c, actor), label: 'You control this company', detail: isController(c, actor) ? 'Only the controlling owner can list or issue shares.' : 'Another owner controls this company.' },
    { id: 'status', ok: c.status === 'operating' && c.bankrupt_tick === null && sec.status !== 'delisted' && sec.status !== 'suspended', label: 'Operating and not suspended', detail: `Status: ${c.bankrupt_tick !== null ? 'closed' : c.status}${sec.status === 'suspended' ? ', trading suspended' : ''}.` },
    { id: 'age', ok: age >= cfg.listingMinAgeTicks, label: `Trading for at least ${cfg.listingMinAgeTicks} days`, detail: `${age} days so far.` },
    { id: 'revenue', ok: rev7 >= cfg.listingMinRevenue7Minor, label: `Revenue of at least ${(cfg.listingMinRevenue7Minor / 100).toFixed(0)} EC in the last 7 days`, detail: `${(rev7 / 100).toFixed(2)} EC.` },
    { id: 'equity', ok: (val?.equityMinor ?? 0) >= cfg.listingMinEquityMinor, label: `Book equity of at least ${(cfg.listingMinEquityMinor / 100).toFixed(0)} EC`, detail: `${((val?.equityMinor ?? 0) / 100).toFixed(2)} EC.` },
    { id: 'arrears', ok: c.unpaid_minor === 0, label: 'No unpaid bills', detail: c.unpaid_minor === 0 ? 'Clear.' : `${(c.unpaid_minor / 100).toFixed(2)} EC overdue.` },
    { id: 'cooldown', ok: lastOffer === null || lastOffer === undefined || tick - lastOffer >= cfg.followOnCooldownTicks, label: `At least ${cfg.followOnCooldownTicks} days since the last offering`, detail: lastOffer === null || lastOffer === undefined ? 'First offering.' : `Last offering on day ${lastOffer}.` },
    { id: 'size', ok: Number.isSafeInteger(newShares) && newShares > 0 && (fromTreasury ? newShares <= treasuryShares(db, companyId) : newShares * 10_000 <= issuedBefore * cfg.listingMaxNewSharesBps), label: fromTreasury ? 'Offer no more than the treasury holds' : `Issue between 1 and ${Math.floor((issuedBefore * cfg.listingMaxNewSharesBps) / 10_000).toLocaleString('en-GB')} new shares`, detail: fromTreasury ? `${treasuryShares(db, companyId)} treasury shares.` : `${newShares.toLocaleString('en-GB')} requested.` },
    { id: 'retention', ok: ctrlAfter >= cfg.listingMinFounderBps, label: `Your stake stays at ${cfg.listingMinFounderBps / 100}% or more if every share sells`, detail: `${(ctrlAfter / 100).toFixed(1)}% after a full placement.` },
    { id: 'price', ok: Number.isSafeInteger(offerPriceMinor) && offerPriceMinor >= low && offerPriceMinor <= high && fair > 0, label: `Offer price between ${(low / 100).toFixed(2)} and ${(high / 100).toFixed(2)} EC`, detail: `Fundamental estimate ${(fair / 100).toFixed(2)} EC a share; allowed ${cfg.listingPriceLowBps / 100}%–${cfg.listingPriceHighBps / 100}%.` },
    { id: 'fee', ok: available(db, c.treasury_account_id) >= fee, label: `Company can pay the ${(fee / 100).toFixed(2)} EC listing fee`, detail: `${(available(db, c.treasury_account_id) / 100).toFixed(2)} EC available in the treasury.` },
  ];
  return {
    companyId, kind, eligible: checks.every((x) => x.ok), checks, newShares, offerPriceMinor, offeringValueMinor: value, listingFeeMinor: fee, priceRange: { lowMinor: low, highMinor: high, fairValueMinor: fair },
    dilution: { issuedBefore, issuedAfter: issuedBefore + issueQty, outstandingBefore: out0, outstandingAfter: outAfterFull, controllerStakeBeforeBps: out0 > 0 ? Math.floor((ctrlShares * 10_000) / out0) : 0, controllerStakeAfterBps: ctrlAfter, newInvestorsBps: outAfterFull > 0 ? Math.floor((offered * 10_000) / outAfterFull) : 0 },
    valuation: val,
  };
}

/**
 * IPO / follow-on. New shares are created into the COMPANY'S OWN treasury holding and offered at a fixed price through the normal order book as a primary
 * sale: every buyer's coins go to the company treasury (share capital raised), and unsold shares simply remain treasury shares. Existing holders' stakes only
 * dilute as shares are actually sold. The listing fee is a transfer to the Penny Exchange (not a sink). Founder sales are ordinary secondary trades whose proceeds go to the seller.
 */
export function listCompany(db: Sql, ctx: TickCtx, cfg: EngineConfig, key: string, companyId: string, newShares: number, offerPriceMinor: number, actor: { kind: string; id: string }, opts: { fromTreasury?: boolean } = {}): { offeringId: number; orderId: number; quote: ListingQuote } {
  return db.transaction(() => {
    const prior = db.get<{ id: number; company_id: string; shares_offered: number; price_minor: number; order_id: number }>('SELECT id, company_id, shares_offered, price_minor, order_id FROM share_offerings WHERE idempotency_key = ?', key);
    if (prior) {
      if (prior.company_id !== companyId || prior.shares_offered !== newShares || prior.price_minor !== offerPriceMinor) throw new ShareError('INVALID', `Idempotency key ${key} was already used for a different offering`);
      return { offeringId: prior.id, orderId: prior.order_id, quote: listingQuote(db, cfg, companyId, newShares, offerPriceMinor, ctx.tick, actor, opts) };
    }
    const quote = listingQuote(db, cfg, companyId, newShares, offerPriceMinor, ctx.tick, actor, opts);
    const failed = quote.checks.filter((c) => !c.ok);
    if (failed.length) throw new ShareError('RULE', `Cannot list yet: ${failed.map((f) => f.label).join('; ')}`);
    const c = db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', companyId)!;
    const sec = security(db, companyId) as SecurityRow;
    const self = companyInvestor(db, companyId);
    const fee = transfer(db, ctx, `${key}:fee`, c.treasury_account_id, EXCHANGE_ACCOUNT, quote.listingFeeMinor, 'state_payment', `listing fee: ${c.name}`);
    if (sec.status === 'unlisted') db.run("UPDATE securities SET status = 'open', listed_tick = ?, listing_price_minor = ? WHERE company_id = ?", ctx.tick, offerPriceMinor, companyId);
    if (!opts.fromTreasury) issueShares(db, ctx, companyId, self.id, newShares, offerPriceMinor, key, quote.kind === 'ipo' ? 'IPO: new shares issued into the company treasury for sale' : 'follow-on issue');
    const off = db.run('INSERT INTO share_offerings (company_id, kind, tick, shares_offered, price_minor, listing_fee_minor, fee_tx_id, founder_bps_after, idempotency_key) VALUES (?,?,?,?,?,?,?,?,?)', companyId, quote.kind, ctx.tick, newShares, offerPriceMinor, quote.listingFeeMinor, fee.txId, quote.dilution.controllerStakeAfterBps, key).lastInsertRowid;
    const placed = placeShareOrder(db, ctx, shareCfg(cfg), { company: companyId, investor: self.id, side: 'sell', price: offerPriceMinor, qty: newShares, key: `${key}:order`, offeringId: off });
    db.run('UPDATE share_offerings SET order_id = ? WHERE id = ?', placed.order.id, off);
    logEvent(db, ctx.tick, quote.kind === 'ipo' ? 'ipo' : 'follow_on', 'info', companyId, quote.kind === 'ipo' ? `${c.name} listed on the Penny Exchange, offering ${newShares.toLocaleString('en-GB')} new shares at ${(offerPriceMinor / 100).toFixed(2)} EC` : `${c.name} is offering ${newShares.toLocaleString('en-GB')} more shares at ${(offerPriceMinor / 100).toFixed(2)} EC`, { shares: newShares, priceMinor: offerPriceMinor, feeMinor: quote.listingFeeMinor, offeringId: off });
    return { offeringId: off, orderId: placed.order.id, quote };
  });
}

export const shareCfg = (cfg: EngineConfig): ShareConfig => ({ shareFeeBps: cfg.shareFeeBps, shareBandBps: cfg.shareBandBps, shareRefStaleTicks: cfg.shareRefStaleTicks, shareMaxOrderTicks: cfg.shareMaxOrderTicks, marketSlippageBps: cfg.marketSlippageBps, maxSlippageBps: cfg.maxSlippageBps });

/** Pulls an open offering: its unsold shares stay in the treasury (still not eligible for dividends, not in public hands). */
export function withdrawOffering(db: Sql, offeringId: number, actor: { kind: string; id: string }) {
  return db.transaction(() => {
    const o = db.get<{ company_id: string; order_id: number; status: string }>('SELECT company_id, order_id, status FROM share_offerings WHERE id = ?', offeringId);
    if (!o) throw new ShareError('NOT_FOUND', `No offering ${offeringId}`);
    const c = db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', o.company_id)!;
    if (!isController(c, actor)) throw new ShareError('FORBIDDEN', 'Only the controlling owner can withdraw an offering');
    if (o.status !== 'open') throw new ShareError('INVALID', `Offering ${offeringId} is already ${o.status}`);
    cancelShareOrder(db, o.order_id);
    db.run("UPDATE share_offerings SET status = 'withdrawn' WHERE id = ?", offeringId);
  });
}

/** Retires unsold treasury shares for good (they vanish from the register; recorded in the journal). */
export function retireTreasuryShares(db: Sql, ctx: TickCtx, companyId: string, qty: number, actor: { kind: string; id: string }) {
  return db.transaction(() => {
    const c = db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', companyId);
    if (!c) throw new ShareError('NOT_FOUND', `Unknown company ${companyId}`);
    if (!isController(c, actor)) throw new ShareError('FORBIDDEN', 'Only the controlling owner can retire shares');
    const own = companyInvestorId(companyId); const h = holding(db, companyId, own);
    if (qty <= 0 || qty > h.shares - h.reserved) throw new ShareError('INSUFFICIENT_SHARES', `The treasury has ${h.shares - h.reserved} unreserved shares`);
    cancelShares(db, ctx, companyId, own, qty, `retire:${ctx.tick}`, 'cancel', 'treasury shares retired');
  });
}
export { PLAYER_ID };
