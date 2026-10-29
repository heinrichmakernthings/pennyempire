// @vitest-environment node
import { allocateDemand, powBps, score, type Seller } from './demand';

const s = (id: string, price: number, over: Partial<Seller> = {}): Seller => ({ id, price, stock: 1_000, quality: 'standard', reputationBps: 5_000, awarenessBps: 0, ...over });

describe('consumer demand allocation', () => {
  it('never spends more than the budget and sells whole units', () => {
    for (const price of [500, 1_000, 1_500]) {
      const r = allocateDemand(180_000, 1_000, 2, [s('a', price), s('b', price + 100)]);
      expect(r.spend).toBeLessThanOrEqual(180_000);
      expect(r.allocations.every((a) => Number.isInteger(a.units) && a.spend === a.units * (a.id === 'a' ? price : price + 100))).toBe(true);
    }
  });
  it('is reproducible', () => { expect(allocateDemand(100_000, 1_000, 2, [s('a', 1_000), s('b', 900)])).toEqual(allocateDemand(100_000, 1_000, 2, [s('a', 1_000), s('b', 900)])); });
  it('equal sellers split equally', () => {
    const r = allocateDemand(100_000, 1_000, 2, [s('a', 1_000), s('b', 1_000)]);
    expect(r.allocations[0]!.units).toBe(r.allocations[1]!.units);
    expect(r.unitsSold).toBe(100);
  });
  it('under-pricing wins share; over-pricing loses it', () => {
    const r = allocateDemand(100_000, 1_000, 2, [s('cheap', 800), s('dear', 1_250)]);
    expect(r.allocations[0]!.units).toBeGreaterThan(r.allocations[1]!.units * 2);
  });
  it('quality, reputation and advertising awareness each raise a seller’s share', () => {
    const base = score(s('x', 1_000), 1_000, 2);
    expect(score(s('x', 1_000, { quality: 'premium' }), 1_000, 2)).toBeGreaterThan(base);
    expect(score(s('x', 1_000, { quality: 'basic' }), 1_000, 2)).toBeLessThan(base);
    expect(score(s('x', 1_000, { reputationBps: 9_000 }), 1_000, 2)).toBeGreaterThan(base);
    expect(score(s('x', 1_000, { awarenessBps: 2_000 }), 1_000, 2)).toBeGreaterThan(base);
  });
  it('high prices shrink total demand; very low prices lift it only up to the cap', () => {
    const at = (p: number) => allocateDemand(100_000, 1_000, 2, [s('a', p)]).unitsWanted;
    expect(at(2_000)).toBeLessThan(at(1_000) / 3);
    expect(at(100)).toBeLessThanOrEqual(Math.floor((100 * 12_500 * 12_500) / 100_000_000) * 10 + 160);
    expect(at(100)).toBeLessThanOrEqual(Math.floor(100 * 1.5625) + 1);
  });
  it('stock caps sales, surplus demand moves to others, the rest is reported unmet', () => {
    const r = allocateDemand(100_000, 1_000, 2, [s('a', 1_000, { stock: 10 }), s('b', 1_000, { stock: 1_000 })]);
    expect(r.allocations[0]!.units).toBe(10); expect(r.allocations[1]!.units).toBe(90);
    const out = allocateDemand(100_000, 1_000, 2, [s('a', 1_000, { stock: 10 })]);
    expect(out.unitsSold).toBe(10); expect(out.unmetUnits).toBe(90);
  });
  it('no budget or no sellers means no demand and no coins created', () => {
    expect(allocateDemand(0, 1_000, 2, [s('a', 1_000)]).spend).toBe(0);
    expect(allocateDemand(1_000, 1_000, 2, []).unitsSold).toBe(0);
  });
  it('powBps', () => { expect(powBps(5_000, 2)).toBe(2_500); expect(powBps(10_000, 4)).toBe(10_000); });
});
