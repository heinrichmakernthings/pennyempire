import type { Sql } from '../db/sql';
import { gameDate, loadConfig } from '../engine/config';
import { THRESHOLDS, capTable, classifyStake, companyInvestorId, getInvestor, holding, outstanding, security, treasuryShares } from '../engine/capital';
import { dividendCapacity } from '../engine/dividends';
import { listingQuote } from '../engine/listing';
import { available } from '../engine/ledger';
import { playerInvestorIds } from '../engine/shareCommands';
import { orderBook, priceBand } from '../engine/shareMarket';
import { computeValuation } from '../engine/valuation';
import { PLAYER_ID, PLAYER_WALLET } from '../seed/bristol';
import type { ExchangeHome, ListingStatus, PortfolioPosition, PortfolioTx, SecurityDetail, SecurityListing, SharePortfolio, StakeClass } from '../../src/shared/securities';

const lastTick = (db: Sql) => db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
type SecRow = { company_id: string; ticker: string; status: ListingStatus; issued_shares: number; suspended_reason: string | null; listed_tick: number | null; listing_price_minor: number | null };
type CoRow = { id: string; name: string; industry_id: string; owner_kind: 'player' | 'npc' | 'state'; owner_id: string; asset_id: string | null };

/** The mark used for valuing holdings: last executed trade, else the offer price, else the fundamental estimate. `basis` always says which. */
export function markOf(db: Sql, company: string, tick: number): { priceMinor: number | null; basis: 'trade' | 'offer' | 'fundamental' | 'none'; stale: boolean } {
  const cfg = loadConfig(db);
  const last = db.get<{ tick: number; p: number }>('SELECT tick, close_minor p FROM security_stats WHERE company_id = ? AND close_minor IS NOT NULL ORDER BY tick DESC LIMIT 1', company);
  if (last) return { priceMinor: last.p, basis: 'trade', stale: tick - last.tick > cfg.shareRefStaleTicks };
  const sec = security(db, company);
  if (sec?.listing_price_minor) return { priceMinor: sec.listing_price_minor, basis: 'offer', stale: true };
  const fv = db.get<{ v: number }>('SELECT fair_value_minor v FROM security_valuations WHERE company_id = ? ORDER BY tick DESC LIMIT 1', company)?.v;
  return fv ? { priceMinor: fv, basis: 'fundamental', stale: true } : { priceMinor: null, basis: 'none', stale: true };
}

function listingOf(db: Sql, s: SecRow, tick: number, mine: Set<string>): SecurityListing {
  const c = db.get<CoRow>('SELECT id, name, industry_id, owner_kind, owner_id, asset_id FROM companies WHERE id = ?', s.company_id)!;
  const mk = markOf(db, s.company_id, tick);
  const prev = db.get<{ p: number }>('SELECT close_minor p FROM security_stats WHERE company_id = ? AND close_minor IS NOT NULL AND tick < COALESCE((SELECT MAX(tick) FROM security_stats WHERE company_id = ? AND close_minor IS NOT NULL), 0) ORDER BY tick DESC LIMIT 1', s.company_id, s.company_id)?.p ?? null;
  const fv = db.get<{ v: number }>('SELECT fair_value_minor v FROM security_valuations WHERE company_id = ? ORDER BY tick DESC LIMIT 1', s.company_id)?.v ?? null;
  const out = outstanding(db, s.company_id), tr = treasuryShares(db, s.company_id);
  const ob = s.status === 'open' ? orderBook(db, s.company_id, tick) : { bids: [], asks: [] };
  const bid = ob.bids[0]?.priceMinor ?? null, ask = ob.asks[0]?.priceMinor ?? null;
  const vol = db.get<{ v: number }>('SELECT COALESCE(SUM(volume),0) v FROM security_stats WHERE company_id = ? AND tick > ?', s.company_id, tick - 7)!.v;
  const yld = mk.priceMinor ? Math.round((db.get<{ d: number }>("SELECT COALESCE(SUM(per_share_minor),0) d FROM dividends WHERE company_id = ? AND status = 'paid' AND payment_tick > ?", s.company_id, tick - 30)!.d * 10_000) / mk.priceMinor) : 0;
  const mineShares = [...mine].reduce((a, id) => a + holding(db, s.company_id, id).shares, 0);
  const top = db.get<{ shares: number }>('SELECT shares FROM share_holdings WHERE company_id = ? AND investor_id <> ? ORDER BY shares DESC LIMIT 1', s.company_id, companyInvestorId(s.company_id))?.shares ?? 0;
  return {
    companyId: s.company_id, ticker: s.ticker, name: c.name, industry: c.industry_id, industryLabel: db.get<{ label: string }>('SELECT label FROM industry_specs WHERE industry_id = ?', c.industry_id)?.label ?? c.industry_id, ownerKind: c.owner_kind, status: s.status, suspendedReason: s.suspended_reason,
    priceMinor: mk.priceMinor, priceBasis: mk.basis, priceStale: mk.stale, changeBps: mk.basis === 'trade' && prev ? Math.round(((mk.priceMinor! - prev) * 10_000) / prev) : null,
    fairValueMinor: fv, premiumBps: fv && mk.priceMinor ? Math.round(((mk.priceMinor - fv) * 10_000) / fv) : null, issuedShares: s.issued_shares, outstandingShares: out, treasuryShares: tr, marketCapMinor: mk.priceMinor ? mk.priceMinor * out : null,
    bestBidMinor: bid, bestAskMinor: ask, spreadBps: bid && ask ? Math.round(((ask - bid) * 10_000) / ask) : null, volume7d: vol, dividendYield30dBps: yld, freeFloatBps: out > 0 ? Math.floor(((out - top) * 10_000) / out) : 0,
    myShares: mineShares, myStakeBps: out > 0 ? Math.floor((mineShares * 10_000) / out) : 0, assetId: c.asset_id, liquidity: s.status !== 'open' ? 'none' : bid && ask && ob.bids.reduce((a, l) => a + l.shares, 0) >= 100 ? 'ok' : bid || ask ? 'thin' : 'none',
  };
}

export function exchangeHome(db: Sql): ExchangeHome {
  const t = lastTick(db), cfg = loadConfig(db); const mine = new Set(playerInvestorIds(db));
  const listings = db.all<SecRow>("SELECT * FROM securities WHERE status IN ('open','suspended') ORDER BY ticker").map((s) => listingOf(db, s, t, mine));
  const idx = db.all<{ tick: number; value_bps: number; market_cap_minor: number; turnover_minor: number }>('SELECT * FROM market_index ORDER BY tick DESC LIMIT 60').reverse();
  const last = idx.at(-1), prev = idx.at(-2);
  const unlisted = db.all<{ id: string; name: string; ticker: string }>("SELECT c.id, c.name, s.ticker FROM companies c JOIN securities s ON s.company_id = c.id WHERE c.owner_kind = 'player' AND c.owner_id = ? AND c.bankrupt_tick IS NULL AND s.status = 'unlisted' ORDER BY c.id", PLAYER_ID).map((c) => {
    const fair = computeValuation(db, cfg, c.id, t)?.fairValuePerShareMinor ?? 1;
    let eligible = false; try { eligible = listingQuote(db, cfg, c.id, 1_000, fair, t, { kind: 'player', id: PLAYER_ID }).eligible; } catch { /* not eligible */ }
    return { companyId: c.id, name: c.name, ticker: c.ticker, eligible };
  });
  return { tick: t, gameDate: gameDate(cfg, t), index: { valueBps: last?.value_bps ?? 10_000, changeBps: last && prev ? Math.round(((last.value_bps - prev.value_bps) * 10_000) / prev.value_bps) : 0, marketCapMinor: last?.market_cap_minor ?? 0, turnoverMinor: last?.turnover_minor ?? 0, series: idx.map((r) => ({ tick: r.tick, valueBps: r.value_bps })) }, listings, unlisted, feeBps: cfg.shareFeeBps, bandBps: cfg.shareBandBps, notice: 'Fictional companies and shares. Empire Coins only: shares cannot be redeemed for real money.' };
}

export function securityDetail(db: Sql, companyId: string): SecurityDetail | null {
  const s = db.get<SecRow>('SELECT * FROM securities WHERE company_id = ?', companyId); if (!s) return null;
  const t = lastTick(db), cfg = loadConfig(db); const mine = new Set(playerInvestorIds(db));
  const listing = listingOf(db, s, t, mine);
  const v = computeValuation(db, cfg, companyId, t);
  const band = s.status === 'open' ? priceBand(db, cfg, companyId, t) : null;
  const book = s.status === 'open' ? orderBook(db, companyId, t) : { bids: [], asks: [] };
  const hist = db.all<{ tick: number; open_minor: number | null; high_minor: number | null; low_minor: number | null; close_minor: number | null; vwap_minor: number | null; volume: number }>('SELECT tick, open_minor, high_minor, low_minor, close_minor, vwap_minor, volume FROM security_stats WHERE company_id = ? ORDER BY tick DESC LIMIT 60', companyId).reverse();
  const fairBy = new Map(db.all<{ tick: number; v: number }>('SELECT tick, fair_value_minor v FROM security_valuations WHERE company_id = ? AND tick > ?', companyId, t - 61).map((r) => [r.tick, r.v]));
  const holders = capTable(db, companyId); const top = holders[0];
  const controllerHolder = top && classifyStake(top.stakeBps) === 'majority' ? { name: top.name, stakeBps: top.stakeBps } : null;
  const inv = getInvestor(db, PLAYER_ID);
  const myOrders = db.all<{ id: number; side: 'buy' | 'sell'; price_minor: number; qty_remaining: number; qty_original: number; investor_id: string; expires_tick: number | null }>("SELECT id, side, price_minor, qty_remaining, qty_original, investor_id, expires_tick FROM share_orders WHERE company_id = ? AND status = 'open' AND primary_offering_id IS NULL ORDER BY id DESC", companyId).filter((o) => mine.has(o.investor_id));
  const h = holding(db, companyId, PLAYER_ID); const c = db.get<{ owner_kind: string; owner_id: string }>('SELECT owner_kind, owner_id FROM companies WHERE id = ?', companyId)!;
  return {
    listing,
    valuation: v ? { fairValuePerShareMinor: v.fairValuePerShareMinor, equityMinor: v.equityMinor, earningsValueMinor: v.earningsValueMinor, dailyEarningsMinor: v.dailyEarningsMinor, growthBps: v.growthBps, riskBps: v.riskBps, liquidationFloorMinor: v.liquidationFloorMinor, components: v.components as unknown as Record<string, unknown>, basis: 'Book equity plus recent earnings over a fixed horizon. An estimate from the company’s own books: it never sets the trading price.' } : null,
    band: band ? { lowMinor: band.low, highMinor: band.high, refMinor: band.ref, basis: band.basis, bandBps: cfg.shareBandBps } : null,
    book,
    history: hist.map((r) => ({ tick: r.tick, gameDate: gameDate(cfg, r.tick), openMinor: r.open_minor, highMinor: r.high_minor, lowMinor: r.low_minor, closeMinor: r.close_minor, vwapMinor: r.vwap_minor, volume: r.volume, fairMinor: fairBy.get(r.tick) ?? null })),
    ownership: { holders, outstanding: outstanding(db, companyId), treasury: treasuryShares(db, companyId), controller: controllerHolder, thresholds: { significantBps: THRESHOLDS.significantBps, substantialBps: THRESHOLDS.substantialBps, majorityBps: THRESHOLDS.majorityBps }, control: db.all<{ tick: number; to_owner_id: string; stake_bps: number }>('SELECT tick, to_owner_id, stake_bps FROM control_log WHERE company_id = ? ORDER BY id DESC LIMIT 5', companyId).map((r) => ({ tick: r.tick, gameDate: gameDate(cfg, r.tick), to: db.get<{ name: string }>('SELECT name FROM owners WHERE id = ?', r.to_owner_id)?.name ?? r.to_owner_id, stakeBps: r.stake_bps })) },
    dividends: db.all<{ id: number; declared_tick: number; payment_tick: number; per_share_minor: number; total_minor: number; status: string; eligible_shares: number }>("SELECT * FROM dividends WHERE company_id = ? ORDER BY id DESC LIMIT 12", companyId).map((d) => ({ id: d.id, declaredGameDate: gameDate(cfg, d.declared_tick), paymentGameDate: gameDate(cfg, d.payment_tick), perShareMinor: d.per_share_minor, totalMinor: d.total_minor, status: d.status, eligibleShares: d.eligible_shares })),
    dividendCapacity: dividendCapacity(db, cfg, companyId),
    financials: db.all<{ tick: number; revenue_minor: number; net_profit_minor: number; cash_end_minor: number }>('SELECT tick, revenue_minor, net_profit_minor, cash_end_minor FROM company_tick_stats WHERE company_id = ? AND tick > 0 ORDER BY tick DESC LIMIT 14', companyId).reverse().map((r) => ({ tick: r.tick, gameDate: gameDate(cfg, r.tick), revenueMinor: r.revenue_minor, netProfitMinor: r.net_profit_minor, cashMinor: r.cash_end_minor })),
    offerings: db.all<{ id: number; kind: string; tick: number; shares_offered: number; shares_sold: number; price_minor: number; proceeds_minor: number; status: string }>('SELECT * FROM share_offerings WHERE company_id = ? ORDER BY id DESC LIMIT 6', companyId).map((o) => ({ id: o.id, kind: o.kind, gameDate: gameDate(cfg, o.tick), sharesOffered: o.shares_offered, sharesSold: o.shares_sold, priceMinor: o.price_minor, proceedsMinor: o.proceeds_minor, status: o.status })),
    trades: db.all<{ id: number; tick: number; qty: number; price_minor: number; buyer_id: string; seller_id: string }>('SELECT id, tick, qty, price_minor, buyer_id, seller_id FROM share_trades WHERE company_id = ? ORDER BY id DESC LIMIT 30', companyId).map((r) => ({ id: r.id, gameDate: gameDate(cfg, r.tick), qty: r.qty, priceMinor: r.price_minor, mine: mine.has(r.buyer_id) || mine.has(r.seller_id) })),
    news: db.all<{ id: number; tick: number; headline: string; body: string }>('SELECT id, tick, headline, body FROM news_articles WHERE subject_company_id = ? ORDER BY tick DESC, id DESC LIMIT 8', companyId).map((n) => ({ id: n.id, gameDate: gameDate(cfg, n.tick), headline: n.headline, body: n.body })),
    mine: { shares: h.shares, reservedShares: h.reserved, avgCostMinor: h.shares > 0 && h.cost_basis_minor > 0 ? Math.round(h.cost_basis_minor / h.shares) : null, cashAvailableMinor: inv ? available(db, inv.account_id) : available(db, PLAYER_WALLET), openOrders: myOrders.map((o) => ({ id: o.id, side: o.side, priceMinor: o.price_minor, remaining: o.qty_remaining, original: o.qty_original, investorId: o.investor_id, expiresTick: o.expires_tick })), controlsCompany: c.owner_kind === 'player' && c.owner_id === PLAYER_ID },
    rules: { feeBps: cfg.shareFeeBps, bandBps: cfg.shareBandBps, maxOrderDays: cfg.shareMaxOrderTicks },
  };
}

export function sharePortfolio(db: Sql): SharePortfolio {
  const t = lastTick(db), cfg = loadConfig(db); const ids = playerInvestorIds(db);
  const wallet = db.get<{ b: number; r: number }>('SELECT balance_minor b, reserved_minor r FROM accounts WHERE id = ?', PLAYER_WALLET)!;
  const positions: PortfolioPosition[] = [];
  for (const id of ids) for (const h of db.all<{ company_id: string; shares: number; reserved: number; cost_basis_minor: number }>('SELECT company_id, shares, reserved, cost_basis_minor FROM share_holdings WHERE investor_id = ? AND shares > 0 ORDER BY company_id', id)) {
    const s = security(db, h.company_id)!; const c = db.get<CoRow>('SELECT id, name, industry_id, owner_kind, owner_id, asset_id FROM companies WHERE id = ?', h.company_id)!;
    if (id === PLAYER_ID && c.owner_kind === 'player' && s.status === 'unlisted' && h.cost_basis_minor === 0) { /* an unlisted company's founder shares are shown, but not marked */ }
    const mk = s.status === 'unlisted' || s.status === 'delisted' ? { priceMinor: null, basis: 'none' as const, stale: true } : markOf(db, h.company_id, t);
    const inv = getInvestor(db, id)!; const out = outstanding(db, h.company_id);
    const real = db.get<{ p: number }>('SELECT COALESCE(SUM(pnl_minor),0) p FROM share_pnl WHERE investor_id = ? AND company_id = ?', id, h.company_id)!.p;
    const dv = db.get<{ d: number }>("SELECT COALESCE(SUM(e.amount_minor),0) d FROM dividend_entitlements e JOIN dividends v ON v.id = e.dividend_id WHERE e.investor_id = ? AND v.company_id = ? AND v.status = 'paid'", id, h.company_id)!.d;
    const value = mk.priceMinor !== null ? mk.priceMinor * h.shares : null;
    positions.push({ companyId: h.company_id, ticker: s.ticker, name: c.name, investorId: id, investorName: inv.name, shares: h.shares, reservedShares: h.reserved, stakeBps: out > 0 ? Math.floor((h.shares * 10_000) / out) : 0, stakeClass: classifyStake(out > 0 ? Math.floor((h.shares * 10_000) / out) : 0) as StakeClass, avgCostMinor: h.cost_basis_minor > 0 ? Math.round(h.cost_basis_minor / h.shares) : null, costBasisMinor: h.cost_basis_minor, markMinor: mk.priceMinor, markBasis: mk.basis, marketValueMinor: value, unrealisedMinor: value !== null && h.cost_basis_minor > 0 ? value - h.cost_basis_minor : null, realisedMinor: real, dividendsMinor: dv, status: s.status });
  }
  const closed = db.all<{ company_id: string; investor_id: string; p: number }>("SELECT company_id, investor_id, COALESCE(SUM(pnl_minor),0) p FROM share_pnl WHERE investor_id IN (" + ids.map(() => '?').join(',') + ') GROUP BY company_id, investor_id', ...ids).filter((r) => !positions.some((p) => p.companyId === r.company_id && p.investorId === r.investor_id));
  const realisedTotal = db.get<{ p: number }>('SELECT COALESCE(SUM(pnl_minor),0) p FROM share_pnl WHERE investor_id IN (' + ids.map(() => '?').join(',') + ')', ...ids)!.p;
  void closed;
  const divTotal = db.get<{ d: number }>("SELECT COALESCE(SUM(e.amount_minor),0) d FROM dividend_entitlements e JOIN dividends v ON v.id = e.dividend_id WHERE v.status = 'paid' AND e.investor_id IN (" + ids.map(() => '?').join(',') + ')', ...ids)!.d;
  const fees = db.get<{ f: number }>('SELECT COALESCE(SUM(fee_minor),0) f FROM share_trades WHERE seller_id IN (' + ids.map(() => '?').join(',') + ')', ...ids)!.f;
  const txs: PortfolioTx[] = [];
  const tk = (c: string) => security(db, c)?.ticker ?? c;
  for (const r of db.all<{ id: number; tick: number; company_id: string; buyer_id: string; seller_id: string; qty: number; price_minor: number; fee_minor: number }>('SELECT * FROM share_trades WHERE buyer_id IN (' + ids.map(() => '?').join(',') + ') OR seller_id IN (' + ids.map(() => '?').join(',') + ') ORDER BY id DESC LIMIT 60', ...ids, ...ids)) {
    const buy = ids.includes(r.buyer_id);
    txs.push({ id: `t${r.id}`, kind: buy ? 'buy' : 'sell', gameDate: gameDate(cfg, r.tick), companyId: r.company_id, ticker: tk(r.company_id), qty: r.qty, priceMinor: r.price_minor, amountMinor: buy ? -(r.qty * r.price_minor) : r.qty * r.price_minor - r.fee_minor, feeMinor: r.fee_minor, note: buy ? 'Bought' : 'Sold' });
  }
  for (const r of db.all<{ dividend_id: number; investor_id: string; shares: number; amount_minor: number; company_id: string; payment_tick: number; per_share_minor: number }>("SELECT e.dividend_id, e.investor_id, e.shares, e.amount_minor, v.company_id, v.payment_tick, v.per_share_minor FROM dividend_entitlements e JOIN dividends v ON v.id = e.dividend_id WHERE v.status = 'paid' AND e.investor_id IN (" + ids.map(() => '?').join(',') + ') ORDER BY v.payment_tick DESC LIMIT 40', ...ids)) txs.push({ id: `d${r.dividend_id}:${r.investor_id}`, kind: 'dividend', gameDate: gameDate(cfg, r.payment_tick), companyId: r.company_id, ticker: tk(r.company_id), qty: r.shares, priceMinor: r.per_share_minor, amountMinor: r.amount_minor, feeMinor: 0, note: 'Dividend' });
  for (const r of db.all<{ id: number; tick: number; company_id: string; qty: number; proceeds_minor: number }>("SELECT id, tick, company_id, qty, proceeds_minor FROM share_pnl WHERE kind = 'liquidation' AND investor_id IN (" + ids.map(() => '?').join(',') + ') ORDER BY id DESC LIMIT 10', ...ids)) txs.push({ id: `l${r.id}`, kind: 'liquidation', gameDate: gameDate(cfg, r.tick), companyId: r.company_id, ticker: tk(r.company_id), qty: r.qty, priceMinor: null, amountMinor: r.proceeds_minor, feeMinor: 0, note: 'Company liquidated: shares cancelled' });
  txs.sort((a, b) => (a.gameDate < b.gameDate ? 1 : a.gameDate > b.gameDate ? -1 : 0));
  const marked = positions.filter((p) => p.marketValueMinor !== null && p.status !== 'unlisted');
  const mv = marked.reduce((a, p) => a + p.marketValueMinor!, 0);
  return {
    cashAvailableMinor: wallet.b - wallet.r, cashReservedMinor: wallet.r,
    totals: { marketValueMinor: mv, costBasisMinor: marked.reduce((a, p) => a + p.costBasisMinor, 0), unrealisedMinor: marked.reduce((a, p) => a + (p.unrealisedMinor ?? 0), 0), realisedMinor: realisedTotal, dividendIncomeMinor: divTotal, feesPaidMinor: fees, basisNote: 'Market value is an estimate at the last trade price. Only sales and dividends put Empire Coins in your wallet.' },
    positions: positions.sort((a, b) => (b.marketValueMinor ?? 0) - (a.marketValueMinor ?? 0)), transactions: txs.slice(0, 80),
    allocation: marked.map((p) => ({ ticker: p.ticker, name: p.name, valueMinor: p.marketValueMinor!, bps: mv > 0 ? Math.floor((p.marketValueMinor! * 10_000) / mv) : 0 })),
    note: 'Fictional securities in Empire Coins. A higher share price does not add to your wallet until you sell.',
  };
}
