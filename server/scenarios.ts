import type { Sql } from './db/sql';
import { configureCompany } from './engine/commands';
import { createCompany } from './engine/company';
import { loadConfig, saveConfig, type EngineConfig } from './engine/config';
import { balance, issue, reconcile, supply } from './engine/ledger';
import { openNpcCompany, type Strategy } from './engine/npc';
import { runTick } from './engine/tick';
import { lastTick, openWorld } from './engine/world';
import { HOUSEHOLDS, PLAYER_WALLET, companyAccount } from './seed/bristol';

export type ScenarioId = 'A' | 'B' | 'C' | 'D' | 'D-energy' | 'E' | 'F';
export interface ScenarioReport {
  id: ScenarioId; name: string; days: number; setup: string[]; notes: string[]; anomalies: string[]; reconciles: boolean;
  supply: { start: number; end: number; changeBps: number };
  companies: { start: number; end: number; opened: number; closed: number; bankrupt: number };
  industries: { industry: string; live: number; npc: number; player: number; playerShareBps: number; hhiBps: number; avgPrice: number }[];
  player: { companies: number; worthStart: number; worthEnd: number; profit: number; shareOfAllUnitsBps: number } | null;
  prices: { commodity: string; reference: number; first: number | null; last: number | null; min: number | null; max: number | null }[];
  shortageDays: number; giniEndBps: number; consumerSpendDay: number; consumerSpendFirst: number;
  timeline: { day: number; circulating: number; live: number; consumerSpend: number; units: number }[];
  decisions: number; strategies: { strategy: string; n: number }[];
}

const NAMES = ['Aldwych', 'Brislington', 'Cabot', 'Dundry', 'Easton', 'Filton', 'Gloucester', 'Hotwells', 'Kingsdown', 'Lawrence', 'Montpelier', 'Newfound', 'Oldbury', 'Pylle', 'Quaker', 'Redland', 'Stokes', 'Totterdown', 'Upper Mills', 'Victoria', 'Whiteladies', 'Yate'];
const STRATS: Strategy[] = ['budget', 'premium', 'growth', 'conservative', 'opportunistic'];
let seqKey = 0; const key = (p: string) => `${p}-${seqKey++}`;
const ctx0 = (db: Sql) => ({ tick: lastTick(db), gameDate: 'scenario', actor: 'scenario' });
const grant = (db: Sql, to: string, amount: number, why: string) => issue(db, ctx0(db), key(`scn:grant:${to}`), to, amount, `scenario grant: ${why}`);
const worth = (db: Sql, ids: string[]) => ids.reduce((a, id) => a + balance(db, companyAccount(id)) + db.get<{ v: number }>('SELECT COALESCE(SUM(value_minor),0) v FROM inventory WHERE company_id = ?', id)!.v, 0);
const live = (db: Sql) => db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE owner_kind <> 'state' AND bankrupt_tick IS NULL AND status <> 'insolvent'")!.n;

/** Test-only: extra vacant lots so a 100-company city has somewhere to stand. Real lots keep their ids; these are labelled so no one mistakes them for the map. */
function addLots(db: Sql, n: number) {
  const specs = db.all<{ w: number; d: number }>('SELECT DISTINCT plot_width w, plot_depth d FROM industry_specs WHERE startable = 1');
  const dist = db.all<{ id: string }>('SELECT id FROM districts ORDER BY id');
  let i = 0;
  for (let k = 0; k < n; k++) { const s = specs[k % specs.length]!; db.run("INSERT INTO plots (id, city_id, district_id, col, row, width, depth, terrain, road_mask, quay_mask, asset_id, company_id) VALUES (?,?,?,?,?,?,?,'paving',0,0,NULL,NULL)", `lot-x-${k}`, 'city-bristol', dist[k % dist.length]!.id, (k * 3) % 13, 1 + ((k * 5) % 17), s.w, s.d); i++; }
  return i;
}

/** Seed `n` NPC companies round-robin over the startable industries, funded by an explicit, recorded grant to the NPC households. */
function seedNpcs(db: Sql, cfg: EngineConfig, n: number, mix?: Record<string, number>) {
  const inds = db.all<{ industry_id: string; plot_width: number; plot_depth: number; working_capital_minor: number }>('SELECT industry_id, plot_width, plot_depth, working_capital_minor FROM industry_specs WHERE startable = 1 ORDER BY industry_id');
  // `mix` is a weighted list (industry → share of n); without it firms are dealt round-robin.
  const order: typeof inds = [];
  if (mix) { const tot = Object.values(mix).reduce((a, b) => a + b, 0); const left = new Map(inds.map((i) => [i.industry_id, Math.round((n * (mix[i.industry_id] ?? 0)) / tot)])); let more = true; while (more) { more = false; for (const i of inds) if ((left.get(i.industry_id) ?? 0) > 0) { order.push(i); left.set(i.industry_id, left.get(i.industry_id)! - 1); more = true; } } }
  else for (let k = 0; k < n; k++) order.push(inds[k % inds.length]!);
  const ids: string[] = []; const used = new Map<string, number>();
  for (let k = 0; k < order.length; k++) {
    const spec = order[k]!;
    const lot = db.get<{ id: string }>("SELECT p.id FROM plots p WHERE p.id LIKE 'lot-%' AND p.company_id IS NULL AND p.asset_id IS NULL AND p.width = ? AND p.depth = ? ORDER BY p.id LIMIT 1", spec.plot_width, spec.plot_depth);
    if (!lot) continue;
    grant(db, HOUSEHOLDS, cfg.npcEntryCapitalMinor, 'NPC entrepreneur capital');
    const nth = (used.get(spec.industry_id) ?? 0) + 1; used.set(spec.industry_id, nth);
    const r = openNpcCompany(db, ctx0(db), cfg, { industry: spec.industry_id, plotId: lot.id, name: `${NAMES[(nth - 1) % NAMES.length]} ${spec.industry_id[0]!.toUpperCase()}${spec.industry_id.slice(1)} ${Math.ceil(nth / NAMES.length)}`, workingCapitalMinor: Math.floor(spec.working_capital_minor * 1.5), strategy: STRATS[k % STRATS.length]!, key: key('scn:npc') });
    if (r.ok) ids.push(r.companyId);
  }
  return ids;
}

function playerFound(db: Sql, industry: string, plot: string, name: string, capital?: number) {
  const r = createCompany(db, key('scn:found'), { industry, plotId: plot, tier: 1, name, workingCapitalMinor: capital, expectedTotalMinor: undefined as never });
  if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
  return (r.data as { companyId: string }).companyId;
}
const freeLot = (db: Sql, industry: string) => db.get<{ id: string }>("SELECT p.id FROM plots p JOIN industry_specs s ON s.plot_width = p.width AND s.plot_depth = p.depth WHERE s.industry_id = ? AND (p.id LIKE 'lot-%' OR p.id IN ('plot-pizza','plot-cafe')) AND p.company_id IS NULL AND p.asset_id IS NULL ORDER BY p.id LIMIT 1", industry)!.id;
const setCfg = (db: Sql, patch: Partial<EngineConfig>, note: string) => saveConfig(db, { ...loadConfig(db), ...patch }, note);
const rev = (db: Sql, id: string) => db.get<{ r: number }>('SELECT revision r FROM companies WHERE id = ?', id)!.r;

export let lastWorld: Sql | null = null;
export function runScenario(id: ScenarioId, days: number): ScenarioReport {
  const base: Partial<EngineConfig> = { realMsPerTick: 3_600_000_000 };
  const db: Sql = openWorld(':memory:', id === 'C' ? { ...base, stateSupplyPerTick: 960, stateSupplyCap: 3_200, npcMaxCompanies: 120, npcMaxPerIndustry: 25, npcReservedLots: 0, npcEntryEveryTicks: 3 } : base, 'new');
  lastWorld = db;
  const setup: string[] = [], notes: string[] = [], anomalies: string[] = [];
  const cfg = loadConfig(db);
  let mine: string[] = [], name = '';
  let startLive = 0;

  if (id === 'A') {
    name = 'A — Solo Player'; setup.push('One player-owned pizza restaurant on default settings against the seeded NPC city; no further input after day 0.');
    grant(db, PLAYER_WALLET, 2_000_000, 'player startup money'); mine = [playerFound(db, 'pizza', freeLot(db, 'pizza'), 'Solo Slice')];
  } else if (id === 'B') {
    name = 'B — Small Community (10 companies)'; setup.push('The seeded city plus NPC seeding up to 10 live firms, and two player companies (pizza and café).');
    grant(db, PLAYER_WALLET, 2_500_000, 'player startup money'); mine = [playerFound(db, 'pizza', freeLot(db, 'pizza'), 'Community Pizza'), playerFound(db, 'cafe', freeLot(db, 'cafe'), 'Community Cafe')];
    const need = Math.max(0, 10 - live(db)); seedNpcs(db, cfg, need);
  } else if (id === 'C') {
    name = 'C — Growing City (100 companies)'; const n = addLots(db, 120);
    db.run('UPDATE cities SET population = ?', 450_000);
    setup.push(`${n} synthetic vacant lots added (stress test only — the real map has about 14), NPC cap raised to 120, entry every 3 days, 90 NPC firms seeded on day 0 from recorded household grants (mix: 24 pizza, 18 cafe, 12 dairy, 12 mill, 12 farm, 12 timber — roughly one input supplier per two consumer-facing restaurants), and the state provisioner's raw-material intake raised 8× to match (a city this size needs more milk and wheat; the fixed intake was what starved the first attempt), and the city's population grown from 50,000 to 450,000 (citizen income and consumer budgets both scale with population; a city cannot hold 100 firms on a village's demand).`);
    grant(db, PLAYER_WALLET, 2_500_000, 'player startup money'); mine = [playerFound(db, 'pizza', freeLot(db, 'pizza'), 'Growth Pizza')];
    seedNpcs(db, cfg, 90, { pizza: 24, cafe: 18, dairy: 12, mill: 12, farm: 12, timber: 12 });
  } else if (id === 'D' || id === 'D-energy') {
    name = id === 'D' ? 'D — Supply Crisis (flour)' : 'D — Supply Crisis (energy)';
    setup.push(id === 'D' ? 'Days 30–50: every mill is shut (paused). Bakery-chain pizza makers must buy flour elsewhere or stop.' : 'Days 30–50: the city power station is shut. Every producer that burns energy must buy it elsewhere or stop.');
    grant(db, PLAYER_WALLET, 2_000_000, 'player startup money'); mine = [playerFound(db, 'pizza', freeLot(db, 'pizza'), 'Crisis Pizza')];
    seedNpcs(db, cfg, 4);
  } else if (id === 'E') {
    name = 'E — Recession'; setup.push('Days 30–70: consumer spending shock of −30% on every household budget (versioned config change), then restored.');
    grant(db, PLAYER_WALLET, 2_000_000, 'player startup money'); mine = [playerFound(db, 'pizza', freeLot(db, 'pizza'), 'Recession Pizza'), playerFound(db, 'cafe', freeLot(db, 'cafe'), 'Recession Cafe')];
  } else {
    name = 'F — Dominant Company'; setup.push('A deeply capitalised player integrates the pizza chain (farm, mill, three pizza restaurants), undercuts rivals by 10% and advertises heavily.');
    grant(db, PLAYER_WALLET, 30_000_000, 'player startup money (deliberately dominant)');
    mine = [playerFound(db, 'farm', freeLot(db, 'farm'), 'Titan Farm', 2_000_000), playerFound(db, 'mill', freeLot(db, 'mill'), 'Titan Mill', 2_000_000), playerFound(db, 'pizza', freeLot(db, 'pizza'), 'Titan Pizza One', 2_000_000)];
    mine.push(playerFound(db, 'pizza', freeLot(db, 'pizza'), 'Titan Pizza Two', 2_000_000)); const l3 = db.get<{ id: string }>("SELECT p.id FROM plots p WHERE p.id LIKE 'lot-%' AND p.company_id IS NULL AND p.asset_id IS NULL AND p.width = 2 AND p.depth = 2 LIMIT 1"); if (l3) mine.push(playerFound(db, 'pizza', l3.id, 'Titan Pizza Three', 2_000_000));
    for (const p of mine.filter((m) => m.includes('pizza') || true)) { void p; }
  }
  startLive = live(db);
  const startWorth = worth(db, mine);
  const supplyStart = supply(db).circulating;
  const timeline: ScenarioReport['timeline'] = [];
  let prev = supplyStart, openedBefore = db.get<{ n: number }>("SELECT COUNT(*) n FROM economic_events WHERE kind = 'company_opened'")!.n;
  let firstSpend = 0, shortageDays = 0;
  const mills = db.all<{ id: string }>("SELECT id FROM companies WHERE industry_id = 'mill'").map((r) => r.id);
  const power = db.all<{ id: string }>("SELECT id FROM companies WHERE industry_id = 'utility'").map((r) => r.id);

  for (let day = 1; day <= days; day++) {
    if ((id === 'D' && (day === 30 || day === 50)) || (id === 'D-energy' && (day === 30 || day === 50))) {
      const targets = id === 'D' ? mills : power; const to = day === 30 ? 'paused' : 'operating';
      for (const t of targets) db.run('UPDATE companies SET status = ?, revision = revision + 1 WHERE id = ?', to, t);
    }
    if (id === 'E' && (day === 30 || day === 70)) setCfg(db, { consumerShockBps: day === 30 ? 3_000 : 0 }, day === 30 ? 'scenario E: recession begins' : 'scenario E: recession ends');
    if (id === 'F' && day % 3 === 0) {
      for (const m of mine) {
        const c = db.get<{ industry_id: string; price_minor: number }>('SELECT industry_id, price_minor FROM companies WHERE id = ?', m)!;
        if (c.industry_id !== 'pizza') continue;
        const rivals = db.all<{ p: number }>("SELECT price_minor p FROM companies WHERE industry_id = 'pizza' AND owner_kind <> 'player' AND bankrupt_tick IS NULL AND status = 'operating' AND price_minor > 0").map((r) => r.p);
        const target = rivals.length ? Math.floor(Math.min(...rivals) * 0.9) : c.price_minor;
        configureCompany(db, key('scn:f'), m, rev(db, m), { priceMinor: Math.max(target, db.get<{ p: number }>('SELECT min_price_minor p FROM companies WHERE id = ?', m)!.p), marketingMinorPerTick: 3_000, plannedUnitsPerTick: undefined });
      }
    }
    const r = runTick(db, lastTick(db) + 1);
    if (r.status !== 'complete') { anomalies.push(`tick ${day} ${r.status}`); break; }
    const s = supply(db); const net = s.issued - s.destroyed;
    if (net !== s.circulating) anomalies.push(`day ${day}: issued − destroyed ≠ circulating`);
    void prev; prev = s.circulating;
    const sp = r.summary.consumerSpendMinor; if (day === 1) firstSpend = sp;
    if (day % Math.max(1, Math.floor(days / 12)) === 0 || day === days) timeline.push({ day, circulating: s.circulating, live: live(db), consumerSpend: sp, units: r.summary.unitsProduced });
    if (r.summary.unmetUnits > 0) shortageDays++;
  }
  const rec = reconcile(db); const tick = lastTick(db);
  const inds = db.all<{ industry_id: string }>("SELECT DISTINCT industry_id FROM companies WHERE owner_kind <> 'state' ORDER BY industry_id").map((r) => r.industry_id);
  const since = Math.max(0, tick - 14);
  const industries = inds.map((i) => {
    const rows = db.all<{ id: string; owner_kind: string; u: number; price_minor: number }>("SELECT c.id, c.owner_kind, c.price_minor, COALESCE((SELECT SUM(units_sold) FROM company_tick_stats s WHERE s.company_id = c.id AND s.tick > ?),0) u FROM companies c WHERE c.industry_id = ? AND c.owner_kind <> 'state' AND c.bankrupt_tick IS NULL AND c.status <> 'insolvent'", since, i);
    const tot = rows.reduce((a, r) => a + r.u, 0), pl = rows.filter((r) => r.owner_kind === 'player').reduce((a, r) => a + r.u, 0);
    return { industry: i, live: rows.length, npc: rows.filter((r) => r.owner_kind === 'npc').length, player: rows.filter((r) => r.owner_kind === 'player').length, playerShareBps: tot ? Math.floor((pl * 10_000) / tot) : 0, hhiBps: tot ? rows.reduce((a, r) => a + Math.floor((Math.floor((r.u * 10_000) / tot) ** 2) / 10_000), 0) : 0, avgPrice: rows.length ? Math.round(rows.reduce((a, r) => a + r.price_minor, 0) / rows.length) : 0 };
  });
  const allUnits = db.get<{ u: number }>("SELECT COALESCE(SUM(units_sold),0) u FROM company_tick_stats s JOIN companies c ON c.id = s.company_id WHERE c.owner_kind <> 'state' AND s.tick > ?", since)!.u;
  const myUnits = mine.length ? db.get<{ u: number }>(`SELECT COALESCE(SUM(units_sold),0) u FROM company_tick_stats WHERE tick > ? AND company_id IN (${mine.map(() => '?').join(',')})`, since, ...mine)!.u : 0;
  const prices = db.all<{ commodity_id: string }>("SELECT DISTINCT commodity_id FROM market_stats WHERE vwap_minor IS NOT NULL ORDER BY commodity_id").map((c) => {
    const v = db.all<{ v: number }>('SELECT vwap_minor v FROM market_stats WHERE commodity_id = ? AND vwap_minor IS NOT NULL ORDER BY tick', c.commodity_id).map((r) => r.v);
    return { commodity: c.commodity_id, reference: db.get<{ p: number }>('SELECT reference_price_minor p FROM commodities WHERE id = ?', c.commodity_id)!.p, first: v[0] ?? null, last: v.at(-1) ?? null, min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null };
  });
  const st = db.get<{ gini_bps: number; consumer_spend_minor: number }>('SELECT gini_bps, consumer_spend_minor FROM stability_stats WHERE tick = ?', tick);
  const opened = db.get<{ n: number }>("SELECT COUNT(*) n FROM economic_events WHERE kind = 'company_opened'")!.n - openedBefore;
  if (!rec.ok) anomalies.push(...rec.problems.slice(0, 5));
  if (id === 'D' || id === 'D-energy') { const p = prices.find((x) => x.commodity === (id === 'D' ? 'flour' : 'energy')); if (p?.max && p.reference) notes.push(`${p.commodity} traded as high as ${(p.max / 100).toFixed(2)} EC against a ${(p.reference / 100).toFixed(2)} EC reference (${Math.round((p.max * 100) / p.reference)}% of reference).`); }
  const sink = db.get<{ m: string; a: number }>("SELECT CASE WHEN t.memo LIKE 'incorporation licence%' THEN 'incorporation licences' ELSE t.memo END m, SUM(p.amount_minor) a FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.kind IN ('sink','sink_fee') AND p.amount_minor > 0 GROUP BY 1 ORDER BY a DESC LIMIT 1");
  if (sink) notes.push(`Largest explicit coin destruction over the run: ${sink.m} — ${ec(sink.a)} (every destruction is a recorded sink; transfers are never counted as sinks).`);
  if (id === 'C') notes.push('Uniform seeding is a stress test, not a forecast: 90 firms opened on day 0 into a city whose households can only fund so many. The shake-out above is the engine behaving as designed — failing firms are liquidated through the ledger, nothing is rescued, and nothing is created or lost off the books.');
  if (id === 'F') notes.push(`The dominant player held ${(myUnits * 100 / Math.max(1, allUnits)).toFixed(1)}% of all units sold in the final fortnight; no rules cap dominance, the market simply answers with its own prices and entrants.`);
  return {
    id, name, days, setup, notes, anomalies, reconciles: rec.ok, supply: { start: supplyStart, end: supply(db).circulating, changeBps: Math.round(((supply(db).circulating - supplyStart) * 10_000) / supplyStart) },
    companies: { start: startLive, end: live(db), opened, closed: db.get<{ n: number }>("SELECT COUNT(*) n FROM economic_events WHERE kind = 'company_closed'")!.n, bankrupt: db.get<{ n: number }>("SELECT COUNT(*) n FROM economic_events WHERE kind = 'bankruptcy'")!.n },
    industries, player: mine.length ? { companies: mine.length, worthStart: startWorth, worthEnd: worth(db, mine), profit: worth(db, mine) - startWorth, shareOfAllUnitsBps: allUnits ? Math.floor((myUnits * 10_000) / allUnits) : 0 } : null,
    prices, shortageDays, giniEndBps: st?.gini_bps ?? 0, consumerSpendDay: st?.consumer_spend_minor ?? 0, consumerSpendFirst: firstSpend, timeline,
    decisions: db.get<{ n: number }>('SELECT COUNT(*) n FROM npc_decisions')!.n, strategies: db.all<{ strategy: string; n: number }>("SELECT p.strategy, COUNT(*) n FROM npc_profiles p JOIN companies c ON c.id = p.company_id WHERE c.bankrupt_tick IS NULL AND c.status <> 'insolvent' GROUP BY p.strategy ORDER BY n DESC"),
  };
}

const ec = (m: number | null) => (m === null ? '—' : `${(m / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EC`);
export function formatScenario(r: ScenarioReport): string {
  const L: string[] = [`# Scenario ${r.name}`, '', `${r.days} in-game days · deterministic · reconciles: **${r.reconciles}** · accounting anomalies: **${r.anomalies.length}**`, '', '## Setup', ...r.setup.map((s) => `- ${s}`)];
  L.push('', '## Headline', `- Circulating supply ${ec(r.supply.start)} → ${ec(r.supply.end)} (${(r.supply.changeBps / 100).toFixed(2)}%)`);
  L.push(`- Live companies ${r.companies.start} → ${r.companies.end} · NPC entries ${r.companies.opened} · voluntary closures ${r.companies.closed} · bankruptcies ${r.companies.bankrupt}`);
  L.push(`- Days with any unmet consumer units: ${r.shortageDays}/${r.days} · company-cash Gini ${(r.giniEndBps / 100).toFixed(0)}% · daily consumer spend ${ec(r.consumerSpendFirst)} (day 1) → ${ec(r.consumerSpendDay)} (last day)`);
  L.push(`- NPC strategy reviews logged: ${r.decisions} · live NPC strategies: ${r.strategies.map((s) => `${s.strategy} ${s.n}`).join(', ')}`);
  if (r.player) L.push(`- Player: ${r.player.companies} compan${r.player.companies === 1 ? 'y' : 'ies'}, net worth ${ec(r.player.worthStart)} → ${ec(r.player.worthEnd)} (${r.player.profit >= 0 ? '+' : ''}${ec(r.player.profit)}), ${(r.player.shareOfAllUnitsBps / 100).toFixed(1)}% of all units sold in the final fortnight`);
  for (const n of r.notes) L.push(`- ${n}`);
  L.push('', '## Industries (final fortnight)', '| industry | live | NPC | player | player share | HHI | avg price |', '|---|---|---|---|---|---|---|');
  for (const i of r.industries) L.push(`| ${i.industry} | ${i.live} | ${i.npc} | ${i.player} | ${(i.playerShareBps / 100).toFixed(0)}% | ${i.hhiBps} | ${ec(i.avgPrice)} |`);
  L.push('', '## Prices (VWAP of executed trades)', '| commodity | reference | first | last | min | max |', '|---|---|---|---|---|---|');
  for (const p of r.prices) L.push(`| ${p.commodity} | ${ec(p.reference)} | ${ec(p.first)} | ${ec(p.last)} | ${ec(p.min)} | ${ec(p.max)} |`);
  L.push('', '## Timeline', '| day | circulating | live companies | consumer spend | units produced |', '|---|---|---|---|---|');
  for (const t of r.timeline) L.push(`| ${t.day} | ${ec(t.circulating)} | ${t.live} | ${ec(t.consumerSpend)} | ${t.units} |`);
  if (r.anomalies.length) L.push('', '## Anomalies', ...r.anomalies.slice(0, 10).map((a) => `- ${a}`));
  return L.join('\n') + '\n';
}
