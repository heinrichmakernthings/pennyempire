import type { Sql } from '../db/sql';

/** Every tunable rule lives here and is stored in `meta` so a database always carries the rules it was simulated under. */
export interface EngineConfig {
  seed: number;
  epochDate: string;                 // game date of tick 0
  realMsPerTick: number;             // wall-clock length of one economic tick (one in-game day)
  maxCatchupTicks: number;           // after downtime, at most this many ticks are replayed; the rest of the gap is skipped (and logged)
  exchangeFeeBps: number;            // seller-paid fee on every trade; paid to the Penny Exchange (a transfer — see exchangeBurnBps for the explicit burn)
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
  // ── company management ──
  maxCompaniesPerPlayer: number;     // active (non-bankrupt) companies one player may own
  bankruptcyAfterTicks: number;      // insolvent this long without being reopened → bankrupt and liquidated
  stockCoverDays: number;            // production pauses once unsold finished goods reach this many days of planned output (no blind overproduction)
  staffChangesPerDay: number;        // max hires and max dismissals per company per day
  awarenessHalfSpendMinor: number;   // daily marketing spend that earns half of the maximum awareness (diminishing returns)
  awarenessMaxBps: number;           // ceiling on the demand-score bonus advertising can ever buy
  awarenessDecayBps: number;         // share of awareness that fades every day (advertising must be sustained)
  wearBpsPerTick: number;            // equipment condition lost per producing day
  serviceCostBps: number;            // share of the equipment's cost needed to restore it from 0% to 100% condition
  liquidationBps: number;            // price the state pays for a bankrupt company's stock, as a share of its cost basis
  // ── exchange ──
  exchangeBurnBps: number;           // share of the Penny Exchange's fee income destroyed each tick (explicit burn); the rest is swept to the state treasury (a transfer)
  marketSlippageBps: number;         // default price protection for market orders (max distance from the best opposite price)
  maxSlippageBps: number;            // hard ceiling a player may request
  maxOrderTicks: number;             // longest lifetime an order may request (days)
  contractNoticeTicks: number;       // days of notice before a cancellation takes effect
  contractMaxMisses: number;         // consecutive missed deliveries that end a contract
  contractMaxTicks: number;          // longest contract duration (days)
  contractShareBps: number;          // largest share of a supplier's daily output (or a buyer's daily need) one contract may commit
  // ── consumer economy (Living Bristol) ──
  consumerSpendCapBps: number;       // total household spending per tick is at most this share of the households' balance at tick start
  householdBufferDays: number;       // consumption function: households aim to hold this many days of baseline spending as savings (0 disables)
  wealthSpendGainBps: number;        // spending rises by gain × (savings − buffer) / buffer; e.g. 5000 = +50% when savings are twice the buffer
  wealthSpendMinBps: number;         // floor of the savings multiplier on household spending
  wealthSpendMaxBps: number;         // ceiling of the savings multiplier on household spending
  consumerShockBps: number;          // recession switch: spending falls by this share (0 = none); applied on top of consumer confidence
  confidenceMinBps: number; confidenceMaxBps: number; confidenceGainBps: number;   // confidence = 100% + gain × (households' balance − 14-day average) ÷ average, clamped
  exploreBps: number;                // share of every segment's budget spent "exploring": split equally among all sellers with stock, ignoring score
  noveltyMaxBps: number; noveltyDays: number;   // a brand-new company's score bonus, fading to zero over this many days
  loyaltyWeightBps: number; loyaltyGainBps: number; loyaltyDecayBps: number;   // loyal customers add up to `weight` to a seller's score; +gain per day served, −decay per day not
  locPenaltyBpsPerTile: number; locFloorBps: number;   // score lost per map tile of distance from the segment's neighbourhood, never below the floor
  repFloorBps: number; repSpanBps: number; repHalfBps: number;   // reputation term = floor + span × rep ÷ (rep + half): concave, diminishing returns
  marketingWeightBps: number;        // scales the advertising-awareness bonus (itself saturating)
  // ── NPC behaviour ──
  npcDecisionsPerTick: number;       // at most this many NPC strategic reviews per tick (batched, staggered)
  npcDecisionEveryTicks: number;     // default review cadence in days
  npcEntryEveryTicks: number;        // at most one new NPC company per this many days
  npcMaxCompanies: number;           // total non-state NPC companies
  npcMaxPerIndustry: number;         // NPC companies per industry
  npcReservedLots: number;           // vacant lots always left for players
  npcEntryCapitalMinor: number;      // finite capital an NPC entrepreneur brings (paid from the NPC shareholders' households)
  npcEntryHouseholdFloorMinor: number;   // entrepreneurs only invest while households hold more than this
  npcExitEveryTicks: number;         // at most one voluntary NPC closure per this many days
  npcExitRunwayDays: number;          // an NPC only quits voluntarily when its cash covers fewer than this many days of fixed costs
  npcMinProfitForEntryMinor: number;
  energyCapacityPerThousandPop: number; // energy units a day the grid can supply per 1,000 residents
  energyTariffLoadStartBps: number; // grid utilisation at which the tariff starts to rise
  energyTariffMaxSurchargeBps: number; // largest load surcharge on the energy tariff
  stateServiceBurnBps: number; // share of a state service provider's daily service revenue burned as infrastructure wear (explicit sink)
  propertyServiceChargeBps: number; // service charge on NEW leases, as a share of rent (existing leases keep 0: grandfathered)
  propertyBuyMultiple: number; // purchase price of premises, in days of rent
  propertyOwnedRatesBps: number; // daily rates paid by an owner-occupier, as a share of the former rent
  logisticsRatePerUnitMinor: number; // delivery fee per unit per distance step
  logisticsBaseFeeMinor: number; // minimum delivery fee per shipment
  logisticsPerTileBps: number; // delivery fee increase per map tile of distance
  logisticsCapacityUnits: number; // units the Bristol fleet can move per day before shipments queue
  logisticsMaxFeeBps: number; // delivery fee never exceeds this share of the goods value
  bankSeedMinor: number; // opening capital of National Bank (recorded issuance)
  loanMaxTermDays: number; // longest loan
  loanMaxMinor: number; // largest single loan
  loanOriginationFeeBps: number; // origination fee
  loanLateFeeBps: number; // late fee on a missed instalment
  loanDefaultAfterMisses: number; // consecutive missed instalments before default
  loanMaxActive: number; // open loans per company
  creditSpreadABps: number; // rate spread over the base rate for grade A (per 30 days)
  creditSpreadBBps: number; // spread for grade B
  creditSpreadCBps: number; // spread for grade C
  depositSpreadBps: number; // deposit rate = base rate minus this
  creditMultipleA: number; // credit limit multiple of average daily profit, grade A
  creditMultipleB: number; // grade B
  creditMultipleC: number; // grade C
  cbBaseRateBps: number; // opening base interest rate, per 30 days
  cbTargetBps: number; // inflation target, per 30 days
  cbReviewEveryTicks: number; // days between rate reviews
  cbRateStepBps: number; // size of one rate move
  cbRateMaxBps: number; // highest permitted base rate
  cbBandBps: number; // tolerance around the inflation target before the bank acts
  cbLiquidityStepMinor: number; // liquidity the central bank may add to the banking system in one review
  cbDrainStepMinor: number; // liquidity it may withdraw in one review
  cbReserveReqBps: number; // share of deposits the National Bank must keep as cash
  eventsEnabled: number; // 1 = random economic events on
  eventsStartTick: number; // first day events can occur
  eventCheckEveryTicks: number; // days between event rolls
  eventMaxActive: number; // most events active at once
  eventCooldownTicks: number; // days before the same event type can recur
  eventProbabilityScaleBps: number; // scales every event probability (10000 = documented table)
  cpiWindowTicks: number; // days over which inflation is measured
  shareFeeBps: number; // fee on share trades, charged to the seller and transferred to the Penny Exchange
  shareBandBps: number; // daily price band around the previous close
  shareRefStaleTicks: number; // days after which a close stops anchoring the band
  shareMaxOrderTicks: number; // longest life of a share order
  listingMinAgeTicks: number; // days a company must have traded before listing
  listingMinRevenue7Minor: number; // 7-day revenue needed to list
  listingMinEquityMinor: number; // book equity needed to list
  listingBaseFeeMinor: number; // flat listing fee
  listingFeeBps: number; // listing fee as a share of offering value
  listingMinFounderBps: number; // existing holders keep at least this share after a full placement
  listingMaxNewSharesBps: number; // new shares per offering vs shares already issued
  listingPriceLowBps: number; // offer price floor vs fundamental estimate
  listingPriceHighBps: number; // offer price ceiling vs fundamental estimate
  followOnCooldownTicks: number; // days between offerings
  dividendMinGapTicks: number; // days between dividend declarations
  dividendPayDelayTicks: number; // days from record date to payment
  dividendReserveDays: number; // days of fixed costs kept after a dividend
  valuationHorizonDays: number; // days of maintainable earnings in the fundamental estimate
  valuationRiskMaxBps: number; // largest risk discount
  exchangeOpensTick: number; // the day the Penny Exchange opens its first listings (after enough trading history exists to value them)
  npcInvestorCount: number; // NPC market participants
  npcInvestorSeedMinor: number; // seed capital per NPC investor (recorded issuance)
  npcInvestorEveryTicks: number; // days between NPC investor reviews
  npcInvestorSpendBps: number; // daily share of an NPC investor's cash above its seed capital spent back into the city (returned to households)
  npcInvestorOrderBps: number; // largest share of cash per NPC order
  holderFloatBps: number; // free float a founding NPC/state holder keeps on offer
  holderPayoutBps: number; // share of surplus cash declared as dividend by listed NPC/state companies
  dividendEveryTicks: number; // days between dividend reviews of listed NPC/state companies // forecast daily profit an industry must offer before an NPC enters
  qualityInputBps: { basic: number; standard: number; premium: number };   // ingredient use per batch by quality grade
}

export const DEFAULT_CONFIG: EngineConfig = {
  seed: 20261029, epochDate: '2026-10-29', realMsPerTick: 600_000, maxCatchupTicks: 48,
  exchangeFeeBps: 100, procurementLimitBps: 15_000, stateSupplyMarkupBps: 14_000, stateSupplyPerTick: 120, stateSupplyCap: 400,
  stipendPerThousandMinor: 120, civilPayrollBps: 500, corporationTaxBps: 1_500, idleCashLevyBps: 10, stateBurnBps: 100, stateReserveMinor: 2_000_000, enterpriseReserveMinor: 300_000,
  insolvencyAfterTicks: 3, npcPriceStepBps: 150, npcSupportMinor: 0, npcPayoutBps: 8_000, npcReserveTicks: 10, supplyTargetMinor: 0, stipendGainBps: 100_000, energyCommodityId: 'energy',
  maxCompaniesPerPlayer: 6, bankruptcyAfterTicks: 10, staffChangesPerDay: 3, stockCoverDays: 5, awarenessHalfSpendMinor: 6_000, awarenessMaxBps: 4_000, awarenessDecayBps: 500, wearBpsPerTick: 20, serviceCostBps: 3_000, liquidationBps: 5_000, exchangeBurnBps: 2_500, consumerSpendCapBps: 10_000, householdBufferDays: 15, wealthSpendGainBps: 5_000, wealthSpendMinBps: 7_000, wealthSpendMaxBps: 18_000, consumerShockBps: 0, confidenceMinBps: 7_000, confidenceMaxBps: 12_000, confidenceGainBps: 20_000, exploreBps: 1_000, noveltyMaxBps: 3_000, noveltyDays: 30, loyaltyWeightBps: 5_000, loyaltyGainBps: 300, loyaltyDecayBps: 150, locPenaltyBpsPerTile: 120, locFloorBps: 6_000, repFloorBps: 7_000, repSpanBps: 6_000, repHalfBps: 5_000, marketingWeightBps: 10_000, npcDecisionsPerTick: 6, npcDecisionEveryTicks: 3, npcEntryEveryTicks: 10, npcMaxCompanies: 14, npcMaxPerIndustry: 2, npcReservedLots: 5, npcEntryCapitalMinor: 450_000, npcEntryHouseholdFloorMinor: 1_200_000, npcExitEveryTicks: 5, npcExitRunwayDays: 10, npcMinProfitForEntryMinor: 2_000, energyCapacityPerThousandPop: 8, energyTariffLoadStartBps: 8000, energyTariffMaxSurchargeBps: 6000, stateServiceBurnBps: 200, propertyServiceChargeBps: 800, propertyBuyMultiple: 60, propertyOwnedRatesBps: 2000, logisticsRatePerUnitMinor: 1, logisticsBaseFeeMinor: 20, logisticsPerTileBps: 300, logisticsCapacityUnits: 6000, logisticsMaxFeeBps: 2000, bankSeedMinor: 2_500_000, loanMaxTermDays: 90, loanMaxMinor: 600_000, loanOriginationFeeBps: 100, loanLateFeeBps: 200, loanDefaultAfterMisses: 5, loanMaxActive: 3, creditSpreadABps: 100, creditSpreadBBps: 250, creditSpreadCBps: 500, depositSpreadBps: 100, creditMultipleA: 40, creditMultipleB: 25, creditMultipleC: 12, cbBaseRateBps: 200, cbTargetBps: 100, cbReviewEveryTicks: 14, cbRateStepBps: 25, cbRateMaxBps: 1500, cbBandBps: 100, cbLiquidityStepMinor: 200_000, cbDrainStepMinor: 200_000, cbReserveReqBps: 1000, eventsEnabled: 1, eventsStartTick: 30, eventCheckEveryTicks: 3, eventMaxActive: 2, eventCooldownTicks: 25, eventProbabilityScaleBps: 10_000, cpiWindowTicks: 30, shareFeeBps: 50, shareBandBps: 2000, shareRefStaleTicks: 10, shareMaxOrderTicks: 60, listingMinAgeTicks: 14, listingMinRevenue7Minor: 100_000, listingMinEquityMinor: 100_000, listingBaseFeeMinor: 5000, listingFeeBps: 100, listingMinFounderBps: 5100, listingMaxNewSharesBps: 10_000, listingPriceLowBps: 5000, listingPriceHighBps: 20_000, followOnCooldownTicks: 30, dividendMinGapTicks: 3, dividendPayDelayTicks: 1, dividendReserveDays: 10, valuationHorizonDays: 60, valuationRiskMaxBps: 3000, exchangeOpensTick: 7, npcInvestorCount: 6, npcInvestorSeedMinor: 150_000, npcInvestorEveryTicks: 2, npcInvestorOrderBps: 1500, npcInvestorSpendBps: 800, holderFloatBps: 3000, holderPayoutBps: 8000, dividendEveryTicks: 7, marketSlippageBps: 500, maxSlippageBps: 2_000, maxOrderTicks: 60, contractNoticeTicks: 3, contractMaxMisses: 3, contractMaxTicks: 90, contractShareBps: 5_000, qualityInputBps: { basic: 9_000, standard: 10_000, premium: 12_500 },
};

export function loadConfig(db: Sql): EngineConfig {
  const row = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'config'");
  return { ...DEFAULT_CONFIG, ...(row ? (JSON.parse(row.value) as Partial<EngineConfig>) : {}) };
}
/** Persists the rules and records every change as a numbered, timestamped version, so a database can always say which tuning it was simulated under. */
export function saveConfig(db: Sql, cfg: EngineConfig, note = 'config saved') {
  const json = JSON.stringify(cfg);
  const prev = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'config'");
  db.run("INSERT INTO meta (key, value) VALUES ('config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", json);
  if (prev?.value !== json && db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'config_versions'")) {
    const tick = db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')?.t ?? 0;
    db.run('INSERT INTO config_versions (tick, note, config_json) VALUES (?,?,?)', tick, note, json);
  }
}

export function validateConfig(c: EngineConfig): string[] {
  const errs: string[] = [];
  const ints: (keyof EngineConfig)[] = ['realMsPerTick', 'maxCatchupTicks', 'exchangeFeeBps', 'procurementLimitBps', 'stateSupplyMarkupBps', 'stateSupplyPerTick', 'stateSupplyCap', 'stipendPerThousandMinor', 'civilPayrollBps', 'corporationTaxBps', 'idleCashLevyBps', 'stateBurnBps', 'stateReserveMinor', 'enterpriseReserveMinor', 'insolvencyAfterTicks', 'npcPriceStepBps', 'npcSupportMinor', 'npcPayoutBps', 'npcReserveTicks', 'supplyTargetMinor', 'stipendGainBps', 'maxCompaniesPerPlayer', 'bankruptcyAfterTicks', 'staffChangesPerDay', 'stockCoverDays', 'awarenessHalfSpendMinor', 'awarenessMaxBps', 'awarenessDecayBps', 'wearBpsPerTick', 'serviceCostBps', 'liquidationBps', 'exchangeBurnBps', 'marketSlippageBps', 'maxSlippageBps', 'maxOrderTicks', 'contractNoticeTicks', 'contractMaxMisses', 'contractMaxTicks', 'contractShareBps', 'consumerSpendCapBps', 'householdBufferDays', 'wealthSpendGainBps', 'wealthSpendMinBps', 'wealthSpendMaxBps', 'consumerShockBps', 'confidenceMinBps', 'confidenceMaxBps', 'confidenceGainBps', 'exploreBps', 'noveltyMaxBps', 'noveltyDays', 'loyaltyWeightBps', 'loyaltyGainBps', 'loyaltyDecayBps', 'locPenaltyBpsPerTile', 'locFloorBps', 'repFloorBps', 'repSpanBps', 'repHalfBps', 'marketingWeightBps', 'npcDecisionsPerTick', 'npcDecisionEveryTicks', 'npcEntryEveryTicks', 'npcMaxCompanies', 'npcMaxPerIndustry', 'npcReservedLots', 'npcEntryCapitalMinor', 'npcEntryHouseholdFloorMinor', 'npcExitEveryTicks', 'npcExitRunwayDays', 'npcMinProfitForEntryMinor', 'energyCapacityPerThousandPop', 'energyTariffLoadStartBps', 'energyTariffMaxSurchargeBps', 'stateServiceBurnBps', 'propertyServiceChargeBps', 'propertyBuyMultiple', 'propertyOwnedRatesBps', 'logisticsRatePerUnitMinor', 'logisticsBaseFeeMinor', 'logisticsPerTileBps', 'logisticsCapacityUnits', 'logisticsMaxFeeBps', 'bankSeedMinor', 'loanMaxTermDays', 'loanMaxMinor', 'loanOriginationFeeBps', 'loanLateFeeBps', 'loanDefaultAfterMisses', 'loanMaxActive', 'creditSpreadABps', 'creditSpreadBBps', 'creditSpreadCBps', 'depositSpreadBps', 'creditMultipleA', 'creditMultipleB', 'creditMultipleC', 'cbBaseRateBps', 'cbTargetBps', 'cbReviewEveryTicks', 'cbRateStepBps', 'cbRateMaxBps', 'cbBandBps', 'cbLiquidityStepMinor', 'cbDrainStepMinor', 'cbReserveReqBps', 'eventsEnabled', 'eventsStartTick', 'eventCheckEveryTicks', 'eventMaxActive', 'eventCooldownTicks', 'eventProbabilityScaleBps', 'cpiWindowTicks', 'shareFeeBps', 'shareBandBps', 'shareRefStaleTicks', 'shareMaxOrderTicks', 'listingMinAgeTicks', 'listingMinRevenue7Minor', 'listingMinEquityMinor', 'listingBaseFeeMinor', 'listingFeeBps', 'listingMinFounderBps', 'listingMaxNewSharesBps', 'listingPriceLowBps', 'listingPriceHighBps', 'followOnCooldownTicks', 'dividendMinGapTicks', 'dividendPayDelayTicks', 'dividendReserveDays', 'valuationHorizonDays', 'valuationRiskMaxBps', 'exchangeOpensTick', 'npcInvestorCount', 'npcInvestorSeedMinor', 'npcInvestorEveryTicks', 'npcInvestorOrderBps', 'npcInvestorSpendBps', 'holderFloatBps', 'holderPayoutBps', 'dividendEveryTicks'];
  for (const k of ints) if (!Number.isSafeInteger(c[k]) || (c[k] as number) < 0) errs.push(`${k} must be a non-negative safe integer`);
  if (c.exchangeFeeBps > 10_000 || c.civilPayrollBps > 10_000 || c.corporationTaxBps > 10_000 || c.idleCashLevyBps > 10_000 || c.stateBurnBps > 10_000 || c.npcPayoutBps > 10_000 || c.exchangeBurnBps > 10_000 || c.contractShareBps > 10_000 || c.consumerSpendCapBps > 10_000 || c.consumerShockBps > 10_000 || c.exploreBps > 10_000) errs.push('basis-point settings must be ≤ 10000');
  if (c.wealthSpendMinBps > c.wealthSpendMaxBps) errs.push('wealthSpendMinBps must be ≤ wealthSpendMaxBps');
  if (c.realMsPerTick < 1) errs.push('realMsPerTick must be ≥ 1');
  if (c.maxCatchupTicks < 1) errs.push('maxCatchupTicks must be ≥ 1');
  return errs;
}

/** Game date for a tick (UTC). Tick N happens on epoch + N days; the economy is a pure function of tick number, never wall-clock. */
export function gameDate(cfg: Pick<EngineConfig, 'epochDate'>, tick: number): string {
  return new Date(Date.parse(`${cfg.epochDate}T00:00:00.000Z`) + tick * 86_400_000).toISOString();
}
