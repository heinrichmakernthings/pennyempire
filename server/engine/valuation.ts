import { baseRate } from './bank';
import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { balance } from './ledger';
import { security } from './capital';
import type { CompanyRow } from './operations';

export interface Valuation {
  companyId: string; shares: number; fairValuePerShareMinor: number; equityMinor: number; earningsValueMinor: number; dailyEarningsMinor: number; growthBps: number; riskBps: number; liquidationFloorMinor: number;
  components: { cashMinor: number; inventoryMinor: number; equipmentMinor: number; arrearsMinor: number; declaredDividendsMinor: number; horizonDays: number; windowDays: number; revenue7Minor: number; profit7Minor: number; volatilityBps: number; notes: string[] };
}

/**
 * Fundamental estimate from the company's real books — NEVER used to set a trading price. Traded prices come only from orders; this is what a careful analyst
 * would compute: book equity (cash + stock at cost + equipment at its worn value − arrears − declared-but-unpaid dividends) plus a capitalised
 * view of maintainable after-tax earnings (`valuationHorizonDays` days of the recent average, nudged by growth and discounted for risk), never below a liquidation floor.
 */
export function computeValuation(db: Sql, cfg: EngineConfig, companyId: string, tick: number): Valuation | null {
  const c = db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', companyId);
  const sec = security(db, companyId);
  if (!c || !sec) return null;
  const cash = balance(db, c.treasury_account_id);
  const inventory = db.get<{ v: number }>('SELECT COALESCE(SUM(value_minor),0) v FROM inventory WHERE company_id = ?', companyId)!.v;
  const equipment = Math.floor((c.equipment_cost_minor * c.condition_bps) / 10_000);
  const declared = db.get<{ v: number }>("SELECT COALESCE(SUM(total_minor - paid_minor),0) v FROM dividends WHERE company_id = ? AND status = 'declared'", companyId)!.v;
  const arrears = c.unpaid_minor;
  const equity = Math.max(0, cash + inventory + equipment - arrears - declared);
  const rows = db.all<{ tick: number; net: number; rev: number }>('SELECT tick, net_profit_minor net, revenue_minor rev FROM company_tick_stats WHERE company_id = ? AND tick > 0 AND tick <= ? ORDER BY tick DESC LIMIT 14', companyId, tick);
  const n = rows.length;
  const mean = n ? rows.reduce((a, r) => a + r.net, 0) / n : 0;
  const recent = rows.slice(0, 7), prior = rows.slice(7, 14);
  const avg = (xs: { net: number }[]) => (xs.length ? xs.reduce((a, r) => a + r.net, 0) / xs.length : 0);
  const growth = prior.length >= 3 && recent.length >= 3 && avg(prior) > 0 ? Math.max(-2_000, Math.min(2_000, Math.round(((avg(recent) - avg(prior)) * 10_000) / avg(prior)))) : 0;
  const sd = n > 1 ? Math.sqrt(rows.reduce((a, r) => a + (r.net - mean) ** 2, 0) / (n - 1)) : 0;
  const volBps = mean > 0 ? Math.min(1_500, Math.round((sd / mean) * 1_000)) : 0;
  const dailyFixed = c.employees * c.wage_minor + c.property_minor + c.marketing_minor;
  const runwayBps = dailyFixed > 0 && cash / dailyFixed < 5 ? 500 : 0;
  const risk = c.status === 'insolvent' ? cfg.valuationRiskMaxBps : Math.min(cfg.valuationRiskMaxBps, volBps + (arrears > 0 ? 1_000 : 0) + runwayBps);
  const earnings = Math.round(mean * cfg.valuationHorizonDays);
  // Interest rates act on value: future earnings are worth less when money costs more. Each 1% the central bank's base rate sits above its neutral setting trims 2% off earnings value (and adds the same when below), capped at ±30%.
  const rateAdjBps = Math.max(-3_000, Math.min(3_000, -(baseRate(db) - cfg.cbBaseRateBps) * 2));
  const adj = earnings > 0 ? Math.round((earnings * (10_000 + Math.floor(growth / 2)) * (10_000 - risk) * (10_000 + rateAdjBps)) / 1_000_000_000_000) : earnings;
  const liquidation = Math.max(0, cash + Math.floor(inventory / 2) - arrears - declared);
  const total = c.status === 'insolvent' || c.bankrupt_tick !== null ? liquidation : Math.max(liquidation, equity + adj);
  const issued = Math.max(1, sec.issued_shares);
  const notes: string[] = [];
  if (n < 3) notes.push('Fewer than 3 days of trading history: earnings are a rough guide.');
  if (arrears > 0) notes.push('The company owes unpaid bills, which lowers the estimate.');
  if (mean < 0) notes.push('Recent losses reduce the estimate below book value.');
  return {
    companyId, shares: issued, fairValuePerShareMinor: Math.max(1, Math.floor(total / issued)), equityMinor: equity, earningsValueMinor: adj, dailyEarningsMinor: Math.round(mean), growthBps: growth, riskBps: risk, liquidationFloorMinor: liquidation,
    components: { cashMinor: cash, inventoryMinor: inventory, equipmentMinor: equipment, arrearsMinor: arrears, declaredDividendsMinor: declared, horizonDays: cfg.valuationHorizonDays, windowDays: n, revenue7Minor: recent.reduce((a, r) => a + r.rev, 0), profit7Minor: recent.reduce((a, r) => a + r.net, 0), volatilityBps: volBps, notes },
  };
}

/** Daily record for every listed security (also readable on demand for unlisted companies through `computeValuation`). */
export function recordValuations(db: Sql, cfg: EngineConfig, tick: number) {
  for (const s of db.all<{ company_id: string }>("SELECT company_id FROM securities WHERE status IN ('open','suspended') ORDER BY company_id")) {
    const v = computeValuation(db, cfg, s.company_id, tick); if (!v) continue;
    db.run('INSERT OR REPLACE INTO security_valuations (tick, company_id, fair_value_minor, equity_minor, earnings_value_minor, daily_earnings_minor, growth_bps, risk_bps, components_json) VALUES (?,?,?,?,?,?,?,?,?)', tick, s.company_id, v.fairValuePerShareMinor, v.equityMinor, v.earningsValueMinor, v.dailyEarningsMinor, v.growthBps, v.riskBps, JSON.stringify(v.components));
  }
}
