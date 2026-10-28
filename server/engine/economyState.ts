import type { Sql } from '../db/sql';

/**
 * The economy's current modifiers: what active economic events (and nothing else) currently do to energy, advertising, logistics, rents, credit, demand and production.
 * They are DERIVED each day from the list of active events, never accumulated: applying the same event twice, or re-running a tick, cannot stack an effect.
 * Neutral values: multipliers 10,000 (= 100%), additive terms 0.
 */
export interface Mods {
  energyCapacityBps: number; energyPriceBps: number; adCostBps: number; adReachBps: number;
  logisticsFeeBps: number; logisticsDelayTicks: number; logisticsCapacityBps: number;
  rentBps: number; creditSpreadBps: number; creditLimitBps: number;
  /** additive, basis points of household spending: positive shrinks demand (recession), negative grows it (boom) */ demandShockBps: number;
  demandByCommodity: Record<string, number>; productionByIndustry: Record<string, number>;
  active: { id: string; type: string; severity: number; endTick: number }[];
}
export const NEUTRAL_MODS: Mods = { energyCapacityBps: 10_000, energyPriceBps: 10_000, adCostBps: 10_000, adReachBps: 10_000, logisticsFeeBps: 10_000, logisticsDelayTicks: 0, logisticsCapacityBps: 10_000, rentBps: 10_000, creditSpreadBps: 0, creditLimitBps: 10_000, demandShockBps: 0, demandByCommodity: {}, productionByIndustry: {}, active: [] };

const cache = new WeakMap<Sql, { tick: number; mods: Mods }>();
const mul = (a: number, b: number) => Math.floor((a * b) / 10_000);

export function combine(parts: Partial<Mods>[]): Mods {
  const m: Mods = { ...NEUTRAL_MODS, demandByCommodity: {}, productionByIndustry: {}, active: [] };
  for (const p of parts) {
    for (const k of ['energyCapacityBps', 'energyPriceBps', 'adCostBps', 'adReachBps', 'logisticsFeeBps', 'logisticsCapacityBps', 'rentBps', 'creditLimitBps'] as const) if (p[k] !== undefined) m[k] = mul(m[k], p[k]!);
    for (const k of ['logisticsDelayTicks', 'creditSpreadBps', 'demandShockBps'] as const) if (p[k] !== undefined) m[k] += p[k]!;
    for (const [c, v] of Object.entries(p.demandByCommodity ?? {})) m.demandByCommodity[c] = mul(m.demandByCommodity[c] ?? 10_000, v);
    for (const [c, v] of Object.entries(p.productionByIndustry ?? {})) m.productionByIndustry[c] = mul(m.productionByIndustry[c] ?? 10_000, v);
  }
  // sane floors so no event combination can switch a system off completely
  m.energyCapacityBps = Math.max(2_500, m.energyCapacityBps); m.logisticsCapacityBps = Math.max(2_500, m.logisticsCapacityBps); m.rentBps = Math.max(5_000, m.rentBps);
  m.creditLimitBps = Math.max(2_000, m.creditLimitBps); m.demandShockBps = Math.max(-3_000, Math.min(5_000, m.demandShockBps)); m.logisticsDelayTicks = Math.max(0, Math.min(5, m.logisticsDelayTicks));
  return m;
}

/** Stores today's modifiers (audit trail) and refreshes the cache. `parts` come from the active events (see events.ts). */
export function storeMods(db: Sql, tick: number, parts: Partial<Mods>[], active: Mods['active']): Mods {
  const mods = combine(parts); mods.active = active;
  db.run('INSERT OR REPLACE INTO economy_mods (tick, mods_json) VALUES (?,?)', tick, JSON.stringify(mods));
  cache.set(db, { tick, mods });
  return mods;
}
export function currentMods(db: Sql): Mods {
  const hit = cache.get(db); if (hit) return hit.mods;
  const row = db.get<{ tick: number; mods_json: string }>('SELECT tick, mods_json FROM economy_mods ORDER BY tick DESC LIMIT 1');
  const mods = row ? ({ ...NEUTRAL_MODS, ...(JSON.parse(row.mods_json) as Mods) }) : NEUTRAL_MODS;
  cache.set(db, { tick: row?.tick ?? -1, mods }); return mods;
}
export const clearModsCache = (db: Sql) => { cache.delete(db); };
