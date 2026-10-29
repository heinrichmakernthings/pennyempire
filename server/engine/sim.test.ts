// @vitest-environment node
import { runSimulation, formatReport } from '../sim';
import { memWorld } from '../test/helpers';

describe('multi-month economic simulation', () => {
  it('12 in-game months: no wealth appears from nowhere, state never fails, supply stays near target', () => {
    const r = runSimulation(360);
    console.log(`\n${formatReport(r)}\n`);
    expect(r.anomalies).toEqual([]);
    expect(r.reconciliation.ok).toBe(true);
    expect(r.npcIssued).toBe(r.totalIssued - r.genesisIssued - r.liquidityIssued);   // everything else issued is rule-based central bank liquidity, reported separately
    expect(Math.abs(r.changeBps)).toBeLessThan(1_500);                    // within ±15% of the genesis supply after a year
    expect(r.maxCirculatingDeviationBps).toBeLessThan(1_500);
    expect(r.companies.filter((c) => c.id.startsWith('co-bristol')).every((c) => c.status === 'operating')).toBe(true);   // state enterprises never fail
    expect(r.companies.filter((c) => c.status === 'operating').length).toBeGreaterThanOrEqual(10);        // NPC firms may enter and exit, the city stays populated
    expect(r.minHouseholds).toBeGreaterThanOrEqual(0);
    const last = r.monthly[r.monthly.length - 1]!; expect(last.consumerSpend).toBeGreaterThan(0);
  });
  it('a different random-free configuration is still conserved (stress: no income grant, aggressive burns)', () => {
    const r = runSimulation(120, { config: { stipendPerThousandMinor: 0, stateBurnBps: 500, supplyTargetMinor: 1 } });
    expect(r.anomalies).toEqual([]); expect(r.npcIssued).toBe(0);         // with no grant, the only issuance ever is genesis
    expect(r.endCirculating).toBe(r.startCirculating - r.totalDestroyed);
  });
  it('supplier failure: if the farm, mill and dairy stop, the state provisioner keeps the chain (bounded) alive and the books still balance', () => {
    const db = memWorld();
    db.run("UPDATE production_lines SET planned_batches = 0 WHERE company_id IN ('co-severn-farm','co-brunel-mill','co-clifton-dairy')");
    db.run("UPDATE companies SET status = 'paused' WHERE id IN ('co-severn-farm','co-brunel-mill','co-clifton-dairy')");
    const r = runSimulation(60, { db });
    expect(r.anomalies).toEqual([]);
    const sold = db.get<{ u: number }>("SELECT SUM(units_sold) u FROM company_tick_stats WHERE company_id IN ('co-mad-slices','co-clifton-slice') AND tick > 5")!.u;
    expect(sold).toBeGreaterThan(0);                                                           // pizzas were still sold from provisioner-supplied inputs
    const fallback = db.get<{ q: number }>("SELECT SUM(-delta) q FROM inventory_movements WHERE reason = 'trade_out' AND company_id = 'co-bristol-provisions'")!.q;
    expect(fallback).toBeGreaterThan(0);
    expect(fallback).toBeLessThanOrEqual(60 * 4 * 120);                                         // never more than the bounded per-tick creation
  });
});
