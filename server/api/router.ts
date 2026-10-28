import type { ApiError, Command, QuoteRequest } from '../../src/contracts/game-state';
import { assertWireIntegrity } from '../../src/domain/integrity';
import type { Sql } from '../db/sql';
import { advanceToNow, nextTickAtMs, runTickSafely } from '../engine/clock';
import { cancelPlayerOrder, configureCompany, fundCompany, placePlayerOrder, quoteOrder, reopenCompany, withdrawFromCompany, type CommandResponse } from '../engine/commands';
import { gameDate, loadConfig } from '../engine/config';
import { economyDashboard } from './dashboard';
import { asOf, cityScreen, companiesScreen, companyDto, commoditiesScreen, financials, portfolioScreen } from './dto';

export interface ApiRequest { method: string; path: string; query?: Record<string, string>; body?: unknown }
export interface ApiResponse { status: number; body: unknown }
export interface ApiOptions { devEndpoints: boolean; now?: () => number }

const json = (status: number, body: unknown): ApiResponse => ({ status, body });
const apiErr = (status: number, code: ApiError['code'], message: string): ApiResponse => json(status, { ok: false, error: { code, message } });
const UNAVAILABLE_TYPES = new Set(['company.create', 'company.upgrade', 'shares.order', 'prestige.buy', 'wallet.testDeposit', 'wallet.testWithdraw']);

/** Envelope with real tick revision and clock; `authority: 'server'` tells the UI to drop the "illustrative" badges. */
function envelope<T>(db: Sql, data: T) {
  const { tick, asOf: at } = asOf(db);
  assertWireIntegrity(data);
  return { authority: 'server' as const, envelope: { schemaVersion: 1 as const, revision: tick, asOf: at, nextTickAt: new Date(nextTickAtMs(db)).toISOString(), data } };
}

/** Pure request handler shared by the Node dev server and the Cloudflare Worker. */
export function handleApi(db: Sql, req: ApiRequest, opts: ApiOptions): ApiResponse {
  const now = opts.now?.() ?? Date.now();
  try {
    advanceToNow(db, now);                                   // lazily catch the clock up (bounded) so reads are never stale
    const { method, path } = req; const q = req.query ?? {};
    const seg = path.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    if (method === 'GET' && seg[0] === 'health') { const { tick, asOf: a } = asOf(db); return json(200, { ok: true, tick, gameDate: a, authority: 'server' }); }
    if (method === 'GET' && seg[0] === 'screens' && seg[1]) {
      switch (seg[1]) {
        case 'city': return json(200, envelope(db, cityScreen(db)));
        case 'companies': return json(200, envelope(db, companiesScreen(db)));
        case 'commodities': return json(200, envelope(db, commoditiesScreen(db)));
        case 'portfolio': return json(200, envelope(db, portfolioScreen(db)));
        default: return apiErr(404, 'UNAVAILABLE', `Screen ${seg[1]} has no server data yet`);
      }
    }
    if (method === 'GET' && seg[0] === 'companies' && seg[1]) {
      if (seg[2] === 'financials') return json(200, { authority: 'server', rows: financials(db, seg[1], Number(q.limit ?? 30)) });
      const c = companyDto(db, seg[1]);
      if (!c) return apiErr(404, 'VALIDATION', `Unknown company ${seg[1]}`);
      const env = envelope(db, c);
      return json(200, { ...env, envelope: { ...env.envelope, revision: c.revision } });
    }
    if (method === 'POST' && seg[0] === 'quote') {
      const b = req.body as QuoteRequest & { companyId: string };
      if (b.kind !== 'commodity') return apiErr(501, 'UNAVAILABLE', `Quotes for ${b.kind} are not available on the server yet`);
      const out = quoteOrder(db, { companyId: b.companyId ?? '', commodityId: b.entityId, side: b.side, quantity: b.quantity, limitPriceMinor: b.limitPriceMinor ?? 0 });
      if (!out.ok) return json(422, out);
      const c = out.quote; const cur = (m: number) => ({ currency: 'EC' as const, minor: m });
      return json(200, { ok: true, quote: { id: c.id, expiresAt: new Date(nextTickAtMs(db)).toISOString(), revision: c.revision, quantity: c.quantity, subtotal: cur(c.subtotalMinor), fee: cur(c.feeMinor), total: cur(c.totalMinor), availableUnits: c.availableUnits } });
    }
    if (method === 'POST' && seg[0] === 'command') return runApiCommand(db, req.body as Command & Record<string, unknown>);
    if (seg[0] === 'dev') {
      if (!opts.devEndpoints) return apiErr(404, 'FORBIDDEN', 'Developer endpoints are disabled');
      if (method === 'GET' && seg[1] === 'economy') return json(200, economyDashboard(db));
      if (method === 'POST' && seg[1] === 'tick') {
        const count = Math.max(1, Math.min(400, Number((req.body as { count?: number } | undefined)?.count ?? 1)));
        const results = [];
        for (let i = 0; i < count; i++) { const last = db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t; const r = runTickSafely(db, last + 1); results.push(r.status === 'complete' ? { tick: r.tick, status: r.status } : r); if (r.status === 'failed') break; }
        return json(200, { ran: results.length, results: results.slice(-5), gameDate: gameDate(loadConfig(db), db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t) });
      }
    }
    return apiErr(404, 'UNAVAILABLE', `No route ${method} ${path}`);
  } catch (e) {
    return json(500, { ok: false, error: { code: 'UNAVAILABLE', message: e instanceof Error ? e.message : 'Internal error' } });
  }
}

function runApiCommand(db: Sql, cmd: Command & Record<string, unknown>): ApiResponse {
  const key = cmd?.idempotencyKey as string;
  let res: CommandResponse;
  switch (cmd?.type as string) {
    case 'company.configure': res = configureCompany(db, key, cmd.companyId as string, cmd.expectedRevision as number, { priceMinor: cmd.priceMinor as number | undefined, employees: cmd.employees as number | undefined, quality: cmd.quality as 'basic' | undefined, plannedUnitsPerTick: cmd.plannedUnitsPerTick as number | undefined, marketingMinorPerTick: cmd.marketingMinorPerTick as number | undefined }); break;
    case 'commodity.order': res = placePlayerOrder(db, key, { companyId: cmd.companyId as string, commodityId: cmd.commodityId as string, side: cmd.side as 'buy', quantity: cmd.quantity as number, limitPriceMinor: cmd.limitPriceMinor as number, quoteId: cmd.quoteId as string }); break;
    case 'order.cancel': res = cancelPlayerOrder(db, key, Number(cmd.orderId)); break;
    case 'company.fund': res = fundCompany(db, key, cmd.companyId as string, cmd.amountMinor as number); break;
    case 'company.withdraw': res = withdrawFromCompany(db, key, cmd.companyId as string, cmd.amountMinor as number); break;
    case 'company.reopen': res = reopenCompany(db, key, cmd.companyId as string); break;
    default: res = { ok: false, error: { code: 'UNAVAILABLE', message: UNAVAILABLE_TYPES.has(cmd?.type as string) ? 'This action is not available on the server yet.' : `Unknown command ${String(cmd?.type)}` } };
  }
  return json(res.ok ? 200 : res.error.code === 'UNAVAILABLE' ? 501 : 422, res);
}
