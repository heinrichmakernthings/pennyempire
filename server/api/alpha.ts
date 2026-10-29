/** Private-alpha views: the onboarding checklist (derived from what the player has actually done) and the administrator health view. */
import type { Sql } from '../db/sql';
import { actingPlayer } from '../engine/actor';
import { reconcile, supply } from '../engine/ledger';
import { reconcileGbp } from '../engine/gbpLedger';
import { treasuryView } from '../engine/commercial';

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
