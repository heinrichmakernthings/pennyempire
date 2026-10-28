import type { ApiError, Command, QuoteRequest } from '../../src/contracts/game-state';
import { assertWireIntegrity } from '../../src/domain/integrity';
import type { Sql } from '../db/sql';
import { advanceToNow, nextTickAtMs, runTickSafely } from '../engine/clock';
import { cancelPlayerOrder, configureCompany, fundCompany, placePlayerOrder, quoteOrder, reopenCompany, withdrawFromCompany, type CommandResponse } from '../engine/commands';
import { gameDate, loadConfig } from '../engine/config';
import { createCompany, procureNow, serviceEquipment, startupQuote, upgradeCompany } from '../engine/company';
import { lots, management, marketShortages, opportunities, rankings } from '../engine/insights';
import { cancelContract, proposeContract, respondContract } from '../engine/contracts';
import { commodityDetail, directory } from '../engine/exchange';
import { contractCandidates, contracts, holdings, ownOrders, ownTrades } from './exchangeApi';
import { economyDashboard } from './dashboard';
import { asOf, cityScreen, companiesScreen, companyDto, commoditiesScreen, financials, portfolioScreen } from './dto';

export interface ApiRequest { method: string; path: string; query?: Record<string, string>; body?: unknown }
export interface ApiResponse { status: number; body: unknown }
export interface ApiOptions { devEndpoints: boolean; now?: () => number }

const json = (status: number, body: unknown): ApiResponse => ({ status, body });
const apiErr = (status: number, code: ApiError['code'], message: string): ApiResponse => json(status, { ok: false, error: { code, message } });
const UNAVAILABLE_TYPES = new Set(['shares.order', 'prestige.buy', 'wallet.testDeposit', 'wallet.testWithdraw']);

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
    if (method === 'GET' && seg[0] === 'exchange') {
      if (seg[1] === 'commodities' && !seg[2]) return json(200, { authority: 'server', city: 'city-bristol', commodities: directory(db), note: 'Prices come from executed trades; supply is units listed for sale now; demand is an ESTIMATE from consumer budgets and production plans.' });
      if (seg[1] === 'commodities' && seg[2]) {
        const d = commodityDetail(db, seg[2]); if (!d) return apiErr(404, 'VALIDATION', `Unknown commodity ${seg[2]}`);
        return json(200, { authority: 'server', detail: d, orders: ownOrders(db, seg[2]), trades: ownTrades(db, seg[2]), holdings: holdings(db, seg[2]), contractOptions: contractCandidates(db, seg[2]) });
      }
      if (seg[1] === 'orders') return json(200, { authority: 'server', orders: ownOrders(db, q.commodity) });
      if (seg[1] === 'trades') return json(200, { authority: 'server', trades: ownTrades(db, q.commodity) });
      if (seg[1] === 'contracts') return json(200, { authority: 'server', contracts: contracts(db) });
    }
    if (method === 'GET' && seg[0] === 'opportunities') return json(200, { authority: 'server', forecastNote: 'Estimates from the last 7 days of simulated Bristol data. Real results depend on your choices and on competitors.', opportunities: opportunities(db), shortages: marketShortages(db) });
    if (method === 'GET' && seg[0] === 'lots') return json(200, { authority: 'server', lots: lots(db) });
    if (method === 'GET' && seg[0] === 'rankings') return json(200, { authority: 'server', rankings: rankings(db) });
    if (method === 'GET' && seg[0] === 'startup-quote') {
      const qq = startupQuote(db, { industry: q.industry ?? '', plotId: q.plotId ?? '', tier: Number(q.tier ?? 1), name: q.name, workingCapitalMinor: q.workingCapitalMinor === undefined ? undefined : Number(q.workingCapitalMinor) });
      return json(200, { authority: 'server', quote: qq });
    }
    if (method === 'GET' && seg[0] === 'companies' && seg[1] && seg[2] === 'management') {
      const m = management(db, seg[1]);
      return m ? json(200, { authority: 'server', management: m }) : apiErr(404, 'VALIDATION', `Unknown company ${seg[1]}`);
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
      const out = quoteOrder(db, { companyId: b.companyId ?? '', commodityId: b.entityId, side: b.side, quantity: b.quantity, limitPriceMinor: b.limitPriceMinor ?? 0, kind: (b as { orderKind?: 'limit' | 'market' }).orderKind, slippageBps: (b as { slippageBps?: number }).slippageBps, expiresInTicks: (b as { expiresInTicks?: number | null }).expiresInTicks, fromCompanyId: (b as { fromCompanyId?: string }).fromCompanyId });
      if (!out.ok) return json(422, out);
      const c = out.quote; const cur = (m: number) => ({ currency: 'EC' as const, minor: m });
      return json(200, { ok: true, quote: { id: c.id, expiresAt: new Date(nextTickAtMs(db)).toISOString(), revision: c.revision, kind: c.kind, limitPriceMinor: c.limitPriceMinor, reserveMinor: c.reserveMinor, slippageBps: c.slippageBps, quantity: c.quantity, subtotal: cur(c.subtotalMinor), fee: cur(c.feeMinor), total: cur(c.totalMinor), availableUnits: c.availableUnits } });
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
    case 'company.configure': res = configureCompany(db, key, cmd.companyId as string, cmd.expectedRevision as number, { priceMinor: cmd.priceMinor as number | undefined, employees: cmd.employees as number | undefined, quality: cmd.quality as 'basic' | undefined, plannedUnitsPerTick: cmd.plannedUnitsPerTick as number | undefined, marketingMinorPerTick: cmd.marketingMinorPerTick as number | undefined, askPriceMinor: cmd.askPriceMinor as number | undefined, autoProcure: cmd.autoProcure as boolean | undefined }); break;
    case 'commodity.order': res = placePlayerOrder(db, key, { companyId: cmd.companyId as string, commodityId: cmd.commodityId as string, side: cmd.side as 'buy', quantity: cmd.quantity as number, limitPriceMinor: cmd.limitPriceMinor as number, quoteId: cmd.quoteId as string, kind: cmd.orderKind as 'limit' | 'market' | 'direct' | undefined, fromCompanyId: cmd.fromCompanyId as string | undefined, slippageBps: cmd.slippageBps as number | undefined, expiresInTicks: cmd.expiresInTicks as number | null | undefined }); break;
    case 'order.cancel': res = cancelPlayerOrder(db, key, Number(cmd.orderId)); break;
    case 'company.fund': res = fundCompany(db, key, cmd.companyId as string, cmd.amountMinor as number); break;
    case 'company.withdraw': res = withdrawFromCompany(db, key, cmd.companyId as string, cmd.amountMinor as number); break;
    case 'company.reopen': res = reopenCompany(db, key, cmd.companyId as string); break;
    case 'contract.propose': res = proposeContract(db, key, { actorCompanyId: cmd.companyId as string, counterpartyId: cmd.counterpartyId as string, role: cmd.role as 'buyer', commodityId: cmd.commodityId as string, qtyPerDelivery: cmd.qtyPerDelivery as number, priceMinor: cmd.priceMinor as number, everyTicks: cmd.everyTicks as number, durationTicks: cmd.durationTicks as number }); break;
    case 'contract.respond': res = respondContract(db, key, Number(cmd.contractId), cmd.accept === true); break;
    case 'contract.cancel': res = cancelContract(db, key, Number(cmd.contractId)); break;
    case 'company.create': res = createCompany(db, key, { industry: cmd.industry as string, plotId: cmd.plotId as string, tier: Number(cmd.tier ?? 1), name: String(cmd.name ?? ''), workingCapitalMinor: cmd.workingCapitalMinor as number | undefined, expectedTotalMinor: cmd.expectedTotalMinor as number }); break;
    case 'company.upgrade': res = upgradeCompany(db, key, cmd.companyId as string, cmd.upgradeId as string); break;
    case 'company.service': res = serviceEquipment(db, key, cmd.companyId as string); break;
    case 'company.procure': res = procureNow(db, key, cmd.companyId as string, cmd.batches as number); break;
    default: res = { ok: false, error: { code: 'UNAVAILABLE', message: UNAVAILABLE_TYPES.has(cmd?.type as string) ? 'This action is not available on the server yet.' : `Unknown command ${String(cmd?.type)}` } };
  }
  return json(res.ok ? 200 : res.error.code === 'UNAVAILABLE' ? 501 : 422, res);
}
