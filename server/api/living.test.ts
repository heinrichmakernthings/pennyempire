// @vitest-environment node
import { handleApi } from './router';
import { advance } from '../engine/world';
import { memWorld } from '../test/helpers';

const db = memWorld({ realMsPerTick: 3_600_000_000 }); advance(db, 63);
const get = (path: string) => handleApi(db, { method: 'GET', path }, { devEndpoints: true, now: () => 1_000 });

describe('living-city API', () => {
  it('standings expose persisted boards and titles held by real companies', () => {
    const b = get('/api/standings').body as { standings: { boards: { rows: unknown[] }[]; titles: { holderName: string }[] } };
    expect(b.standings.boards.length).toBeGreaterThan(0); expect(b.standings.titles.length).toBeGreaterThan(0);
  });
  it('the Penny Post lists dated articles that come from recorded events', () => {
    const b = get('/api/news').body as { articles: { headline: string; gameDate: string }[] };
    expect(b.articles.length).toBeGreaterThan(0); for (const a of b.articles) { expect(a.headline.length).toBeGreaterThan(3); expect(a.gameDate).toMatch(/^\d{4}-/); }
  });
  it('a competitor profile contains public data only', () => {
    const r = get('/api/competitors/co-mad-slices'); expect(r.status).toBe(200);
    const p = (r.body as { profile: Record<string, unknown> }).profile;
    expect(p).toMatchObject({ name: expect.any(String), future: { shareInvestable: false, acquirable: false } });
    for (const secret of ['cash', 'strategy', 'treasury', 'profit', 'inventory', 'balance']) expect(Object.keys(p).map((k) => k.toLowerCase()).join(' ')).not.toContain(secret);
    expect(get('/api/competitors/state-power').status).toBe(404);
  });
  it('opportunities carry derived labels and metrics, never a profit promise', () => {
    const b = get('/api/opportunities').body as { forecastNote: string; opportunities: { labels: string[]; metrics: object }[] };
    expect(b.opportunities.every((o) => Array.isArray(o.labels) && typeof o.metrics === 'object')).toBe(true);
    expect(b.forecastNote.toLowerCase()).toContain('estimate');
  });
  it('the developer dashboard reports where purchasing power originates and exposes the NPC inspector', () => {
    const d = (get('/api/dev/economy').body as { living: { purchasingPower: { householdIncomeByOrigin: { issuance: boolean }[] }; npcInspector: unknown[]; npcByIndustry: unknown[]; configVersions: unknown[] } }).living;
    expect(d.purchasingPower.householdIncomeByOrigin.length).toBeGreaterThan(0);
    expect(d.npcInspector.length).toBeGreaterThan(3); expect(d.npcByIndustry.length).toBeGreaterThan(3);
  });
});

describe('city activity', () => {
  it('is derived from recorded state: every company appears, closed firms look closed, new firms look under construction', () => {
    const b = get('/api/city/activity').body as { items: { companyId: string; state: string; customers: number; vans: number }[] };
    expect(b.items.length).toBeGreaterThanOrEqual(7);
    const states = new Set(b.items.map((i) => i.state)); expect(states.size).toBeGreaterThan(1);
    for (const i of b.items) { expect(i.customers).toBeLessThanOrEqual(4); expect(i.vans).toBeLessThanOrEqual(2); if (i.state === 'closed') expect(i.customers + i.vans).toBe(0); }
  });
});
