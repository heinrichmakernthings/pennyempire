import { actingPlayer } from '../engine/actor';
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
import { cityActivity, competitorProfile, news, standings } from './livingApi';
import { exchangeHome, securityDetail, sharePortfolio } from './shareApi';
import { cancelPlayerShareOrder, declarePlayerDividend, listPlayerCompany, placePlayerShareOrder, quoteShareOrder, retirePlayerShares, withdrawPlayerOffering } from '../engine/shareCommands';
import { listingQuote } from '../engine/listing';

import { economyDashboard } from './dashboard';
import { companyServices, loanQuote, stateOverview } from './stateApi';
import { adminLog, authorised, cancelEventAdmin, logDenied, setBaseRate, setCentralBankRule, setParam, triggerEvent, ADMIN_PARAMS } from '../engine/admin';
import { bankDeposit, bankWithdraw, buyPremisesCmd, cancelAd, repayBankLoan, startAd, takeBankLoan } from '../engine/stateCommands';
import { stateDashboard } from './stateDashboard';
import { marketScreen, prestigeScreen, rewardsScreen, walletScreen } from './prestigeApi';
import { walletCommand } from '../engine/walletCommands';
import { membershipView } from '../engine/membership';
import { providerAttest, recordImpression } from '../engine/rewards';
import { treasuryView } from '../engine/commercial';
import { runScheduledServices } from '../engine/services';
import { treasuryAction } from '../engine/treasuryAdmin';
import { leaderboard } from '../engine/prestige';
import { adminHealth, onboarding } from './alpha';
import { asOf, cityScreen, companiesScreen, companyDto, commoditiesScreen, financials, portfolioScreen } from './dto';

export interface ApiRequest { method: string; path: string; query?: Record<string, string>; body?: unknown; headers?: Record<string, string> }
export interface ApiResponse { status: number; body: unknown; headers?: Record<string, string> }
/** `adminActor` is set by the session layer when the signed-in user has the admin role; the shared token remains for operators and scripts. */
export interface ApiOptions { devEndpoints: boolean; now?: () => number; adminToken?: string; adminActor?: string }

const json = (status: number, body: unknown): ApiResponse => ({ status, body });
const apiErr = (status: number, code: ApiError['code'], message: string): ApiResponse => json(status, { ok: false, error: { code, message } });
const UNAVAILABLE_TYPES = new Set<string>();
/** Another player's private books (management, ledgers, bank services) are not readable; NPC, state and own companies are. */
const othersPrivate = (db: Sql, companyId: string) => !!db.get("SELECT 1 FROM companies WHERE id = ? AND owner_kind = 'player' AND owner_id <> ?", companyId, actingPlayer());

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
    if (method === 'GET' && seg[0] === 'city' && seg[1] === 'activity') return json(200, { authority: 'server', ...cityActivity(db) });
    if (method === 'GET' && seg[0] === 'securities') {
      if (!seg[1]) return json(200, { authority: 'server', exchange: exchangeHome(db) });
      if (seg[1] === 'listing-quote') {
        try { const cfg = loadConfig(db); const t = db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t; return json(200, { authority: 'server', quote: listingQuote(db, cfg, q.companyId ?? '', Number(q.newShares ?? 0), Number(q.offerPriceMinor ?? 0), t, { kind: 'player', id: actingPlayer() }, { fromTreasury: q.fromTreasury === 'true' }) }); } catch (e) { return apiErr(404, 'VALIDATION', (e as Error).message); }
      }
      if (seg[1] === 'order-quote') return json(200, { authority: 'server', quote: quoteShareOrder(db, { companyId: q.companyId ?? '', investorId: q.investorId, side: q.side === 'sell' ? 'sell' : 'buy', quantity: Number(q.quantity ?? 0), limitPriceMinor: q.limitPriceMinor === undefined ? undefined : Number(q.limitPriceMinor), kind: q.kind === 'market' ? 'market' : 'limit', slippageBps: q.slippageBps === undefined ? undefined : Number(q.slippageBps) }) });
      const d = securityDetail(db, seg[1]); return d ? json(200, { authority: 'server', detail: d }) : apiErr(404, 'VALIDATION', `Unknown company ${seg[1]}`);
    }
    if (method === 'GET' && seg[0] === 'portfolio' && seg[1] === 'securities') return json(200, { authority: 'server', portfolio: sharePortfolio(db) });
    if (method === 'GET' && seg[0] === 'standings') return json(200, { authority: 'server', standings: standings(db) });
    if (method === 'GET' && seg[0] === 'news') return json(200, { authority: 'server', articles: news(db, Number(q.limit ?? 30)) });
    if (method === 'GET' && seg[0] === 'competitors' && seg[1]) { const p = competitorProfile(db, seg[1]); return p ? json(200, { authority: 'server', profile: p }) : apiErr(404, 'VALIDATION', `Unknown competitor ${seg[1]}`); }
    if (method === 'GET' && seg[0] === 'onboarding') return json(200, { authority: 'server', ...onboarding(db) });
    if (method === 'GET' && seg[0] === 'rankings') return json(200, { authority: 'server', rankings: rankings(db) });
    if (method === 'GET' && seg[0] === 'startup-quote') {
      const qq = startupQuote(db, { industry: q.industry ?? '', plotId: q.plotId ?? '', tier: Number(q.tier ?? 1), name: q.name, workingCapitalMinor: q.workingCapitalMinor === undefined ? undefined : Number(q.workingCapitalMinor) });
      return json(200, { authority: 'server', quote: qq });
    }
    if (method === 'GET' && seg[0] === 'companies' && seg[1] && (seg[2] === 'management' || seg[2] === 'financials') && othersPrivate(db, seg[1])) return apiErr(403, 'FORBIDDEN', 'That company belongs to another player.');
    if (method === 'GET' && seg[0] === 'state' && ((seg[1] === 'company' && seg[2] && othersPrivate(db, seg[2])) || (seg[1] === 'loan-quote' && othersPrivate(db, q.companyId ?? '')))) return apiErr(403, 'FORBIDDEN', 'That company belongs to another player.');
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
    if (method === 'GET' && seg[0] === 'prestige') {
      if (seg[1] === 'market') return json(200, { authority: 'server', ...marketScreen(db) });
      if (seg[1] === 'leaderboard') return json(200, { authority: 'server', ...leaderboard(db, actingPlayer(), q.scope === 'global' ? 'global' : 'city') });
      return json(200, { authority: 'server', ...prestigeScreen(db) });
    }
    if (method === 'GET' && seg[0] === 'rewards') return json(200, { authority: 'server', ...rewardsScreen(db, now) });
    if (method === 'GET' && seg[0] === 'wallet') return json(200, { authority: 'server', ...walletScreen(db) });
    if (method === 'GET' && seg[0] === 'membership') return json(200, { authority: 'server', membership: membershipView(db, actingPlayer(), db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t) });
    if (method === 'POST' && seg[0] === 'ads' && seg[1] === 'attest') {   // the (simulated) provider's server-side proof of completion: refused until the minimum viewing time has passed
      try { return json(200, { ok: true, ...providerAttest(db, now, String((req.body as { sessionId?: string })?.sessionId ?? '')) }); } catch (e) { return apiErr(422, 'FORBIDDEN', e instanceof Error ? e.message : 'Refused'); }
    }
    if (method === 'POST' && seg[0] === 'ads' && seg[1] === 'impression') {
      try { recordImpression(db, { tick: db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t, gameDate: '', actor: 'ui' }, String((req.body as { slot?: string })?.slot ?? '')); return json(200, { ok: true }); } catch (e) { return apiErr(422, 'FORBIDDEN', e instanceof Error ? e.message : 'Refused'); }
    }
    if (method === 'GET' && seg[0] === 'state') {
      if (seg[1] === 'overview') return json(200, { authority: 'server', ...stateOverview(db) });
      if (seg[1] === 'company' && seg[2]) { const r = companyServices(db, seg[2]); return r ? json(200, { authority: 'server', services: r }) : apiErr(404, 'VALIDATION', `Unknown company ${seg[2]}`); }
      if (seg[1] === 'loan-quote') return json(200, { authority: 'server', quote: loanQuote(db, q.companyId ?? '', Number(q.amountMinor ?? 0), Number(q.termDays ?? 30)) });
      if (seg[1] === 'events') return json(200, { authority: 'server', events: stateOverview(db).events });
    }
    if (seg[0] === 'admin') {
      const token = req.headers?.['x-admin-token'];
      if (!opts.adminActor && !authorised(token, opts.adminToken)) { logDenied(db, `${method} ${path}`, { reason: opts.adminToken ? 'bad token' : 'administration disabled' }); return apiErr(403, 'FORBIDDEN', 'Administrator permission required.'); }
      const actor = opts.adminActor ?? 'admin'; const b = (req.body ?? {}) as Record<string, unknown>; const reason = String(b.reason ?? '');
      const wrap = (r: { ok: boolean; message: string; detail?: unknown }) => json(r.ok ? 200 : 422, r.ok ? { ok: true, message: r.message, detail: r.detail } : { ok: false, error: { code: 'VALIDATION', message: r.message } });
      if (method === 'GET' && seg[1] === 'state') return json(200, { authority: 'server', dashboard: stateDashboard(db), params: ADMIN_PARAMS, log: adminLog(db) });
      if (method === 'GET' && seg[1] === 'health') return json(200, { authority: 'server', health: adminHealth(db), log: adminLog(db) });
      if (method === 'GET' && seg[1] === 'treasury') return json(200, { authority: 'server', treasury: treasuryView(db) });
      if (method === 'POST' && seg[1] === 'treasury' && seg[2]) { const r = treasuryAction(db, now, actor, seg[2], b); return json(r.ok ? 200 : 422, r.ok ? { ok: true, message: r.message, detail: r.detail } : { ok: false, error: { code: 'VALIDATION', message: r.message } }); }
      if (method === 'POST' && seg[1] === 'param') return wrap(setParam(db, actor, String(b.key ?? ''), Number(b.value), reason));
      if (method === 'POST' && seg[1] === 'base-rate') return wrap(setBaseRate(db, actor, Number(b.rateBps), reason));
      if (method === 'POST' && seg[1] === 'event') return wrap(triggerEvent(db, actor, String(b.type ?? ''), Number(b.severity ?? 1), b.days === undefined ? undefined : Number(b.days), reason));
      if (method === 'POST' && seg[1] === 'event-cancel') return wrap(cancelEventAdmin(db, actor, String(b.eventId ?? ''), reason));
      if (method === 'POST' && seg[1] === 'cb-rule') return wrap(setCentralBankRule(db, actor, b.enabled === true, reason));
      return apiErr(404, 'UNAVAILABLE', `No admin route ${method} ${path}`);
    }
    if (method === 'POST' && seg[0] === 'command') return runApiCommand(db, req.body as Command & Record<string, unknown>, now);
    if (seg[0] === 'dev') {
      if (!opts.devEndpoints) return apiErr(404, 'FORBIDDEN', 'Developer endpoints are disabled');
      if (method === 'GET' && seg[1] === 'economy') return json(200, economyDashboard(db));
      if (method === 'GET' && seg[1] === 'state') return json(200, { authority: 'server', dashboard: stateDashboard(db) });
      if (method === 'GET' && seg[1] === 'health') return json(200, { authority: 'server', health: adminHealth(db), log: adminLog(db) });
      if (method === 'GET' && seg[1] === 'treasury') return json(200, { authority: 'server', treasury: treasuryView(db), withdrawals: db.all("SELECT id, player_id playerId, amount_pence amountPence, status, reason, created_ms createdMs FROM gbp_withdrawals ORDER BY created_ms DESC, id DESC LIMIT 30"), deposits: db.all('SELECT id, player_id playerId, amount_pence amountPence, status, fee_pence feePence, failure_reason failureReason FROM gbp_deposits ORDER BY created_ms DESC, id DESC LIMIT 30'), audit: db.all('SELECT id, ms, actor, action, subject, detail_json detail, ok FROM gbp_audit ORDER BY id DESC LIMIT 40').map((a: any) => ({ ...a, detail: JSON.parse(a.detail) })) });
      if (method === 'POST' && seg[1] === 'treasury' && seg[2]) { const r = treasuryAction(db, now, 'developer', seg[2], (req.body ?? {}) as Record<string, unknown>); return json(r.ok ? 200 : 422, r.ok ? { ok: true, message: r.message, detail: r.detail } : { ok: false, error: { code: 'VALIDATION', message: r.message } }); }
      if (method === 'POST' && seg[1] === 'tick') {
        const count = Math.max(1, Math.min(400, Number((req.body as { count?: number } | undefined)?.count ?? 1)));
        const results = [];
        for (let i = 0; i < count; i++) { const last = db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t; const r = runTickSafely(db, last + 1); results.push(r.status === 'complete' ? { tick: r.tick, status: r.status } : r); if (r.status === 'failed') break; }
        runScheduledServices(db, now);
        return json(200, { ran: results.length, results: results.slice(-5), gameDate: gameDate(loadConfig(db), db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t) });
      }
    }
    return apiErr(404, 'UNAVAILABLE', `No route ${method} ${path}`);
  } catch (e) {
    return json(500, { ok: false, error: { code: 'UNAVAILABLE', message: e instanceof Error ? e.message : 'Internal error' } });
  }
}

function runApiCommand(db: Sql, cmd: Command & Record<string, unknown>, nowMs: number): ApiResponse {
  const key = cmd?.idempotencyKey as string;
  let res: CommandResponse;
  const wc = walletCommand(db, nowMs, key, cmd as Record<string, unknown>); if (wc) return json(wc.ok ? 200 : wc.error.code === 'UNAVAILABLE' ? 501 : 422, wc);
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
    case 'share.order': res = placePlayerShareOrder(db, key, { companyId: cmd.companyId as string, investorId: cmd.investorId as string | undefined, side: cmd.side as 'buy', quantity: cmd.quantity as number, limitPriceMinor: cmd.limitPriceMinor as number | undefined, kind: cmd.orderKind as 'limit' | 'market' | undefined, slippageBps: cmd.slippageBps as number | undefined, expiresInTicks: cmd.expiresInTicks as number | null | undefined, acknowledgeControlLoss: cmd.acknowledgeControlLoss === true }); break;
    case 'share.cancel': res = cancelPlayerShareOrder(db, key, Number(cmd.orderId)); break;
    case 'share.list': res = listPlayerCompany(db, key, { companyId: cmd.companyId as string, newShares: cmd.newShares as number, offerPriceMinor: cmd.offerPriceMinor as number, fromTreasury: cmd.fromTreasury === true }); break;
    case 'share.withdraw': res = withdrawPlayerOffering(db, key, Number(cmd.offeringId)); break;
    case 'share.retire': res = retirePlayerShares(db, key, cmd.companyId as string, cmd.quantity as number); break;
    case 'dividend.declare': res = declarePlayerDividend(db, key, cmd.companyId as string, cmd.perShareMinor as number); break;
    case 'company.create': res = createCompany(db, key, { industry: cmd.industry as string, plotId: cmd.plotId as string, tier: Number(cmd.tier ?? 1), name: String(cmd.name ?? ''), workingCapitalMinor: cmd.workingCapitalMinor as number | undefined, expectedTotalMinor: cmd.expectedTotalMinor as number }); break;
    case 'company.upgrade': res = upgradeCompany(db, key, cmd.companyId as string, cmd.upgradeId as string); break;
    case 'company.service': res = serviceEquipment(db, key, cmd.companyId as string); break;
    case 'company.procure': res = procureNow(db, key, cmd.companyId as string, cmd.batches as number); break;
    case 'ad.start': res = startAd(db, key, { companyId: cmd.companyId as string, kind: cmd.kind as 'local', tier: Number(cmd.tier ?? 1), days: Number(cmd.days) }); break;
    case 'ad.cancel': res = cancelAd(db, key, cmd.companyId as string, String(cmd.campaignId)); break;
    case 'loan.take': res = takeBankLoan(db, key, { companyId: cmd.companyId as string, amountMinor: Number(cmd.amountMinor), termDays: Number(cmd.termDays) }); break;
    case 'loan.repay': res = repayBankLoan(db, key, { companyId: cmd.companyId as string, loanId: String(cmd.loanId), amountMinor: Number(cmd.amountMinor) }); break;
    case 'bank.deposit': res = bankDeposit(db, key, { companyId: cmd.companyId as string, amountMinor: Number(cmd.amountMinor) }); break;
    case 'bank.withdraw': res = bankWithdraw(db, key, { companyId: cmd.companyId as string, amountMinor: Number(cmd.amountMinor) }); break;
    case 'property.buy': res = buyPremisesCmd(db, key, cmd.companyId as string); break;
    default: res = { ok: false, error: { code: 'UNAVAILABLE', message: UNAVAILABLE_TYPES.has(cmd?.type as string) ? 'This action is not available on the server yet.' : `Unknown command ${String(cmd?.type)}` } };
  }
  return json(res.ok ? 200 : res.error.code === 'UNAVAILABLE' ? 501 : 422, res);
}
