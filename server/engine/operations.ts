import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { freeStock, stock } from './inventory';
import type { TickCtx } from './ledger';
import { depth, placeOrder, type FillEvent } from './market';

/** The company columns the production system reads. Loaded with SELECT * so new columns flow through. */
export interface CompanyRow {
  id: string; name: string; city_id: string; industry_id: string; owner_kind: 'player' | 'npc' | 'state'; owner_id: string; treasury_account_id: string; status: 'operating' | 'paused' | 'insolvent';
  retail_commodity_id: string | null; price_minor: number; min_price_minor: number; max_price_minor: number; quality: 'basic' | 'standard' | 'premium'; employees: number; max_employees: number; wage_minor: number; capacity_batches: number;
  storage_cap_units: number; property_minor: number; marketing_minor: number; reputation_bps: number; unpaid_minor: number; shortfall_ticks: number; revision: number;
  premises_tier: number; productivity_bps: number; energy_saving_bps: number; condition_bps: number; awareness_bps: number; equipment_cost_minor: number; pending_labour_minor: number; pending_maintenance_minor: number;
  staff_change_tick: number; hires_in_tick: number; dismissals_in_tick: number; auto_procure: number; insolvent_tick: number | null; bankrupt_tick: number | null; written_off_minor: number; plot_id: string | null; lot_id: string | null; asset_id: string | null;
}
export interface Line { company_id: string; recipe_id: string; planned_batches: number; ask_price_minor: number; output_commodity_id: string; output_units: number; energy_units: number; ref_price: number }
export type LimitReason = 'plan' | 'staff' | 'storage' | 'inputs' | 'cash' | 'supply' | 'condition' | 'closed';

export const linesOf = (db: Sql, id: string) => db.all<Line>('SELECT l.company_id, l.recipe_id, l.planned_batches, l.ask_price_minor, r.output_commodity_id, r.output_units, r.energy_units, cm.reference_price_minor ref_price FROM production_lines l JOIN recipes r ON r.id = l.recipe_id JOIN commodities cm ON cm.id = r.output_commodity_id WHERE l.company_id = ? ORDER BY l.recipe_id', id);
export const recipeInputs = (db: Sql, recipe: string) => db.all<{ commodity_id: string; units: number }>('SELECT commodity_id, units FROM recipe_inputs WHERE recipe_id = ? ORDER BY commodity_id', recipe);
export const refPriceOf = (db: Sql, commodity: string) => db.get<{ p: number }>('SELECT reference_price_minor p FROM commodities WHERE id = ?', commodity)!.p;

/** Ingredient units per batch: better quality costs more to produce (basic −10%, premium +25%). */
export const inputUnitsPerBatch = (cfg: Pick<EngineConfig, 'qualityInputBps'>, quality: CompanyRow['quality'], units: number) => Math.ceil((units * cfg.qualityInputBps[quality]) / 10_000);
/** Energy units per batch after efficiency upgrades. */
export const energyPerBatch = (c: Pick<CompanyRow, 'energy_saving_bps'>, energyUnits: number) => Math.ceil((energyUnits * (10_000 - c.energy_saving_bps)) / 10_000);
/** Equipment wears: 100% condition = full output, 0% = 50% output. */
export const conditionFactorBps = (c: Pick<CompanyRow, 'condition_bps'>) => 5_000 + Math.floor(c.condition_bps / 2);
/** Share of full capacity the current staff can run: each employee covers max/employees of the workplace, scaled by productivity upgrades. Capped at 100%: extra staff beyond the workplace cannot exist. */
export const staffFactorBps = (c: Pick<CompanyRow, 'employees' | 'max_employees' | 'productivity_bps'>) => (c.max_employees === 0 ? 0 : Math.min(10_000, Math.floor((c.employees * (10_000 + c.productivity_bps)) / c.max_employees)));
export const staffedCapacity = (c: CompanyRow) => Math.floor((c.capacity_batches * staffFactorBps(c)) / 10_000);
/** Rounded, not floored: a hair of wear must not cost a whole batch. */
export const effCapacity = (c: CompanyRow) => Math.round((staffedCapacity(c) * conditionFactorBps(c)) / 10_000);
/** Employees needed to run `planned` batches at the current condition and productivity (hire/fire to demand rule for NPCs; shown to players as "staff needed"). */
export const staffNeeded = (c: CompanyRow, planned: number) => {
  const denom = c.capacity_batches * conditionFactorBps(c) * (10_000 + c.productivity_bps);
  return denom === 0 ? 0 : Math.max(1, Math.min(c.max_employees, Math.ceil((planned * c.max_employees * 10_000 * 10_000) / denom)));
};

export interface PlannedLine { line: Line; batches: number; wanted: number; reason: LimitReason }
/** What each production line may run before inputs are considered: min(target, staffed+condition capacity, storage room). */
export function planCompany(db: Sql, c: CompanyRow, cfg: Pick<EngineConfig, 'stockCoverDays'>, override?: number): PlannedLine[] {
  let capLeft = effCapacity(c); const noCond = staffedCapacity(c);
  return linesOf(db, c.id).map((line) => {
    const wanted = override ?? line.planned_batches;
    const held = stock(db, c.id, line.output_commodity_id).qty;
    const cover = Math.max(0, Math.floor((line.planned_batches * line.output_units * cfg.stockCoverDays - held) / line.output_units));   // days-of-stock guard
    const room = Math.min(cover, Math.max(0, Math.floor((c.storage_cap_units - held) / line.output_units)));
    const b = Math.max(0, Math.min(wanted, capLeft, room));
    let reason: LimitReason = 'plan';
    if (b < wanted) reason = room <= capLeft ? 'storage' : (capLeft < noCond && noCond >= wanted ? 'condition' : 'staff');
    capLeft -= b;
    return { line, batches: b, wanted, reason };
  });
}

export interface Purchase { commodity: string; qty: number; cost: number }
export interface ProcureResult { purchases: Purchase[]; batches: number; limit: 'cash' | 'supply' | null }
/**
 * Buys the missing inputs for as many batches as the cash budget and the live order book allow (immediate-or-cancel limit buys at up to
 * `procurementLimitBps` of reference price). Used by the daily tick (automatic purchasing) and by the player's "buy supplies now" action.
 */
export function procureInputs(db: Sql, ctx: TickCtx, cfg: EngineConfig, c: CompanyRow, budget: number, energyPrice: number, onFill?: (f: FillEvent) => void, override?: number): ProcureResult {
  const purchases: Purchase[] = []; let limit: ProcureResult['limit'] = null; let total = 0;
  for (const { line, batches } of planCompany(db, c, cfg, override)) {
    const inputs = recipeInputs(db, line.recipe_id); if (inputs.length === 0 || batches === 0) continue;
    const energyCost = energyPerBatch(c, line.energy_units) * energyPrice;
    let done = false;
    for (let b = batches; b > 0 && !done; b--) {
      let cost = b * energyCost, ok = true, why: 'cash' | 'supply' = 'supply'; const buys: { com: string; qty: number }[] = [];
      for (const i of inputs) {
        const need = inputUnitsPerBatch(cfg, c.quality, i.units);
        const deficit = Math.max(0, b * need - freeStock(db, c.id, i.commodity_id)); if (deficit === 0) continue;
        const cap = Math.floor((refPriceOf(db, i.commodity_id) * cfg.procurementLimitBps) / 10_000);
        const d = depth(db, i.commodity_id, cap, c.id, deficit);
        if (d.qty < deficit) { ok = false; why = 'supply'; break; }
        cost += d.cost; buys.push({ com: i.commodity_id, qty: deficit });
      }
      if (ok && cost > budget) { ok = false; why = 'cash'; }
      if (!ok) { if (b === batches) limit = why; continue; }
      for (const bu of buys) {
        const price = Math.floor((refPriceOf(db, bu.com) * cfg.procurementLimitBps) / 10_000);
        const r = placeOrder(db, ctx, cfg.exchangeFeeBps, { company: c.id, commodity: bu.com, side: 'buy', price, qty: bu.qty, ioc: true }, onFill);
        const got = r.fills.reduce((a, f) => a + f.qty, 0), paid = r.fills.reduce((a, f) => a + f.qty * f.price, 0);
        if (got > 0) purchases.push({ commodity: bu.com, qty: got, cost: paid });
      }
      budget -= cost; total += b; done = true;
    }
  }
  return { purchases, batches: total, limit };
}
