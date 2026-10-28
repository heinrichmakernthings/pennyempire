import type { Sql } from './db/sql';
import { loadConfig } from './engine/config';
import { reconcile, supply } from './engine/ledger';
import { runTick } from './engine/tick';
import { lastTick, openWorld } from './engine/world';
import type { EngineConfig } from './engine/config';

export interface MonthRow { day: number; circulating: number; issued: number; destroyed: number; households: number; state: number; companies: number; players: number; goodsAtCost: number; consumerSpend: number; unitsProduced: number; insolvent: number; failures: number }
export interface SimReport {
  days: number; startCirculating: number; endCirculating: number; changeBps: number; totalIssued: number; totalDestroyed: number; genesisIssued: number; npcIssued: number;
  monthly: MonthRow[]; anomalies: string[]; reconciliation: { ok: boolean; problems: string[] };
  companies: { id: string; avgProfit: number; avgRevenue: number; status: string; finalCash: number }[];
  minHouseholds: number; maxCirculatingDeviationBps: number;
}

/**
 * Runs the economy forward and audits it as it goes. "Anomalies" are violations of the accounting identities — any non-empty list is a bug:
 *   Δcirculating each tick must equal issued − destroyed that tick (no wealth appears or vanishes), balances never negative, no failed ticks.
 */
export function runSimulation(days: number, opts: { db?: Sql; config?: Partial<EngineConfig> } = {}): SimReport {
  const db = opts.db ?? openWorld(':memory:', opts.config ?? {});
  const start = supply(db).circulating;
  const anomalies: string[] = [];
  let prev = start, minHh = Infinity, maxDev = 0;
  const target = loadConfig(db).supplyTargetMinor;
  for (let i = 0; i < days; i++) {
    const r = runTick(db, lastTick(db) + 1);
    if (r.status !== 'complete') { anomalies.push(`tick ${i + 1} did not complete: ${JSON.stringify(r)}`); break; }
    const snap = db.get<{ circulating_minor: number; issued_tick_minor: number; destroyed_tick_minor: number; households_minor: number }>('SELECT * FROM supply_snapshots WHERE tick = ?', r.tick)!;
    if (snap.circulating_minor - prev !== snap.issued_tick_minor - snap.destroyed_tick_minor) anomalies.push(`tick ${r.tick}: Δsupply ${snap.circulating_minor - prev} != issued ${snap.issued_tick_minor} - destroyed ${snap.destroyed_tick_minor}`);
    if (r.summary.failures > 0) anomalies.push(`tick ${r.tick}: ${r.summary.failures} failed economic actions`);
    prev = snap.circulating_minor; minHh = Math.min(minHh, snap.households_minor);
    if (target > 0) maxDev = Math.max(maxDev, Math.abs(Math.round(((snap.circulating_minor - target) * 10_000) / target)));
    if (r.tick % 25 === 0) { const rec = reconcile(db); if (!rec.ok) anomalies.push(`tick ${r.tick}: reconciliation failed: ${rec.problems[0]}`); }
  }
  const rec = reconcile(db); if (!rec.ok) anomalies.push(...rec.problems.slice(0, 5));
  const s = supply(db);
  const monthly = db.all<{ tick: number }>('SELECT tick FROM supply_snapshots WHERE tick > 0 AND tick % 30 = 0 ORDER BY tick').map(({ tick }): MonthRow => {
    const sn = db.get<Record<string, number>>('SELECT * FROM supply_snapshots WHERE tick = ?', tick)!;
    const sm = JSON.parse(db.get<{ j: string }>('SELECT summary_json j FROM ticks WHERE tick = ?', tick)!.j);
    return { day: tick, circulating: sn.circulating_minor!, issued: sn.issued_total_minor!, destroyed: sn.destroyed_total_minor!, households: sn.households_minor!, state: sn.state_minor!, companies: sn.companies_minor!, players: sn.players_minor!, goodsAtCost: sn.goods_value_minor!, consumerSpend: sm.consumerSpendMinor, unitsProduced: sm.unitsProduced, insolvent: db.get<{ n: number }>("SELECT COUNT(*) n FROM company_tick_stats WHERE tick = ? AND status = 'insolvent'", tick)!.n, failures: sm.failures };
  });
  const genesis = db.get<{ s: number }>("SELECT COALESCE(SUM(p.amount_minor),0) s FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.idempotency_key LIKE 'seed:%' AND p.amount_minor > 0 AND t.kind = 'issuance'")!.s;
  const window = Math.max(0, days - 30);
  return {
    days, startCirculating: start, endCirculating: s.circulating, changeBps: Math.round(((s.circulating - start) * 10_000) / start), totalIssued: s.issued, totalDestroyed: s.destroyed, genesisIssued: genesis, npcIssued: s.issued - genesis,
    monthly, anomalies, reconciliation: { ok: rec.ok, problems: rec.problems }, minHouseholds: minHh, maxCirculatingDeviationBps: maxDev,
    companies: db.all<{ company_id: string; p: number; r: number }>('SELECT company_id, AVG(net_profit_minor) p, AVG(revenue_minor) r FROM company_tick_stats WHERE tick > ? GROUP BY company_id ORDER BY company_id', window).map((c) => ({
      id: c.company_id, avgProfit: Math.round(c.p), avgRevenue: Math.round(c.r), status: db.get<{ status: string }>('SELECT status FROM companies WHERE id = ?', c.company_id)!.status,
      finalCash: db.get<{ b: number }>('SELECT a.balance_minor b FROM accounts a JOIN companies c ON c.treasury_account_id = a.id WHERE c.id = ?', c.company_id)!.b,
    })),
  };
}

export const ec = (m: number) => `${(m / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })} EC`;
export function formatReport(r: SimReport): string {
  const lines = [`Simulated ${r.days} in-game days (${(r.days / 30).toFixed(1)} months)`,
    `Circulating supply: ${ec(r.startCirculating)} → ${ec(r.endCirculating)} (${(r.changeBps / 100).toFixed(2)}%), max deviation from target ${(r.maxCirculatingDeviationBps / 100).toFixed(2)}%`,
    `Issued ${ec(r.totalIssued)} (genesis ${ec(r.genesisIssued)} + NPC income grants ${ec(r.npcIssued)}); destroyed ${ec(r.totalDestroyed)}`,
    `Lowest household liquidity ${ec(r.minHouseholds)}`, '', 'month  supply      households  state      companies  players  goods   consumer-spend/day  insolvent'];
  for (const m of r.monthly.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 12)) === 0 || i === a.length - 1)) lines.push(`${String(m.day).padStart(5)}  ${ec(m.circulating).padEnd(11)} ${ec(m.households).padEnd(11)} ${ec(m.state).padEnd(10)} ${ec(m.companies).padEnd(10)} ${ec(m.players).padEnd(8)} ${ec(m.goodsAtCost).padEnd(7)} ${ec(m.consumerSpend).padEnd(19)} ${m.insolvent}`);
  lines.push('', 'company                avg daily profit   avg daily revenue   cash        status');
  for (const c of r.companies) lines.push(`${c.id.padEnd(22)} ${ec(c.avgProfit).padEnd(18)} ${ec(c.avgRevenue).padEnd(19)} ${ec(c.finalCash).padEnd(11)} ${c.status}`);
  lines.push('', r.anomalies.length ? `ANOMALIES (${r.anomalies.length}):\n  ${r.anomalies.slice(0, 10).join('\n  ')}` : 'No accounting anomalies: Δsupply == issued − destroyed on every tick; ledger reconciles.');
  return lines.join('\n');
}
