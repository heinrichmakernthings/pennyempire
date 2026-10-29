/**
 * Prompt 11 reproducible economic stress framework. Every run is a pure function of (scenario, seed, players, days): seeded player agents act
 * through the real API router (ownership, validation, idempotency) while the real engine ticks; stresses are applied only through levers the
 * game really has (economic events, admin parameters, the ledger). Results are aggregate measurements, never per-tick dumps, so reports stay
 * small enough to diff between balance changes (`docs/audit/*.json`).
 */
import type { Sql } from '../db/sql';
import { advance, lastTick, openWorld } from '../engine/world';
import { withPlayer } from '../engine/actor';
import { handleApi } from '../api/router';
import { createInvite, registerUser } from '../engine/accounts';
import { setParam, triggerEvent } from '../engine/admin';
import { loadConfig, saveConfig } from '../engine/config';
import { transfer } from '../engine/ledger';
import { HOUSEHOLDS } from '../seed/bristol';
import { deepAudit } from './invariants';
import { rng, type Rng } from './rng';
import { createDeposit, handleDepositEvent, requestWithdrawal, approveWithdrawal, settleWithdrawal, sandboxEvent, fundTreasury } from '../engine/gbpWallet';
import { awardReward, createProgram, fundProgram } from '../engine/rewards';
import { reconcileGbp } from '../engine/gbpLedger';

export type ScenarioId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'POP';
export interface RunSpec { id: ScenarioId; name: string; seed: number; players: number; days: number }
export interface Checkpoint { day: number; circulatingEC: number; householdsEC: number; cpiBps: number; consumerSpendPerDayEC: number; velocityBps: number; operating: number; playerOperating: number; bankruptcies: number; unmetUnitsPerDay: number; loansEC: number; shareIndexBps: number }
export interface ScenarioReport {
  spec: RunSpec; setup: string[]; checkpoints: Checkpoint[];
  money: { startEC: number; endEC: number; changeBps: number; issuedByReasonEC: Record<string, number>; destroyedByReasonEC: Record<string, number> };
  inflation: { cpiStartBps: number; cpiEndBps: number; annualisedBps: number };
  industries: Record<string, { companies: number; operating: number; meanDailyProfitEC: number; meanDailyRevenueEC: number; failures: number }>;
  concentration: { topSellerShareBps: Record<string, number> };
  credit: { loansMade: number; defaults: number; writtenOffEC: number };
  markets: { commodityTrades: number; commodityValueEC: number; shareTrades: number; shareValueEC: number };
  wallet: { liabilitiesPence: number; reconciles: boolean };
  performance: { msPerTickAvg: number; msPerTickMax: number; msPerCommand: number; commands: number };
  audit: { ok: boolean; findings: string[] };
  outcome: Record<string, number | string | boolean>;
}

const ec = (m: number) => Math.round(m / 100);
const one = <T>(db: Sql, sql: string, ...a: (string | number)[]) => db.get<T>(sql, ...a)!;

interface Agent { id: string; wallet: string; style: 'builder' | 'trader' | 'investor' | 'idle' }

/** A seeded population of simple, sensible players: builders found and run a company, traders work the exchange, investors buy shares and prestige. */
class Population {
  agents: Agent[] = []; commands = 0; cmdMs = 0; private seq = 0;
  constructor(private db: Sql, private r: Rng, n: number) {
    const styles: Agent['style'][] = ['builder', 'trader', 'investor', 'idle'];
    for (let i = 0; i < n; i++) {
      const u = registerUser(db, 1, { invite: createInvite(db, 1, 'scenario', 'player').code, username: `sim${i}`, displayName: `Sim ${i}`, hash: '0'.repeat(64), salt: '00', iterations: 100_000 });
      this.agents.push({ id: u.playerId, wallet: u.wallet, style: i === 0 ? 'builder' : styles[i % styles.length]! });
    }
  }
  private call(a: Agent, method: string, path: string, body?: unknown, query?: Record<string, string>) { return withPlayer(a, () => handleApi(this.db, { method, path, body, query }, { devEndpoints: false, now: () => 2_000_000_000_000 })); }
  cmd(a: Agent, body: Record<string, unknown>) { const t0 = performance.now(); const r = this.call(a, 'POST', '/api/command', { idempotencyKey: `${a.id}:${this.seq++}`, expectedRevision: 0, ...body }); this.cmdMs += performance.now() - t0; this.commands++; return r.body as { ok: boolean; data?: Record<string, unknown> }; }
  private owned(a: Agent) { return this.db.all<{ id: string; industry_id: string; revision: number }>("SELECT id, industry_id, revision FROM companies WHERE owner_kind = 'player' AND owner_id = ? AND bankrupt_tick IS NULL ORDER BY rowid", a.id); }
  found(a: Agent, industry: string): string | null {
    const lots = this.db.all<{ id: string }>("SELECT p.id FROM plots p JOIN industry_specs s ON s.industry_id = ? WHERE p.district_id IS NOT NULL AND p.company_id IS NULL AND p.asset_id IS NULL AND p.width = s.plot_width AND p.depth = s.plot_depth ORDER BY p.id", industry);
    if (!lots.length) return null;
    const q = (this.call(a, 'GET', '/api/startup-quote', undefined, { industry, plotId: lots[0]!.id, tier: '1' }).body as { quote: { ok: boolean; totalMinor: number } }).quote;
    if (!q.ok) return null;
    const r = this.cmd(a, { type: 'company.create', industry, plotId: lots[0]!.id, tier: 1, name: `Sim ${industry} ${this.seq}`, expectedTotalMinor: q.totalMinor });
    if (!r.ok) return null;
    const id = r.data!.companyId as string;
    this.cmd(a, { type: 'company.configure', companyId: id, expectedRevision: 1, autoProcure: true });
    return id;
  }
  /** One decision per agent every ~`every` days. */
  act(day: number, every = 5) {
    for (const a of this.agents) {
      if (a.style === 'idle' || this.r.next() > 1 / every) continue;
      const mine = this.owned(a);
      if (a.style === 'builder') {
        if (!mine.length && day >= 1) this.found(a, this.r.pick(['farm', 'mill', 'dairy', 'pizza', 'cafe', 'timber']));
        for (const c of mine) { const s = this.db.get<{ cash: number; fixed: number }>('SELECT a.balance_minor - a.reserved_minor cash, c.employees * c.wage_minor + c.property_minor + c.marketing_minor fixed FROM companies c JOIN accounts a ON a.id = c.treasury_account_id WHERE c.id = ?', c.id)!; if (s.cash < 5 * s.fixed) this.cmd(a, { type: 'company.fund', companyId: c.id, amountMinor: 5 * s.fixed }); if (s.cash > 40 * s.fixed) this.cmd(a, { type: 'company.withdraw', companyId: c.id, amountMinor: Math.floor(s.cash / 4) }); }
      } else if (a.style === 'investor') {
        const sec = this.db.all<{ company_id: string }>("SELECT company_id FROM securities WHERE status = 'open' ORDER BY company_id");
        if (sec.length) { const c = this.r.pick(sec).company_id; const fair = this.db.get<{ v: number }>('SELECT fair_value_minor v FROM security_valuations WHERE company_id = ? ORDER BY tick DESC LIMIT 1', c)?.v ?? 100; this.cmd(a, { type: 'share.order', companyId: c, side: this.r.chance(0.7) ? 'buy' : 'sell', quantity: this.r.int(10, 60), limitPriceMinor: Math.max(1, Math.round(fair * (this.r.chance(0.5) ? 0.95 : 1.05))), orderKind: 'limit', acknowledgeControlLoss: true }); }
        if (this.r.chance(0.05)) this.cmd(a, { type: 'prestige.buy', itemId: this.r.pick(['veh-hatch', 'veh-executive']) });
      } else if (a.style === 'trader') {
        if (!mine.length && this.r.chance(0.3)) this.found(a, this.r.pick(['farm', 'dairy', 'mill']));
      }
    }
  }
}

function checkpoint(db: Sql, day: number, players: string[]): Checkpoint {
  const t = lastTick(db);
  const ms = db.get<{ c: number; s: number; tv: number; l: number }>('SELECT circulating_minor c, consumer_spend_minor s, trading_value_minor tv, loans_outstanding_minor l FROM monetary_stats ORDER BY tick DESC LIMIT 1');
  const spend7 = one<{ s: number }>(db, 'SELECT COALESCE(AVG(consumer_spend_minor),0) s FROM monetary_stats WHERE tick > ?', t - 7).s;
  const tv7 = one<{ s: number }>(db, 'SELECT COALESCE(AVG(trading_value_minor),0) s FROM monetary_stats WHERE tick > ?', t - 7).s;
  const circ = ms?.c ?? 1;
  return {
    day, circulatingEC: ec(circ), householdsEC: ec(one<{ b: number }>(db, 'SELECT balance_minor b FROM accounts WHERE id = ?', HOUSEHOLDS).b),
    cpiBps: db.get<{ i: number }>('SELECT index_bps i FROM cpi_index ORDER BY tick DESC LIMIT 1')?.i ?? 10_000,
    consumerSpendPerDayEC: ec(spend7), velocityBps: Math.round(((spend7 + tv7) * 365 * 10_000) / Math.max(1, circ)) ,
    operating: one<{ n: number }>(db, "SELECT COUNT(*) n FROM companies WHERE owner_kind <> 'state' AND status = 'operating'").n,
    playerOperating: players.length ? one<{ n: number }>(db, `SELECT COUNT(*) n FROM companies WHERE owner_kind = 'player' AND status = 'operating' AND owner_id IN (${players.map(() => '?').join(',')})`, ...players).n : 0,
    bankruptcies: one<{ n: number }>(db, 'SELECT COUNT(*) n FROM companies WHERE bankrupt_tick IS NOT NULL').n,
    unmetUnitsPerDay: Math.round(one<{ u: number }>(db, 'SELECT COALESCE(SUM(unmet_units),0) u FROM demand_tick_stats WHERE tick > ?', t - 7).u / 7),
    loansEC: ec(ms?.l ?? 0), shareIndexBps: db.get<{ v: number }>('SELECT value_bps v FROM market_index ORDER BY tick DESC LIMIT 1')?.v ?? 10_000,
  };
}

export function runScenario(spec: RunSpec): ScenarioReport {
  const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'new');
  const r = rng(spec.seed); const setup: string[] = []; const outcome: ScenarioReport['outcome'] = {};
  const pop = new Population(db, r, spec.players);
  const players = pop.agents.map((a) => a.id);
  const admin = (type: string, severity: number, days: number) => { const res = triggerEvent(db, 'scenario', type, severity, days, `scenario ${spec.id}: ${type}`); if (!res.ok) setup.push(`(event ${type} refused: ${res.message})`); };
  const cfgSet = (patch: Record<string, number>, note: string) => { saveConfig(db, { ...loadConfig(db), ...patch }, note); setup.push(note); };
  const start = one<{ c: number }>(db, "SELECT COALESCE(SUM(balance_minor),0) c FROM accounts WHERE kind <> 'issuance' AND id <> 'acct:burn'").c;
  const ticks: number[] = []; const checkpoints: Checkpoint[] = [];
  const every = Math.max(1, Math.floor(spec.days / 12));
  const step = (day: number) => { pop.act(day); const t0 = performance.now(); advance(db, 1); ticks.push(performance.now() - t0); if (day % every === 0 || day === spec.days) checkpoints.push(checkpoint(db, day, players)); };

  // scenario-specific stress: applied through the same levers an operator has
  const plan: Record<ScenarioId, (day: number) => void> = {
    A: () => {},
    POP: () => {},
    B: (d) => { if (d === 60) { cfgSet({ eventMaxActive: 3 }, 'allow three concurrent events'); } if (d >= 60 && d < 240 && d % 30 === 0) admin('recession', 3, 30); if (d === 60) setup.push('days 60–240: severe recession (severity 3) renewed every 30 days'); },
    C: (d) => { if (d === 60) setup.push('days 60–180: agricultural and supply-chain disruption (severity 3) renewed every 20 days'); if (d >= 60 && d < 180 && d % 20 === 0) { admin('agricultural_disruption', 3, 20); admin('supply_chain_disruption', 3, 20); } },
    D: (d) => { if (d === 60) setup.push('days 60–180: energy shortage (severity 3) renewed every 20 days'); if (d >= 60 && d < 180 && d % 20 === 0) admin('energy_shortage', 3, 20); },
    E: (d) => {
      if (d === 30) setup.push('days 30–90: every investor-style player bids 2× fair value for shares (bubble); days 90–150 they dump at 0.5× (reversal)');
      if (d >= 30 && d < 150) for (const a of pop.agents.filter((x) => x.style !== 'builder')) { const sec = db.all<{ company_id: string }>("SELECT company_id FROM securities WHERE status = 'open' ORDER BY company_id"); if (!sec.length) break; const c = r.pick(sec).company_id; const fair = db.get<{ v: number }>('SELECT fair_value_minor v FROM security_valuations WHERE company_id = ? ORDER BY tick DESC LIMIT 1', c)?.v ?? 100; const held = db.get<{ s: number }>('SELECT shares - reserved s FROM share_holdings WHERE company_id = ? AND investor_id = ?', c, a.id)?.s ?? 0; if (d < 90) pop.cmd(a, { type: 'share.order', companyId: c, side: 'buy', quantity: 40, limitPriceMinor: fair * 2, orderKind: 'limit', acknowledgeControlLoss: true }); else if (held > 0) pop.cmd(a, { type: 'share.order', companyId: c, side: 'sell', quantity: held, limitPriceMinor: Math.max(1, Math.floor(fair / 2)), orderKind: 'limit' }); }
    },
    F: (d) => {
      if (d !== 90) return;
      const victims = db.all<{ id: string; name: string; treasury_account_id: string; owner_id: string }>("SELECT c.id, c.name, c.treasury_account_id, c.owner_id FROM companies c WHERE c.owner_kind = 'npc' AND c.status = 'operating' ORDER BY c.employees DESC, c.id LIMIT 4");
      for (const v of victims) { const cash = one<{ b: number }>(db, 'SELECT balance_minor - reserved_minor b FROM accounts WHERE id = ?', v.treasury_account_id).b; if (cash > 0) transfer(db, { tick: lastTick(db), gameDate: 'scenario', actor: 'scenario' }, `scn:F:${v.id}`, v.treasury_account_id, HOUSEHOLDS, cash, 'owner_withdrawal', `scenario F: owners strip ${v.name}`); }
      setup.push(`day 90: the owners of the four largest NPC employers (${victims.map((v) => v.name).join(', ')}) withdraw all their cash at once`);
    },
    G: (d) => { if (d === 30) cfgSet({ stipendPerThousandMinor: loadConfig(db).stipendPerThousandMinor * 6, supplyTargetMinor: 0 }, 'day 30: citizen income grant ×6 and the supply-target controller switched off (issuance far ahead of goods)'); },
    H: (d) => {
      if (d !== 2) return;
      const king = pop.agents[0]!; const made: string[] = [];
      for (const ind of ['farm', 'farm', 'mill', 'dairy', 'pizza']) { const id = pop.found(king, ind); if (id) made.push(id); }
      setup.push(`day 2: one player founds a vertical chain (${made.length} companies: farms, mill, dairy, pizza) and keeps every company stocked to corner wheat and milk`);
      outcome.dominantCompanies = made.length;
    },
    I: () => {},
  };

  setup.unshift(`seed ${spec.seed}, ${spec.players} player agents, ${spec.days} days, fresh Bristol ('new' profile)`);
  for (let d = 1; d <= spec.days; d++) { plan[spec.id](d); step(d); }

  if (spec.id === 'I') {   // mass financial claims (simulated GBP only)
    const g = (ms = 1) => ({ tick: lastTick(db), ms, actor: 'scenario' });
    fundTreasury(db, g(), 'scn:I:fund', 5_000_000, 'scenario: owner funds the simulated treasury');
    createProgram(db, g(), { id: 'scn-mass', name: 'Mass claim (simulated)', source: 'promotion', rules: [{ kind: 'open' }], awardPence: 500, budgetPence: Math.max(500, Math.floor(spec.players / 2) * 500), perPlayerMax: 1 });
    fundProgram(db, g(), 'scn-mass', Math.max(500, Math.floor(spec.players / 2) * 500));
    let awarded = 0, refused = 0, dupes = 0, paid = 0, wdRefused = 0;
    for (const [i, a] of pop.agents.entries()) {
      const dep = createDeposit(db, g(), { playerId: a.id, amountPence: 1_000, key: `scn:dep:${i}` }); handleDepositEvent(db, g(), sandboxEvent(dep.depositId, 'succeeded')); handleDepositEvent(db, g(), sandboxEvent(dep.depositId, 'succeeded'));
      for (const k of [`claim:${i}`, `claim:${i}`, `claim:${i}:again`]) { try { const x = awardReward(db, g(), { programId: 'scn-mass', playerId: a.id, key: k }); if (x.duplicate) dupes++; else awarded++; } catch { refused++; } }
    }
    for (const [i, a] of pop.agents.entries()) { try { const w = requestWithdrawal(db, g(), { playerId: a.id, amountPence: 500, key: `scn:wd:${i}` }); approveWithdrawal(db, g(), w.withdrawalId); settleWithdrawal(db, g(), w.withdrawalId, 'paid', `scn:evt:${i}`); settleWithdrawal(db, g(), w.withdrawalId, 'paid', `scn:evt:${i}`); paid++; } catch { wdRefused++; } }
    Object.assign(outcome, { rewardsAwarded: awarded, rewardsRefusedBudget: refused, duplicateClaimsIgnored: dupes, withdrawalsPaid: paid, withdrawalsRefused: wdRefused });
    setup.push(`after the run: ${spec.players} players each deposit £10 (with a duplicate webhook), claim a £5 reward three times against a budget for half of them, then all withdraw £5 at once`);
  }

  // ── measurements ──
  const end = one<{ c: number }>(db, "SELECT COALESCE(SUM(balance_minor),0) c FROM accounts WHERE kind <> 'issuance' AND id <> 'acct:burn'").c;
  const a = deepAudit(db); const g = reconcileGbp(db);
  const cpi = db.all<{ i: number }>('SELECT index_bps i FROM cpi_index ORDER BY tick');
  const cpiStart = cpi[Math.min(cpi.length - 1, 7)]?.i ?? 10_000, cpiEnd = cpi.at(-1)?.i ?? 10_000;
  const years = Math.max(1 / 365, (spec.days - 7) / 365);
  const industries: ScenarioReport['industries'] = {};
  for (const ind of db.all<{ industry_id: string; n: number; op: number; f: number }>("SELECT industry_id, COUNT(*) n, SUM(status = 'operating') op, SUM(bankrupt_tick IS NOT NULL) f FROM companies WHERE owner_kind <> 'state' GROUP BY industry_id ORDER BY industry_id")) {
    const s = one<{ p: number | null; r: number | null }>(db, "SELECT AVG(s.net_profit_minor) p, AVG(s.revenue_minor) r FROM company_tick_stats s JOIN companies c ON c.id = s.company_id WHERE c.industry_id = ? AND c.owner_kind <> 'state' AND s.status = 'operating'", ind.industry_id);
    industries[ind.industry_id] = { companies: ind.n, operating: ind.op, meanDailyProfitEC: Math.round((s.p ?? 0) / 100), meanDailyRevenueEC: Math.round((s.r ?? 0) / 100), failures: ind.f };
  }
  const top: Record<string, number> = {};
  for (const c of db.all<{ commodity_id: string; share: number }>('SELECT commodity_id, MAX(q) * 10000 / SUM(q) share FROM (SELECT commodity_id, seller_company_id, SUM(qty) q FROM trades WHERE tick > ? GROUP BY 1,2) GROUP BY commodity_id', lastTick(db) - 60)) top[c.commodity_id] = Math.round(c.share);
  return {
    spec, setup, checkpoints,
    money: { startEC: ec(start), endEC: ec(end), changeBps: Math.round(((end - start) * 10_000) / Math.max(1, start)), issuedByReasonEC: Object.fromEntries(Object.entries(a.issuanceByReason).map(([k, v]) => [k, ec(v)])), destroyedByReasonEC: Object.fromEntries(Object.entries(a.sinksByReason).map(([k, v]) => [k, ec(v)])) },
    inflation: { cpiStartBps: cpiStart, cpiEndBps: cpiEnd, annualisedBps: Math.round((Math.pow(cpiEnd / cpiStart, 1 / years) - 1) * 10_000) },
    industries, concentration: { topSellerShareBps: top },
    credit: { loansMade: one<{ n: number }>(db, 'SELECT COUNT(*) n FROM loans').n, defaults: one<{ n: number }>(db, 'SELECT COUNT(*) n FROM credit_defaults').n, writtenOffEC: ec(one<{ w: number }>(db, 'SELECT COALESCE(SUM(written_off_minor),0) w FROM credit_defaults').w) },
    markets: { commodityTrades: one<{ n: number }>(db, 'SELECT COUNT(*) n FROM trades').n, commodityValueEC: ec(one<{ v: number }>(db, 'SELECT COALESCE(SUM(qty * price_minor),0) v FROM trades').v), shareTrades: one<{ n: number }>(db, 'SELECT COUNT(*) n FROM share_trades').n, shareValueEC: ec(one<{ v: number }>(db, 'SELECT COALESCE(SUM(qty * price_minor),0) v FROM share_trades').v) },
    wallet: { liabilitiesPence: -(g.totals.walletLiabilities + g.totals.pendingLiabilities), reconciles: g.ok },
    performance: { msPerTickAvg: Math.round(ticks.reduce((x, y) => x + y, 0) / Math.max(1, ticks.length)), msPerTickMax: Math.round(Math.max(0, ...ticks)), msPerCommand: Math.round((pop.cmdMs / Math.max(1, pop.commands)) * 100) / 100, commands: pop.commands },
    audit: { ok: a.ok, findings: a.findings.map((f) => `${f.severity} ${f.id}: ${f.detail} (${f.count}) e.g. ${JSON.stringify(f.sample).slice(0, 300)}`) },
    outcome: { ...outcome, playersStillOperating: checkpoints.at(-1)?.playerOperating ?? 0, finalOperating: checkpoints.at(-1)?.operating ?? 0, finalUnmetUnitsPerDay: checkpoints.at(-1)?.unmetUnitsPerDay ?? 0 },
  };
  void setParam;
}

export const SCENARIOS: RunSpec[] = [
  { id: 'A', name: 'Stable growth (3 years)', seed: 101, players: 10, days: 1095 },
  { id: 'B', name: 'Severe recession', seed: 102, players: 10, days: 365 },
  { id: 'C', name: 'Supply-chain collapse (wheat and flour)', seed: 103, players: 10, days: 365 },
  { id: 'D', name: 'Energy crisis', seed: 104, players: 10, days: 365 },
  { id: 'E', name: 'Share bubble and reversal', seed: 105, players: 30, days: 200 },
  { id: 'F', name: 'Mass bankruptcy of major employers', seed: 106, players: 10, days: 365 },
  { id: 'G', name: 'Inflation shock', seed: 107, players: 10, days: 365 },
  { id: 'H', name: 'Dominant player (vertical chain)', seed: 108, players: 5, days: 365 },
  { id: 'I', name: 'Mass financial claims (1,000 players)', seed: 109, players: 1_000, days: 30 },
];
export const POPULATIONS: RunSpec[] = [1, 10, 100, 1_000].map((n, i) => ({ id: 'POP' as const, name: `${n} player${n === 1 ? '' : 's'}, one year`, seed: 200 + i, players: n, days: 365 }));
