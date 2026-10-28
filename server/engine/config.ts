import type { Sql } from '../db/sql';

/** Every tunable rule lives here and is stored in `meta` so a database always carries the rules it was simulated under. */
export interface EngineConfig {
  seed: number;
  epochDate: string;                 // game date of tick 0
  realMsPerTick: number;             // wall-clock length of one economic tick (one in-game day)
  maxCatchupTicks: number;           // after downtime, at most this many ticks are replayed; the rest of the gap is skipped (and logged)
  exchangeFeeBps: number;            // seller-paid fee on every trade; destroyed (a sink)
  procurementLimitBps: number;       // NPC/company input purchases are limited to this share of the reference price
  stateSupplyMarkupBps: number;      // price of the state provisioner's bounded fallback stock
  stateSupplyPerTick: number;        // units of each base commodity the provisioner can create per tick
  stateSupplyCap: number;            // provisioner stock ceiling per commodity
  stipendPerThousandMinor: number;   // NPC citizens' income grant per 1,000 citizens per tick — the explicit injection that funds consumers
  civilPayrollBps: number;           // share of the treasury balance paid to households (civil service wages & benefits) each tick
  corporationTaxBps: number;         // share of positive net profit paid to the treasury (a transfer, not a sink)
  idleCashLevyBps: number;           // per-tick levy on company cash above its operating reserve (anti-hoarding transfer to the treasury)
  stateBurnBps: number;              // share of treasury balance above reserve destroyed each tick (infrastructure upkeep sink)
  stateReserveMinor: number;
  enterpriseReserveMinor: number;    // state enterprises keep this much; surplus is swept to the treasury (a transfer, not a sink)
  insolvencyAfterTicks: number;      // consecutive ticks of unpaid operating costs before a company is declared insolvent
  npcPriceStepBps: number;           // NPC wholesale price adjustment per tick when stock is high/low
  npcSupportMinor: number;           // max state liquidity support per NPC company per tick (0 disables)
  npcPayoutBps: number;              // share of NPC company cash above its reserve paid to NPC shareholders (households) each tick
  npcReserveTicks: number;           // NPC companies keep this many ticks of fixed costs before paying dividends
  supplyTargetMinor: number;         // inflation controller: target circulating supply (0 disables the controller)
  stipendGainBps: number;            // stipend = base × (1 + gain × (target − supply)/target), clamped to [0, 2×base]
  energyCommodityId: string;
}

export const DEFAULT_CONFIG: EngineConfig = {
  seed: 20261029, epochDate: '2026-10-29', realMsPerTick: 60_000, maxCatchupTicks: 48,
  exchangeFeeBps: 100, procurementLimitBps: 15_000, stateSupplyMarkupBps: 14_000, stateSupplyPerTick: 120, stateSupplyCap: 400,
  stipendPerThousandMinor: 120, civilPayrollBps: 500, corporationTaxBps: 1_500, idleCashLevyBps: 10, stateBurnBps: 100, stateReserveMinor: 2_000_000, enterpriseReserveMinor: 300_000,
  insolvencyAfterTicks: 3, npcPriceStepBps: 150, npcSupportMinor: 0, npcPayoutBps: 8_000, npcReserveTicks: 10, supplyTargetMinor: 0, stipendGainBps: 100_000, energyCommodityId: 'energy',
};

export function loadConfig(db: Sql): EngineConfig {
  const row = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'config'");
  return { ...DEFAULT_CONFIG, ...(row ? (JSON.parse(row.value) as Partial<EngineConfig>) : {}) };
}
export function saveConfig(db: Sql, cfg: EngineConfig) {
  db.run("INSERT INTO meta (key, value) VALUES ('config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(cfg));
}

export function validateConfig(c: EngineConfig): string[] {
  const errs: string[] = [];
  const ints: (keyof EngineConfig)[] = ['realMsPerTick', 'maxCatchupTicks', 'exchangeFeeBps', 'procurementLimitBps', 'stateSupplyMarkupBps', 'stateSupplyPerTick', 'stateSupplyCap', 'stipendPerThousandMinor', 'civilPayrollBps', 'corporationTaxBps', 'idleCashLevyBps', 'stateBurnBps', 'stateReserveMinor', 'enterpriseReserveMinor', 'insolvencyAfterTicks', 'npcPriceStepBps', 'npcSupportMinor', 'npcPayoutBps', 'npcReserveTicks', 'supplyTargetMinor', 'stipendGainBps'];
  for (const k of ints) if (!Number.isSafeInteger(c[k]) || (c[k] as number) < 0) errs.push(`${k} must be a non-negative safe integer`);
  if (c.exchangeFeeBps > 10_000 || c.civilPayrollBps > 10_000 || c.corporationTaxBps > 10_000 || c.idleCashLevyBps > 10_000 || c.stateBurnBps > 10_000 || c.npcPayoutBps > 10_000) errs.push('basis-point settings must be ≤ 10000');
  if (c.realMsPerTick < 1) errs.push('realMsPerTick must be ≥ 1');
  if (c.maxCatchupTicks < 1) errs.push('maxCatchupTicks must be ≥ 1');
  return errs;
}

/** Game date for a tick (UTC). Tick N happens on epoch + N days; the economy is a pure function of tick number, never wall-clock. */
export function gameDate(cfg: Pick<EngineConfig, 'epochDate'>, tick: number): string {
  return new Date(Date.parse(`${cfg.epochDate}T00:00:00.000Z`) + tick * 86_400_000).toISOString();
}
