import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertWireIntegrity } from '@/domain/integrity';
import { frameById, manifest } from '@/assets/artAssets';
import { city, companies, mapMeta, player } from './bristol';
import { commodities, holdings, listings, ownOrders, orders, prestigeItems, testWallet } from './markets';
import { createFixtureDataSource } from './index';
import type { ScreenKey } from '../types';

describe('fixture self-consistency (illustrative data must still be internally coherent)', () => {
  it('company P&L: profit = revenue − expenses, ownership sums to 100%', () => {
    for (const c of companies) {
      expect(c.dailyProfit.minor).toBe(c.dailyRevenue.minor - c.dailyExpenses.minor);
      expect(c.ownership.reduce((a, o) => a + o.ownershipBps, 0)).toBe(10_000);
      expect(c.minPrice.minor).toBeLessThanOrEqual(c.price.minor);
      expect(c.price.minor).toBeLessThanOrEqual(c.maxPrice.minor);
      for (const l of c.inventory) expect(l.availableUnits + l.reservedUnits).toBeLessThanOrEqual(l.capacityUnits);
    }
  });
  it('player totals reconcile with owned companies and holdings', () => {
    const mine = companies.filter((c) => c.owner.id === player.id);
    expect(player.dailyProfit.minor).toBe(mine.reduce((a, c) => a + c.dailyProfit.minor, 0));
    expect(player.portfolioValue.minor).toBe(holdings.reduce((a, h) => a + h.value.minor, 0));
    expect(player.netWorth.minor).toBe(player.coins.minor + player.portfolioValue.minor);
    for (const h of holdings) {
      const l = listings.find((x) => x.id === h.listingId)!;
      expect(h.value.minor).toBe(h.shares * l.price.minor);
      expect(h.unrealizedPnl.minor).toBe(h.value.minor - h.costBasis.minor);
      expect(h.reservedShares).toBeLessThanOrEqual(h.shares);
    }
  });
  it('every plot reference resolves and every asset exists in the manifest', () => {
    const plotIds = new Set(city.plots.map((p) => p.id));
    for (const c of companies) { expect(plotIds.has(c.plotId)).toBe(true); expect(frameById.has(c.assetId)).toBe(true); }
    for (const p of city.plots) if (p.assetId) expect(frameById.get(p.assetId)?.usage).toBe('building');
    for (const d of mapMeta.decor) expect(frameById.has(d.assetId)).toBe(true);
    for (const c of commodities) expect(frameById.has(c.iconAssetId)).toBe(true);
    for (const i of prestigeItems) if (i.assetId) expect(frameById.has(i.assetId)).toBe(true);
  });
  it('building footprints match the manifest and never overlap each other or non-paving terrain', () => {
    const taken = new Map<string, string>();
    const kind = new Map(city.plots.filter((p) => !p.assetId).map((p) => [`${p.column},${p.row}`, p.terrain]));
    for (const p of city.plots.filter((x) => x.assetId)) {
      expect([p.width, p.depth]).toEqual(frameById.get(p.assetId!)!.footprint);
      for (let c = p.column; c < p.column + p.width; c++) for (let r = p.row; r < p.row + p.depth; r++) {
        expect(taken.get(`${c},${r}`), `overlap at ${c},${r}`).toBeUndefined(); taken.set(`${c},${r}`, p.id);
        expect(['road', 'water']).not.toContain(kind.get(`${c},${r}`));
        expect(c).toBeLessThan(mapMeta.columns); expect(r).toBeLessThan(mapMeta.rows);
      }
    }
  });
  it('all six starting industries are present and placed', () => {
    expect(new Set(companies.map((c) => c.industry))).toEqual(new Set(['farm', 'mill', 'dairy', 'pizza', 'cafe', 'timber']));
  });
  it('orders: remaining ≤ original; filled orders have nothing remaining', () => {
    for (const o of [...orders, ...ownOrders]) { expect(o.remainingUnits).toBeLessThanOrEqual(o.originalUnits); if (o.status === 'filled') expect(o.remainingUnits).toBe(0); }
  });
  it('wallet is SIMULATED GBP_TEST only with the £5 threshold', () => {
    expect(testWallet.mode).toBe('SIMULATED'); expect(testWallet.currency).toBe('GBP_TEST'); expect(testWallet.minimumWithdrawalMinor).toBe(500);
    for (const t of testWallet.transactions) expect(t.amount.currency).toBe('GBP_TEST');
  });
  it('prestige items without artwork are never purchasable', () => {
    for (const i of prestigeItems) if (!i.assetId) { expect(i.purchasable).toBe(false); expect(i.unavailableReason).toBeTruthy(); }
  });
});

describe('fixture data source', () => {
  const keys: ScreenKey[] = ['city', 'companies', 'commodities', 'stocks', 'prestige', 'wallet', 'portfolio'];
  it('labels every payload as illustrative and passes the integrity guard', async () => {
    const src = createFixtureDataSource('normal', { delayMs: 0 });
    for (const k of keys) { const r = await src.load(k); expect(r.authority).toBe('illustrative-fixture'); expect(() => assertWireIntegrity(r.envelope.data)).not.toThrow(); }
  });
  it('keeps GBP_TEST out of every screen except the wallet', async () => {
    const src = createFixtureDataSource('normal', { delayMs: 0 });
    for (const k of keys.filter((x) => x !== 'wallet')) expect(JSON.stringify((await src.load(k)).envelope.data)).not.toContain('GBP_TEST');
  });
  it('commands are refused, not faked, because no server exists', async () => {
    const res = await createFixtureDataSource('normal', { delayMs: 0 }).submitCommand({ type: 'wallet.testDeposit', amountMinor: 50, idempotencyKey: 'k', expectedRevision: 1 });
    expect(res).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
  });
  it('error and empty modes behave', async () => {
    await expect(createFixtureDataSource('error', { delayMs: 0 }).load('city')).rejects.toThrow();
    expect((await createFixtureDataSource('empty', { delayMs: 0 }).load('companies')).envelope.data.companies.items).toEqual([]);
  });
  it('quotes use integer fees and reject over-sized orders', async () => {
    const src = createFixtureDataSource('normal', { delayMs: 0 });
    const q = await src.requestQuote({ kind: 'commodity', entityId: 'flour', companyId: 'co-mad-slices', side: 'buy', quantity: 10, limitPriceMinor: 240, cityId: city.id });
    expect(q.ok && q.quote.total.minor).toBe(2_400 + 48);
    const big = await src.requestQuote({ kind: 'commodity', entityId: 'flour', companyId: 'co-mad-slices', side: 'buy', quantity: 9_999, limitPriceMinor: 240, cityId: city.id });
    expect(big.ok).toBe(false);
  });
});

describe('asset boundary (runtime manifest vs files on disk)', () => {
  it('every frame is inside its source image and every source file exists', () => {
    const root = resolve(__dirname, '../../..');
    const ids = new Set<string>();
    for (const a of manifest.assets) {
      expect(ids.has(a.id)).toBe(false); ids.add(a.id);
      expect(existsSync(resolve(root, a.source)), a.source).toBe(true);
      const [x, y, w, h] = a.frame;
      expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(a.sourceSize[0]); expect(y + h).toBeLessThanOrEqual(a.sourceSize[1]);
      if (a.usage === 'actor') expect(a.logicalSize[1]).toBe(40);
      if (a.usage === 'inventory') expect(Math.max(...a.logicalSize)).toBeLessThanOrEqual(48);
    }
    expect(manifest.assets).toHaveLength(41 + 18);   // base atlas + 18 Phase 2 tier-2/3 building frames
  });
});
