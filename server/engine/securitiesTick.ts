import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import {
  classifyStake, companyInvestorId, ensureInvestor, getInvestor, holding, outstanding, type Investor,
} from './capital';
import { declareDividend, dividendCapacity, payDueDividends, cancelOpenDividends } from './dividends';
import { available, createAccount, issue, transfer, type TickCtx } from './ledger';
import { cancelShareOrder, expireShareOrders, orderBook, placeShareOrder, priceBand, matchCompany, type ShareOrderRow } from './shareMarket';
import { shareCfg } from './listing';
import { recordValuations } from './valuation';
import { logEvent } from './stats';
import type { CompanyRow } from './operations';
import { HOUSEHOLDS } from '../seed/bristol';

export const NPC_STRATEGIES = ['value', 'income', 'momentum', 'contrarian', 'balanced', 'value'] as const;
export type InvestorStrategy = (typeof NPC_STRATEGIES)[number];
export const INVESTOR_BLURB: Record<string, string> = {
  value: 'Buys shares trading well below the fundamental estimate and sells when they run well above it.',
  income: 'Buys for dividends: prefers companies with a high recent payout relative to price.',
  momentum: 'Follows the trend: buys after a rising week, sells after a falling one.',
  contrarian: 'Buys sharp falls in companies that are still sound, sells sharp rises.',
  balanced: 'Spreads a modest budget across listed companies and rebalances slowly.',
};

/** Start of day: stale orders expire and declared dividends reach their payment day. */
export function runShareOpening(db: Sql, ctx: TickCtx) {
  expireShareOrders(db, ctx.tick);
  payDueDividends(db, ctx);
}

/** NPC market participants: finite budgets, defined strategies, creation of the participants themselves is a one-off recorded issuance. */
export function seedNpcInvestors(db: Sql, ctx: TickCtx, cfg: EngineConfig): number {
  let issued = 0;
  for (let i = 1; i <= cfg.npcInvestorCount; i++) {
    const id = `inv-npc-${i}`, acct = `acct:investor:${i}`;
    if (db.get('SELECT 1 FROM investors WHERE id = ?', id)) continue;
    createAccount(db, acct, 'households', `NPC investor ${i}`);
    db.run("INSERT OR IGNORE INTO owners (id, kind, name) VALUES (?, 'npc', ?)", id, `NPC investor ${i}`);
    ensureInvestor(db, { id, kind: 'npc', name: `Investor ${['Ashdown', 'Bedminster', 'Cotham', 'Dowry', 'Eastville', 'Fishponds'][i - 1] ?? i}`, account: acct, strategy: NPC_STRATEGIES[(i - 1) % NPC_STRATEGIES.length], every: cfg.npcInvestorEveryTicks, tick: ctx.tick });
    issue(db, ctx, `seed:investor:${i}`, acct, cfg.npcInvestorSeedMinor, 'NPC investor seed capital'); issued += cfg.npcInvestorSeedMinor;
  }
  return issued;
}

const lastPrice = (db: Sql, company: string): number | null => db.get<{ p: number }>('SELECT close_minor p FROM security_stats WHERE company_id = ? AND close_minor IS NOT NULL ORDER BY tick DESC LIMIT 1', company)?.p ?? null;
const fairOf = (db: Sql, company: string, tick: number): number | null => db.get<{ v: number }>('SELECT fair_value_minor v FROM security_valuations WHERE company_id = ? AND tick < ? ORDER BY tick DESC LIMIT 1', company, tick)?.v ?? null;   // yesterday's estimate: no peeking
const changeBps = (db: Sql, company: string, tick: number, days: number): number => {
  const now = db.get<{ p: number }>('SELECT close_minor p FROM security_stats WHERE company_id = ? AND close_minor IS NOT NULL AND tick < ? ORDER BY tick DESC LIMIT 1', company, tick)?.p;
  const then = db.get<{ p: number }>('SELECT close_minor p FROM security_stats WHERE company_id = ? AND close_minor IS NOT NULL AND tick < ? ORDER BY tick DESC LIMIT 1', company, tick - days)?.p;
  return now && then ? Math.round(((now - then) * 10_000) / then) : 0;
};
const yield30Bps = (db: Sql, company: string, tick: number, price: number): number => {
  const d = db.get<{ s: number }>("SELECT COALESCE(SUM(per_share_minor),0) s FROM dividends WHERE company_id = ? AND status = 'paid' AND payment_tick > ?", company, tick - 30)!.s;
  return price > 0 ? Math.round((d * 10_000) / price) : 0;
};
const logInv = (db: Sql, tick: number, inv: string, company: string | null, action: string, reason: string, inputs: unknown, applied: boolean) => db.run('INSERT INTO investor_decisions (tick, investor_id, company_id, action, reason, inputs_json, applied) VALUES (?,?,?,?,?,?,?)', tick, inv, company, action, reason, JSON.stringify(inputs), applied ? 1 : 0);

function tryOrder(db: Sql, ctx: TickCtx, cfg: EngineConfig, inv: Investor, company: string, side: 'buy' | 'sell', price: number, qty: number, why: string, inputs: unknown): boolean {
  if (qty <= 0 || price <= 0) return false;
  const band = priceBand(db, cfg, company, ctx.tick);
  if (band) price = Math.min(Math.max(price, band.low), band.high);
  if (side === 'buy') qty = Math.min(qty, Math.floor(available(db, inv.account_id) / price));
  if (qty <= 0) return false;
  try {
    placeShareOrder(db, ctx, shareCfg(cfg), { company, investor: inv.id, side, price, qty, key: `npcinv:${inv.id}:${ctx.tick}:${company}:${side}`, expiresTick: ctx.tick + 3 });
    logInv(db, ctx.tick, inv.id, company, `${side} ${qty} @ ${(price / 100).toFixed(2)}`, why, inputs, true); return true;
  } catch (e) { logInv(db, ctx.tick, inv.id, company, `${side} refused`, (e as Error).message, inputs, false); return false; }
}

interface ListedRow { company_id: string; ticker: string }
const listed = (db: Sql) => db.all<ListedRow>("SELECT company_id, ticker FROM securities WHERE status = 'open' ORDER BY company_id");

/** NPC investors review the market on a staggered schedule. They read only recorded prices, yesterday's valuation and their own books. */
function runInvestors(db: Sql, ctx: TickCtx, cfg: EngineConfig) {
  // NPC investors live in the city: cash above their seed capital is spent back to the households a little each day (a transfer, so the money keeps circulating).
  for (const inv of db.all<Investor>("SELECT * FROM investors WHERE kind = 'npc' ORDER BY id")) {
    const spend = Math.floor((Math.max(0, available(db, inv.account_id) - cfg.npcInvestorSeedMinor) * cfg.npcInvestorSpendBps) / 10_000);
    if (spend > 0) transfer(db, ctx, `npcinv:${inv.id}:spend:${ctx.tick}`, inv.account_id, HOUSEHOLDS, spend, 'transfer', `${inv.name} living expenses`);
  }
  const due = db.all<Investor>("SELECT * FROM investors WHERE kind = 'npc' AND next_decision_tick <= ? ORDER BY next_decision_tick, id", ctx.tick);
  const secs = listed(db);
  for (const inv of due) {
    db.run('UPDATE investors SET next_decision_tick = ? WHERE id = ?', ctx.tick + inv.decision_every, inv.id);
    for (const o of db.all<ShareOrderRow>("SELECT * FROM share_orders WHERE investor_id = ? AND status = 'open'", inv.id)) cancelShareOrder(db, o.id);   // refresh quotes
    let cash = available(db, inv.account_id); let orders = 0;
    const budgetOne = () => Math.floor((cash * cfg.npcInvestorOrderBps) / 10_000);
    const rank = secs.map((s) => {
      const fair = fairOf(db, s.company_id, ctx.tick); const px = lastPrice(db, s.company_id) ?? priceBand(db, cfg, s.company_id, ctx.tick)?.ref ?? null;
      const ob = orderBook(db, s.company_id, ctx.tick);
      return { s, fair, px, ask: ob.asks[0]?.priceMinor ?? null, bid: ob.bids[0]?.priceMinor ?? null, chg5: changeBps(db, s.company_id, ctx.tick, 5), held: holding(db, s.company_id, inv.id) };
    }).filter((r) => r.px !== null && r.fair !== null);
    if (inv.strategy === 'value' || inv.strategy === 'income' || inv.strategy === 'balanced') {
      // sells first: take profit when the market pays well above the fundamental estimate
      for (const r of rank) {
        const free = r.held.shares - r.held.reserved; if (free <= 0 || orders >= 3) continue;
        const hi = inv.strategy === 'income' ? 13_000 : inv.strategy === 'balanced' ? 14_000 : 11_500;
        if (r.px! * 10_000 >= r.fair! * hi) { if (tryOrder(db, ctx, cfg, inv, r.s.company_id, 'sell', Math.max(r.bid ?? 0, Math.floor((r.fair! * (hi - 300)) / 10_000)), Math.min(free, Math.max(1, Math.ceil(free / 3))), `price ${(r.px! / 100).toFixed(2)} is ${Math.round((r.px! * 100) / r.fair!)}% of the ${(r.fair! / 100).toFixed(2)} estimate`, { fair: r.fair, px: r.px })) orders++; }
      }
    }
    if (inv.strategy === 'momentum' || inv.strategy === 'contrarian') {
      for (const r of rank) {
        const free = r.held.shares - r.held.reserved; if (free <= 0 || orders >= 3) continue;
        const sell = inv.strategy === 'momentum' ? r.chg5 <= -400 : r.chg5 >= 1_000;
        if (sell && tryOrder(db, ctx, cfg, inv, r.s.company_id, 'sell', Math.max(1, Math.floor(r.px! * 0.99)), Math.max(1, Math.ceil(free / 2)), `${inv.strategy}: 5-day move ${(r.chg5 / 100).toFixed(1)}%`, { chg5: r.chg5, px: r.px })) orders++;
      }
    }
    // buys
    const candidates = rank.map((r) => ({ r, score: inv.strategy === 'value' ? (r.fair! * 10_000) / Math.max(1, r.px!) : inv.strategy === 'income' ? yield30Bps(db, r.s.company_id, ctx.tick, r.px!) + ((r.fair! * 1_000) / Math.max(1, r.px!)) / 10 : inv.strategy === 'momentum' ? r.chg5 : inv.strategy === 'contrarian' ? -r.chg5 : (r.fair! * 10_000) / Math.max(1, r.px!) - (r.held.shares * 5) })).sort((a, b) => b.score - a.score || a.r.s.company_id.localeCompare(b.r.s.company_id));
    for (const { r } of candidates) {
      if (orders >= 3) break;
      const b = budgetOne(); const ask = r.ask ?? r.px!; if (b < ask) break;
      let want = false, limit = ask, why = '';
      // Take the best ask when it is within the strategy's ceiling (a real, crossing order); otherwise rest a bid just under the ceiling.
      const cross = (ceilBps: number) => { const c = Math.floor((r.fair! * ceilBps) / 10_000); return r.ask !== null && r.ask <= c ? r.ask : Math.min(c, Math.max((r.bid ?? 0) + 1, Math.floor(r.px! * 0.99))); };
      if (inv.strategy === 'value' && r.px! * 10_000 <= r.fair! * 9_200) { want = true; limit = cross(9_200); why = `trading at ${Math.round((r.px! * 100) / r.fair!)}% of the ${(r.fair! / 100).toFixed(2)} estimate`; }
      else if (inv.strategy === 'income' && yield30Bps(db, r.s.company_id, ctx.tick, r.px!) >= 50 && r.px! * 10_000 <= r.fair! * 11_000) { want = true; limit = cross(11_000); why = `recent dividend yield ${(yield30Bps(db, r.s.company_id, ctx.tick, r.px!) / 100).toFixed(2)}% of price`; }
      else if (inv.strategy === 'momentum' && r.chg5 >= 400 && r.px! * 10_000 <= r.fair! * 17_000) { want = true; limit = cross(17_000); why = `5-day gain ${(r.chg5 / 100).toFixed(1)}%`; }
      else if (inv.strategy === 'contrarian' && r.chg5 <= -600 && r.px! * 10_000 >= r.fair! * 7_000) { want = true; limit = cross(10_000); why = `5-day fall ${(r.chg5 / 100).toFixed(1)}% in a company still worth ${Math.round((r.fair! * 100) / r.px!)}% of its price`; }
      else if (inv.strategy === 'balanced' && r.px! * 10_000 <= r.fair! * 10_500 && r.held.shares * r.px! < cash * 0.4) { want = true; limit = cross(10_500); why = 'building a diversified position'; }
      if (!want) continue;
      const qty = Math.max(1, Math.floor(b / Math.max(1, limit)));
      if (tryOrder(db, ctx, cfg, inv, r.s.company_id, 'buy', limit, qty, why, { fair: r.fair, px: r.px, chg5: r.chg5 })) { orders++; cash = available(db, inv.account_id); }
    }
    if (orders === 0) logInv(db, ctx.tick, inv.id, null, 'hold', 'no listed share met the strategy’s conditions', { strategy: inv.strategy }, false);
  }
}

/** Founding NPC/state holders keep a ladder of asks on the book for part of their stake. They sell at a premium to the last close: they are sellers of an asset, not price-setters. */
function runHolderFloat(db: Sql, ctx: TickCtx, cfg: EngineConfig) {
  for (const s of listed(db)) {
    const c = db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', s.company_id); if (!c || c.owner_kind === 'player') continue;
    const holder = getInvestor(db, c.owner_id); if (!holder || holder.kind === 'company') continue;
    const out = outstanding(db, s.company_id); if (out <= 0) continue;
    const h = holding(db, s.company_id, holder.id);
    const floorShares = Math.ceil((out * 5_500) / 10_000);                 // a holder never sells itself out of control
    const target = Math.max(0, Math.min(Math.floor((out * cfg.holderFloatBps) / 10_000), h.shares - floorShares));
    const onOffer = db.get<{ q: number }>("SELECT COALESCE(SUM(qty_remaining),0) q FROM share_orders WHERE investor_id = ? AND company_id = ? AND side = 'sell' AND status = 'open'", holder.id, s.company_id)!.q;
    const band = priceBand(db, cfg, s.company_id, ctx.tick); if (!band) continue;
    if (onOffer > 0 && ctx.tick % 3 !== 0) continue;                       // refresh the ladder every third day
    for (const o of db.all<ShareOrderRow>("SELECT * FROM share_orders WHERE investor_id = ? AND company_id = ? AND side = 'sell' AND status = 'open'", holder.id, s.company_id)) cancelShareOrder(db, o.id);
    const free = Math.min(target, holding(db, s.company_id, holder.id).shares - holding(db, s.company_id, holder.id).reserved);
    if (free <= 0) continue;
    const rungs = [{ bps: 300, part: 3 }, { bps: 800, part: 3 }, { bps: 1_500, part: 4 }];
    let left = free;
    rungs.forEach((r, i) => {
      const qty = i === rungs.length - 1 ? left : Math.floor((free * r.part) / 10);
      if (qty <= 0) return; left -= qty;
      try { placeShareOrder(db, ctx, shareCfg(cfg), { company: s.company_id, investor: holder.id, side: 'sell', price: Math.min(band.high, Math.ceil((band.ref * (10_000 + r.bps)) / 10_000)), qty, key: `float:${s.company_id}:${ctx.tick}:${i}` }); } catch { /* a refused rung is simply not posted */ }
    });
  }
}

/** Listed companies controlled by NPCs or the state pay a regular dividend out of genuine treasury surplus (same reserve rule that used to sweep cash to households). */
function runDividendPolicy(db: Sql, ctx: TickCtx, cfg: EngineConfig) {
  if (ctx.tick % cfg.dividendEveryTicks !== 0) return;
  for (const s of listed(db)) {
    const c = db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', s.company_id)!;
    if (c.owner_kind === 'player' || c.status !== 'operating') continue;
    const cap = dividendCapacity(db, cfg, s.company_id); if (cap.eligibleShares <= 0) continue;
    const reserveDays = db.get<{ r: number }>('SELECT reserve_days r FROM npc_profiles WHERE company_id = ?', s.company_id)?.r ?? cfg.npcReserveTicks;
    const extra = Math.max(0, reserveDays - cfg.dividendReserveDays) * (c.employees * c.wage_minor + c.property_minor + c.marketing_minor) + (c.owner_kind === 'state' ? cfg.enterpriseReserveMinor : 200_000);
    const spendable = Math.max(0, cap.capacityMinor - extra);
    const per = Math.floor((spendable * cfg.holderPayoutBps) / 10_000 / cap.eligibleShares);
    if (per < 1) continue;
    try { declareDividend(db, ctx, cfg, `divpol:${s.company_id}:${ctx.tick}`, s.company_id, per, `policy:${c.owner_kind}`); } catch { /* not eligible today */ }
  }
}

/** Decision phase (after NPC company reviews). */
export function runShareDecisions(db: Sql, ctx: TickCtx, cfg: EngineConfig) {
  runHolderFloat(db, ctx, cfg);
  runInvestors(db, ctx, cfg);
  runDividendPolicy(db, ctx, cfg);
}

/** End of day: suspensions, daily statistics, the index, valuations, and the facts the Penny Post reports. */
export function runShareClosing(db: Sql, ctx: TickCtx, cfg: EngineConfig) {
  const n = ctx.tick;
  for (const s of db.all<{ company_id: string; ticker: string; status: string; suspended_reason: string | null }>("SELECT company_id, ticker, status, suspended_reason FROM securities WHERE status IN ('open','suspended') ORDER BY company_id")) {
    const c = db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', s.company_id)!;
    const bad = c.status === 'insolvent' || c.bankrupt_tick !== null;
    if (s.status === 'open' && bad) {
      db.run("UPDATE securities SET status = 'suspended', suspended_reason = 'company insolvent', suspended_tick = ? WHERE company_id = ?", n, s.company_id);
      cancelOpenDividends(db, s.company_id);
      logEvent(db, n, 'trading_suspended', 'warning', s.company_id, `Trading in ${c.name} (${s.ticker}) was suspended: the company cannot pay its bills`, { reason: 'insolvent' });
    } else if (s.status === 'suspended' && !bad && s.suspended_reason === 'company insolvent') {
      db.run("UPDATE securities SET status = 'open', suspended_reason = NULL, suspended_tick = NULL WHERE company_id = ?", s.company_id);
      logEvent(db, n, 'trading_resumed', 'info', s.company_id, `Trading in ${c.name} (${s.ticker}) resumed: the company is solvent again`, {});
      matchCompany(db, ctx, shareCfg(cfg), s.company_id);
    }
  }
  recordValuations(db, cfg, n);
  // daily statistics + carry-forward last price
  let turnover = 0, capNow = 0, capPrev = 0, listedN = 0;
  for (const s of db.all<{ company_id: string; status: string; issued_shares: number }>("SELECT company_id, status, issued_shares FROM securities WHERE status IN ('open','suspended') ORDER BY company_id")) {
    const ob = orderBook(db, s.company_id, n);
    const band = priceBand(db, cfg, s.company_id, n);
    const px = lastPrice(db, s.company_id) ?? band?.ref ?? 0;
    const prevPx = db.get<{ p: number | null }>('SELECT ref_minor p FROM security_stats WHERE company_id = ? AND tick = ?', s.company_id, n - 1)?.p ?? px;
    const out = outstanding(db, s.company_id);
    if (!db.get('SELECT 1 FROM security_stats WHERE tick = ? AND company_id = ?', n, s.company_id)) db.run('INSERT INTO security_stats (tick, company_id, volume, trades, status) VALUES (?,?,0,0,?)', n, s.company_id, s.status);
    db.run('UPDATE security_stats SET best_bid_minor = ?, best_ask_minor = ?, bid_depth = ?, ask_depth = ?, ref_minor = ?, market_cap_minor = ?, status = ? WHERE tick = ? AND company_id = ?', ob.bids[0]?.priceMinor ?? null, ob.asks[0]?.priceMinor ?? null, ob.bids.reduce((a, l) => a + l.shares, 0), ob.asks.reduce((a, l) => a + l.shares, 0), px, px * out, s.status, n, s.company_id);
    const day = db.get<{ v: number; vol: number }>('SELECT COALESCE(vwap_minor * volume,0) v, volume vol FROM security_stats WHERE tick = ? AND company_id = ?', n, s.company_id)!;
    turnover += day.v; capNow += px * out; capPrev += prevPx * out; listedN++;
  }
  if (listedN > 0) {
    const prev = db.get<{ value_bps: number }>('SELECT value_bps FROM market_index WHERE tick = ?', n - 1)?.value_bps ?? 10_000;
    const v = capPrev > 0 ? Math.round((prev * capNow) / capPrev) : prev;
    db.run('INSERT OR REPLACE INTO market_index (tick, value_bps, market_cap_minor, listed, turnover_minor) VALUES (?,?,?,?,?)', n, Math.max(1, v), capNow, listedN, turnover);
    const back = db.get<{ value_bps: number }>('SELECT value_bps FROM market_index WHERE tick = ?', n - 5)?.value_bps;
    const crash = db.get<{ n: number }>("SELECT COUNT(*) n FROM economic_events WHERE kind = 'market_crash' AND tick > ?", n - 10)!.n;
    if (back && v * 10 <= back * 9 && !crash) logEvent(db, n, 'market_crash', 'warning', null, `The Penny Exchange index fell ${(((back - v) * 100) / back).toFixed(1)}% in five days`, { fromBps: back, toBps: v });
  }
  // facts for the Penny Post
  for (const s of db.all<{ company_id: string }>("SELECT company_id FROM securities WHERE status IN ('open','suspended') ORDER BY company_id")) {
    const c = db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', s.company_id)!;
    const net7 = db.get<{ v: number }>('SELECT COALESCE(SUM(net_profit_minor),0) v FROM company_tick_stats WHERE company_id = ? AND tick > ? AND tick <= ?', s.company_id, n - 7, n)!.v;
    const best = db.get<{ v: number | null }>('SELECT MAX(w) v FROM (SELECT SUM(net_profit_minor) OVER (ORDER BY tick ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) w FROM company_tick_stats WHERE company_id = ? AND tick > 0 AND tick < ?)', s.company_id, n)?.v ?? 0;
    const recent = (kind: string) => db.get<{ n: number }>('SELECT COUNT(*) n FROM economic_events WHERE kind = ? AND subject = ? AND tick > ?', kind, s.company_id, n - 14)!.n;
    if (n >= 14 && net7 > 0 && net7 > (best ?? 0) && !recent('record_profit')) logEvent(db, n, 'record_profit', 'info', s.company_id, `${c.name} posted its best week yet: ${(net7 / 100).toFixed(2)} EC of profit`, { net7 });
    const eq = db.get<{ e: number }>('SELECT equity_minor e FROM security_valuations WHERE company_id = ? AND tick = ?', s.company_id, n)?.e ?? 0;
    if (n >= 14 && net7 < 0 && -net7 * 10 >= Math.max(1, eq) && !recent('major_loss')) logEvent(db, n, 'major_loss', 'warning', s.company_id, `${c.name} lost ${(-net7 / 100).toFixed(2)} EC over the last week`, { net7 });
    // ownership announcements: crossing the published thresholds
    const o = outstanding(db, s.company_id);
    if (o > 0) for (const h of db.all<{ investor_id: string; shares: number }>('SELECT investor_id, shares FROM share_holdings WHERE company_id = ? AND shares > 0 AND investor_id <> ?', s.company_id, companyInvestorId(s.company_id))) {
      const cls = classifyStake(Math.floor((h.shares * 10_000) / o));
      const prev = db.get<{ class: string }>('SELECT class FROM stake_marks WHERE company_id = ? AND investor_id = ?', s.company_id, h.investor_id)?.class ?? 'minority';
      if (cls !== prev) {
        db.run('INSERT OR REPLACE INTO stake_marks (company_id, investor_id, class) VALUES (?,?,?)', s.company_id, h.investor_id, cls);
        const order = ['minority', 'significant', 'substantial', 'majority'];
        if (order.indexOf(cls) > order.indexOf(prev) && cls !== 'majority') logEvent(db, n, 'large_holder', 'info', s.company_id, `${getInvestor(db, h.investor_id)?.name ?? h.investor_id} now holds a ${cls} stake (${((h.shares * 100) / o).toFixed(1)}%) in ${c.name}`, { investor: h.investor_id, stakeBps: Math.floor((h.shares * 10_000) / o), class: cls });
      }
    }
  }
}

