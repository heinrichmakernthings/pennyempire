import type { Sql } from './db/sql';
import { configureCompany } from './engine/commands';
import { createCompany, startupQuote } from './engine/company';
import { loadConfig, saveConfig } from './engine/config';
import { checkShareIntegrity, ensureInvestor, holding, outstanding, security } from './engine/capital';
import { createAccount, balance, issue, reconcile, supply } from './engine/ledger';
import { computeValuation } from './engine/valuation';
import { listingQuote, shareCfg } from './engine/listing';
import { declarePlayerDividend, listPlayerCompany, placePlayerShareOrder } from './engine/shareCommands';
import { placeShareOrder, priceBand } from './engine/shareMarket';
import { runTick } from './engine/tick';
import { lastTick, openWorld } from './engine/world';
import { PLAYER_ID, PLAYER_WALLET, companyAccount } from './seed/bristol';

export type StockScenarioId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export interface StockRow { day: number; priceMinor: number | null; fairMinor: number | null; volume: number; indexBps: number; note?: string }
export interface StockScenarioReport {
  id: StockScenarioId; name: string; days: number; setup: string[]; notes: string[]; anomalies: string[]; ledgerReconciles: boolean; sharesConsistent: boolean;
  supply: { start: number; end: number }; timeline: StockRow[];
  headline: Record<string, string | number>;
}
let n = 0; const key = (p: string) => `${p}-${n++}`;
const ctx0 = (db: Sql) => ({ tick: lastTick(db), gameDate: 'scenario', actor: 'scenario' });
const found = (db: Sql, industry: string, plot: string, name: string) => { const q = startupQuote(db, { industry, plotId: plot, tier: 1, name }); const r = createCompany(db, key('scn:found'), { industry, plotId: plot, tier: 1, name, expectedTotalMinor: q.totalMinor }); if (!r.ok) throw new Error(r.error.message); return (r.data as { companyId: string }).companyId; };
function trader(db: Sql, id: string, cash: number) {
  const acct = `acct:scn:${id}`; if (!db.get('SELECT 1 FROM accounts WHERE id = ?', acct)) createAccount(db, acct, 'households', `scenario trader ${id}`);
  db.run("INSERT OR IGNORE INTO owners (id, kind, name) VALUES (?, 'npc', ?)", id, id);
  const inv = ensureInvestor(db, { id, kind: 'household', name: id, account: acct });
  if (cash > 0) issue(db, ctx0(db), key(`scn:cash:${id}`), acct, cash, `scenario funding of ${id}`);
  return inv;
}
const step = (db: Sql, days: number, onDay?: (day: number) => void) => { for (let i = 0; i < days; i++) { const r = runTick(db, lastTick(db) + 1); if (r.status !== 'complete') throw new Error(`tick failed: ${JSON.stringify(r)}`); onDay?.(lastTick(db)); } };
const px = (db: Sql, co: string) => db.get<{ p: number }>('SELECT close_minor p FROM security_stats WHERE company_id = ? AND close_minor IS NOT NULL ORDER BY tick DESC LIMIT 1', co)?.p ?? null;
const fair = (db: Sql, co: string) => db.get<{ v: number }>('SELECT fair_value_minor v FROM security_valuations WHERE company_id = ? ORDER BY tick DESC LIMIT 1', co)?.v ?? null;
const row = (db: Sql, co: string, note?: string): StockRow => { const t = lastTick(db); return { day: t, priceMinor: px(db, co), fairMinor: fair(db, co), volume: db.get<{ v: number }>('SELECT COALESCE(SUM(volume),0) v FROM security_stats WHERE company_id = ? AND tick > ?', co, t - 7)!.v, indexBps: db.get<{ v: number }>('SELECT value_bps v FROM market_index WHERE tick = ?', t)?.v ?? 10_000, note }; };
const cashNow = (db: Sql, id: string) => balance(db, id);
const buyBand = (db: Sql, co: string) => priceBand(db, loadConfig(db), co, lastTick(db))!;
const order = (db: Sql, co: string, investor: string, side: 'buy' | 'sell', price: number, qty: number) => { try { return placeShareOrder(db, ctx0(db), shareCfg(loadConfig(db)), { company: co, investor, side, price, qty, key: key('scn:ord'), acknowledgeControlLoss: true }); } catch { return null; } };

export function runStockScenario(id: StockScenarioId, days: number): StockScenarioReport {
  const db: Sql = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'new');
  issue(db, ctx0(db), key('scn:wallet'), PLAYER_WALLET, 4_000_000, 'scenario grant: player startup money');
  const setup: string[] = [], notes: string[] = [], anomalies: string[] = [], timeline: StockRow[] = [], headline: Record<string, string | number> = {};
  const s0 = supply(db).circulating; let name = ''; let co = '';
  const cfg = loadConfig(db);
  const ownerWorth = () => balance(db, PLAYER_WALLET);
  const listAt = (company: string, shares: number, ratio: number) => { const fv = listingQuote(db, cfg, company, shares, 1, lastTick(db), { kind: 'player', id: PLAYER_ID }).priceRange.fairValueMinor; const price = Math.max(1, Math.floor(fv * ratio)); const r = listPlayerCompany(db, key('scn:ipo'), { companyId: company, newShares: shares, offerPriceMinor: price }); if (!r.ok) throw new Error(r.error.message); return { fv, price }; };
  const sample = (label?: string) => timeline.push(row(db, co, label));
  const sampleEvery = Math.max(1, Math.floor(days / 12));
  const weeklyDividend = (day: number, pct = 60) => { if (day % 7 !== 0) return; const cap = (db.get<{ c: number }>('SELECT 0 c') as { c: number }).c; void cap; const c = security(db, co); if (!c || c.status !== 'open') return; const holders = outstanding(db, co); const cash = balance(db, companyAccount(co)); const per = Math.floor((Math.max(0, cash - 400_000) * pct) / 100 / Math.max(1, holders)); if (per > 0) declarePlayerDividend(db, key('scn:div'), co, per); };

  if (id === 'A') {
    name = 'A — Growing Startup'; setup.push('A player founds a pizza restaurant, runs it for 16 days, lists 3,000 new shares at 70% of the fundamental estimate, then declares a dividend each week from real treasury surplus.');
    co = found(db, 'pizza', 'lot-1', 'Quay Pizza'); step(db, 16); const w0 = ownerWorth();
    const { fv, price } = listAt(co, 3_000, 0.7); notes.push(`Offer price ${(price / 100).toFixed(2)} EC against an estimate of ${(fv / 100).toFixed(2)} EC a share.`);
    step(db, days - 16, (d) => { weeklyDividend(d); if (d % 5 === 0 && d >= 26) { const b = buyBand(db, co); order(db, co, PLAYER_ID, 'sell', Math.min(b.high, Math.ceil(b.ref * 1.04)), 250); } if ((d - 16) % sampleEvery === 0) sample(); });
    const offered = db.get<{ s: number; p: number }>('SELECT shares_sold s, proceeds_minor p FROM share_offerings WHERE company_id = ?', co)!;
    headline.sharesSoldInOffering = offered.s; headline.raisedForCompanyEC = offered.p / 100; headline.dividendsPaidEC = (db.get<{ v: number }>("SELECT COALESCE(SUM(paid_minor),0) v FROM dividends WHERE company_id = ?", co)!.v) / 100;
    headline.playerWalletChangeEC = (ownerWorth() - w0) / 100; headline.founderStakeBps = Math.floor((holding(db, co, PLAYER_ID).shares * 10_000) / Math.max(1, outstanding(db, co)));
  } else if (id === 'B') {
    name = 'B — Struggling Business'; setup.push('A listed pizza restaurant starts losing customers on day 30: its owner prices it at the maximum, cuts quality and stops advertising. Investors watch profit, valuation and demand fall.');
    co = found(db, 'pizza', 'lot-1', 'Quay Pizza'); step(db, 16); listAt(co, 3_000, 0.8);
    step(db, 14, () => {}); sample('before the slide');
    const c = db.get<{ revision: number; max_price_minor: number }>('SELECT revision, max_price_minor FROM companies WHERE id = ?', co)!; const full = db.get<{ max_employees: number }>('SELECT max_employees FROM companies WHERE id = ?', co)!.max_employees; configureCompany(db, key('scn:cfg'), co, c.revision, { priceMinor: c.max_price_minor, quality: 'basic', marketingMinorPerTick: 0, employees: full });
    const peak = fair(db, co) ?? 0; step(db, days - 30, (d) => { if (d % 4 === 0) { const b = buyBand(db, co); order(db, co, PLAYER_ID, 'sell', b.low, 300); } if ((d - 30) % sampleEvery === 0) sample(); });
    headline.estimateBeforeEC = peak / 100; headline.estimateAfterEC = (fair(db, co) ?? 0) / 100; headline.lastPriceEC = (px(db, co) ?? 0) / 100; headline.companyStatus = db.get<{ s: string }>('SELECT status s FROM companies WHERE id = ?', co)!.s;
  } else if (id === 'C') {
    name = 'C — Speculative Bubble'; setup.push('Three speculators with large budgets bid at the top of the daily price band for 10 days while the founder sells into the rally; NPC value investors sell too once the price is well above their estimate. Then the speculators dump at the bottom of the band. Prices are set only by these orders, and the daily band limits how fast they can move.');
    co = found(db, 'pizza', 'lot-1', 'Quay Pizza'); step(db, 16); listAt(co, 4_000, 1.0); step(db, 6);
    const spec = [trader(db, 'spec-1', 2_500_000), trader(db, 'spec-2', 2_500_000), trader(db, 'spec-3', 2_500_000)]; const cash0 = spec.map((s) => cashNow(db, s.account_id));
    let peak = 0; const start = lastTick(db);
    step(db, 10, (d) => { { const bb = buyBand(db, co); order(db, co, PLAYER_ID, 'sell', bb.high, 700); } for (const s of spec) { const b = buyBand(db, co); const have = db.get<{ a: number }>('SELECT balance_minor - reserved_minor a FROM accounts WHERE id = ?', s.account_id)!.a; const qty = Math.min(1_500, Math.floor(have / Math.max(1, b.high))); if (qty > 0) order(db, co, s.id, 'buy', b.high, qty); } peak = Math.max(peak, px(db, co) ?? 0); if ((d - start) % 2 === 0) sample('bubble'); });
    const premium = Math.round((((px(db, co) ?? 0) - (fair(db, co) ?? 1)) * 100) / (fair(db, co) ?? 1)); headline.peakPriceEC = peak / 100; headline.premiumOverEstimatePct = premium;
    step(db, 8, (d) => { for (const s of spec) { const b = buyBand(db, co); const held = holding(db, co, s.id); const free = held.shares - held.reserved; if (free > 0) order(db, co, s.id, 'sell', b.low, Math.min(free, 1_200)); } if ((d - start) % 2 === 0) sample('reversal'); });
    step(db, Math.max(0, days - 40), (d) => { if (d % sampleEvery === 0) sample(); });
    headline.priceAfterEC = (px(db, co) ?? 0) / 100; headline.estimateEC = (fair(db, co) ?? 0) / 100;
    headline.speculatorNetEC = spec.reduce((a, s, i) => a + (cashNow(db, s.account_id) + (holding(db, co, s.id).shares * (px(db, co) ?? 0)) - cash0[i]!), 0) / 100;
  } else if (id === 'D') {
    name = 'D — NPC Market'; setup.push('One human investor trades against the NPC market for the whole run: buys the listed companies whose price is below the fundamental estimate, sells those far above it, and collects dividends.');
    co = 'co-bean-there'; step(db, 5); const cash0 = balance(db, PLAYER_WALLET);
    const listed = db.all<{ company_id: string }>("SELECT company_id FROM securities WHERE status = 'open' ORDER BY company_id").map((r) => r.company_id);
    step(db, days - 5, (d) => {
      if (d % 2) return;
      for (const c of listed) { const p = px(db, c), f = fair(db, c); const b = priceBand(db, loadConfig(db), c, lastTick(db)); if (!p || !f || !b) continue;
        if (p * 10 < f * 8) placePlayerShareOrder(db, key('scn:buy'), { companyId: c, side: 'buy', quantity: 150, limitPriceMinor: Math.min(b.high, Math.ceil(p * 1.02)), expiresInTicks: 2 });
        const held = holding(db, c, PLAYER_ID); if (held.shares > 0 && p * 10 > f * 12) placePlayerShareOrder(db, key('scn:sell'), { companyId: c, side: 'sell', quantity: Math.min(held.shares - held.reserved, 150), limitPriceMinor: Math.max(b.low, Math.floor(p * 0.98)), expiresInTicks: 2, acknowledgeControlLoss: true }); }
      if (d % sampleEvery === 0) sample();
    });
    const pr = db.get<{ r: number; d: number }>("SELECT COALESCE((SELECT SUM(pnl_minor) FROM share_pnl WHERE investor_id = ?),0) r, COALESCE((SELECT SUM(e.amount_minor) FROM dividend_entitlements e JOIN dividends v ON v.id = e.dividend_id WHERE v.status = 'paid' AND e.investor_id = ?),0) d", PLAYER_ID, PLAYER_ID)!;
    headline.realisedGainEC = pr.r / 100; headline.dividendIncomeEC = pr.d / 100; headline.positions = db.get<{ n: number }>('SELECT COUNT(*) n FROM share_holdings WHERE investor_id = ? AND shares > 0', PLAYER_ID)!.n; headline.walletChangeEC = (balance(db, PLAYER_WALLET) - cash0) / 100;
    const mv = db.all<{ company_id: string; shares: number }>('SELECT company_id, shares FROM share_holdings WHERE investor_id = ? AND shares > 0', PLAYER_ID).reduce((a, h) => a + h.shares * (px(db, h.company_id) ?? 0), 0); headline.markedValueEC = mv / 100;
    const npc = db.get<{ v: number }>("SELECT COALESCE(SUM(t.qty),0) v FROM share_trades t JOIN investors i ON (i.id = t.buyer_id OR i.id = t.seller_id) WHERE i.kind = 'npc'")!.v; const all = db.get<{ v: number }>('SELECT COALESCE(SUM(qty),0) v FROM share_trades')!.v; headline.npcInvestorShareOfVolumePct = all ? Math.round((npc * 100) / all) : 0;
  } else if (id === 'E') {
    name = 'E — Acquisition'; setup.push('A well-funded investor (the human player) buys a controlling interest in an NPC café through the order book over several days. Control passes by the published majority rule; the café’s cash stays in the café.');
    co = 'co-bean-there'; issue(db, ctx0(db), key('scn:whale'), PLAYER_WALLET, 40_000_000, 'scenario grant: acquisition budget'); step(db, 3);
    const holder = db.get<{ owner_id: string }>('SELECT owner_id FROM companies WHERE id = ?', co)!.owner_id; const cash = balance(db, companyAccount(co)); let controlDay = -1;
    step(db, days - 3, (d) => {
      const b = buyBand(db, co); const held = holding(db, co, holder);
      if (outstanding(db, co) > 0 && controlDay < 0) { order(db, co, holder, 'sell', Math.min(b.high, Math.ceil(b.ref * 1.05)), Math.min(held.shares - held.reserved, 2_000)); placePlayerShareOrder(db, key('scn:take'), { companyId: co, side: 'buy', quantity: 2_000, limitPriceMinor: Math.min(b.high, Math.ceil(b.ref * 1.05)), expiresInTicks: 1 }); }
      const own = db.get<{ owner_kind: string }>('SELECT owner_kind FROM companies WHERE id = ?', co)!.owner_kind; if (own === 'player' && controlDay < 0) { controlDay = d; sample('control passed'); }
      if (d % sampleEvery === 0) sample();
    });
    const ctl = db.get<{ tick: number; stake_bps: number }>('SELECT tick, stake_bps FROM control_log WHERE company_id = ? ORDER BY id LIMIT 1', co);
    headline.controlDay = ctl?.tick ?? -1; headline.stakeAtControlPct = ctl ? ctl.stake_bps / 100 : 0; headline.ownerNow = db.get<{ o: string }>('SELECT owner_kind || \':\' || owner_id o FROM companies WHERE id = ?', co)!.o; headline.cafeCashBeforeEC = cash / 100; headline.cafeCashAfterEC = balance(db, companyAccount(co)) / 100;
    headline.playerStakePct = Number(((holding(db, co, PLAYER_ID).shares * 100) / Math.max(1, outstanding(db, co))).toFixed(1));
  } else {
    name = 'F — Bankruptcy'; setup.push('A listed pizza restaurant loses its supply chain (state supply stops, every mill, dairy and farm closes). It cannot produce, cannot pay its bills, is declared insolvent, suspended, then liquidated. Shareholders (NPC and scripted) lose money.');
    co = found(db, 'pizza', 'lot-1', 'Quay Pizza'); step(db, 16); listAt(co, 3_000, 0.9); const holders = [trader(db, 'bag-1', 1_000_000), trader(db, 'bag-2', 1_000_000)];
    step(db, 6, () => { for (const h of holders) { const b = buyBand(db, co); order(db, co, h.id, 'buy', b.high, 600); } }); sample('before');
    const cashBefore = holders.map((h) => cashNow(db, h.account_id)); const held = holders.map((h) => holding(db, co, h.id).shares);
    // The collapse: the state stops supplying raw materials and every mill and dairy shuts, so the restaurant cannot get flour or cheese while wages and rent keep running.
    saveConfig(db, { ...loadConfig(db), stateSupplyPerTick: 0 }, 'scenario F: raw-material supply collapses');
    db.run("UPDATE companies SET status = 'paused', revision = revision + 1 WHERE industry_id IN ('mill','dairy','farm') AND owner_kind <> 'player'"); notes.push('Day 22: the state stops supplying raw materials and every mill, dairy and farm closes.');
    let suspendedDay = -1; step(db, days - 22, (d) => { const s = security(db, co)!; if (s.status === 'suspended' && suspendedDay < 0) { suspendedDay = d; sample('suspended'); } if (d % sampleEvery === 0) sample(); });
    headline.suspendedOnDay = suspendedDay; headline.finalStatus = security(db, co)!.status; headline.sharesRemaining = security(db, co)!.issued_shares;
    const ids = holders.map((h) => h.id); const loss = db.get<{ p: number; q: number }>(`SELECT COALESCE(SUM(pnl_minor),0) p, COALESCE(SUM(qty),0) q FROM share_pnl WHERE company_id = ? AND investor_id IN (${ids.map(() => '?').join(',')})`, co, ...ids)!;
    headline.sharesHeldAtCollapse = held.reduce((a, x) => a + x, 0); headline.scriptedHoldersRealisedGainEC = loss.p / 100;
    headline.allShareholdersRealisedEC = db.get<{ p: number }>('SELECT COALESCE(SUM(pnl_minor),0) p FROM share_pnl WHERE company_id = ?', co)!.p / 100; headline.distributedToShareholdersEC = db.get<{ p: number }>("SELECT COALESCE(SUM(proceeds_minor),0) p FROM share_pnl WHERE company_id = ? AND kind = 'liquidation'", co)!.p / 100;
    void cashBefore;
  }
  const rec = reconcile(db); const probs = checkShareIntegrity(db);
  if (!rec.ok) anomalies.push(...rec.problems.slice(0, 5)); anomalies.push(...probs.slice(0, 5));
  const d = computeValuation(db, cfg, co, lastTick(db)); void d;
  return { id, name, days, setup, notes, anomalies, ledgerReconciles: rec.ok, sharesConsistent: probs.length === 0, supply: { start: s0, end: supply(db).circulating }, timeline, headline };
}

const ec = (m: number | null) => (m === null ? '—' : `${(m / 100).toFixed(2)} EC`);
export function formatStockScenario(r: StockScenarioReport): string {
  const L = [`# Stock scenario ${r.name}`, '', `${r.days} in-game days · deterministic · ledger reconciles: **${r.ledgerReconciles}** · share register consistent: **${r.sharesConsistent}** · anomalies: **${r.anomalies.length}**`, '', '## Setup', ...r.setup.map((s) => `- ${s}`), ...r.notes.map((s) => `- ${s}`), '', '## Headline', ...Object.entries(r.headline).map(([k, v]) => `- ${k}: ${v}`), '', `Circulating supply ${ec(r.supply.start)} → ${ec(r.supply.end)} (changes only by explicit scenario grants and recorded sinks).`, '', '## Timeline', '| day | last price | estimate | 7-day volume | index | note |', '|---|---|---|---|---|---|'];
  for (const t of r.timeline) L.push(`| ${t.day} | ${ec(t.priceMinor)} | ${ec(t.fairMinor)} | ${t.volume} | ${(t.indexBps / 100).toFixed(1)} | ${t.note ?? ''} |`);
  if (r.anomalies.length) L.push('', '## Anomalies', ...r.anomalies.map((a) => `- ${a}`));
  return L.join('\n') + '\n';
}
