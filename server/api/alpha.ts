/** Private-alpha views: the onboarding checklist (derived from what the player has actually done) and the administrator health view. */
import type { Sql } from '../db/sql';
import { actingPlayer } from '../engine/actor';
import { reconcile, supply } from '../engine/ledger';
import { reconcileGbp } from '../engine/gbpLedger';
import { treasuryView } from '../engine/commercial';
import { deepAudit } from '../audit/invariants';

export function onboarding(db: Sql) {
  const me = actingPlayer();
  const cos = db.all<{ id: string }>("SELECT id FROM companies WHERE owner_kind = 'player' AND owner_id = ?", me).map((c) => c.id);
  const ph = cos.map(() => '?').join(',') || "''";
  const has = (sql: string, ...args: string[]) => !!db.get(sql, ...args);
  const steps = [
    { id: 'company', label: 'Start your first company', detail: 'Pick a vacant plot in Bristol. A farm costs about 2,500 EC and starts producing on the next day tick.', link: '/start', done: cos.length > 0 },
    { id: 'produce', label: 'Produce your first goods', detail: 'Your company produces each simulated day once it has staff, inputs and energy.', link: '/companies', done: cos.length > 0 && has(`SELECT 1 FROM production_log WHERE company_id IN (${ph}) AND produced_batches > 0`, ...cos) },
    { id: 'sell', label: 'Make your first sale', detail: 'Sell to Bristol households or on the Commodity Exchange.', link: '/commodities', done: cos.length > 0 && (has(`SELECT 1 FROM company_tick_stats WHERE company_id IN (${ph}) AND revenue_minor > 0`, ...cos) || has(`SELECT 1 FROM trades WHERE seller_company_id IN (${ph})`, ...cos)) },
    { id: 'trade', label: 'Place an order on the exchange', detail: 'Buy inputs or sell output to other players and NPC companies.', link: '/commodities', done: cos.length > 0 && has(`SELECT 1 FROM orders WHERE company_id IN (${ph})`, ...cos) },
    { id: 'invest', label: 'Buy shares in a listed company', detail: 'Optional: the Stock Exchange lets you own part of other businesses.', link: '/stocks', done: has('SELECT 1 FROM share_trades WHERE buyer_id = ?', me) },
  ];
  return { steps, complete: steps.filter((s) => s.done).length, total: steps.length };
}

export function adminHealth(db: Sql) {
  const r = reconcile(db), g = reconcileGbp(db), s = supply(db);
  const last = db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
  return {
    tick: last,
    ticks: db.get<{ failed: number; avgMs: number | null; maxMs: number | null }>("SELECT SUM(status = 'failed') failed, AVG(duration_ms) avgMs, MAX(duration_ms) maxMs FROM (SELECT * FROM ticks ORDER BY tick DESC LIMIT 50)"),
    coinLedger: { ok: r.ok, problems: r.problems.slice(0, 10), ...s },
    gbpLedger: { ok: g.ok, problems: g.problems.slice(0, 10), totals: g.totals, simulated: true },
    players: db.get<{ n: number }>('SELECT COUNT(*) n FROM users')!.n,
    companies: db.all<{ kind: string; status: string; n: number }>('SELECT owner_kind kind, status, COUNT(*) n FROM companies GROUP BY owner_kind, status ORDER BY owner_kind, status'),
    openOrders: db.get<{ n: number }>("SELECT COUNT(*) n FROM orders WHERE status = 'open'")!.n,
    trades24: db.get<{ n: number; v: number }>('SELECT COUNT(*) n, COALESCE(SUM(qty * price_minor),0) v FROM trades WHERE tick > ?', last - 1)!,
    npcDecisions: db.get<{ n: number }>('SELECT COUNT(*) n FROM npc_decisions WHERE tick > ?', last - 7)!.n,
    activeEvents: db.all("SELECT id, type, severity, headline, start_tick startTick, end_tick endTick FROM eco_events WHERE status = 'active' ORDER BY start_tick DESC LIMIT 10"),
    recentErrors: db.all('SELECT tick, kind, reason FROM failed_transactions ORDER BY id DESC LIMIT 20'),
    rewardBudgets: treasuryView(db),
  };
}

/** Administrator economy audit: the deep invariants run live, plus the diagnostics an operator needs to explain the economy (not decorative charts). */
export function economyAudit(db: Sql) {
  const t0 = Date.now();
  const a = deepAudit(db);
  const last = db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
  const cpi = db.all<{ tick: number; i: number }>('SELECT tick, index_bps i FROM cpi_index WHERE tick > ? ORDER BY tick', last - 90);
  const window = (days: number) => last - days;
  const byIndustry = db.all<{ industry: string; companies: number; operating: number; failures: number; profit: number | null; revenue: number | null; cash: number }>(
    `SELECT c.industry_id industry, COUNT(DISTINCT c.id) companies, SUM(c.status = 'operating') operating, SUM(c.bankrupt_tick IS NOT NULL) failures,
       (SELECT AVG(s.net_profit_minor) FROM company_tick_stats s JOIN companies x ON x.id = s.company_id WHERE x.industry_id = c.industry_id AND x.owner_kind <> 'state' AND s.tick > ?) profit,
       (SELECT AVG(s.revenue_minor) FROM company_tick_stats s JOIN companies x ON x.id = s.company_id WHERE x.industry_id = c.industry_id AND x.owner_kind <> 'state' AND s.tick > ?) revenue,
       (SELECT COALESCE(SUM(ac.balance_minor),0) FROM companies x JOIN accounts ac ON ac.id = x.treasury_account_id WHERE x.industry_id = c.industry_id AND x.owner_kind <> 'state' AND x.bankrupt_tick IS NULL) cash
     FROM companies c WHERE c.owner_kind <> 'state' GROUP BY c.industry_id ORDER BY c.industry_id`, window(30), window(30));
  return {
    tick: last, ms: 0,
    invariants: { ok: a.ok, checks: a.checks, findings: a.findings.map((f) => ({ id: f.id, severity: f.severity, count: f.count, detail: f.detail })) },
    money: { ...a.supply, issuedByReason: a.issuanceByReason, destroyedByReason: a.sinksByReason },
    inflation: { cpiNowBps: cpi.at(-1)?.i ?? 10_000, cpi30dAgoBps: cpi.find((c) => c.tick >= last - 30)?.i ?? null, cpi90dAgoBps: cpi[0]?.i ?? null },
    volumes30d: {
      commodityTrades: db.get<{ n: number }>('SELECT COUNT(*) n FROM trades WHERE tick > ?', window(30))!.n, commodityValueMinor: db.get<{ v: number }>('SELECT COALESCE(SUM(qty * price_minor),0) v FROM trades WHERE tick > ?', window(30))!.v,
      shareTrades: db.get<{ n: number }>('SELECT COUNT(*) n FROM share_trades WHERE tick > ?', window(30))!.n, shareValueMinor: db.get<{ v: number }>('SELECT COALESCE(SUM(qty * price_minor),0) v FROM share_trades WHERE tick > ?', window(30))!.v,
      consumerSpendMinor: db.get<{ v: number }>('SELECT COALESCE(SUM(consumer_spend_minor),0) v FROM monetary_stats WHERE tick > ?', window(30))!.v,
    },
    industries: byIndustry.map((r) => ({ ...r, profit: Math.round(r.profit ?? 0), revenue: Math.round(r.revenue ?? 0) })),
    npcFinances: db.get<{ cash: number; operating: number; losing: number }>("SELECT COALESCE(SUM(a.balance_minor),0) cash, SUM(c.status = 'operating') operating, (SELECT COUNT(*) FROM npc_profiles p JOIN companies x ON x.id = p.company_id WHERE p.strategy = 'struggling' AND x.bankrupt_tick IS NULL) losing FROM companies c JOIN accounts a ON a.id = c.treasury_account_id WHERE c.owner_kind = 'npc' AND c.bankrupt_tick IS NULL"),
    bankruptcies: { total: db.get<{ n: number }>('SELECT COUNT(*) n FROM companies WHERE bankrupt_tick IS NOT NULL')!.n, last30d: db.get<{ n: number }>('SELECT COUNT(*) n FROM companies WHERE bankrupt_tick > ?', window(30))!.n },
    credit: db.get<{ active: number; outstanding: number; defaults: number; writtenOff: number }>("SELECT (SELECT COUNT(*) FROM loans WHERE status = 'active') active, (SELECT COALESCE(SUM(outstanding_minor),0) FROM loans WHERE status IN ('active','defaulted')) outstanding, (SELECT COUNT(*) FROM credit_defaults) defaults, (SELECT COALESCE(SUM(written_off_minor),0) FROM credit_defaults) writtenOff"),
    stateTreasuries: db.all<{ id: string; name: string; cash: number }>("SELECT c.id, c.name, a.balance_minor cash FROM companies c JOIN accounts a ON a.id = c.treasury_account_id WHERE c.owner_kind = 'state' ORDER BY c.id").concat([{ id: 'treasury', name: 'Bristol state treasury', cash: db.get<{ b: number }>("SELECT balance_minor b FROM accounts WHERE id = 'acct:state:bristol-treasury'")!.b }]),
    householdsMinor: db.get<{ b: number }>("SELECT balance_minor b FROM accounts WHERE id = 'acct:households:bristol'")!.b,
    walletLiabilitiesPence: (() => { const g = reconcileGbp(db); return -(g.totals.walletLiabilities + g.totals.pendingLiabilities); })(),
    elapsedMs: Date.now() - t0,
  };
}
