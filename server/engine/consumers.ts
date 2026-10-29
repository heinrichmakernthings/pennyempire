import { currentMods } from './economyState';
import type { Sql } from '../db/sql';
import { gameDate, type EngineConfig } from './config';
import { allocateByWeights, powBps, type WeightedSeller } from './demand';
import { freeStock, removeStock } from './inventory';
import { available, type LedgerKind, type TickCtx } from './ledger';
import { logEvent } from './stats';
import type { CompanyRow } from './operations';

export interface Segment { id: string; district_id: string | null; name: string; population_bps: number; income_bps: number; price_sens_delta: number; quality_pref_bps: number; loyalty_trait_bps: number; center_col: number; center_row: number }
export interface DemandRule { id: string; label: string; commodity_id: string; funder_account_id: string; mode: 'pool_share' | 'fixed'; amount: number; payment_kind: 'consumer_sale' | 'state_payment'; goods_reason: 'consumer_purchase' | 'public_works'; price_sensitivity: number; per_thousand_minor: number; confidence_exposure_bps: number; seasonality: string | null; segmented: number }

/** One "virtual" segment used for budgets that are not household spending (e.g. the council's public works): neutral on every dimension. */
export const CITY_SEGMENT: Segment = { id: 'seg-city', district_id: null, name: 'Council procurement', population_bps: 10_000, income_bps: 10_000, price_sens_delta: 0, quality_pref_bps: 5_000, loyalty_trait_bps: 0, center_col: -1, center_row: -1 };

/** Monthly factor for a rule on a game date, normalised so the twelve months average exactly 100%. */
export function seasonBps(seasonality: string | null, isoDate: string): number {
  if (!seasonality) return 10_000;
  const m = JSON.parse(seasonality) as number[];
  const mean = m.reduce((a, b) => a + b, 0) / m.length;
  return Math.round((m[new Date(isoDate).getUTCMonth()]! * 10_000) / mean);
}

/** Consumer confidence: 100% when households hold their recent average; falls when their money drains, rises when it builds. Clamped. */
export function confidenceFor(cfg: EngineConfig, balance: number, avg: number): number {
  if (avg <= 0) return 10_000;
  const raw = 10_000 + Math.trunc(((balance - avg) * cfg.confidenceGainBps) / avg);
  return Math.max(cfg.confidenceMinBps, Math.min(cfg.confidenceMaxBps, raw));
}

/** Records this tick's household balance and returns (confidence, shock). Called once per tick, before spending. */
export function consumerClimate(db: Sql, cfg: EngineConfig, tick: number, householdsBalance: number): { confidenceBps: number; shockBps: number } {
  const avg = db.get<{ a: number | null }>('SELECT AVG(households_minor) a FROM (SELECT households_minor FROM consumer_state WHERE tick < ? ORDER BY tick DESC LIMIT 14)', tick)?.a ?? null;
  const confidence = confidenceFor(cfg, householdsBalance, Math.round(avg ?? householdsBalance));
  const shock = cfg.consumerShockBps + currentMods(db).demandShockBps;   // configured shock plus any active economic event (recession +, boom −)
  db.run('INSERT OR REPLACE INTO consumer_state (tick, households_minor, households_avg_minor, confidence_bps, shock_bps) VALUES (?,?,?,?,?)', tick, householdsBalance, Math.round(avg ?? householdsBalance), confidence, shock);
  return { confidenceBps: confidence, shockBps: shock };
}

/** The budget consumers WOULD like to spend on a rule today, before the funder's balance caps it. */
export function potentialBudget(_cfg: EngineConfig, rule: DemandRule, population: number, climate: { confidenceBps: number; shockBps: number }, isoDate: string): { potential: number; seasonBps: number } {
  const season = seasonBps(rule.seasonality, isoDate);
  if (rule.per_thousand_minor <= 0) return { potential: rule.amount, seasonBps: 10_000 };
  const exposure = rule.confidence_exposure_bps;
  const conf = 10_000 + Math.trunc(((climate.confidenceBps - 10_000) * exposure) / 10_000);
  const shock = 10_000 - Math.trunc((climate.shockBps * exposure) / 10_000);
  let b = Math.floor((population / 1_000) * rule.per_thousand_minor);
  b = Math.floor((b * season) / 10_000); b = Math.floor((b * conf) / 10_000); b = Math.floor((b * shock) / 10_000);
  return { potential: b, seasonBps: season };
}

export interface ConsumerSeller { id: string; price: number; stock: number; quality: CompanyRow['quality']; reputationBps: number; awarenessBps: number; ageTicks: number; distance: number; loyaltyBps: number }
const GRADE_BPS = { basic: 8_000, standard: 10_000, premium: 13_000 } as const;

/** Transparent attractiveness of a seller to one segment (all integer): (ref/price)^sensitivity × quality × reputation × advertising × location × loyalty × newcomer bonus. */
export function segmentScore(cfg: EngineConfig, seg: Segment, sens: number, ref: number, s: ConsumerSeller): number {
  const ratioPpm = Math.floor((ref * 1_000_000) / s.price);
  let w = ratioPpm;
  for (let i = 1; i < sens; i++) w = Math.floor((w * ratioPpm) / 1_000_000);
  const step = (term: number) => { w = Math.floor((w * term) / 10_000); };
  step(10_000 + Math.trunc(((GRADE_BPS[s.quality] - 10_000) * seg.quality_pref_bps) / 5_000));                         // quality, weighted by what this segment cares about
  step(cfg.repFloorBps + Math.floor((cfg.repSpanBps * s.reputationBps) / (s.reputationBps + cfg.repHalfBps)));         // reputation: concave, diminishing
  step(10_000 + Math.floor((s.awarenessBps * cfg.marketingWeightBps) / 10_000));                                       // advertising awareness (itself saturating)
  step(seg.center_col < 0 ? 10_000 : Math.max(cfg.locFloorBps, 10_000 - s.distance * cfg.locPenaltyBpsPerTile));        // location
  step(10_000 + Math.floor((cfg.loyaltyWeightBps * s.loyaltyBps * seg.loyalty_trait_bps) / 100_000_000));              // loyal customers of loyal segments
  step(10_000 + Math.floor((cfg.noveltyMaxBps * Math.max(0, cfg.noveltyDays - s.ageTicks)) / Math.max(1, cfg.noveltyDays)));   // newcomer curiosity
  return Math.max(1, w);
}

export interface SegmentResult { allocations: { id: string; units: number; spend: number }[]; unitsWanted: number; unitsSold: number }
/** One segment's purchases: (1 − explore) of its budget follows the scores; `exploreBps` of it is spent sampling every seller with stock equally. */
export function allocateSegment(cfg: EngineConfig, seg: Segment, sens: number, ref: number, budget: number, sellers: ConsumerSeller[]): SegmentResult {
  const explore = Math.floor((budget * cfg.exploreBps) / 10_000), main = budget - explore;
  const r1 = allocateByWeights(main, ref, sens, sellers.map((s): WeightedSeller => ({ id: s.id, price: s.price, stock: s.stock, weight: segmentScore(cfg, seg, sens, ref, s) })));
  const left = sellers.map((s, i) => ({ id: s.id, price: s.price, stock: s.stock - r1.allocations[i]!.units, weight: 10_000 }));
  const r2 = allocateByWeights(explore, ref, sens, left);
  return { allocations: sellers.map((s, i) => ({ id: s.id, units: r1.allocations[i]!.units + r2.allocations[i]!.units, spend: r1.allocations[i]!.spend + r2.allocations[i]!.spend })), unitsWanted: r1.unitsWanted + r2.unitsWanted, unitsSold: r1.unitsSold + r2.unitsSold };
}

export interface PhaseDeps {
  order: CompanyRow[]; byId: Map<string, CompanyRow>; refPrice: (commodity: string) => number; cityId: string; population: number; householdsAccount: string;
  st: (id: string) => { revenue: number; cogs: number; unitsSold: number; demanded: number; stockedOut: boolean };
  pay: (kind: Exclude<LedgerKind, 'issuance' | 'sink' | 'sink_fee'>, from: string, to: string, amount: number, memo: string) => void;
  safe: (kind: string, subject: string, fn: () => void) => void;
}

/**
 * Tick phase G. For each demand rule: potential budget (population × per-capita spend × season × confidence × shock) → capped by the funder's real balance →
 * split across neighbourhood segments by population × purchasing power → each segment's customers choose among sellers that really hold stock →
 * money moves funder → seller through the ledger and units leave inventory. Segments are served in a rotating order so nobody always shops first.
 */
export function runConsumers(db: Sql, ctx: TickCtx, cfg: EngineConfig, deps: PhaseDeps): { spend: number; unmet: number } {
  const rules = db.all<DemandRule>('SELECT * FROM demand_rules WHERE city_id = ? ORDER BY id', deps.cityId);
  const segments = db.all<Segment>('SELECT * FROM consumer_segments WHERE city_id = ? ORDER BY id', deps.cityId);
  const hh = available(db, deps.householdsAccount);
  const climate = consumerClimate(db, cfg, ctx.tick, hh);
  const date = gameDate(cfg, ctx.tick);
  const plotPos = new Map(db.all<{ id: string; col: number; row: number }>('SELECT id, col, row FROM plots WHERE width > 1 OR depth > 1').map((p) => [p.id, p]));
  const loyalty = new Map(db.all<{ company_id: string; segment_id: string; loyalty_bps: number }>('SELECT * FROM customer_loyalty').map((l) => [`${l.company_id}|${l.segment_id}`, l.loyalty_bps]));
  const startBal = new Map<string, number>(); for (const r of rules) if (!startBal.has(r.funder_account_id)) startBal.set(r.funder_account_id, available(db, r.funder_account_id));
  const householdCap = Math.floor((hh * cfg.consumerSpendCapBps) / 10_000); let householdCommitted = 0;
  const committed = new Map<string, number>();
  let totalSpend = 0, totalUnmet = 0;
  const rot = segments.length ? ctx.tick % segments.length : 0;
  for (const r of rules) {
    const base = startBal.get(r.funder_account_id)!;
    const { potential, seasonBps: season } = potentialBudget(cfg, r, deps.population, climate, date);
    const wantRaw = r.per_thousand_minor > 0 ? potential : r.mode === 'pool_share' ? Math.floor((base * r.amount) / 10_000) : potential;
    const want = r.per_thousand_minor > 0 ? Math.floor((wantRaw * (currentMods(db).demandByCommodity[r.commodity_id] ?? 10_000)) / 10_000) : wantRaw;   // event: commodity-specific demand (tourism, construction)
    const isHouseholdFunded = r.funder_account_id === deps.householdsAccount;
    const capLeft = isHouseholdFunded ? Math.max(0, householdCap - householdCommitted) : Number.MAX_SAFE_INTEGER;
    const budget = Math.max(0, Math.min(want, capLeft, base - (committed.get(r.funder_account_id) ?? 0), available(db, r.funder_account_id)));
    committed.set(r.funder_account_id, (committed.get(r.funder_account_id) ?? 0) + budget);
    if (isHouseholdFunded) householdCommitted += budget;
    const ref = deps.refPrice(r.commodity_id);
    const sellers = deps.order.filter((c) => c.status === 'operating' && c.retail_commodity_id === r.commodity_id);
    for (const c of sellers) if (freeStock(db, c.id, r.commodity_id) === 0) deps.st(c.id).stockedOut = true;
    const segs = r.segmented ? [...segments.slice(rot), ...segments.slice(0, rot)] : [CITY_SEGMENT];
    const weightSum = (r.segmented ? segments : [CITY_SEGMENT]).reduce((a, s) => a + Math.floor((s.population_bps * s.income_bps) / 10_000), 0);
    const stockLeft = new Map(sellers.map((c) => [c.id, freeStock(db, c.id, r.commodity_id)]));
    let spent = 0, sold = 0, wanted = 0, allocatedBudget = 0;
    for (const seg of segs) {
      const segBudget = r.segmented ? Math.floor((budget * Math.floor((seg.population_bps * seg.income_bps) / 10_000)) / weightSum) : budget;
      allocatedBudget += segBudget;
      const sens = Math.max(1, Math.min(4, r.price_sensitivity + seg.price_sens_delta));
      const live = sellers.filter((c) => (stockLeft.get(c.id) ?? 0) > 0);
      const cs: ConsumerSeller[] = live.map((c) => {
        const p = plotPos.get(c.plot_id ?? '');
        return { id: c.id, price: c.price_minor, stock: stockLeft.get(c.id)!, quality: c.quality, reputationBps: c.reputation_bps, awarenessBps: c.awareness_bps, ageTicks: Math.max(0, ctx.tick - (c as unknown as { created_tick: number }).created_tick),
          distance: p && seg.center_col >= 0 ? Math.abs(p.col - seg.center_col) + Math.abs(p.row - seg.center_row) : 0, loyaltyBps: loyalty.get(`${c.id}|${seg.id}`) ?? 0 };
      });
      const res = segBudget > 0 && cs.length ? allocateSegment(cfg, seg, sens, ref, segBudget, cs) : { allocations: [], unitsWanted: segBudget > 0 ? Math.floor(segBudget / ref) : 0, unitsSold: 0 };
      wanted += res.unitsWanted;
      const avgPrice = cs.length ? Math.floor(cs.reduce((a, s) => a + s.price, 0) / cs.length) : 0;
      for (const a of res.allocations) {
        const c = deps.byId.get(a.id)!;
        deps.st(c.id).demanded += Math.floor(res.unitsWanted / Math.max(1, cs.length));
        if (a.units <= 0) continue;
        deps.safe('consumer_sale', c.id, () => {
          deps.pay(r.payment_kind, r.funder_account_id, c.treasury_account_id, a.spend, `${a.units} ${r.commodity_id} to ${r.id}`);
          const cost = removeStock(db, ctx, c.id, r.commodity_id, a.units, r.goods_reason, `${r.id}:${seg.id}`);
          const s = deps.st(c.id); s.revenue += a.spend; s.cogs += cost; s.unitsSold += a.units; spent += a.spend; sold += a.units;
          stockLeft.set(c.id, (stockLeft.get(c.id) ?? 0) - a.units);
          db.run('INSERT INTO segment_sales (tick, segment_id, rule_id, company_id, units, spend_minor, budget_minor) VALUES (?,?,?,?,?,?,?) ON CONFLICT(tick, segment_id, rule_id, company_id) DO UPDATE SET units = units + excluded.units, spend_minor = spend_minor + excluded.spend_minor', ctx.tick, seg.id, r.id, c.id, a.units, a.spend, segBudget);
        });
      }
      // loyalty: customers return to sellers that served them at a fair price and drift away from sellers that were out of stock or overpriced
      if (r.segmented) for (const c of sellers) {
        const key = `${c.id}|${seg.id}`, cur = loyalty.get(key) ?? 0;
        const got = res.allocations.find((x) => x.id === c.id)?.units ?? 0;
        const next = got > 0 && c.price_minor <= Math.floor((avgPrice * 11_500) / 10_000) ? Math.min(10_000, cur + cfg.loyaltyGainBps) : Math.max(0, cur - cfg.loyaltyDecayBps * ((stockLeft.get(c.id) ?? 0) === 0 ? 2 : 1));
        if (next !== cur || loyalty.has(key)) { loyalty.set(key, next); db.run('INSERT INTO customer_loyalty (company_id, segment_id, loyalty_bps) VALUES (?,?,?) ON CONFLICT(company_id, segment_id) DO UPDATE SET loyalty_bps = excluded.loyalty_bps', c.id, seg.id, next); }
      }
    }
    void allocatedBudget;
    totalSpend += spent; totalUnmet += Math.max(0, wanted - sold);
    db.run('INSERT INTO demand_tick_stats (tick, rule_id, budget_minor, spent_minor, units_wanted, units_sold, unmet_units) VALUES (?,?,?,?,?,?,?)', ctx.tick, r.id, budget, spent, wanted, sold, Math.max(0, wanted - sold));
    db.run('INSERT INTO consumer_budget_log (tick, rule_id, potential_minor, funded_minor, spent_minor, units_wanted, units_sold, confidence_bps, season_bps) VALUES (?,?,?,?,?,?,?,?,?)', ctx.tick, r.id, want, budget, spent, wanted, sold, climate.confidenceBps, season);
    if (wanted > 0 && sold * 10 < wanted * 7) logEvent(db, ctx.tick, 'shortage', 'warning', r.commodity_id, `${r.label}: only ${sold} of ${wanted} units could be served`, { rule: r.id, wanted, sold });
  }
  void powBps;
  return { spend: totalSpend, unmet: totalUnmet };
}
