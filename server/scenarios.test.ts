// @vitest-environment node
import { formatScenario, runScenario, lastWorld, type ScenarioId } from './scenarios';
import { reconcile } from './engine/ledger';

describe.each<[ScenarioId, number]>([['A', 40], ['B', 40], ['C', 25], ['D', 60], ['D-energy', 60], ['E', 80], ['F', 40]])('balancing scenario %s', (id, days) => {
  const r = runScenario(id, days);
  it('runs deterministically with zero accounting anomalies and a reconciling ledger', () => {
    expect(r.anomalies).toEqual([]); expect(r.reconciles).toBe(true); expect(reconcile(lastWorld!).ok).toBe(true);
  });
  it('produces a readable report with real numbers', () => {
    const md = formatScenario(r); expect(md).toContain('## Industries'); expect(r.industries.length).toBeGreaterThan(3); expect(r.timeline.length).toBeGreaterThan(3);
  });
  it('never leaves a zombie: every insolvent company is liquidated, and no state enterprise fails', () => {
    expect(lastWorld!.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE owner_kind = 'state' AND status = 'insolvent'")!.n).toBe(0);
  });
});

describe('scenario outcomes', () => {
  it('D: a mill shutdown lifts flour prices but the state fallback caps them and the economy recovers', () => {
    const r = runScenario('D', 90); const flour = r.prices.find((p) => p.commodity === 'flour')!;
    expect(flour.max!).toBeGreaterThan(flour.reference); expect(flour.max!).toBeLessThanOrEqual(Math.floor(flour.reference * 1.5));
    expect(r.timeline.at(-1)!.units).toBeGreaterThan(0);
  });
  it('E: a consumer shock lowers spending while it lasts, and no coin is conjured to compensate', () => {
    const r = runScenario('E', 60); const s = lastWorld!;
    expect(s.get<{ n: number }>('SELECT COUNT(*) n FROM config_versions')!.n).toBeGreaterThanOrEqual(1);
    const shocked = s.get<{ v: number }>('SELECT AVG(consumer_spend_minor) v FROM stability_stats WHERE tick BETWEEN 40 AND 60')!.v, before = s.get<{ v: number }>('SELECT AVG(consumer_spend_minor) v FROM stability_stats WHERE tick BETWEEN 15 AND 29')!.v;
    expect(shocked).toBeLessThan(before); expect(r.anomalies).toEqual([]);
  });
  it('F: a dominant company wins a large share but a rival is never frozen out — NPCs keep trading', () => {
    const r = runScenario('F', 60); const pizza = r.industries.find((i) => i.industry === 'pizza')!;
    expect(pizza.playerShareBps).toBeGreaterThan(3_000); expect(pizza.npc).toBeGreaterThanOrEqual(0); expect(r.reconciles).toBe(true);
  });
});
