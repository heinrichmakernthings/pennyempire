// @vitest-environment node
import { handleApi, type ApiResponse } from './router';
import { advance } from '../engine/world';
import { memWorld } from '../test/helpers';
import { reconcile } from '../engine/ledger';
import { assertWireIntegrity } from '../../src/domain/integrity';

const world = (ticks = 5) => { const db = memWorld({ realMsPerTick: 3_600_000_000 }); advance(db, ticks); return db; };
const get = (db: ReturnType<typeof world>, path: string, dev = true): ApiResponse => handleApi(db, { method: 'GET', path }, { devEndpoints: dev, now: () => 1_000 });
const post = (db: ReturnType<typeof world>, path: string, body: unknown, dev = true): ApiResponse => handleApi(db, { method: 'POST', path, body }, { devEndpoints: dev, now: () => 1_000 });
type Env<T> = { authority: string; envelope: { schemaVersion: number; revision: number; asOf: string; nextTickAt: string; data: T } };

describe('read API — server data in the frontend contract shapes', () => {
  it('health reports the real tick and server authority', () => {
    expect(get(world(7), '/api/health').body).toMatchObject({ ok: true, tick: 7, authority: 'server' });
  });
  it('city screen: 11 building plots, 8 selectable companies, real balances, funded demand, valid integers', () => {
    const r = get(world(), '/api/screens/city'); expect(r.status).toBe(200);
    const b = r.body as Env<{ player: { coins: { minor: number }; dailyProfit: { minor: number } }; city: { plots: { assetId: string | null }[]; demand: unknown[]; events: unknown[] }; directory: { id: string }[] }>;
    expect(b.authority).toBe('server'); expect(b.envelope.revision).toBe(5);
    expect(b.envelope.data.city.plots.filter((p) => p.assetId)).toHaveLength(11);
    expect(b.envelope.data.directory.map((d) => d.id).sort()).toEqual(['co-avon-timber', 'co-bean-there', 'co-brunel-mill', 'co-clifton-dairy', 'co-clifton-slice', 'co-harbour-bean', 'co-mad-slices', 'co-severn-farm']);
    expect(b.envelope.data.player.coins.minor).toBe(1_500_000);
    expect(b.envelope.data.city.demand.length).toBe(3);
    expect(() => assertWireIntegrity(b.envelope.data)).not.toThrow();
  });
  it('company detail is derived from stored financials: profit = revenue − expenses, history from real ticks', () => {
    const r = get(world(10), '/api/companies/co-mad-slices').body as Env<Record<string, any>>;
    const c = r.envelope.data;
    expect(c.dailyProfit.minor).toBe(c.dailyRevenue.minor - c.dailyExpenses.minor);
    expect(c.profitHistory.points).toHaveLength(10); expect(c.revenueHistory.points).toHaveLength(10);
    expect(c.permissions.manage).toBe(true); expect(c.inventory.some((i: { commodityId: string }) => i.commodityId === 'flour')).toBe(true);
    expect(c.cash.minor).toBeGreaterThan(0);
    const npc = (get(world(), '/api/companies/co-brunel-mill').body as Env<Record<string, any>>).envelope.data;
    expect(npc.permissions).toEqual({ manage: false, buySupplies: false, upgrade: false }); expect(npc.owner.kind).toBe('npc');
  });
  it('state enterprises and unknown companies are not exposed as company DTOs', () => {
    expect(get(world(), '/api/companies/co-bristol-energy').status).toBe(404);
    expect(get(world(), '/api/companies/nope').status).toBe(404);
  });
  it('companies, commodities and portfolio screens match their contract roots', () => {
    const db = world(8);
    const comp = (get(db, '/api/screens/companies').body as Env<{ companies: { items: { id: string }[] }; recipes: { id: string }[] }>).envelope.data;
    expect(comp.companies.items.map((c) => c.id)).toEqual(['co-harbour-bean', 'co-mad-slices']); expect(comp.recipes.length).toBe(7);
    const com = (get(db, '/api/screens/commodities').body as Env<{ commodities: { id: string; history: { points: unknown[] } }[]; orders: { items: unknown[] }; history: { items: unknown[] } }>).envelope.data;
    expect(com.commodities.map((c) => c.id)).toEqual(['cafe-drink', 'cheese', 'coffee', 'flour', 'milk', 'packaging', 'pizza', 'timber', 'wheat']);
    expect(com.orders.items.length).toBeGreaterThan(0); expect(com.commodities.find((c) => c.id === 'flour')!.history.points.length).toBeGreaterThan(0);
    const pf = (get(db, '/api/screens/portfolio').body as Env<{ holdings: unknown[] }>).envelope.data; expect(pf.holdings).toEqual([]);
    expect(get(db, '/api/screens/wallet').status).toBe(404);              // wallet/stocks/prestige have no server data yet
  });
  it('financial history endpoint returns every cost line', () => {
    const rows = (get(world(6), '/api/companies/co-mad-slices/financials').body as { rows: Record<string, number>[] }).rows;
    expect(rows).toHaveLength(6); expect(Object.keys(rows[0]!)).toEqual(expect.arrayContaining(['revenue', 'cogs', 'labour', 'property', 'marketing', 'fees', 'tax', 'energyPaid', 'netProfit', 'cash']));
    for (const r of rows) expect(r.netProfit).toBe(r.revenue! - r.cogs! - r.labour! - r.property! - r.marketing! - r.fees! - r.tax!);
  });
});

describe('write API', () => {
  it('company.configure works end to end and is idempotent', () => {
    const db = world(); const cmd = { type: 'company.configure', companyId: 'co-mad-slices', idempotencyKey: 'api-1', expectedRevision: 1, priceMinor: 1_200 };
    const a = post(db, '/api/command', cmd), b = post(db, '/api/command', cmd);
    expect(a.status).toBe(200); expect(b.body).toEqual(a.body);
    expect((get(db, '/api/companies/co-mad-slices').body as Env<{ price: { minor: number }; revision: number }>).envelope.data).toMatchObject({ price: { minor: 1_200 }, revision: 2 });
  });
  it('unsupported actions are refused honestly rather than faked', () => {
    const r = post(world(), '/api/command', { type: 'wallet.convertCoins', amountMinor: 50, idempotencyKey: 'w', expectedRevision: 1 });   // there is deliberately no coin ↔ GBP conversion
    expect(r.status).toBe(501); expect(r.body).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
    expect(post(world(), '/api/command', { type: 'shares.order', idempotencyKey: 'x' }).status).toBe(501);
    expect(post(world(), '/api/command', { type: 'nonsense', idempotencyKey: 'x' }).status).toBe(501);
  });
  it('quote → order → settlement through the API leaves the books balanced', () => {
    const db = world(2);
    const q = post(db, '/api/quote', { kind: 'commodity', entityId: 'flour', companyId: 'co-mad-slices', side: 'buy', quantity: 10, limitPriceMinor: 400, cityId: 'city-bristol' });
    const quote = (q.body as { quote: { id: string; total: { minor: number } } }).quote; expect(q.status).toBe(200); expect(quote.total.minor).toBeGreaterThan(0);
    const o = post(db, '/api/command', { type: 'commodity.order', companyId: 'co-mad-slices', commodityId: 'flour', side: 'buy', quantity: 10, limitPriceMinor: 400, quoteId: quote.id, idempotencyKey: 'ord-1', expectedRevision: 2 });
    expect(o.body).toMatchObject({ ok: true, data: { filled: 10 } });
    expect(reconcile(db).ok).toBe(true);
    expect(post(db, '/api/quote', { kind: 'shares', entityId: 'x', companyId: null, side: 'buy', quantity: 1, limitPriceMinor: null, cityId: 'c' }).status).toBe(501);
  });
  it('bad quotes are validation errors with field messages', () => {
    const r = post(world(), '/api/quote', { kind: 'commodity', entityId: 'flour', companyId: 'co-mad-slices', side: 'buy', quantity: 0, limitPriceMinor: 400, cityId: 'c' });
    expect(r.status).toBe(422); expect(r.body).toMatchObject({ ok: false, error: { code: 'VALIDATION', fieldErrors: { quantity: expect.any(String) } } });
  });
});

describe('developer endpoints', () => {
  it('are disabled unless explicitly enabled', () => {
    expect(get(world(), '/api/dev/economy', false).status).toBe(404);
    expect(post(world(), '/api/dev/tick', { count: 1 }, false).status).toBe(404);
  });
  it('economy dashboard reports real ledger figures', () => {
    const db = world(20); const d = get(db, '/api/dev/economy').body as Record<string, any>;
    expect(d.tick).toBe(20); expect(d.reconciliation.ok).toBe(true);
    expect(d.money.issued - d.money.destroyed).toBe(d.money.circulating);
    expect(d.money.households + d.money.stateTreasury + d.money.stateEnterprises + d.money.companies + d.money.players).toBe(d.money.circulating);
    expect(d.companies.count).toBe(16); expect(d.ticks).toHaveLength(21 > 30 ? 30 : 21); expect(d.demand.length).toBe(3);
    expect(d.flows.issuedByReason.map((r: { reason: string }) => r.reason)).toEqual(expect.arrayContaining(['genesis grants', 'NPC citizen income grant']));
    expect(d.flows.destroyedByKind.length).toBeGreaterThan(0);
  });
  it('can advance ticks on demand', () => {
    const db = world(0); const r = post(db, '/api/dev/tick', { count: 3 });
    expect(r.body).toMatchObject({ ran: 3 }); expect((get(db, '/api/health').body as { tick: number }).tick).toBe(3);
  });
});
