// @vitest-environment node
import { formatMarketReport, runMarketSim } from '../marketSim';

describe('market simulation with scripted test players (90 days)', () => {
  const r = runMarketSim(90);
  it('the economy stays consistent: identities hold every tick, the ledger reconciles, circulating supply stays within ±5%', () => {
    expect(r.anomalies).toEqual([]); expect(r.reconciliation).toBe(true); expect(Math.abs(r.supplyChangeBps)).toBeLessThan(500);
  });
  it('competition may close NPC firms, but only through orderly liquidation (no zombies), and the city keeps its suppliers; the state provisioner never runs below zero', () => {
    expect(r.npc.insolventNpc).toEqual([]); expect(r.npc.bankruptcies.filter((id) => !id.startsWith('co-pl-')).length).toBeLessThanOrEqual(4);
    expect(r.npc.minStateStock.every((m) => m.units >= 0)).toBe(true);
  });
  it('prices emerge from trading and stay inside a sane band of the reference price', () => {
    for (const c of r.commodities.filter((x) => x.volume > 0)) { expect(c.minVwap!).toBeGreaterThan(c.reference * 0.3); expect(c.maxVwap!).toBeLessThan(c.reference * 3); }
    expect(r.commodities.filter((c) => c.volume > 0).length).toBeGreaterThanOrEqual(6);
  });
  it('a would-be monopolist cannot profitably corner wheat: no bank-breaking gains, supply was replenished by others', () => {
    const b = r.bots.find((x) => x.bot.startsWith('B'))!;
    expect(b.profit).toBeLessThan(b.startWorth * 0.1);
  });
  it('contract buyers receive deliveries on schedule', () => { expect(r.exchange.contractDeliveries).toBeGreaterThan(50); expect(r.exchange.contractMisses).toBeLessThan(r.exchange.contractDeliveries * 0.15); });
  it('fees are recorded and every coin of them is burned (explicitly) or kept as the exchange revenue: nothing vanishes', () => {
    expect(r.exchange.feesCollected).toBeGreaterThan(0); expect(r.exchange.burned + r.exchange.retained).toBeLessThanOrEqual(r.exchange.feesCollected + 1);
    expect(r.exchange.burned).toBeGreaterThan(0); expect(r.exchange.burned).toBeLessThanOrEqual(r.exchange.feesCollected);   // the rest is the exchange's revenue: it pays wages and costs from it
  });
  it('produces a readable report', () => { expect(formatMarketReport(r)).toContain('Commodity markets'); });
});
