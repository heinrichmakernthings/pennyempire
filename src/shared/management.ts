/** Wire types for the company-management endpoints. Shared by the server (which builds them) and the UI (which renders them). */
type Sells = 'consumers' | 'state' | 'businesses';

export interface Opportunity {
  industry: string; label: string; tagline: string; sells: Sells;
  /** Everything under `forecast` is an ESTIMATE from the last week of real simulation data, not a promise. */
  forecast: { label: 'FORECAST'; unitsPerDay: number; pricePerUnitMinor: number; revenueMinor: number; inputsMinor: number; energyMinor: number; wagesMinor: number; rentMinor: number; feesMinor: number; profitMinor: number; marginBps: number; paybackDays: number | null };
  startup: { totalMinor: number; licenceMinor: number; premisesMinor: number; equipmentMinor: number; workingCapitalMinor: number };
  market: { demandUnitsPerDay: number; supplyUnitsPerDay: number; unmetUnitsPerDay: number; saturationBps: number; competitors: number; leaderUnitsPerDay: number; referencePriceMinor: number };
  inputs: { commodityId: string; unitsPerDay: number; unitPriceMinor: number; availableUnits: number; stateFallback: boolean }[];
  risk: 'low' | 'medium' | 'high'; score: number; headline: string; reasons: string[]; warnings: string[];
  tiers: { tier: number; name: string; fitoutMinor: number; capacity: number; staff: number }[];
}

export interface LotInfo { id: string; column: number; row: number; width: number; depth: number; district: string; districtName: string; propertyIndexBps: number; status: 'vacant' | 'taken'; fits: string[]; rentFrom: Record<string, number> }

export interface RankRow { rank: number; companyId: string; name: string; unitsPerDay: number; shareBps: number; reputationBps: number; priceMinor: number; mine: boolean }

export interface Ranking { industry: string; label: string; total: number; unitsPerDay: number; rows: RankRow[] }

export interface Management {
  companyId: string; rank: { rank: number; of: number; label: string } | null;
  diagnosis: { kind: 'good' | 'warn' | 'bad'; text: string }[];
  staff: { employees: number; max: number; needed: number; wagePerDayMinor: number; changesLeftToday: { hire: number; dismiss: number }; changeFeeMinor: number };
  equipment: { conditionBps: number; serviceCostMinor: number; capacityFactorBps: number; wearBpsPerDay: number };
  production: { recipeId: string; plannedBatches: number; effectiveBatches: number; outputUnits: number; outputPerBatch: number; log: { tick: number; gameDate: string; planned: number; produced: number; limitedBy: string; outputUnits: number }[]; limitedBy: string | null };
  supplyChain: { commodityId: string; perBatch: number; inStock: number; forSale: number; bestAskMinor: number | null; stateFallbackMinor: number | null }[];
  advertising: { spendPerDayMinor: number; awarenessBps: number; maxAwarenessBps: number };
  quality: { current: string; inputMultiplierBps: Record<string, number> };
  upgrades: { id: string; name: string; description: string; kind: string; costMinor: number; effect: string; installed: boolean; blocker: string | null; affordable: boolean }[];
  autoProcure: boolean; premisesTier: number; tierName: string; assetId: string; closed: { bankrupt: boolean; writtenOffMinor: number } | null;
}

export interface StartupLine { kind: 'licence' | 'premises' | 'equipment' | 'working_capital'; label: string; amountMinor: number; paidTo: string; note: string }

export interface StartupQuote {
  ok: boolean; industry: string; plotId: string; tier: number; lines: StartupLine[]; totalMinor: number; walletAvailableMinor: number; shortfallMinor: number;
  workingCapitalMinMinor: number; workingCapitalDefaultMinor: number; issues: { field: string; message: string }[];
  running: { rentPerDayMinor: number; wagesPerDayMinor: number; staff: number; maxStaff: number; capacityBatches: number; storageUnits: number; assetId: string };
}
