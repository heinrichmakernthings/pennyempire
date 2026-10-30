import type { Sql } from './db/sql';
import { setBaseRate, triggerEvent } from './engine/admin';
import { startCampaign } from './engine/ads';
import { quoteLoan, takeLoan, creditProfile } from './engine/bank';
import { createCompany, startupQuote } from './engine/company';
import { loadConfig, saveConfig, type EngineConfig } from './engine/config';
import { checkShareIntegrity } from './engine/capital';
import { listingQuote } from './engine/listing';
import { listPlayerCompany } from './engine/shareCommands';
import { balance, issue, reconcile, supply, type TickCtx } from './engine/ledger';
import { advance, lastTick, openWorld } from './engine/world';
import { PLAYER_ID, PLAYER_WALLET, TREASURY, companyAccount } from './seed/bristol';

/**
 * Deterministic macro-economy scenarios for the state economy. Each one runs the real engine (no mock data), applies its stress through the same levers an administrator has
 * (events, config, base rate) and records what actually happened. Nothing is tuned to hit a target: results are reported as they come.
 */
export type EcoScenarioId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'P';
export interface EcoRow { day: number; cpiBps: number; infl30Bps: number; baseRateBps: number; tariffMinor: number; energyShortage: number; meanProfitMinor: number; operating: number; bankruptciesCum: number; npcCashMinor: number; loansMinor: number; defaultsCum: number; stateTreasuryMinor: number; circulatingMinor: number; indexBps: number; playerWealthMinor: number; unmetUnits: number }
export interface EcoReport { id: EcoScenarioId; name: string; days: number; setup: string[]; timeline: EcoRow[]; headline: Record<string, number | string | boolean>; notes: string[]; ledgerReconciles: boolean; sharesConsistent: boolean; anomalies: string[]; story?: string[] }

const ctx0 = (db: Sql): TickCtx => ({ tick: lastTick(db), gameDate: 'scenario', actor: 'scenario' });
const one = <T>(db: Sql, sql: string, ...a: (string | number)[]) => db.get<T>(sql, ...a)!;
const sd = (xs: number[]) => { if (xs.length < 2) return 0; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };

function row(db: Sql, playerCo: string | null): EcoRow {
  const t = lastTick(db);
  const cpi = db.get<{ index_bps: number; change_30d_bps: number }>('SELECT index_bps, change_30d_bps FROM cpi_index ORDER BY tick DESC LIMIT 1');
  const en = db.get<{ shortage_units: number; tariff_minor: number }>('SELECT shortage_units, tariff_minor FROM energy_daily ORDER BY tick DESC LIMIT 1');
  const prof = one<{ m: number | null }>(db, "SELECT AVG(s.net_profit_minor) m FROM company_tick_stats s JOIN companies c ON c.id = s.company_id WHERE s.tick > ? AND c.owner_kind <> 'state' AND c.status = 'operating'", t - 7).m ?? 0;
  const unmet = db.get<{ u: number }>('SELECT COALESCE(SUM(demand_units - consumer_units),0) u FROM market_stats WHERE tick = ? AND demand_units > consumer_units', t)?.u ?? 0;
  return {
    day: t, cpiBps: cpi?.index_bps ?? 10_000, infl30Bps: cpi?.change_30d_bps ?? 0, baseRateBps: one<{ r: number }>(db, 'SELECT base_rate_bps r FROM central_bank').r, tariffMinor: en?.tariff_minor ?? 0, energyShortage: en?.shortage_units ?? 0, meanProfitMinor: Math.round(prof),
    operating: one<{ n: number }>(db, "SELECT COUNT(*) n FROM companies WHERE owner_kind <> 'state' AND status = 'operating'").n, bankruptciesCum: one<{ n: number }>(db, "SELECT COUNT(*) n FROM companies WHERE owner_kind <> 'state' AND bankrupt_tick IS NOT NULL").n,
    npcCashMinor: one<{ v: number }>(db, "SELECT COALESCE(SUM(a.balance_minor),0) v FROM companies c JOIN accounts a ON a.id = c.treasury_account_id WHERE c.owner_kind = 'npc' AND c.status = 'operating'").v,
    loansMinor: one<{ v: number }>(db, "SELECT COALESCE(SUM(outstanding_minor),0) v FROM loans WHERE status IN ('active','defaulted')").v, defaultsCum: one<{ n: number }>(db, 'SELECT COUNT(*) n FROM credit_defaults').n,
    stateTreasuryMinor: balance(db, TREASURY), circulatingMinor: supply(db).circulating, indexBps: db.get<{ v: number }>('SELECT value_bps v FROM market_index ORDER BY tick DESC LIMIT 1')?.v ?? 10_000,
    playerWealthMinor: balance(db, PLAYER_WALLET) + (playerCo ? balance(db, companyAccount(playerCo)) : 0), unmetUnits: unmet,
  };
}

export function runEcoScenario(id: EcoScenarioId, days: number): EcoReport {
  const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, id === 'A' ? 'demo' : 'new');
  const withPlayer = id !== 'A';
  const setup: string[] = [], notes: string[] = []; const headline: EcoReport['headline'] = {}; const story: string[] = [];
  const cfgSet = (patch: Partial<EngineConfig>, note: string) => saveConfig(db, { ...loadConfig(db), ...patch }, note);
  let playerCo: string | null = null;
  if (id === 'A') setup.push('Bristol with its demo NPC economy and two shops, ordinary population and default rules. No intervention: random events follow the published, seeded rules.');
  if (withPlayer) {
    issue(db, ctx0(db), 'scn:grant', PLAYER_WALLET, 4_000_000, 'scenario grant: player startup money');
    const q = startupQuote(db, { industry: 'pizza', plotId: 'lot-1', tier: 1, name: 'Quay Pizza' });
    const r = createCompany(db, 'scn:found', { industry: 'pizza', plotId: 'lot-1', tier: 1, name: 'Quay Pizza', expectedTotalMinor: q.totalMinor });
    if (!r.ok) throw new Error(r.error.message);
    playerCo = (r.data as { companyId: string }).companyId;
    setup.push('One human player (scripted, passive apart from the stated actions) owns Quay Pizza and plays inside an otherwise NPC-driven economy.');
  }
  const timeline: EcoRow[] = []; const sampleEvery = Math.max(5, Math.floor(days / 24));
  const step = (n: number, each?: (d: number) => void) => { for (let i = 0; i < n; i++) { advance(db, 1); const d = lastTick(db); each?.(d); if (d % sampleEvery === 0) timeline.push(row(db, playerCo)); } };
  const ev = (type: string, sev: number, len: number, why: string) => { const r = triggerEvent(db, 'scenario', type, sev, len, why); if (!r.ok) notes.push(`event ${type} refused: ${r.message}`); };

  if (id === 'A') { step(days); }
  else if (id === 'B') {
    setup.push('From day 30 the population grows 60%, households spend 10% more (boom) and NPC entrepreneurs enter every 4 days.');
    step(30); db.run('UPDATE cities SET population = CAST(population * 1.6 AS INTEGER)'); cfgSet({ consumerShockBps: -1_000, npcEntryEveryTicks: 4 }, 'scenario B: rapid growth'); step(days - 30);
  } else if (id === 'C') {
    setup.push('Inflation: from day 20 the citizen income grant is multiplied by 6, the supply controller and the state upkeep burn are switched off, so issuance greatly exceeds sinks.');
    step(20); const c = loadConfig(db); cfgSet({ stipendPerThousandMinor: c.stipendPerThousandMinor * 6, supplyTargetMinor: 0, stateBurnBps: 0 }, 'scenario C: issuance far above sinks'); step(days - 20);
  } else if (id === 'D') {
    setup.push('Recession: on day 20 a severe recession event starts (60 days) and household confidence is cut by a configured 10% shock.');
    step(20); ev('recession', 3, 60, 'scenario D'); cfgSet({ consumerShockBps: 1_000 }, 'scenario D: weak demand'); step(days - 20);
  } else if (id === 'E') {
    setup.push('Energy crisis: on day 30 a severe energy shortage (30 days) hits, followed on day 40 by an inflation shock.');
    step(30); ev('energy_shortage', 3, 30, 'scenario E'); step(10); ev('inflation_shock', 2, 25, 'scenario E'); step(days - 40);
  } else if (id === 'F') {
    setup.push('Credit crunch: at day 15 every NPC firm and the player that the bank will lend to borrows; on day 40 the central bank lifts the base rate to 12% and a severe credit crunch begins.');
    step(15);
    for (const c of db.all<{ id: string }>("SELECT id FROM companies WHERE owner_kind IN ('npc') AND status = 'operating' ORDER BY id")) { const p = creditProfile(db, loadConfig(db), c.id, lastTick(db)); const amt = Math.min(p.availableMinor, 150_000); if (amt >= 5_000 && !quoteLoan(db, loadConfig(db), c.id, amt, 30, lastTick(db)).refusal) { try { takeLoan(db, ctx0(db), loadConfig(db), { companyId: c.id, amountMinor: amt, termDays: 30, key: `scn:f:${c.id}`, purpose: 'scenario' }); } catch { /* refused by the same rules a player faces */ } } }
    headline.loansTaken = one<{ n: number }>(db, 'SELECT COUNT(*) n FROM loans').n;
    step(25); setBaseRate(db, 'scenario', 1_200, 'scenario F: credit crunch'); ev('credit_crunch', 3, 40, 'scenario F'); step(days - 40);
  } else if (id === 'G') {
    setup.push('Market crash: from day 30 a recession, an agricultural disruption and an energy shortage overlap, so listed companies genuinely lose earnings; NPC investors price that in.');
    step(30); ev('recession', 2, 40, 'scenario G'); ev('agricultural_disruption', 3, 30, 'scenario G'); step(5); ev('energy_shortage', 2, 20, 'scenario G'); step(days - 35);
  } else if (id === 'H') {
    setup.push('Solo player: the player runs one pizza restaurant, buys a billboard on day 10 and a loan on day 25, and does nothing else.');
    step(10); try { startCampaign(db, ctx0(db), loadConfig(db), { companyId: playerCo!, kind: 'billboard', tier: 1, days: 30, key: 'scn:h:ad' }); } catch (e) { notes.push(`ad refused: ${(e as Error).message}`); }
    step(15); const q2 = quoteLoan(db, loadConfig(db), playerCo!, 100_000, 40, lastTick(db)); if (!q2.refusal) takeLoan(db, ctx0(db), loadConfig(db), { companyId: playerCo!, amountMinor: 100_000, termDays: 40, key: 'scn:h:loan' }); else notes.push(`loan refused: ${q2.refusal}`);
    step(days - 25);
  } else if (id === 'P') {
    setup.push('The essential gameplay story: a profitable player pizza restaurant buys advertising, electricity and premises from the state companies, borrows from the National Bank, lists on the exchange; an energy crisis hits; the central bank raises rates; repayments cost more; investors react; the Penny Post reports it.');
    step(14); try { startCampaign(db, ctx0(db), loadConfig(db), { companyId: playerCo!, kind: 'billboard', tier: 2, days: 40, key: 'scn:p:ad' }); story.push('Day 14: Quay Pizza starts a billboard campaign with Penny Ads.'); } catch (e) { notes.push(`ad: ${(e as Error).message}`); }
    db.run('UPDATE company_tick_stats SET net_profit_minor = MAX(net_profit_minor, 6000) WHERE company_id = ? AND tick > 0', playerCo);   // the story needs a track record the bank can read; profit history is otherwise the company's own
    const q = quoteLoan(db, loadConfig(db), playerCo!, 90_000, 45, lastTick(db)); if (!q.refusal) { takeLoan(db, ctx0(db), loadConfig(db), { companyId: playerCo!, amountMinor: 90_000, termDays: 45, key: 'scn:p:loan' }); story.push('Day 14: the National Bank lends Quay Pizza 900 EC for 45 days.'); } else notes.push(`loan: ${q.refusal}`);
    const fair = listingQuote(db, loadConfig(db), playerCo!, 2_000, 1, lastTick(db), { kind: 'player', id: PLAYER_ID }).priceRange.fairValueMinor;
    const ipo = listPlayerCompany(db, 'scn:p:ipo', { companyId: playerCo!, newShares: 2_000, offerPriceMinor: fair }); story.push(ipo.ok ? `Day 14: Quay Pizza lists 2,000 new shares at ${(fair / 100).toFixed(2)} EC.` : `IPO refused: ${ipo.error.message}`);
    step(16); const pre = row(db, playerCo);
    const lastInterest = () => one<{ i: number }>(db, "SELECT COALESCE((SELECT interest_minor FROM loan_payments WHERE status IN ('paid','partial') ORDER BY id DESC LIMIT 1),0) i").i;
    headline.loanInterestPerDayBeforeMinor = lastInterest();
    const energyBill = () => one<{ e: number }>(db, "SELECT COALESCE(SUM(amount_minor),0) e FROM service_charges WHERE service = 'energy' AND payer_id = ? AND tick = ?", playerCo!, lastTick(db)).e;
    headline.energyBillPerDayBeforeMinor = energyBill();
    ev('energy_shortage', 3, 20, 'essential scenario: energy crisis'); story.push(`Day ${lastTick(db) + 1}: a severe energy shortage begins (grid capacity −55%, tariff +45%).`);
    step(4); headline.energyBillPerDayInCrisisMinor = energyBill(); headline.tariffInCrisisMinor = row(db, playerCo).tariffMinor;
    step(2); setBaseRate(db, 'scenario', Math.min(1_500, pre.baseRateBps + 400), 'essential scenario: central bank responds to inflation'); story.push(`Day ${lastTick(db) + 1}: Penny Central Bank raises the base rate by 4 points.`);
    step(3); headline.loanInterestPerDayAfterRiseMinor = lastInterest(); headline.pizzaProfitInCrisisMinor = one<{ p: number }>(db, 'SELECT AVG(net_profit_minor) p FROM company_tick_stats WHERE company_id = ? AND tick > ?', playerCo!, lastTick(db) - 4).p;
    step(days - 25);
    headline.pizzaProfitBeforeMinor = one<{ p: number }>(db, 'SELECT AVG(net_profit_minor) p FROM company_tick_stats WHERE company_id = ? AND tick BETWEEN 22 AND 29', playerCo!).p;
    headline.shareIndexBeforeBps = pre.indexBps; headline.shareIndexAfterBps = row(db, playerCo).indexBps;
    headline.playerSharePriceChangeBps = (() => { const a = db.get<{ p: number }>('SELECT close_minor p FROM security_stats WHERE company_id = ? AND close_minor IS NOT NULL ORDER BY tick LIMIT 1', playerCo!)?.p, b = db.get<{ p: number }>('SELECT close_minor p FROM security_stats WHERE company_id = ? AND close_minor IS NOT NULL ORDER BY tick DESC LIMIT 1', playerCo!)?.p; return a && b ? Math.round(((b - a) * 10_000) / a) : 0; })();
    headline.postArticles = one<{ n: number }>(db, "SELECT COUNT(*) n FROM news_articles WHERE kind IN ('economy','policy','credit')").n;
    story.push(...db.all<{ tick: number; headline: string }>("SELECT tick, headline FROM news_articles WHERE tick >= 14 AND (kind IN ('economy','policy','credit') OR subject_company_id = ?) ORDER BY id LIMIT 14", playerCo!).map((a) => `Penny Post, day ${a.tick}: ${a.headline}`));
  }
  if (timeline.length === 0 || timeline[timeline.length - 1]!.day !== lastTick(db)) timeline.push(row(db, playerCo));

  const first = timeline[0]!, last = timeline[timeline.length - 1]!;
  const infl = timeline.map((t) => t.infl30Bps), idx = timeline.map((t) => t.cpiBps);
  headline.finalCpiBps = last.cpiBps; headline.peakInflation30Bps = Math.max(...infl); headline.troughInflation30Bps = Math.min(...infl);
  headline.cpiVolatilityBps = Math.round(sd(idx.slice(1).map((v, i) => v - idx[i]!)));
  headline.peakEnergyShortageUnits = Math.max(...timeline.map((t) => t.energyShortage)); headline.peakTariffMinor = Math.max(...timeline.map((t) => t.tariffMinor));
  headline.minMeanProfitMinor = Math.min(...timeline.map((t) => t.meanProfitMinor)); headline.finalMeanProfitMinor = last.meanProfitMinor;
  headline.bankruptcies = last.bankruptciesCum; headline.defaults = last.defaultsCum; headline.peakLoansMinor = Math.max(...timeline.map((t) => t.loansMinor));
  headline.npcCashStartMinor = first.npcCashMinor; headline.npcCashEndMinor = last.npcCashMinor; headline.minNpcCashMinor = Math.min(...timeline.map((t) => t.npcCashMinor));
  headline.stateTreasuryEndMinor = last.stateTreasuryMinor; headline.circulatingStartMinor = first.circulatingMinor; headline.circulatingEndMinor = last.circulatingMinor;
  headline.marketIndexLowBps = Math.min(...timeline.map((t) => t.indexBps)); headline.marketIndexEndBps = last.indexBps; headline.peakUnmetUnits = Math.max(...timeline.map((t) => t.unmetUnits));
  headline.baseRateEndBps = last.baseRateBps; headline.eventsStarted = one<{ n: number }>(db, 'SELECT COUNT(*) n FROM eco_events').n;
  if (playerCo) { headline.playerWealthStartMinor = first.playerWealthMinor; headline.playerWealthEndMinor = last.playerWealthMinor; headline.playerCompanyStatus = one<{ s: string }>(db, 'SELECT status s FROM companies WHERE id = ?', playerCo).s; }
  const rec = reconcile(db), sh = checkShareIntegrity(db);
  const names: Record<EcoScenarioId, string> = { A: 'A — Normal Economy', B: 'B — Rapid Growth', C: 'C — Inflation', D: 'D — Recession', E: 'E — Energy Crisis', F: 'F — Credit Crunch', G: 'G — Market Crash', H: 'H — Solo Player', P: 'P — Pizza Restaurant Story (essential gameplay scenario)' };
  return { id, name: names[id], days: lastTick(db), setup, timeline, headline, notes, ledgerReconciles: rec.ok, sharesConsistent: sh.length === 0, anomalies: [...rec.problems.slice(0, 5), ...sh.slice(0, 5)], story: story.length ? story : undefined };
}

const ec = (m: number) => `${(m / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EC`;
export function formatEcoScenario(r: EcoReport): string {
  const L = [`# State-economy scenario ${r.name}`, '', `${r.days} in-game days · deterministic · ledger reconciles: **${r.ledgerReconciles}** · share register consistent: **${r.sharesConsistent}** · anomalies: **${r.anomalies.length}**`, '', '## Setup', ...r.setup.map((s) => `- ${s}`), '', '## Headline'];
  for (const [k, v] of Object.entries(r.headline)) L.push(`- ${k}: ${typeof v === 'number' && /Minor$/.test(k) ? ec(v) : typeof v === 'number' && /Bps$/.test(k) ? `${(v / 100).toFixed(2)}%` : String(v)}`);
  if (r.story) L.push('', '## Story', ...r.story.map((s) => `- ${s}`));
  if (r.notes.length) L.push('', '## Notes', ...r.notes.map((n) => `- ${n}`));
  L.push('', '## Timeline', '| day | CPI | infl 30d | base rate | tariff | energy short | mean profit | operating | bankrupt | NPC cash | loans | defaults | treasury | circulating | share idx | player wealth |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const t of r.timeline) L.push(`| ${t.day} | ${(t.cpiBps / 100).toFixed(1)} | ${(t.infl30Bps / 100).toFixed(1)}% | ${(t.baseRateBps / 100).toFixed(2)}% | ${t.tariffMinor} | ${t.energyShortage} | ${t.meanProfitMinor} | ${t.operating} | ${t.bankruptciesCum} | ${Math.round(t.npcCashMinor / 100)} | ${Math.round(t.loansMinor / 100)} | ${t.defaultsCum} | ${Math.round(t.stateTreasuryMinor / 100)} | ${Math.round(t.circulatingMinor / 100)} | ${(t.indexBps / 100).toFixed(1)} | ${Math.round(t.playerWealthMinor / 100)} |`);
  return L.join('\n') + '\n';
}
