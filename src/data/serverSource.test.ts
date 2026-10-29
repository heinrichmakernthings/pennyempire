import { afterEach, vi } from 'vitest';
import { chooseDataSource, createServerDataSource } from './serverSource';

const okJson = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const env = (data: unknown) => ({ authority: 'server', envelope: { schemaVersion: 1, revision: 4, asOf: '2026-11-02T00:00:00.000Z', nextTickAt: '2026-11-02T00:01:00.000Z', data } });
afterEach(() => vi.unstubAllGlobals());

describe('server data source', () => {
  it('loads engine-owned screens from the API and keeps the server authority label', async () => {
    const f = vi.fn(() => okJson(env({ player: { coins: { currency: 'EC', minor: 1_500_000 } } })));
    vi.stubGlobal('fetch', f);
    const r = await createServerDataSource().load('city');
    expect(f).toHaveBeenCalledWith('/api/screens/city', expect.anything());
    expect(r.authority).toBe('server'); expect(r.envelope.revision).toBe(4);
  });
  it('screens the engine does not model yet stay labelled illustrative and never hit the server', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    for (const k of ['wallet', 'stocks', 'prestige'] as const) expect((await createServerDataSource().load(k)).authority).toBe('illustrative-fixture');
    expect(f).not.toHaveBeenCalled();
  });
  it('surfaces server errors instead of inventing data', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okJson({ ok: false, error: { code: 'UNAVAILABLE', message: 'database is locked' } }, 500)));
    await expect(createServerDataSource().load('companies')).rejects.toThrow('database is locked');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>bad gateway</html>', { status: 502 }))));
    await expect(createServerDataSource().loadCompany('co-mad-slices')).rejects.toThrow(/non-JSON/);
  });
  it('rejects payloads that violate integer-money rules', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okJson(env({ player: { coins: { currency: 'EC', minor: 12.5 } } }))));
    await expect(createServerDataSource().load('city')).rejects.toThrow(/safe integer/);
  });
  it('posts commands as JSON and returns the server’s verdict untouched', async () => {
    const f = vi.fn(() => okJson({ ok: false, error: { code: 'STALE_REVISION', message: 'Company changed' } }, 422)); vi.stubGlobal('fetch', f);
    const res = await createServerDataSource().submitCommand({ type: 'company.configure', companyId: 'c', priceMinor: 1_100, idempotencyKey: 'k', expectedRevision: 1 });
    expect(res).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toMatchObject({ idempotencyKey: 'k', expectedRevision: 1 });
  });
  it('commodity quotes come from the server; share quotes stay illustrative', async () => {
    const f = vi.fn(() => okJson({ ok: true, quote: { id: 'q', expiresAt: 'x', revision: 1, quantity: 1, subtotal: { currency: 'EC', minor: 1 }, fee: { currency: 'EC', minor: 0 }, total: { currency: 'EC', minor: 1 }, availableUnits: 1 } })); vi.stubGlobal('fetch', f);
    const src = createServerDataSource();
    await src.requestQuote({ kind: 'commodity', entityId: 'flour', companyId: 'c', side: 'buy', quantity: 1, limitPriceMinor: 100, cityId: 'x' });
    expect(f).toHaveBeenCalledWith('/api/quote', expect.objectContaining({ method: 'POST' }));
    f.mockClear();
    await src.requestQuote({ kind: 'shares', entityId: 'lst-mill', companyId: null, side: 'buy', quantity: 1, limitPriceMinor: 100, cityId: 'x' });
    expect(f).not.toHaveBeenCalled();
  });
  it('map decor never sits inside a server building footprint', () => {
    const meta = createServerDataSource().mapMeta('city-bristol');
    expect(meta.decor.some((d) => d.assetId === 'crane' && d.column === 11 && d.row === 12)).toBe(false);   // inside the NPC café at (10,11)
    expect(meta.decor.length).toBeGreaterThan(10);
  });
});

describe('choosing a data source at startup', () => {
  it('uses the server when /api/health says it is the engine', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okJson({ ok: true, tick: 3, authority: 'server' })));
    const r = await chooseDataSource(''); expect(r.source.authority).toBe('server'); expect(r.fallbackReason).toBeNull();
  });
  it('falls back to labelled fixtures — and says so — when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('connect ECONNREFUSED'))));
    const r = await chooseDataSource('');
    expect(r.source.authority).toBe('illustrative-fixture'); expect(r.fallbackReason).toMatch(/illustrative fixture data only/i);
  });
  it('?source=fixture forces fixtures without probing the network', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const r = await chooseDataSource('?source=fixture'); expect(r.source.authority).toBe('illustrative-fixture'); expect(f).not.toHaveBeenCalled();
  });
});
