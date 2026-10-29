import type { Sql } from '../db/sql';
import { HOUSEHOLDS } from '../seed/bristol';

/** Developer view of the living city. Everything is read from recorded tables; nothing is estimated or cached. */
export interface LivingDashboard {
  npcByIndustry: { industry: string; npc: number; player: number; closed: number }[];
  shareByOwner: { industry: string; playerBps: number; npcBps: number }[];
  purchasingPower: { window: number; householdIncomeByOrigin: { origin: string; kind: string; amount: number; issuance: boolean }[]; householdSpendByRule: { rule: string; funded: number; spent: number }[]; spendBySegment: { segment: string; spend: number }[] };
  profitDistribution: { buckets: { label: string; companies: number }[]; median7: number; top10ShareBps: number };
  concentration: { industry: string; hhiBps: number; leaderShareBps: number }[];
  entryExit: { opened: number; closed: number; bankruptcies: number; recent: { tick: number; kind: string; text: string }[] };
  stability: { tick: number; circulating: number; households: number; npcCash: number; playerCash: number; gini: number; companies: number; failures: number }[];
  strategies: { strategy: string; companies: number }[];
  npcInspector: { company: string; name: string; strategy: string; sinceTick: number; nextReview: number; lastDecisions: { tick: number; action: string; reason: string; applied: boolean }[] }[];
  configVersions: { version: number; tick: number; note: string }[];
}

export function livingDashboard(db: Sql, tick: number): LivingDashboard {
  const since = Math.max(0, tick - 7), since30 = Math.max(0, tick - 30);
  const inds = db.all<{ industry_id: string }>("SELECT DISTINCT industry_id FROM companies WHERE owner_kind <> 'state' ORDER BY industry_id").map((r) => r.industry_id);
  const npcByIndustry = inds.map((i) => ({
    industry: i,
    npc: db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE industry_id = ? AND owner_kind = 'npc' AND bankrupt_tick IS NULL AND status <> 'insolvent'", i)!.n,
    player: db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE industry_id = ? AND owner_kind = 'player' AND bankrupt_tick IS NULL AND status <> 'insolvent'", i)!.n,
    closed: db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE industry_id = ? AND owner_kind <> 'state' AND (bankrupt_tick IS NOT NULL OR status = 'insolvent')", i)!.n,
  }));
  const units = (i: string, owner?: string) => db.get<{ u: number }>(`SELECT COALESCE(SUM(s.units_sold),0) u FROM company_tick_stats s JOIN companies c ON c.id = s.company_id WHERE c.industry_id = ? AND c.owner_kind ${owner ? '= ?' : "<> 'state'"} AND s.tick > ?`, ...(owner ? [i, owner, since] : [i, since]))!.u;
  const shareByOwner = inds.map((i) => { const tot = units(i); return { industry: i, playerBps: tot ? Math.floor((units(i, 'player') * 10_000) / tot) : 0, npcBps: tot ? Math.floor((units(i, 'npc') * 10_000) / tot) : 0 }; });

  // Where household purchasing power comes from: every coin posted INTO the households account, by the ledger kind and memo that put it there.
  const income = db.all<{ k: string; m: string; a: number }>("SELECT t.kind k, CASE WHEN t.memo LIKE 'NPC citizen%' THEN 'citizen income (new coins)' WHEN t.memo LIKE '%dividend%' OR t.memo LIKE '%shareholders%' THEN 'company payouts to shareholders' WHEN t.memo LIKE '%payroll%' OR t.memo LIKE '%wage%' OR t.memo LIKE '%staff%' THEN 'wages' ELSE substr(t.memo,1,40) END m, SUM(p.amount_minor) a FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE p.account_id = ? AND p.amount_minor > 0 AND t.tick > ? GROUP BY t.kind, m ORDER BY a DESC LIMIT 12", HOUSEHOLDS, since30);
  const householdIncomeByOrigin = income.map((r) => ({ origin: r.m, kind: r.k, amount: r.a, issuance: r.k === 'issuance' }));
  const householdSpendByRule = db.all<{ rule_id: string; f: number; s: number }>('SELECT rule_id, SUM(funded_minor) f, SUM(spent_minor) s FROM consumer_budget_log WHERE tick > ? GROUP BY rule_id ORDER BY s DESC', since30).map((r) => ({ rule: r.rule_id, funded: r.f, spent: r.s }));
  const spendBySegment = db.all<{ segment_id: string; s: number }>('SELECT segment_id, SUM(spend_minor) s FROM segment_sales WHERE tick > ? GROUP BY segment_id ORDER BY s DESC', since30).map((r) => ({ segment: r.segment_id, spend: r.s }));

  const profits = db.all<{ p: number }>("SELECT COALESCE(SUM(net_profit_minor),0) p FROM company_tick_stats s JOIN companies c ON c.id = s.company_id WHERE c.owner_kind <> 'state' AND c.bankrupt_tick IS NULL AND s.tick > ? GROUP BY s.company_id ORDER BY p", since).map((r) => r.p);
  const edges: [string, (p: number) => boolean][] = [['loss', (p) => p < 0], ['0–50 EC', (p) => p >= 0 && p < 5_000], ['50–200 EC', (p) => p >= 5_000 && p < 20_000], ['200+ EC', (p) => p >= 20_000]];
  const pos = profits.filter((p) => p > 0).reduce((a, b) => a + b, 0), top = [...profits].sort((a, b) => b - a).slice(0, 10).filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const profitDistribution = { buckets: edges.map(([label, f]) => ({ label, companies: profits.filter(f).length })), median7: profits.length ? profits[Math.floor(profits.length / 2)]! : 0, top10ShareBps: pos ? Math.floor((top * 10_000) / pos) : 0 };

  const concentration = inds.map((i) => {
    const us = db.all<{ u: number }>("SELECT COALESCE(SUM(s.units_sold),0) u FROM company_tick_stats s JOIN companies c ON c.id = s.company_id WHERE c.industry_id = ? AND c.owner_kind <> 'state' AND s.tick > ? GROUP BY s.company_id", i, since).map((r) => r.u);
    const tot = us.reduce((a, b) => a + b, 0);
    const shares = tot ? us.map((u) => Math.floor((u * 10_000) / tot)) : [];
    return { industry: i, hhiBps: shares.reduce((a, s) => a + Math.floor((s * s) / 10_000), 0), leaderShareBps: shares.length ? Math.max(...shares) : 0 };
  });
  const cnt = (kind: string) => db.get<{ n: number }>('SELECT COUNT(*) n FROM economic_events WHERE kind = ?', kind)!.n;
  const entryExit = { opened: cnt('company_opened'), closed: cnt('company_closed'), bankruptcies: cnt('bankruptcy'), recent: db.all<{ tick: number; kind: string; message: string }>("SELECT tick, kind, message FROM economic_events WHERE kind IN ('company_opened','company_closed','bankruptcy') ORDER BY id DESC LIMIT 10").map((e) => ({ tick: e.tick, kind: e.kind, text: e.message })) };
  const stability = db.all<{ tick: number; circulating_minor: number; households_minor: number; npc_cash_minor: number; player_cash_minor: number; gini_bps: number; company_count: number; failures_cum: number }>('SELECT * FROM (SELECT * FROM stability_stats ORDER BY tick DESC LIMIT 60) ORDER BY tick')
    .map((r) => ({ tick: r.tick, circulating: r.circulating_minor, households: r.households_minor, npcCash: r.npc_cash_minor, playerCash: r.player_cash_minor, gini: r.gini_bps, companies: r.company_count, failures: r.failures_cum }));
  const strategies = db.all<{ strategy: string; n: number }>("SELECT p.strategy, COUNT(*) n FROM npc_profiles p JOIN companies c ON c.id = p.company_id WHERE c.bankrupt_tick IS NULL AND c.status <> 'insolvent' GROUP BY p.strategy ORDER BY n DESC").map((r) => ({ strategy: r.strategy, companies: r.n }));
  const npcInspector = db.all<{ id: string; name: string; strategy: string; strategy_since_tick: number; next_decision_tick: number }>("SELECT c.id, c.name, p.strategy, p.strategy_since_tick, p.next_decision_tick FROM npc_profiles p JOIN companies c ON c.id = p.company_id WHERE c.owner_kind = 'npc' AND c.bankrupt_tick IS NULL ORDER BY c.id").map((r) => ({
    company: r.id, name: r.name, strategy: r.strategy, sinceTick: r.strategy_since_tick, nextReview: r.next_decision_tick,
    lastDecisions: db.all<{ tick: number; action: string; reason: string; applied: number }>('SELECT tick, action, reason, applied FROM npc_decisions WHERE company_id = ? ORDER BY id DESC LIMIT 4', r.id).map((d) => ({ tick: d.tick, action: d.action, reason: d.reason, applied: d.applied === 1 })),
  }));
  const configVersions = db.all<{ version: number; tick: number; note: string }>('SELECT version, tick, note FROM config_versions ORDER BY version DESC LIMIT 10');
  return { npcByIndustry, shareByOwner, purchasingPower: { window: 30, householdIncomeByOrigin, householdSpendByRule, spendBySegment }, profitDistribution, concentration, entryExit, stability, strategies, npcInspector, configVersions };
}
