import type { Sql } from '../db/sql';
import { gameDate, loadConfig, type EngineConfig } from '../engine/config';
import { BURN, ISSUANCE, balance, reconcile, supply } from '../engine/ledger';

/** Everything the developer economy dashboard shows. Read-only, computed from the ledger and history tables — no cached or invented numbers. */
export interface EconomyDashboard {
  tick: number; gameDate: string; config: EngineConfig;
  money: { issued: number; destroyed: number; circulating: number; target: number; deviationBps: number; households: number; stateTreasury: number; stateEnterprises: number; companies: number; players: number; goodsAtCost: number };
  flows: { issuedByReason: { reason: string; amount: number }[]; destroyedByKind: { kind: string; amount: number }[]; lastTick: { issued: number; destroyed: number; net: number } };
  series: { tick: number; circulating: number; issued: number; destroyed: number; households: number; state: number; companies: number; players: number; goods: number }[];
  output: { consumerSpendLastTick: number; tradeValueLastTick: number; unitsProducedLastTick: number; avgDailyOutput30: number };
  demand: { rule: string; label: string; commodity: string; budget: number; spent: number; unitsWanted: number; unitsSold: number; unmet: number }[];
  companies: { count: number; operating: number; paused: number; insolvent: number; profitable: number; list: { id: string; name: string; owner: string; industry: string; status: string; cash: number; avgProfit7: number; avgRevenue7: number; lastProfit: number; unpaid: number; price: number }[] };
  ticks: { tick: number; status: string; durationMs: number | null; trades: number | null; issued: number | null; destroyed: number | null; circulating: number | null; failures: number | null }[];
  errors: { failedTransactions: { id: number; tick: number; kind: string; reason: string; key: string | null }[]; events: { id: number; tick: number; kind: string; severity: string; subject: string | null; message: string }[]; failedTicks: number };
  reconciliation: { ok: boolean; problems: string[]; transactions: number; accounts: number };
}

export function economyDashboard(db: Sql): EconomyDashboard {
  const cfg = loadConfig(db);
  const tick = db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
  const s = supply(db);
  const sumAcc = (where: string) => db.get<{ s: number }>(`SELECT COALESCE(SUM(balance_minor),0) s FROM accounts WHERE ${where}`)!.s;
  const stateEnt = sumAcc("id IN (SELECT treasury_account_id FROM companies WHERE owner_kind = 'state')");
  const companiesCash = sumAcc("kind = 'company' AND id NOT IN (SELECT treasury_account_id FROM companies WHERE owner_kind = 'state')");
  const issuedByReason = db.all<{ reason: string; amount: number }>("SELECT CASE WHEN t.idempotency_key LIKE 'seed:%' THEN 'genesis grants' WHEN t.memo LIKE 'NPC citizen%' THEN 'NPC citizen income grant' ELSE t.memo END reason, SUM(p.amount_minor) amount FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.kind = 'issuance' AND p.account_id <> ? GROUP BY reason ORDER BY amount DESC", ISSUANCE);
  const destroyedByKind = db.all<{ kind: string; amount: number }>("SELECT CASE WHEN t.memo LIKE 'exchange fee%' THEN 'exchange fees' WHEN t.memo LIKE 'infrastructure upkeep%' THEN 'state infrastructure upkeep' ELSE t.memo END kind, SUM(p.amount_minor) amount FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.kind IN ('sink','sink_fee') AND p.account_id = ? GROUP BY kind ORDER BY amount DESC", BURN);
  const snap = db.get<{ issued_tick_minor: number; destroyed_tick_minor: number }>('SELECT * FROM supply_snapshots WHERE tick = ?', tick);
  const series = db.all<Record<string, number>>('SELECT * FROM (SELECT * FROM supply_snapshots ORDER BY tick DESC LIMIT 120) ORDER BY tick').map((r) => ({ tick: r.tick!, circulating: r.circulating_minor!, issued: r.issued_tick_minor!, destroyed: r.destroyed_tick_minor!, households: r.households_minor!, state: r.state_minor!, companies: r.companies_minor!, players: r.players_minor!, goods: r.goods_value_minor! }));
  const last = (col: string) => JSON.parse(db.get<{ j: string | null }>('SELECT summary_json j FROM ticks WHERE tick = ?', tick)?.j ?? '{}')[col] ?? 0;
  const out30 = db.get<{ a: number }>('SELECT COALESCE(AVG(x),0) a FROM (SELECT SUM(revenue_minor) x FROM company_tick_stats WHERE tick > ? AND tick <= ? AND company_id IN (SELECT id FROM companies WHERE retail_commodity_id IS NOT NULL) GROUP BY tick)', Math.max(0, tick - 30), tick)!.a;
  const co = db.all<{ id: string; name: string; owner_name: string; industry_id: string; status: string; treasury_account_id: string; unpaid_minor: number; price_minor: number }>('SELECT c.id, c.name, o.name owner_name, c.industry_id, c.status, c.treasury_account_id, c.unpaid_minor, c.price_minor FROM companies c JOIN owners o ON o.id = c.owner_id ORDER BY c.id');
  const list = co.map((c) => {
    const avg = db.get<{ p: number; r: number }>('SELECT COALESCE(AVG(net_profit_minor),0) p, COALESCE(AVG(revenue_minor),0) r FROM company_tick_stats WHERE company_id = ? AND tick > ? AND tick <= ?', c.id, Math.max(0, tick - 7), tick)!;
    const lastP = db.get<{ p: number }>('SELECT net_profit_minor p FROM company_tick_stats WHERE company_id = ? AND tick = ?', c.id, tick)?.p ?? 0;
    return { id: c.id, name: c.name, owner: c.owner_name, industry: c.industry_id, status: c.status, cash: balance(db, c.treasury_account_id), avgProfit7: Math.round(avg.p), avgRevenue7: Math.round(avg.r), lastProfit: lastP, unpaid: c.unpaid_minor, price: c.price_minor };
  });
  const rec = reconcile(db);
  return {
    tick, gameDate: gameDate(cfg, tick), config: cfg,
    money: { issued: s.issued, destroyed: s.destroyed, circulating: s.circulating, target: cfg.supplyTargetMinor, deviationBps: cfg.supplyTargetMinor > 0 ? Math.round(((s.circulating - cfg.supplyTargetMinor) * 10_000) / cfg.supplyTargetMinor) : 0, households: sumAcc("kind = 'households'"), stateTreasury: sumAcc("kind = 'state_treasury'"), stateEnterprises: stateEnt, companies: companiesCash, players: sumAcc("kind = 'player'"), goodsAtCost: db.get<{ v: number }>('SELECT COALESCE(SUM(value_minor),0) v FROM inventory')!.v },
    flows: { issuedByReason, destroyedByKind, lastTick: { issued: snap?.issued_tick_minor ?? 0, destroyed: snap?.destroyed_tick_minor ?? 0, net: (snap?.issued_tick_minor ?? 0) - (snap?.destroyed_tick_minor ?? 0) } },
    series,
    output: { consumerSpendLastTick: last('consumerSpendMinor'), tradeValueLastTick: last('tradeValueMinor'), unitsProducedLastTick: last('unitsProduced'), avgDailyOutput30: Math.round(out30) },
    demand: db.all<{ rule_id: string; label: string; commodity_id: string; budget_minor: number; spent_minor: number; units_wanted: number; units_sold: number; unmet_units: number }>('SELECT s.*, r.label, r.commodity_id FROM demand_tick_stats s JOIN demand_rules r ON r.id = s.rule_id WHERE s.tick = ? ORDER BY s.rule_id', tick).map((d) => ({ rule: d.rule_id, label: d.label, commodity: d.commodity_id, budget: d.budget_minor, spent: d.spent_minor, unitsWanted: d.units_wanted, unitsSold: d.units_sold, unmet: d.unmet_units })),
    companies: { count: co.length, operating: list.filter((c) => c.status === 'operating').length, paused: list.filter((c) => c.status === 'paused').length, insolvent: list.filter((c) => c.status === 'insolvent').length, profitable: list.filter((c) => c.avgProfit7 > 0).length, list },
    ticks: db.all<{ tick: number; status: string; duration_ms: number | null; summary_json: string | null }>('SELECT tick, status, duration_ms, summary_json FROM ticks ORDER BY tick DESC LIMIT 30').map((t) => { const sm = t.summary_json ? JSON.parse(t.summary_json) : {}; return { tick: t.tick, status: t.status, durationMs: t.duration_ms, trades: sm.trades ?? null, issued: sm.issuedMinor ?? null, destroyed: sm.destroyedMinor ?? null, circulating: sm.circulatingMinor ?? null, failures: sm.failures ?? null }; }),
    errors: {
      failedTransactions: db.all<{ id: number; tick: number; kind: string; reason: string; idempotency_key: string | null }>('SELECT * FROM failed_transactions ORDER BY id DESC LIMIT 20').map((f) => ({ id: f.id, tick: f.tick, kind: f.kind, reason: f.reason, key: f.idempotency_key })),
      events: db.all<{ id: number; tick: number; kind: string; severity: string; subject: string | null; message: string }>("SELECT id, tick, kind, severity, subject, message FROM economic_events WHERE severity IN ('warning','error') ORDER BY id DESC LIMIT 20"),
      failedTicks: db.get<{ n: number }>("SELECT COUNT(*) n FROM ticks WHERE status = 'failed'")!.n,
    },
    reconciliation: { ok: rec.ok, problems: rec.problems, transactions: rec.checked.transactions, accounts: rec.checked.accounts },
  };
}
