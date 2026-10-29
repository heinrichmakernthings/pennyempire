import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { foundCompany, installUpgrade, upgradeBlocker, type Founder, type UpgradeRow } from './company';
import { directory } from './exchange';
import { opportunities } from './insights';
import { available, balance, type TickCtx } from './ledger';
import { liquidateCompany } from './lifecycle';
import { cancelOrder, placeOrder } from './market';
import { linesOf, recipeInputs, type CompanyRow } from './operations';
import { stock } from './inventory';
import { logEvent } from './stats';
import { HOUSEHOLDS, CITY_ID } from '../seed/bristol';

export type Strategy = 'budget' | 'premium' | 'growth' | 'conservative' | 'opportunistic' | 'struggling';
export interface Profile { company_id: string; strategy: Strategy; previous_strategy: Strategy | null; strategy_since_tick: number; decision_every: number; next_decision_tick: number; last_decision_tick: number | null; markup_bps: number; target_quality: 'basic' | 'standard' | 'premium'; marketing_minor: number; reserve_days: number; losing_decisions: number; profitable_decisions: number; created_tick: number }

/** What each strategy means. Every number is a plain, inspectable rule: nothing is hidden and nobody sees the future. */
export const STRATEGIES: Record<Strategy, { label: string; blurb: string; markup: number; quality: Profile['target_quality']; marketing: number; reserveDays: number; markupMin: number; markupMax: number }> = {
  budget: { label: 'Budget competitor', blurb: 'Low prices, high volume, modest margins.', markup: 10_200, quality: 'basic', marketing: 0, reserveDays: 8, markupMin: 10_200, markupMax: 11_000 },
  premium: { label: 'Premium operator', blurb: 'Invests in quality and reputation, charges more.', markup: 11_500, quality: 'premium', marketing: 1_500, reserveDays: 10, markupMin: 10_800, markupMax: 14_000 },
  growth: { label: 'Growth company', blurb: 'Reinvests profit in capacity and expansion.', markup: 10_500, quality: 'standard', marketing: 500, reserveDays: 6, markupMin: 10_300, markupMax: 12_000 },
  conservative: { label: 'Conservative business', blurb: 'Keeps large reserves, avoids risk.', markup: 11_000, quality: 'standard', marketing: 0, reserveDays: 25, markupMin: 10_500, markupMax: 12_000 },
  opportunistic: { label: 'Opportunistic trader', blurb: 'Reprices on shortages and surpluses, posts standing bids for inputs.', markup: 10_800, quality: 'standard', marketing: 0, reserveDays: 10, markupMin: 10_200, markupMax: 14_000 },
  struggling: { label: 'Struggling company', blurb: 'Cutting costs; may fail.', markup: 10_500, quality: 'basic', marketing: 0, reserveDays: 4, markupMin: 10_300, markupMax: 11_500 },
};

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

export function logDecision(db: Sql, tick: number, c: Pick<CompanyRow, 'id'>, strategy: string, action: string, reason: string, inputs: unknown, applied: boolean, isPublic = false) {
  db.run('INSERT INTO npc_decisions (tick, company_id, strategy, action, reason, inputs_json, applied, public) VALUES (?,?,?,?,?,?,?,?)', tick, c.id, strategy, action, reason, JSON.stringify(inputs), applied ? 1 : 0, isPublic ? 1 : 0);
}

export function createProfile(db: Sql, tick: number, companyId: string, strategy: Strategy, every: number) {
  const s = STRATEGIES[strategy];
  db.run('INSERT OR IGNORE INTO npc_profiles (company_id, strategy, strategy_since_tick, decision_every, next_decision_tick, markup_bps, target_quality, marketing_minor, reserve_days, created_tick) VALUES (?,?,?,?,?,?,?,?,?,?)',
    companyId, strategy, tick, every, tick + 1 + (hash(companyId) % every), 10_500, s.quality, 0, s.reserveDays, tick);
}

const window = (db: Sql, id: string, from: number, to: number) => db.get<{ profit: number; revenue: number; sold: number; produced: number; n: number; buys: number }>('SELECT COALESCE(SUM(input_purchases_minor + energy_paid_minor),0) buys, COALESCE(SUM(net_profit_minor),0) profit, COALESCE(SUM(revenue_minor),0) revenue, COALESCE(SUM(units_sold),0) sold, COALESCE(SUM(units_produced),0) produced, COUNT(*) n FROM company_tick_stats WHERE company_id = ? AND tick > ? AND tick <= ?', id, from, to)!;

/**
 * Periodic strategic review for the NPCs that are due this tick (staggered, at most `npcDecisionsPerTick`). Each review reads only the company's own books and
 * public market data (rival prices, shortage status); every action goes through the same cores the player uses and is recorded with its reasons in `npc_decisions`.
 */
export function runNpcDecisions(db: Sql, ctx: TickCtx, cfg: EngineConfig, lastExit: { tick: number }): { reviewed: number; closed: string[] } {
  const due = db.all<Profile>('SELECT p.* FROM npc_profiles p JOIN companies c ON c.id = p.company_id WHERE p.next_decision_tick <= ? AND c.status <> ? AND c.bankrupt_tick IS NULL AND c.owner_kind = ? ORDER BY p.next_decision_tick, p.company_id LIMIT ?', ctx.tick, 'x', 'npc', cfg.npcDecisionsPerTick);
  if (!due.length) return { reviewed: 0, closed: [] };
  const dir = new Map(directory(db).map((d) => [d.commodityId, d]));
  const closed: string[] = [];
  for (const p of due) {
    const c = db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', p.company_id)!;
    const every = p.decision_every;
    const w = window(db, c.id, ctx.tick - 1 - every, ctx.tick - 1);   // completed days only: today's books are not closed yet
    const lines = linesOf(db, c.id);
    const out = lines[0]?.output_commodity_id ?? c.retail_commodity_id ?? '';
    const market = dir.get(out);
    const cash = available(db, c.treasury_account_id);
    const dailyFixed = c.employees * c.wage_minor + c.property_minor + c.marketing_minor;
    const reserve = p.reserve_days * (dailyFixed + Math.floor(w.buys / Math.max(1, w.n)));   // working capital for ingredients counts: never invest the money that pays tomorrow's inputs
    const inv = out ? stock(db, c.id, out) : { qty: 0, reserved: 0, value_minor: 0 };
    const daySales = Math.max(1, Math.floor(w.sold / Math.max(1, w.n)));
    const cover = inv.qty / daySales;
    const stockedOut = db.get<{ n: number }>("SELECT COUNT(*) n FROM production_log WHERE company_id = ? AND tick > ? AND limited_by IN ('inputs','supply','cash')", c.id, ctx.tick - every)!.n;
    const inputs = { cash, reserve, profitWindow: w.profit, revenueWindow: w.revenue, soldWindow: w.sold, cover: Math.round(cover * 10) / 10, market: market?.status ?? 'n/a', marketShortage: market?.shortageUnits ?? 0, starved: stockedOut };
    let strategy = p.strategy, markup = p.markup_bps, losing = p.losing_decisions, profitable = p.profitable_decisions;
    const act = (action: string, reason: string, applied = true, pub = false) => logDecision(db, ctx.tick, c, strategy, action, reason, inputs, applied, pub);

    // ── 1. strategy changes ──
    if (w.n >= every) {
      const trend = window(db, c.id, ctx.tick - 1 - every * 4, ctx.tick - 1);   // judged over four review periods so one lucky or unlucky day does not decide
      if (trend.profit < 0) { losing++; profitable = 0; } else { profitable++; losing = Math.max(0, losing - 1); }
      if (strategy !== 'struggling' && losing >= 4) {
        act('change_strategy', `Lost money for ${losing} reviews in a row (${(cash / 100).toFixed(0)} EC left in the bank): switching to the struggling playbook (cut costs, no marketing, basic quality).`, true, true);
        db.run('UPDATE npc_profiles SET previous_strategy = ?, strategy_since_tick = ? WHERE company_id = ?', strategy, ctx.tick, c.id);
        strategy = 'struggling'; markup = STRATEGIES.struggling.markup;
      } else if (strategy === 'struggling' && profitable >= 3 && cash >= reserve * 2) {
        const back = p.previous_strategy && p.previous_strategy !== 'struggling' ? p.previous_strategy : 'budget';
        act('change_strategy', `Profitable for ${profitable} reviews and reserves restored: returning to the ${STRATEGIES[back].label.toLowerCase()} playbook.`, true, true);
        strategy = back; markup = STRATEGIES[back].markup; db.run('UPDATE npc_profiles SET strategy_since_tick = ? WHERE company_id = ?', ctx.tick, c.id);
      } else if (strategy === 'conservative' && cash > reserve * 3 && market?.status === 'shortage' && w.profit > 0) {
        act('change_strategy', `Plenty of cash (${(cash / 100).toFixed(0)} EC) and a shortage in ${out}: becoming a growth company.`, true, true);
        strategy = 'growth'; db.run('UPDATE npc_profiles SET previous_strategy = ?, strategy_since_tick = ? WHERE company_id = ?', 'conservative', ctx.tick, c.id);
      } else if (strategy === 'growth' && w.profit < 0 && cash < reserve) {
        act('change_strategy', 'Expansion is not paying and cash is below reserve: becoming conservative.', true, true);
        strategy = 'conservative'; db.run('UPDATE npc_profiles SET previous_strategy = ?, strategy_since_tick = ? WHERE company_id = ?', 'growth', ctx.tick, c.id);
      }
    }
    const S = STRATEGIES[strategy];

    // ── 2. pricing stance (the daily cost-plus rule applies this markup) ──
    let next = markup;
    if (strategy === 'opportunistic') next = market?.status === 'shortage' ? markup + 300 : market?.status === 'surplus' ? markup - 300 : markup + Math.sign(S.markup - markup) * Math.min(100, Math.abs(S.markup - markup));
    else if (stockedOut > 0 || (c.retail_commodity_id && cover < 0.3 && w.sold > 0)) next = markup + 100;                  // selling out: room to charge more
    else if (cover > cfg.stockCoverDays) next = markup - 100;                                                              // piling up: cut
    else next = markup + Math.sign(S.markup - markup) * Math.min(50, Math.abs(S.markup - markup));
    next = Math.max(S.markupMin, Math.min(S.markupMax, next));
    if (next !== p.markup_bps) act('set_markup', `Markup ${(p.markup_bps / 100).toFixed(0)}% → ${(next / 100).toFixed(0)}% (${market?.status ?? 'no market data'}, stock cover ${inputs.cover} days${stockedOut ? ', ran short of inputs' : ''}).`, true, Math.abs(next - p.markup_bps) >= 300);

    // ── 3. quality and marketing ──
    if (c.retail_commodity_id) {
      if (c.quality !== S.quality) { db.run('UPDATE companies SET quality = ?, revision = revision + 1 WHERE id = ?', S.quality, c.id); act('set_quality', `Quality ${c.quality} → ${S.quality} to match the ${S.label.toLowerCase()} strategy.`, true, true); }
      const mk = cash > reserve ? S.marketing : 0;
      if (mk !== c.marketing_minor) { db.run('UPDATE companies SET marketing_minor = ?, revision = revision + 1 WHERE id = ?', mk, c.id); act('set_marketing', `Advertising ${(c.marketing_minor / 100).toFixed(2)} → ${(mk / 100).toFixed(2)} EC a day (${cash > reserve ? 'affordable' : 'reserves too low'}).`); }
    }

    // ── 4. growth: one upgrade at a time, never beyond what the company can pay for ──
    const lastUp = db.get<{ t: number | null }>('SELECT MAX(purchased_tick) t FROM company_upgrades WHERE company_id = ?', c.id)?.t ?? -999;
    const wantsExpansion = (strategy === 'growth' || strategy === 'premium' || strategy === 'conservative' || strategy === 'opportunistic') && w.profit > 0 && (stockedOut > 0 || cover < 0.5 || market?.status === 'shortage') && ctx.tick - lastUp >= 10;
    if (wantsExpansion) {
      const owned = new Set(db.all<{ upgrade_id: string }>('SELECT upgrade_id FROM company_upgrades WHERE company_id = ?', c.id).map((r) => r.upgrade_id));
      const need = strategy === 'conservative' ? 2 : 1;
      const options = db.all<UpgradeRow>("SELECT * FROM upgrade_catalog WHERE industry_id = ? AND kind IN ('capacity','storage','productivity','tier') ORDER BY CASE kind WHEN 'capacity' THEN 0 WHEN 'productivity' THEN 1 WHEN 'storage' THEN 2 ELSE 3 END, cost_minor", c.industry_id).filter((u) => !upgradeBlocker(db, c, u, owned));
      const pick = options.find((u) => cash - u.cost_minor >= reserve * need);
      if (pick) { installUpgrade(db, ctx, c, pick, `npc:${c.id}:${ctx.tick}:up`); act('upgrade', `Sold out and profitable (${(w.profit / 100).toFixed(0)} EC over ${every} days): installed "${pick.name}" for ${(pick.cost_minor / 100).toFixed(0)} EC.`, true, true); }
      else act('upgrade', 'Wanted to expand but could not pay for an upgrade and keep its reserve; holding.', false);
    }

    // ── 5. supply chain: standing bids for missing inputs, a little below the best offer (improves liquidity, trades only if sellers come to us) ──
    if (strategy === 'opportunistic' || strategy === 'conservative' || strategy === 'growth') for (const i of lines[0] ? recipeInputs(db, lines[0].recipe_id) : []) {
      const key = `npc:bid:${c.id}:${i.commodity_id}`;
      for (const o of db.all<{ id: number }>("SELECT id FROM orders WHERE company_id = ? AND commodity_id = ? AND side = 'buy' AND status = 'open' AND idempotency_key LIKE 'npc:bid:%'", c.id, i.commodity_id)) cancelOrder(db, o.id);
      const need = i.units * lines[0]!.planned_batches * 2 - stock(db, c.id, i.commodity_id).qty;
      const ask = dir.get(i.commodity_id)?.bestAskMinor ?? null;
      if (need <= 0 || ask === null || cash < reserve) continue;
      const price = Math.max(1, Math.floor((ask * 9_600) / 10_000)), qty = Math.min(need, Math.floor((cash - reserve) * 0.3 / price));
      if (qty <= 0) continue;
      try { placeOrder(db, ctx, cfg.exchangeFeeBps, { company: c.id, commodity: i.commodity_id, side: 'buy', price, qty, key: `${key}:${ctx.tick}`, expiresTick: ctx.tick + every + 1 }); act('standing_bid', `Posted a bid for ${qty} ${i.commodity_id} at ${(price / 100).toFixed(2)} EC (best offer ${(ask / 100).toFixed(2)}).`); } catch { /* an unaffordable bid is simply not placed */ }
    }

    // ── 6. exit: a struggling company that keeps losing and has no debts winds down; the state buys its stock at a discount, debts are settled first ──
    if (strategy === 'struggling' && losing >= 6 && c.unpaid_minor === 0 && ctx.tick - lastExit.tick >= cfg.npcExitEveryTicks && c.owner_kind === 'npc') {
      act('close', `Lost money in ${losing} consecutive reviews; closing down and returning what is left to its shareholders.`, true, true);
      logEvent(db, ctx.tick, 'company_closed', 'warning', c.id, `${c.name} closed after months of losses`, { reason: 'voluntary', losingReviews: losing });
      liquidateCompany(db, ctx, cfg, c); lastExit.tick = ctx.tick; closed.push(c.id);
      db.run('UPDATE npc_profiles SET losing_decisions = ?, last_decision_tick = ?, next_decision_tick = ? WHERE company_id = ?', losing, ctx.tick, ctx.tick + 9999, c.id);
      continue;
    }
    db.run('UPDATE npc_profiles SET strategy = ?, markup_bps = ?, target_quality = ?, marketing_minor = ?, reserve_days = ?, losing_decisions = ?, profitable_decisions = ?, last_decision_tick = ?, next_decision_tick = ? WHERE company_id = ?',
      strategy, next, S.quality, S.marketing, S.reserveDays, losing, profitable, ctx.tick, ctx.tick + every, c.id);
  }
  return { reviewed: due.length, closed };
}

const NAMES: Record<string, string[]> = {
  pizza: ['Redcliffe Oven', 'Avon Crust', 'Temple Slice', 'Brunel Pizzeria', 'Cabot Pies', 'Floating Harbour Pizza'],
  cafe: ['Cabot Coffee', 'Temple Beans', 'Quayside Café', 'Clifton Roast', 'Brew & Bridge', 'The Daily Grind'],
  farm: ['Mendip Growers', 'Chew Valley Farm', 'Avon Acres'], mill: ['Bathurst Milling', 'Cumberland Mill', 'Temple Mill'], dairy: ['Mendip Creamery', 'Chew Dairy', 'Severn Cheese Co'], timber: ['Brislington Timber', 'Forest of Avon Yard', 'Ashton Sawmill'],
};

const ENTRY_STRATEGIES: Strategy[] = ['budget', 'premium', 'growth', 'conservative', 'opportunistic'];

/** Found an NPC company with the same founding core players use, funded from the NPC shareholders' households; gives it a strategy profile. Also used to seed scenarios. */
export function openNpcCompany(db: Sql, ctx: TickCtx, cfg: EngineConfig, a: { industry: string; plotId: string; name: string; workingCapitalMinor?: number; strategy: Strategy; key: string }): { ok: true; companyId: string } | { ok: false; error: string } {
  const seq = db.get<{ n: number }>("SELECT COUNT(*) n FROM owners WHERE id LIKE 'npc-entrant-%'")!.n + 1;
  const ownerId = `npc-entrant-${seq}`;
  db.run('INSERT INTO owners (id, kind, name) VALUES (?,?,?)', ownerId, 'npc', `${a.name} Ltd`);
  const founder: Founder = { kind: 'npc', ownerId, fundingAccount: HOUSEHOLDS, idPrefix: 'co-npc', limited: false };
  const r = foundCompany(db, ctx, a.key, { industry: a.industry, plotId: a.plotId, tier: 1, name: a.name, workingCapitalMinor: a.workingCapitalMinor }, founder);
  if (!r.ok) { db.run('DELETE FROM owners WHERE id = ?', ownerId); return { ok: false, error: r.error.message }; }
  createProfile(db, ctx.tick, r.companyId, a.strategy, cfg.npcDecisionEveryTicks);
  db.run('UPDATE companies SET owner_kind = ?, owner_id = ? WHERE id = ?', 'npc', ownerId, r.companyId);
  return { ok: true, companyId: r.companyId };
}

/** Market entry: at most one new NPC company per `npcEntryEveryTicks`, only where the live opportunity data shows demand, only with finite capital from the NPC shareholders. */
export function runNpcEntry(db: Sql, ctx: TickCtx, cfg: EngineConfig): string | null {
  if (ctx.tick < 20 || ctx.tick % cfg.npcEntryEveryTicks !== 0) return null;   // needs a few weeks of real market history first
  const npcCount = db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE owner_kind = 'npc' AND bankrupt_tick IS NULL")!.n;
  const log = (industry: string, outcome: string, reason: string, companyId: string | null, score: number | null) => db.run('INSERT OR REPLACE INTO npc_entry_log (tick, industry_id, outcome, reason, company_id, score) VALUES (?,?,?,?,?,?)', ctx.tick, industry, outcome, reason, companyId, score);
  if (npcCount >= cfg.npcMaxCompanies) { log('*', 'skipped', `NPC company cap reached (${npcCount}/${cfg.npcMaxCompanies})`, null, null); return null; }
  const households = balance(db, HOUSEHOLDS);
  if (households < cfg.npcEntryHouseholdFloorMinor + cfg.npcEntryCapitalMinor) { log('*', 'skipped', 'NPC shareholders lack spare capital', null, null); return null; }
  const free = db.all<{ id: string; width: number; depth: number; district_id: string | null }>("SELECT p.id, p.width, p.depth, p.district_id FROM plots p WHERE (p.id LIKE 'lot-%' OR p.id IN ('plot-pizza','plot-cafe')) AND p.company_id IS NULL AND p.asset_id IS NULL ORDER BY p.row, p.col");
  if (free.length <= cfg.npcReservedLots) { log('*', 'skipped', `only ${free.length} vacant lots; ${cfg.npcReservedLots} are kept for players`, null, null); return null; }
  const ops = opportunities(db).filter((o) => o.sells !== 'state');
  for (const o of [...ops].sort((a, b) => b.score - a.score || a.industry.localeCompare(b.industry))) {
    const npcInIndustry = db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE owner_kind = 'npc' AND industry_id = ? AND bankrupt_tick IS NULL", o.industry)!.n;
    const rivals = o.market.competitors;
    if (npcInIndustry >= cfg.npcMaxPerIndustry) { log(o.industry, 'skipped', `already ${npcInIndustry} NPC companies in this industry`, null, o.score); continue; }
    if (o.forecast.profitMinor < cfg.npcMinProfitForEntryMinor) { log(o.industry, 'skipped', `forecast profit ${(o.forecast.profitMinor / 100).toFixed(2)} EC/day is below the entry bar`, null, o.score); continue; }
    if (rivals > 0 && o.market.unmetUnitsPerDay * 5 < o.market.demandUnitsPerDay) { log(o.industry, 'skipped', 'less than a fifth of demand is unserved: existing companies cover it', null, o.score); continue; }
    // Promising means incumbents are actually making money AND selling out of what they make: demand left on the table, not just a thin forecast.
    const inc = db.get<{ n: number; profit: number; sold: number; produced: number }>("SELECT COUNT(DISTINCT c.id) n, COALESCE(SUM(s.net_profit_minor),0) profit, COALESCE(SUM(s.units_sold),0) sold, COALESCE(SUM(s.units_produced),0) produced FROM company_tick_stats s JOIN companies c ON c.id = s.company_id WHERE c.industry_id = ? AND c.owner_kind <> 'state' AND c.bankrupt_tick IS NULL AND s.tick > ?", o.industry, ctx.tick - 14)!;
    if (inc.n > 0 && (inc.profit <= 0 || inc.sold * 10 < inc.produced * 9)) { log(o.industry, 'skipped', `incumbents are not clearly profitable and sold out (profit ${(inc.profit / 100).toFixed(0)} EC, sold ${inc.sold} of ${inc.produced} made)`, null, o.score); continue; }
    const spec = db.get<{ plot_width: number; plot_depth: number; label: string }>('SELECT plot_width, plot_depth, label FROM industry_specs WHERE industry_id = ?', o.industry)!;
    const lot = free.find((l) => l.width === spec.plot_width && l.depth === spec.plot_depth);
    if (!lot) { log(o.industry, 'skipped', 'no vacant lot of the right size', null, o.score); continue; }
    if (o.startup.totalMinor > cfg.npcEntryCapitalMinor) { log(o.industry, 'skipped', 'startup costs exceed the capital an entrepreneur brings', null, o.score); continue; }
    const used = new Set(db.all<{ name: string }>('SELECT name FROM companies').map((r) => r.name));
    const name = (NAMES[o.industry] ?? []).find((n) => !used.has(n));
    if (!name) { log(o.industry, 'skipped', 'no company names left', null, o.score); continue; }
    const wc = Math.min(Math.floor(o.startup.workingCapitalMinor * 1.5), cfg.npcEntryCapitalMinor - (o.startup.totalMinor - o.startup.workingCapitalMinor));
    const strategy = ENTRY_STRATEGIES[(hash(name) + ctx.tick) % ENTRY_STRATEGIES.length]!;
    const r = openNpcCompany(db, ctx, cfg, { industry: o.industry, plotId: lot.id, name, workingCapitalMinor: wc, strategy, key: `npc:found:${ctx.tick}:${o.industry}` });
    if (!r.ok) { log(o.industry, 'failed', r.error, null, o.score); continue; }
    logDecision(db, ctx.tick, { id: r.companyId }, strategy, 'enter_market', `Forecast profit ${(o.forecast.profitMinor / 100).toFixed(2)} EC/day, ${o.market.unmetUnitsPerDay} units/day unserved, ${rivals} rivals: opened as a ${STRATEGIES[strategy].label.toLowerCase()} with ${(o.startup.totalMinor / 100).toFixed(0)} EC of startup capital.`, { forecast: o.forecast, market: o.market }, true, true);
    log(o.industry, 'entered', `opened ${name}`, r.companyId, o.score);
    void CITY_ID;
    return r.companyId;
  }
  return null;
}
