/**
 * Private-alpha load and resilience scenarios, driven through the real session layer (real invites, PBKDF2, cookies, per-player identity).
 * Each scenario reports latencies, tick cost and the invariants that must hold: both ledgers reconcile, the share register is consistent,
 * no account below zero (except the mint), and no player can end up with another player's assets.
 */
import type { Sql } from './db/sql';
import { advance, lastTick, openWorld } from './engine/world';
import { reconcile, supply } from './engine/ledger';
import { reconcileGbp } from './engine/gbpLedger';
import { checkShareIntegrity } from './engine/capital';
import { createInvite } from './engine/accounts';
import { client, order, type Client } from './test/http';
import { setParam } from './engine/admin';

export interface AlphaStress { name: string; facts: Record<string, number | string | boolean>; ok: boolean; problems: string[] }
let fake = 1_900_000_000_000;
const tick = () => (fake += 1_000);                                       // a clock that advances one second per request, so burst limits do not distort load tests
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! * 10) / 10 : 0; };
const timed = async <T>(lat: number[], f: () => Promise<T>) => { const t0 = performance.now(); const r = await f(); lat.push(performance.now() - t0); return r; };

async function signUp(db: Sql, n: number, role: 'player' | 'admin' = 'player'): Promise<Client> {
  const c = client(db, `p${n}`, { now: tick });
  const r = await c.call('POST', '/api/auth/register', { invite: createInvite(db, fake, 'stress', role).code, username: `player${n}${role === 'admin' ? 'admin' : ''}`, password: `stress-password-${n}`, displayName: `Player ${n}` }, { 'cf-connecting-ip': `10.0.${n >> 8}.${n & 255}` });
  if (r.status !== 200) throw new Error(`register ${n}: ${JSON.stringify(r.body)}`);
  c.playerId = r.body.user.playerId; return c;
}
function invariants(db: Sql) {
  const problems: string[] = [];
  const c = reconcile(db); if (!c.ok) problems.push(...c.problems.slice(0, 5));
  const g = reconcileGbp(db); if (!g.ok) problems.push(...g.problems.slice(0, 5));
  problems.push(...checkShareIntegrity(db).slice(0, 5));
  const neg = db.get<{ n: number }>("SELECT COUNT(*) n FROM accounts WHERE balance_minor < 0 AND kind <> 'issuance'")!.n; if (neg) problems.push(`${neg} accounts below zero`);
  const foreign = db.get<{ n: number }>("SELECT COUNT(*) n FROM companies c JOIN players p ON p.id = c.owner_id WHERE c.owner_kind = 'player' AND c.treasury_account_id = p.wallet_account_id")!.n; if (foreign) problems.push('a company shares a wallet with a player');
  return problems;
}
const tickCost = (db: Sql, days: number) => { const ms: number[] = []; for (let i = 0; i < days; i++) { const t0 = performance.now(); advance(db, 1); ms.push(performance.now() - t0); } return { tickAvgMs: Math.round(ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length)), tickMaxMs: Math.round(Math.max(...ms)) }; };
const freeLots = (db: Sql, industry: string) => db.all<{ id: string }>("SELECT p.id FROM plots p JOIN industry_specs s ON s.industry_id = ? WHERE p.district_id IS NOT NULL AND p.company_id IS NULL AND p.asset_id IS NULL AND p.width = s.plot_width AND p.depth = s.plot_depth ORDER BY p.id", industry).map((r) => r.id);

async function found(c: Client, industry: string, plot: string, name: string) {
  const q = (await c.get(`/api/startup-quote?industry=${industry}&plotId=${plot}&tier=1`)).quote; if (!q.ok) return null;
  const r = await c.cmd({ type: 'company.create', industry, plotId: plot, tier: 1, name, expectedTotalMinor: q.totalMinor });
  return r.status === 200 ? (r.body.data.companyId as string) : null;
}

/** N players join, look around, found companies while land lasts, trade, invest and buy prestige; then the world runs 30 days. */
export async function population(n: number): Promise<AlphaStress> {
  const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'new'); advance(db, 8);   // the stock exchange opens on day 7
  const reg: number[] = [], lat: number[] = []; const players: Client[] = [];
  for (let i = 0; i < n; i++) players.push(await timed(reg, () => signUp(db, i)));
  let founded = 0, refusedNoLand = 0, prestige = 0, shareBuys = 0, orders = 0;
  const listed = (await players[0]!.get('/api/securities')).exchange.listings.filter((l: { status: string; priceMinor: number | null; fairValueMinor: number | null }) => l.status === 'open');
  for (const [i, p] of players.entries()) {
    for (const path of ['/api/screens/city', '/api/screens/portfolio', '/api/notifications', '/api/onboarding', '/api/exchange/commodities']) await timed(lat, () => p.call('GET', path));
    const industry = i % 2 ? 'pizza' : 'farm'; const lot = freeLots(db, industry)[0];
    if (lot) { if (await timed(lat, () => found(p, industry, lot, `Stress ${industry} ${i}`))) founded++; } else refusedNoLand++;
    if ((await timed(lat, () => p.cmd({ type: 'prestige.buy', itemId: 'veh-executive' }))).status === 200) prestige++;
    const sec = listed[i % Math.max(1, listed.length)];
    if (sec) { const px = sec.priceMinor ?? sec.fairValueMinor ?? 100; if ((await timed(lat, () => p.cmd({ type: 'share.order', companyId: sec.companyId, side: 'buy', quantity: 20, limitPriceMinor: Math.ceil(px * 1.1), orderKind: 'limit' }))).status === 200) shareBuys++; }
  }
  for (const p of players) {
    const mine = db.all<{ id: string; industry_id: string }>("SELECT id, industry_id FROM companies WHERE owner_kind = 'player' AND owner_id = ?", p.playerId);
    for (const co of mine) { const r = await timed(lat, () => (co.industry_id === 'farm' ? order(p, co.id, 'milk', 'buy', 5, 80) : order(p, co.id, 'flour', 'buy', 10, 260))); if (r.status === 200) orders++; }
  }
  const cost = tickCost(db, 30);
  const problems = invariants(db);
  return { name: `${n} player${n === 1 ? '' : 's'}`, ok: problems.length === 0, problems, facts: { players: n, registerP50Ms: pct(reg, 50), registerP95Ms: pct(reg, 95), requests: lat.length, requestP50Ms: pct(lat, 50), requestP95Ms: pct(lat, 95), requestMaxMs: pct(lat, 100), companiesFounded: founded, refusedNoFreeLot: refusedNoLand, prestigeBought: prestige, shareOrders: shareBuys, commodityOrders: orders, ...cost, playerCompaniesOperatingAfter30d: db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE owner_kind = 'player' AND status = 'operating'")!.n, npcCompanies: db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE owner_kind = 'npc' AND bankrupt_tick IS NULL")!.n, circulatingEC: supply(db).circulating / 100 } };
}

/** Ten trading companies fire hundreds of orders at the same moment; the books, inventories and reservations must still tie out. */
export async function heavyTrading(): Promise<AlphaStress> {
  const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'new'); advance(db, 2);
  const ps: { c: Client; co: string; ind: string }[] = [];
  for (let i = 0; i < 10; i++) { const c = await signUp(db, i); const ind = i < 4 ? 'farm' : 'pizza'; const lot = freeLots(db, ind)[0]; const co = lot ? await found(c, ind, lot, `Trader ${i}`) : null; if (co) ps.push({ c, co, ind }); }
  advance(db, 3);
  const lat: number[] = []; let ok = 0, refused = 0;
  const jobs: Promise<unknown>[] = [];
  for (let round = 0; round < 30; round++) for (const p of ps) {
    const job = p.ind === 'farm' ? order(p.c, p.co, 'wheat', 'sell', 5 + (round % 7), 45 + (round % 15)) : order(p.c, p.co, 'cheese', 'buy', 2 + (round % 3), 300 + (round % 40));
    jobs.push(timed(lat, () => job).then((r) => { if ((r as { status: number }).status === 200) ok++; else refused++; }));
  }
  await Promise.all(jobs);
  const cost = tickCost(db, 10);
  const problems = invariants(db);
  return { name: 'Heavy simultaneous trading', ok: problems.length === 0, problems, facts: { companies: ps.length, ordersSubmitted: jobs.length, accepted: ok, refused, requestP95Ms: pct(lat, 95), trades: db.get<{ n: number }>('SELECT COUNT(*) n FROM trades')!.n, openOrders: db.get<{ n: number }>("SELECT COUNT(*) n FROM orders WHERE status = 'open'")!.n, ...cost } };
}

/** Recession, inflation shock and energy shortage applied together for weeks, plus a deliberately starved player company. */
async function shocks(): Promise<AlphaStress> {
  const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'new');
  const admin = await signUp(db, 900, 'admin'); const p = await signUp(db, 1);
  const pizza = await found(p, 'pizza', freeLots(db, 'pizza')[0]!, 'Fragile Pizza');
  advance(db, 5);
  const ev = async (type: string) => (await admin.call('POST', '/api/admin/event', { type, severity: 3, days: 30, reason: `stress test: ${type}` })).status;
  const triggered = [await ev('recession'), await ev('inflation_shock'), await ev('energy_shortage')];
  setParam(db, 'stress', 'eventMaxActive', 3, 'stress test allows three concurrent events');
  const triggered3 = triggered.includes(422) ? await ev('energy_shortage') : 200;
  // the player strips the company's cash: it should become insolvent and be wound up, with any residual returned to THIS player
  const co = db.get<{ b: number; reserve: number }>('SELECT a.balance_minor - a.reserved_minor b, c.employees * c.wage_minor + c.property_minor + c.marketing_minor reserve FROM companies c JOIN accounts a ON a.id = c.treasury_account_id WHERE c.id = ?', pizza)!;
  const wd = await p.cmd({ type: 'company.withdraw', companyId: pizza!, amountMinor: Math.max(1, co.b - co.reserve) });
  const rev = (await p.get(`/api/companies/${pizza}`)).envelope.revision;
  const burn = await p.cmd({ type: 'company.configure', companyId: pizza!, expectedRevision: rev, marketingMinorPerTick: 50_000 });   // spends far beyond its means
  const bankrupt0 = db.get<{ n: number }>('SELECT COUNT(*) n FROM companies WHERE bankrupt_tick IS NOT NULL')!.n;
  const cpi0 = db.get<{ v: number }>('SELECT COALESCE(MAX(households_avg_minor),0) v FROM consumer_state')!.v;
  const cost = tickCost(db, 40);
  const status = db.get<{ s: string; b: number | null }>('SELECT status s, bankrupt_tick b FROM companies WHERE id = ?', pizza)!;
  const problems = invariants(db);
  return { name: 'Recession + inflation + energy shortage, with a starved company', ok: problems.length === 0, problems, facts: { eventsTriggered: [...triggered, triggered3].join('/'), cashWithdrawn: wd.status === 200 ? true : String(wd.body.error?.message), overspendSet: burn.status === 200 ? true : String(burn.body.error?.message), playerCompanyStatus: status.s, playerCompanyBankrupt: status.b !== null, residualPaidToOwnerWallet: db.get<{ n: number }>("SELECT COUNT(*) n FROM ledger_postings lp JOIN ledger_transactions t ON t.id = lp.tx_id JOIN players pl ON pl.wallet_account_id = lp.account_id WHERE t.idempotency_key = ? AND pl.id = ? AND lp.amount_minor > 0", `liq:${pizza}:owner`, p.playerId)!.n > 0 ? 'yes' : 'no residual', bankruptciesDuring40Days: db.get<{ n: number }>('SELECT COUNT(*) n FROM companies WHERE bankrupt_tick IS NOT NULL')!.n - bankrupt0, npcCompaniesOperating: db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE owner_kind = 'npc' AND status = 'operating'")!.n, householdsAvgBeforeMinor: cpi0, unmetUnits: db.get<{ u: number }>('SELECT COALESCE(SUM(unmet_units),0) u FROM demand_tick_stats WHERE tick > ?', lastTick(db) - 7)!.u, ...cost } };
}

/** A long NPC-only run with player accounts idle: the world must keep moving and stay solvent with no human input. */
function longNpcRun(): AlphaStress {
  const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'new');
  const cost = tickCost(db, 180);
  const problems = invariants(db);
  return { name: 'Large NPC economy, 180 days unattended', ok: problems.length === 0, problems, facts: { days: 180, npcCompanies: db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE owner_kind = 'npc' AND bankrupt_tick IS NULL")!.n, npcDecisions: db.get<{ n: number }>('SELECT COUNT(*) n FROM npc_decisions')!.n, trades: db.get<{ n: number }>('SELECT COUNT(*) n FROM trades')!.n, failedTicks: db.get<{ n: number }>("SELECT COUNT(*) n FROM ticks WHERE status = 'failed'")!.n, ...cost } };
}

export async function runAlphaStress(): Promise<AlphaStress[]> {
  return [await population(1), await population(10), await population(100), await heavyTrading(), await shocks(), longNpcRun()];
}
export function formatAlphaStress(rs: AlphaStress[]): string {
  return ['# Private-alpha stress results', '', ...rs.flatMap((r) => [`## ${r.name} — ${r.ok ? 'invariants hold' : 'PROBLEMS'}`, '', '| fact | value |', '|---|---|', ...Object.entries(r.facts).map(([k, v]) => `| ${k} | ${v} |`), ...(r.problems.length ? ['', ...r.problems.map((p) => `- ${p}`)] : []), ''])].join('\n');
}
