/**
 * Seeded adversarial fuzzer. Simulated players issue a mix of sensible, careless and hostile commands through the real API router
 * (ownership checks, idempotency, validation) while the world ticks. After every audit interval the deep invariants must hold, replays
 * must return the stored response, and no command aimed at another player's assets may succeed.
 */
import type { Sql } from '../db/sql';
import { advance, lastTick, openWorld } from '../engine/world';
import { withPlayer } from '../engine/actor';
import { handleApi } from '../api/router';
import { registerUser, createInvite } from '../engine/accounts';
import { deepAudit, type Finding } from './invariants';
import { rng, type Rng } from './rng';

export interface FuzzOptions { seed: number; players: number; ticks: number; actionsPerTick: number; auditEvery: number; profile?: 'new' | 'demo' }
export interface FuzzReport { issuanceByReason: Record<string, number>; sinksByReason: Record<string, number>; seed: number; players: number; ticks: number; commands: number; accepted: number; rejected: number; byType: Record<string, { ok: number; err: number }>; violations: string[]; findings: Finding[]; audits: number; msPerTick: number; msPerCommand: number; supply: { start: number; end: number } }

interface P { id: string; wallet: string }
const INDUSTRIES = ['farm', 'mill', 'dairy', 'pizza', 'cafe', 'timber'] as const;
const COMMODITIES = ['wheat', 'milk', 'flour', 'cheese', 'timber', 'pizza', 'cafe-drink', 'energy'] as const;

export function runFuzz(o: FuzzOptions): FuzzReport {
  const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, o.profile ?? 'new');
  const r = rng(o.seed); const now = 2_000_000_000_000;
  const players: P[] = [];
  for (let i = 0; i < o.players; i++) {
    const u = registerUser(db, now, { invite: createInvite(db, now, 'fuzz', 'player').code, username: `fz${i}`, displayName: `Fuzz ${i}`, hash: '0'.repeat(64), salt: '00', iterations: 100_000 });
    players.push({ id: u.playerId, wallet: u.wallet });
  }
  const supply0 = db.get<{ s: number }>("SELECT COALESCE(SUM(balance_minor),0) s FROM accounts WHERE kind <> 'issuance' AND id <> 'acct:burn'")!.s;
  const report: FuzzReport = { issuanceByReason: {}, sinksByReason: {}, seed: o.seed, players: o.players, ticks: o.ticks, commands: 0, accepted: 0, rejected: 0, byType: {}, violations: [], findings: [], audits: 0, msPerTick: 0, msPerCommand: 0, supply: { start: supply0, end: 0 } };
  const history: { p: P; body: Record<string, unknown>; response: string }[] = [];
  let seq = 0, tickMs = 0, cmdMs = 0;

  const call = (p: P, method: string, path: string, body?: unknown, query?: Record<string, string>) => withPlayer(p, () => handleApi(db, { method, path, body, query }, { devEndpoints: false, now: () => now }));
  const owned = (p: P) => db.all<{ id: string; industry_id: string }>("SELECT id, industry_id FROM companies WHERE owner_kind = 'player' AND owner_id = ? AND bankrupt_tick IS NULL ORDER BY rowid", p.id);
  const foreign = (p: P) => db.all<{ id: string }>("SELECT id FROM companies WHERE bankrupt_tick IS NULL AND NOT (owner_kind = 'player' AND owner_id = ?) ORDER BY rowid", p.id);
  /** Seeded choice of one row (never SQL RANDOM(), which would make runs irreproducible). */
  const one = <T>(sql: string, ...a: (string | number)[]): T | undefined => { const rows = db.all<T>(sql, ...a); return rows.length ? r.pick(rows) : undefined; };
  const cmd = (p: P, body: Record<string, unknown>, hostileTarget = false) => {
    const t0 = performance.now();
    const full = { idempotencyKey: `${p.id}:${seq++}`, expectedRevision: 0, ...body };
    const res = call(p, 'POST', '/api/command', full);
    cmdMs += performance.now() - t0; report.commands++;
    const ok = (res.body as { ok?: boolean }).ok === true; const ty = String(body.type);
    const b = (report.byType[ty] ??= { ok: 0, err: 0 }); if (ok) { b.ok++; report.accepted++; } else { b.err++; report.rejected++; }
    if (hostileTarget && ok) report.violations.push(`${ty} on another player's/NPC's asset succeeded: ${JSON.stringify(body)}`);
    if (r.chance(0.3)) history.push({ p, body: full, response: JSON.stringify(res.body) });
    return res;
  };
  const quoteOrder = (p: P, co: string, commodity: string, side: 'buy' | 'sell', qty: number, price: number, extra: Record<string, unknown> = {}, hostile = false) => {
    const q = call(p, 'POST', '/api/quote', { kind: 'commodity', companyId: co, entityId: commodity, side, quantity: qty, limitPriceMinor: price, ...extra });
    const quoteId = (q.body as { quote?: { id: string } }).quote?.id ?? 'no-quote';
    return cmd(p, { type: 'commodity.order', companyId: co, commodityId: commodity, side, quantity: qty, limitPriceMinor: price, quoteId, ...extra }, hostile);
  };

  const act = (p: P, x: Rng) => {
    const mine = owned(p); const co = mine.length ? x.pick(mine).id : null; const other = x.pick(foreign(p))?.id ?? 'co-severn-farm';
    const amount = () => x.pick([-500, 0, 1, 50, 999, 25_000, 1e9, 0.5, Number.NaN]);
    switch (x.int(0, 19)) {
      case 0: case 1: { // found a company on a free lot (or an occupied one)
        const ind = x.pick(INDUSTRIES); const lots = db.all<{ id: string }>("SELECT p.id FROM plots p WHERE p.district_id IS NOT NULL ORDER BY p.id"); const plot = x.pick(lots).id;
        const q = (call(p, 'GET', '/api/startup-quote', undefined, { industry: ind, plotId: plot, tier: '1' }).body as { quote: { totalMinor: number } }).quote;
        cmd(p, { type: 'company.create', industry: ind, plotId: plot, tier: 1, name: `F${seq} ${ind}`, expectedTotalMinor: x.chance(0.8) ? q.totalMinor : 1 }); break; }
      case 2: if (co) { const rev = db.get<{ r: number }>('SELECT revision r FROM companies WHERE id = ?', co)!.r; cmd(p, { type: 'company.configure', companyId: co, expectedRevision: rev, priceMinor: x.int(1, 3_000), employees: x.int(0, 12), plannedUnitsPerTick: x.int(0, 500), marketingMinorPerTick: x.pick([0, 500, 5_000]), autoProcure: x.chance(0.7) }); } break;
      case 3: case 4: if (co) quoteOrder(p, co, x.pick(COMMODITIES), x.chance(0.5) ? 'buy' : 'sell', x.pick([1, 5, 40, 500, -3, 0]), x.pick([1, 30, 60, 220, 400, 5_000, -1]), x.chance(0.3) ? { orderKind: 'market', slippageBps: 500 } : x.chance(0.3) ? { orderKind: 'direct', fromCompanyId: x.chance(0.5) ? other : co } : {}); break;
      case 5: quoteOrder(p, other, x.pick(COMMODITIES), x.chance(0.5) ? 'buy' : 'sell', 5, 100, {}, true); break;            // hostile: trade with someone else's company
      case 6: { const ord = one<{ id: number; company_id: string }>("SELECT id, company_id FROM orders WHERE status = 'open' ORDER BY rowid"); if (ord) cmd(p, { type: 'order.cancel', orderId: ord.id }, !mine.some((m) => m.id === ord.company_id)); break; }
      case 7: if (co) cmd(p, { type: x.chance(0.5) ? 'company.fund' : 'company.withdraw', companyId: co, amountMinor: amount() }); else cmd(p, { type: 'company.withdraw', companyId: other, amountMinor: 100 }, true); break;
      case 8: cmd(p, { type: 'company.withdraw', companyId: other, amountMinor: x.int(1, 50_000) }, true); break;
      case 9: { const sec = one<{ company_id: string }>("SELECT company_id FROM securities WHERE status = 'open' ORDER BY rowid"); if (sec) cmd(p, { type: 'share.order', companyId: sec.company_id, side: x.chance(0.6) ? 'buy' : 'sell', quantity: x.pick([1, 20, 300, 100_000, -5]), limitPriceMinor: x.pick([1, 50, 100, 300, 10_000]), orderKind: 'limit', acknowledgeControlLoss: true }); break; }
      case 10: if (co) { const fv = 100; cmd(p, { type: 'share.list', companyId: co, newShares: x.pick([500, 2_000, 20_000]), offerPriceMinor: x.pick([fv, 50, 150, 1]) }); } break;
      case 11: if (co) cmd(p, { type: 'dividend.declare', companyId: co, perShareMinor: x.pick([1, 2, 10, 1_000]) }); else cmd(p, { type: 'dividend.declare', companyId: other, perShareMinor: 1 }, true); break;
      case 12: if (co) cmd(p, { type: x.chance(0.5) ? 'loan.take' : 'bank.deposit', companyId: co, amountMinor: x.pick([10_000, 100_000, 1e9, -1]), termDays: x.pick([7, 30, 90, 1000]) }); break;
      case 13: if (co) { const l = one<{ id: string }>('SELECT id FROM loans WHERE borrower_id = ? ORDER BY rowid', co); if (l) cmd(p, { type: 'loan.repay', companyId: co, loanId: l.id, amountMinor: x.pick([100, 10_000, 1e9]) }); else cmd(p, { type: 'bank.withdraw', companyId: co, amountMinor: x.pick([100, 1e9]) }); } break;
      case 14: cmd(p, { type: 'prestige.buy', itemId: x.pick(['veh-executive', 'veh-sports', 'veh-hatch', 'nope']) }); break;
      case 15: { const own = one<{ id: string; owner_id: string }>('SELECT id, owner_id FROM prestige_owned ORDER BY rowid'); if (own) cmd(p, { type: 'prestige.list', ownedId: own.id, askMinor: x.pick([1, 1_000, 500_000]) }, own.owner_id !== p.id); const l = one<{ id: string }>("SELECT id FROM prestige_listings WHERE status = 'open' ORDER BY rowid"); if (l) cmd(p, { type: 'prestige.buyListing', listingId: l.id }); break; }
      case 16: { const lot = one<{ id: string }>("SELECT id FROM lotteries WHERE status = 'open' ORDER BY rowid"); if (lot) cmd(p, { type: 'lottery.buy', lotteryId: lot.id, count: x.pick([1, 3, 50, -1]) }); cmd(p, { type: 'boost.buy', offerId: x.pick(['boost-production-3', 'boost-marketing-5', 'bogus']) }); break; }
      case 17: cmd(p, { type: x.chance(0.5) ? 'wallet.testDeposit' : 'wallet.testWithdraw', amountMinor: x.pick([50, 500, 499, 1_000, -50, 1e9]) }); break;
      case 18: if (co) cmd(p, { type: x.pick(['company.service', 'company.procure', 'company.upgrade', 'property.buy']), companyId: co, batches: x.int(-1, 5), upgradeId: x.pick(['ovens', 'staff-training', 'x']) }); break;
      case 19: if (history.length) { const h = x.pick(history); const res = withPlayer(h.p, () => handleApi(db, { method: 'POST', path: '/api/command', body: h.body }, { devEndpoints: false, now: () => now })); report.commands++; if (JSON.stringify(res.body) !== h.response) report.violations.push(`replay of ${String(h.body.type)} returned a different response`); } break;
    }
  };

  const audit = () => { report.audits++; const a = deepAudit(db); report.issuanceByReason = a.issuanceByReason; report.sinksByReason = a.sinksByReason; for (const f of a.findings) if (!report.findings.some((x) => x.id === f.id)) report.findings.push(f); };
  for (let t = 0; t < o.ticks; t++) {
    for (let i = 0; i < o.actionsPerTick; i++) { try { act(r.pick(players), r); } catch (e) { report.violations.push(`unhandled exception: ${(e as Error).message}`); } }
    const t0 = performance.now(); advance(db, 1); tickMs += performance.now() - t0;
    if ((t + 1) % o.auditEvery === 0) audit();
  }
  audit();
  report.msPerTick = Math.round(tickMs / Math.max(1, o.ticks));
  report.msPerCommand = Math.round((cmdMs / Math.max(1, report.commands)) * 100) / 100;
  report.supply.end = db.get<{ s: number }>("SELECT COALESCE(SUM(balance_minor),0) s FROM accounts WHERE kind <> 'issuance' AND id <> 'acct:burn'")!.s;
  void lastTick;
  return report;
}
export { openWorld };
export type { Sql };
