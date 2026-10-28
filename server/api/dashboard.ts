import type { Sql } from '../db/sql';
import { gameDate, loadConfig, type EngineConfig } from '../engine/config';
import { BURN, ISSUANCE, balance, reconcile, supply } from '../engine/ledger';
import { directory } from '../engine/exchange';
import { livingDashboard, type LivingDashboard } from './livingDashboard';
import { EXCHANGE_ACCOUNT } from '../seed/bristol';

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
  exchange: ExchangeDashboard;
  living: LivingDashboard;
}

export interface ExchangeDashboard {
  fees: { balance: number; collected7d: number; burnedTotal: number; sweptTotal: number; burnBps: number; feeBps: number };
  commodities: { id: string; lastPrice: number | null; vwap7d: number | null; reference: number; volumeToday: number; volume7d: number; value7d: number; bestBid: number | null; bestAsk: number | null; spreadBps: number | null; depthNearAsk: number; listed: number; demand: number; shortage: number; surplus: number; status: string; contractUnits: number }[];
  orders: { open: number; openBuy: number; openSell: number; reservedFunds: number; reservedUnits: number; byOwner: { kind: string; open: number }[]; expiredLast7: number; cancelledLast7: number };
  trades: { count7d: number; value7d: number; byPair: { pair: string; trades: number; value: number }[] };
  reservations: { accountReservedTotal: number; orderReservedTotal: number; inventoryReservedTotal: number; sellOrderUnitsTotal: number; consistent: boolean };
  npcActivity: { company: string; name: string; boughtUnits: number; soldUnits: number; boughtValue: number; soldValue: number }[];
  contracts: { active: number; pending: number; ended: number; delivered7d: number; missed7d: number; failureRateBps: number; byStatus: { status: string; n: number }[] };
  failedSettlements: { kind: string; n: number; lastReason: string | null }[];
  anomalies: { kind: string; severity: 'warning' | 'error'; detail: string }[];
}

function exchangeDashboard(db: Sql, tick: number): ExchangeDashboard {
  const cfg = loadConfig(db);
  const since = Math.max(0, tick - 7);
  const sumTx = (like: string, acct: string, sign: 1 | -1) => db.get<{ a: number }>(`SELECT COALESCE(SUM(p.amount_minor * ?),0) a FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.memo LIKE ? AND p.account_id = ?`, sign, like, acct)!.a;
  const dir = directory(db);
  const commodities = dir.map((d) => {
    const near = d.bestAskMinor === null ? 0 : db.get<{ q: number }>("SELECT COALESCE(SUM(qty_remaining),0) q FROM orders WHERE commodity_id = ? AND side='sell' AND status='open' AND price_minor <= ?", d.commodityId, Math.ceil(d.bestAskMinor * 1.05))!.q;
    return { id: d.commodityId, lastPrice: d.lastTradePriceMinor, vwap7d: d.vwap7dMinor, reference: d.referencePriceMinor, volumeToday: d.volumeToday, volume7d: d.volume7d, value7d: d.value7dMinor, bestBid: d.bestBidMinor, bestAsk: d.bestAskMinor, spreadBps: d.bestBidMinor && d.bestAskMinor ? Math.round(((d.bestAskMinor - d.bestBidMinor) * 10_000) / d.bestAskMinor) : null, depthNearAsk: near, listed: d.listedUnits, demand: d.demandUnitsPerDay, shortage: d.shortageUnits, surplus: d.surplusUnits, status: d.status, contractUnits: d.contractUnitsToday };
  });
  const o = db.get<{ n: number; b: number; s: number; rf: number; ru: number }>("SELECT COUNT(*) n, COALESCE(SUM(side='buy'),0) b, COALESCE(SUM(side='sell'),0) s, COALESCE(SUM(reserved_funds_minor),0) rf, COALESCE(SUM(CASE WHEN side='sell' THEN qty_remaining ELSE 0 END),0) ru FROM orders WHERE status = 'open'")!;
  const pairs = db.all<{ b: string; s: string; n: number; v: number }>("SELECT cb.owner_kind b, cs.owner_kind s, COUNT(*) n, COALESCE(SUM(t.qty * t.price_minor),0) v FROM trades t JOIN companies cb ON cb.id = t.buyer_company_id JOIN companies cs ON cs.id = t.seller_company_id WHERE t.tick > ? GROUP BY cb.owner_kind, cs.owner_kind ORDER BY v DESC", since);
  const acctRes = db.get<{ r: number }>('SELECT COALESCE(SUM(reserved_minor),0) r FROM accounts')!.r;
  const invRes = db.get<{ r: number }>('SELECT COALESCE(SUM(reserved),0) r FROM inventory')!.r;
  const shareBuyRes = db.get<{ r: number }>("SELECT COALESCE(SUM(reserved_funds_minor),0) r FROM share_orders WHERE status = 'open' AND side = 'buy'")!.r;
  const divRes = db.get<{ r: number }>("SELECT COALESCE(SUM(total_minor - paid_minor),0) r FROM dividends WHERE status = 'declared'")!.r;
  const consistent = acctRes === o.rf + shareBuyRes + divRes && invRes === o.ru;
  const npc = db.all<{ id: string; name: string; bu: number; su: number; bv: number; sv: number }>(`SELECT c.id, c.name,
      COALESCE((SELECT SUM(qty) FROM trades WHERE buyer_company_id = c.id AND tick > ?),0) bu, COALESCE((SELECT SUM(qty) FROM trades WHERE seller_company_id = c.id AND tick > ?),0) su,
      COALESCE((SELECT SUM(qty*price_minor) FROM trades WHERE buyer_company_id = c.id AND tick > ?),0) bv, COALESCE((SELECT SUM(qty*price_minor) FROM trades WHERE seller_company_id = c.id AND tick > ?),0) sv
    FROM companies c WHERE c.owner_kind <> 'player' ORDER BY c.id`, since, since, since, since).filter((r) => r.bu + r.su > 0);
  const cs = db.all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM supply_contracts GROUP BY status');
  const del = db.get<{ d: number; m: number }>("SELECT COALESCE(SUM(status = 'delivered'),0) d, COALESCE(SUM(status <> 'delivered'),0) m FROM contract_deliveries WHERE due_tick > ?", since)!;
  const failed = db.all<{ kind: string; n: number }>('SELECT kind, COUNT(*) n FROM failed_transactions WHERE tick > ? GROUP BY kind ORDER BY n DESC', Math.max(0, tick - 30)).map((f) => ({ ...f, lastReason: db.get<{ r: string }>('SELECT reason r FROM failed_transactions WHERE kind = ? ORDER BY id DESC LIMIT 1', f.kind)?.r ?? null }));
  const anomalies: ExchangeDashboard['anomalies'] = [];
  if (!consistent) anomalies.push({ kind: 'reservation_mismatch', severity: 'error', detail: `Account reservations ${acctRes} vs open buy orders ${o.rf}, share buy orders ${shareBuyRes} and declared dividends ${divRes}; inventory reservations ${invRes} vs open sell units ${o.ru}.` });
  const selfTrades = db.get<{ n: number }>('SELECT COUNT(*) n FROM trades WHERE buyer_company_id = seller_company_id')!.n; if (selfTrades) anomalies.push({ kind: 'self_trade', severity: 'error', detail: `${selfTrades} trade(s) where buyer and seller are the same company.` });
  const stale = db.get<{ n: number }>("SELECT COUNT(*) n FROM orders WHERE status = 'open' AND expires_tick IS NOT NULL AND expires_tick < ?", tick)!.n; if (stale) anomalies.push({ kind: 'expired_order_open', severity: 'warning', detail: `${stale} expired order(s) are still open.` });
  for (const c of commodities) {
    if (c.vwap7d && (c.vwap7d > c.reference * 3 || c.vwap7d * 3 < c.reference)) anomalies.push({ kind: 'price_outlier', severity: 'warning', detail: `${c.id} traded at ${(c.vwap7d / 100).toFixed(2)} EC against a ${(c.reference / 100).toFixed(2)} EC reference.` });
    if (c.bestBid !== null && c.bestAsk !== null && c.bestBid >= c.bestAsk) anomalies.push({ kind: 'crossed_book', severity: 'error', detail: `${c.id}: best bid ${c.bestBid} ≥ best ask ${c.bestAsk} left unmatched.` });
    if (c.status === 'shortage') anomalies.push({ kind: 'shortage', severity: 'warning', detail: `${c.id}: demand ${c.demand}/day, ${c.shortage}/day short of listed supply.` });
  }
  const top = db.get<{ c: string; sh: number }>("SELECT seller_company_id c, SUM(qty) sh FROM trades WHERE tick > ? GROUP BY seller_company_id, commodity_id ORDER BY sh DESC LIMIT 1", since);
  const totalVol = db.get<{ q: number }>('SELECT COALESCE(SUM(qty),0) q FROM trades WHERE tick > ?', since)!.q;
  if (top && totalVol > 0 && top.sh * 10 > totalVol * 8 && totalVol > 500) anomalies.push({ kind: 'concentration', severity: 'warning', detail: `${top.c} supplied over 80% of one week's traded units.` });
  return {
    fees: { balance: balance(db, EXCHANGE_ACCOUNT), collected7d: db.get<{ f: number }>('SELECT COALESCE(SUM(fee_minor),0) f FROM trades WHERE tick > ?', since)!.f + db.get<{ f: number }>('SELECT COALESCE(SUM(fee_minor),0) f FROM contract_deliveries WHERE settled_tick > ?', since)!.f, burnedTotal: sumTx('Penny Exchange fee burn%', BURN, 1), sweptTotal: sumTx('Penny Exchange fee income%', EXCHANGE_ACCOUNT, -1), burnBps: cfg.exchangeBurnBps, feeBps: cfg.exchangeFeeBps },
    commodities,
    orders: { open: o.n, openBuy: o.b, openSell: o.s, reservedFunds: o.rf, reservedUnits: o.ru, byOwner: db.all<{ kind: string; open: number }>("SELECT c.owner_kind kind, COUNT(*) open FROM orders o JOIN companies c ON c.id = o.company_id WHERE o.status = 'open' GROUP BY c.owner_kind"), expiredLast7: db.get<{ n: number }>("SELECT COUNT(*) n FROM orders WHERE end_reason = 'expired' AND created_tick > ?", since - 60)!.n, cancelledLast7: db.get<{ n: number }>("SELECT COUNT(*) n FROM orders WHERE end_reason = 'cancelled' AND created_tick > ?", since)!.n },
    trades: { count7d: db.get<{ n: number }>('SELECT COUNT(*) n FROM trades WHERE tick > ?', since)!.n, value7d: db.get<{ v: number }>('SELECT COALESCE(SUM(qty*price_minor),0) v FROM trades WHERE tick > ?', since)!.v, byPair: pairs.map((p) => ({ pair: `${p.b} buys from ${p.s}`, trades: p.n, value: p.v })) },
    reservations: { accountReservedTotal: acctRes, orderReservedTotal: o.rf, inventoryReservedTotal: invRes, sellOrderUnitsTotal: o.ru, consistent },
    npcActivity: npc.map((n) => ({ company: n.id, name: n.name, boughtUnits: n.bu, soldUnits: n.su, boughtValue: n.bv, soldValue: n.sv })),
    contracts: { active: cs.find((c) => c.status === 'active')?.n ?? 0, pending: cs.find((c) => c.status === 'pending')?.n ?? 0, ended: cs.filter((c) => !['active', 'pending'].includes(c.status)).reduce((a, c) => a + c.n, 0), delivered7d: del.d, missed7d: del.m, failureRateBps: del.d + del.m > 0 ? Math.round((del.m * 10_000) / (del.d + del.m)) : 0, byStatus: cs },
    failedSettlements: failed, anomalies,
  };
}

export function economyDashboard(db: Sql): EconomyDashboard {
  const cfg = loadConfig(db);
  const tick = db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
  const s = supply(db);
  const sumAcc = (where: string) => db.get<{ s: number }>(`SELECT COALESCE(SUM(balance_minor),0) s FROM accounts WHERE ${where}`)!.s;
  const stateEnt = sumAcc("id IN (SELECT treasury_account_id FROM companies WHERE owner_kind = 'state')");
  const companiesCash = sumAcc("kind = 'company' AND id NOT IN (SELECT treasury_account_id FROM companies WHERE owner_kind = 'state')");
  const issuedByReason = db.all<{ reason: string; amount: number }>("SELECT CASE WHEN t.idempotency_key LIKE 'seed:%' THEN 'genesis grants' WHEN t.memo LIKE 'NPC citizen%' THEN 'NPC citizen income grant' ELSE t.memo END reason, SUM(p.amount_minor) amount FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.kind = 'issuance' AND p.account_id <> ? GROUP BY reason ORDER BY amount DESC", ISSUANCE);
  const destroyedByKind = db.all<{ kind: string; amount: number }>("SELECT CASE WHEN t.memo LIKE 'Penny Exchange fee burn%' THEN 'Penny Exchange fee burn (explicit)' WHEN t.memo LIKE 'infrastructure upkeep%' THEN 'state infrastructure upkeep' ELSE t.memo END kind, SUM(p.amount_minor) amount FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.kind IN ('sink','sink_fee') AND p.account_id = ? GROUP BY kind ORDER BY amount DESC", BURN);
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
    exchange: exchangeDashboard(db, tick),
    living: livingDashboard(db, tick),
  };
}
