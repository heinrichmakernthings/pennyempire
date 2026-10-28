/**
 * Consumer allocation, integer arithmetic only. Given a funded budget and the sellers able to serve it, decides how many
 * units each seller sells. Reproducible: same inputs → same outputs (ties broken by input order, which the tick rotates fairly).
 */
export interface Seller { id: string; price: number; stock: number; quality: 'basic' | 'standard' | 'premium'; reputationBps: number; awarenessBps: number }
export interface Allocation { id: string; units: number; spend: number; share: number }
export interface DemandResult { allocations: Allocation[]; unitsWanted: number; unitsSold: number; unmetUnits: number; spend: number; weightedAvgPrice: number }

const QUALITY_BPS = { basic: 8_000, standard: 10_000, premium: 13_000 } as const;
export const MAX_DEMAND_FACTOR_BPS = 12_500; // cheap prices can lift volume by at most 25% — never unbounded demand

export const powBps = (ratioBps: number, n: number) => { let r = 10_000; for (let i = 0; i < n; i++) r = Math.floor((r * ratioBps) / 10_000); return r; };

/** Attractiveness: (ref/price)² × quality × reputation × advertising awareness. All integer, each step bounded < 2^53. */
export function score(s: Seller, refPrice: number, priceSensitivity: number): number {
  const ratioPpm = Math.floor((refPrice * 1_000_000) / s.price);
  let w = ratioPpm;
  for (let i = 1; i < priceSensitivity; i++) w = Math.floor((w * ratioPpm) / 1_000_000);
  w = Math.floor((w * QUALITY_BPS[s.quality]) / 10_000);
  w = Math.floor((w * (5_000 + s.reputationBps)) / 10_000);
  return Math.max(1, Math.floor((w * (10_000 + s.awarenessBps)) / 10_000));    // awareness (0..4000 bps) is earned by sustained advertising, see tick.ts
}

export interface WeightedSeller { id: string; price: number; stock: number; weight: number }
/**
 * Core allocation given precomputed weights: how many units each seller sells from `budget`. Total wanted units follow the budget and the weighted average price
 * (cheap prices lift volume by at most 25%); sellers are served in proportion to weight, limited by the stock they really hold; the budget is a hard ceiling.
 */
export function allocateByWeights(budget: number, refPrice: number, sensitivity: number, sellers: WeightedSeller[]): DemandResult {
  const empty: DemandResult = { allocations: sellers.map((s) => ({ id: s.id, units: 0, spend: 0, share: 0 })), unitsWanted: 0, unitsSold: 0, unmetUnits: 0, spend: 0, weightedAvgPrice: 0 };
  if (budget <= 0 || sellers.length === 0) return empty;
  const w = sellers.map((s) => Math.max(1, s.weight));
  const sumW = w.reduce((a, b) => a + b, 0);
  const avg = Math.floor(sellers.reduce((a, s, i) => a + s.price * w[i]!, 0) / sumW);
  const factor = Math.min(MAX_DEMAND_FACTOR_BPS, Math.floor((refPrice * 10_000) / avg));
  const wanted = Math.floor((Math.floor(budget / refPrice) * powBps(factor, sensitivity)) / 10_000);
  const units = sellers.map(() => 0);
  let remaining = wanted;
  let active = sellers.map((_, i) => i).filter((i) => sellers[i]!.stock > 0);
  for (let round = 0; round < 8 && remaining > 0 && active.length > 0; round++) {
    const totalW = active.reduce((a, i) => a + w[i]!, 0);
    const shares = active.map((i) => Math.floor((remaining * w[i]!) / totalW));
    let leftover = remaining - shares.reduce((a, b) => a + b, 0);
    const byRemainder = active.map((i, k) => ({ i, k, rem: (remaining * w[i]!) % totalW })).sort((a, b) => b.rem - a.rem || a.k - b.k);
    for (const r of byRemainder) { if (leftover <= 0) break; shares[r.k]! += 1; leftover--; }
    active.forEach((i, k) => { const take = Math.min(shares[k]!, sellers[i]!.stock - units[i]!); units[i]! += take; remaining -= take; });
    active = active.filter((i) => units[i]! < sellers[i]!.stock);
  }
  let left = budget; let spend = 0; let sold = 0;
  const allocations: Allocation[] = sellers.map((s, i) => {
    const u = Math.min(units[i]!, Math.floor(left / s.price));
    const cost = u * s.price; left -= cost; spend += cost; sold += u;
    return { id: s.id, units: u, spend: cost, share: Math.floor((w[i]! * 10_000) / sumW) };
  });
  return { allocations, unitsWanted: wanted, unitsSold: sold, unmetUnits: Math.max(0, wanted - sold), spend, weightedAvgPrice: avg };
}

export function allocateDemand(budget: number, refPrice: number, sensitivity: number, sellers: Seller[]): DemandResult {
  return allocateByWeights(budget, refPrice, sensitivity, sellers.map((s) => ({ id: s.id, price: s.price, stock: s.stock, weight: score(s, refPrice, sensitivity) })));
}
