import type { Sql } from '../db/sql';
import { gameDate, loadConfig } from './config';
import { energyPerBatch, inputUnitsPerBatch, linesOf, recipeInputs, type CompanyRow } from './operations';
import { LOT_SQL, defaultStaff, rentFor, tierOf, upgradeBlocker, type Spec, type Tier, type UpgradeRow } from './company';
import type { MarketShortage } from '../../src/shared/exchange';
import type { LotInfo, Management, Opportunity, RankRow, Ranking } from '../../src/shared/management';
import { PLAYER_ID } from '../seed/bristol';
import { directory as directoryRows } from './exchange';
import { washSql } from './standings';
import { feeFromBps } from '../../src/domain/money';

const lastTick = (db: Sql) => db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
const WINDOW = 7;                                         // days of history behind every estimate
const startable = (db: Sql) => db.all<Spec>('SELECT * FROM industry_specs WHERE startable = 1 ORDER BY industry_id');
/** Days of real history behind an average: a young world has fewer than WINDOW ticks, and the first tick (0) is the seed, not a trading day. */
const daysOf = (db: Sql) => Math.max(1, Math.min(WINDOW, lastTick(db)));
const avgOver = (n: number, days: number) => Math.round(n / days);


/** Real units wanted/sold per day for a commodity, derived from consumer + public-works demand rules. */
function consumerDemand(db: Sql, commodity: string, t: number) {
  const days = daysOf(db);
  const r = db.get<{ w: number; s: number; u: number }>('SELECT COALESCE(SUM(s.units_wanted),0) w, COALESCE(SUM(s.units_sold),0) s, COALESCE(SUM(s.unmet_units),0) u FROM demand_tick_stats s JOIN demand_rules r ON r.id = s.rule_id WHERE r.commodity_id = ? AND s.tick > ? AND s.tick > 0', commodity, t - WINDOW)!;
  if (r.w > 0) return { wanted: avgOver(r.w, days), sold: avgOver(r.s, days), unmet: avgOver(r.u, days) };
  // No trading day yet: estimate from the demand rules' funding at the reference price.
  const ref = db.get<{ p: number }>('SELECT reference_price_minor p FROM commodities WHERE id = ?', commodity)!.p;
  const rules = db.all<{ mode: string; amount: number; bal: number }>('SELECT r.mode, r.amount, a.balance_minor bal FROM demand_rules r JOIN accounts a ON a.id = r.funder_account_id WHERE r.commodity_id = ?', commodity);
  const budget = rules.reduce((a, x) => a + (x.mode === 'fixed' ? Math.min(x.amount, x.bal) : Math.floor((x.bal * x.amount) / 10_000)), 0);
  return { wanted: Math.floor(budget / ref), sold: 0, unmet: 0 };
}
/** Business-to-business demand: units per day that production lines in the city plan to consume. */
function businessDemand(db: Sql, commodity: string) {
  return db.get<{ n: number }>("SELECT COALESCE(SUM(ri.units * l.planned_batches),0) n FROM production_lines l JOIN recipe_inputs ri ON ri.recipe_id = l.recipe_id JOIN companies c ON c.id = l.company_id WHERE ri.commodity_id = ? AND c.bankrupt_tick IS NULL AND c.status <> 'insolvent'", commodity)!.n;
}

/** Opportunity finder. Pure read of the live simulation; ranks the six industries by expected daily profit after costs, with the reasoning spelled out. */
export function opportunities(db: Sql): Opportunity[] {
  const cfg = loadConfig(db), t = lastTick(db);
  const wallet = db.get<{ b: number; r: number }>('SELECT a.balance_minor b, a.reserved_minor r FROM accounts a JOIN players p ON p.wallet_account_id = a.id WHERE p.id = ?', PLAYER_ID)!;
  const out: Opportunity[] = [];
  const lotRows = db.all<{ d: string | null; w: number; dep: number }>(`SELECT p.district_id d, p.width w, p.depth dep FROM plots p WHERE ${LOT_SQL} AND p.company_id IS NULL AND p.asset_id IS NULL`);
  for (const spec of startable(db)) {
    const tier = tierOf(db, spec.industry_id, 1)!;
    const recipe = db.get<{ id: string; output_commodity_id: string; output_units: number; energy_units: number }>('SELECT * FROM recipes WHERE id = ?', spec.primary_recipe_id)!;
    const commodity = recipe.output_commodity_id;
    const ref = db.get<{ p: number }>('SELECT reference_price_minor p FROM commodities WHERE id = ?', commodity)!.p;
    const energyRef = db.get<{ p: number }>('SELECT reference_price_minor p FROM commodities WHERE id = ?', cfg.energyCommodityId)?.p ?? 0;
    const days = daysOf(db);
    const rivals = db.all<{ id: string; u: number }>("SELECT c.id, COALESCE((SELECT SUM(s.units_sold) FROM company_tick_stats s WHERE s.company_id = c.id AND s.tick > ? AND s.tick > 0),0) u FROM companies c WHERE c.industry_id = ? AND c.owner_kind <> 'state' AND c.bankrupt_tick IS NULL AND c.status <> 'insolvent'", t - WINDOW, spec.industry_id);
    // Before the first trading day there is no sales history: use what rivals plan to make (their real production lines) instead.
    if (t < 1) for (const r of rivals) r.u = db.get<{ u: number }>('SELECT COALESCE(SUM(l.planned_batches * rc.output_units),0) u FROM production_lines l JOIN recipes rc ON rc.id = l.recipe_id WHERE l.company_id = ? AND rc.output_commodity_id = ?', r.id, commodity)!.u;
    const supply = avgOver(rivals.reduce((a, r) => a + r.u, 0), t < 1 ? 1 : days), leader = avgOver(Math.max(0, ...rivals.map((r) => r.u)), t < 1 ? 1 : days);
    const demand = spec.sells === 'businesses' ? businessDemand(db, commodity) : consumerDemand(db, commodity, t).wanted;
    const unmet = Math.max(0, demand - supply);
    const saturation = demand > 0 ? Math.min(20_000, Math.floor((supply * 10_000) / demand)) : 20_000;
    const price = spec.sells === 'consumers' ? spec.default_price_minor : Math.min(spec.max_price_minor, Math.max(spec.min_price_minor, ref));
    // a newcomer expects to win the unmet demand plus an equal slice of what rivals already serve
    // newcomers start with neutral reputation (50%), so against established rivals they win a little less than an equal slice
    const rivalRep = rivals.length ? db.get<{ r: number }>("SELECT AVG(reputation_bps) r FROM companies WHERE industry_id = ? AND owner_kind <> 'state' AND bankrupt_tick IS NULL", spec.industry_id)!.r : 5_000;
    const slice = Math.floor(supply / (rivals.length + 1));
    const share = unmet + (spec.sells === 'consumers' ? Math.floor((slice * 10_000) / (5_000 + Math.max(5_000, rivalRep))) : slice);
    const staff = defaultStaff(spec, tier), batches = Math.min(spec.default_batches, tier.capacity_batches);
    const units = Math.max(0, Math.min(batches * recipe.output_units, share));
    const usedBatches = Math.ceil(units / recipe.output_units);
    const inputs = recipeInputs(db, spec.primary_recipe_id).map((i) => {
      const asks = db.get<{ p: number | null; q: number }>("SELECT MIN(price_minor) p, COALESCE(SUM(qty_remaining),0) q FROM orders WHERE commodity_id = ? AND side='sell' AND status='open'", i.commodity_id)!;
      const refIn = db.get<{ p: number }>('SELECT reference_price_minor p FROM commodities WHERE id = ?', i.commodity_id)!.p;
      return { commodityId: i.commodity_id, unitsPerDay: inputUnitsPerBatch(cfg, 'standard', i.units) * usedBatches, unitPriceMinor: Math.max(refIn, asks.p ?? 0), availableUnits: asks.q, stateFallback: true };
    });
    const inputsMinor = inputs.reduce((a, i) => a + i.unitsPerDay * i.unitPriceMinor, 0);
    const energyMinor = energyPerBatch({ energy_saving_bps: 0 }, recipe.energy_units) * usedBatches * energyRef;
    const revenue = units * price;
    const fees = spec.sells === 'consumers' ? 0 : feeFromBps(revenue, cfg.exchangeFeeBps);
    const freeLots = lotRows.filter((l) => l.w === spec.plot_width && l.dep === spec.plot_depth);
    const rent = freeLots.length ? Math.min(...freeLots.map((l) => rentFor(db, spec, tier, l.d))) : rentFor(db, spec, tier, null);
    const wages = staff * spec.wage_minor;
    const profit = revenue - fees - inputsMinor - energyMinor - wages - rent;
    const total = spec.licence_fee_minor + tier.fitout_minor + spec.equipment_minor + spec.working_capital_minor;
    const sunk = spec.licence_fee_minor + tier.fitout_minor + spec.equipment_minor;
    const margin = revenue > 0 ? Math.floor((profit * 10_000) / revenue) : -10_000;
    const reasons: string[] = [], warnings: string[] = [];
    const nm = spec.label.toLowerCase();
    if (rivals.length === 0) reasons.push(`Nobody in Bristol runs a ${nm} yet: you would be the only supplier.`);
    else if (unmet > 0) reasons.push(`Bristol wants about ${demand.toLocaleString('en-GB')} ${commodity} per day but only ${supply.toLocaleString('en-GB')} are being sold, leaving roughly ${unmet.toLocaleString('en-GB')} per day unserved.`);
    else reasons.push(`Demand (${demand.toLocaleString('en-GB')}/day) is already met by ${rivals.length} competitor${rivals.length === 1 ? '' : 's'}; you would take customers from them, not find new ones.`);
    if (spec.sells === 'businesses') reasons.push(`You sell to other businesses: they buy ${commodity} as an ingredient, so your customers are the Bristol firms whose recipes need it.`);
    if (spec.sells === 'state') reasons.push('Your main customer is the city’s public-works programme, funded from the state treasury.');
    const lowStock = inputs.filter((i) => i.availableUnits < i.unitsPerDay);
    for (const i of lowStock) warnings.push(`Only ${i.availableUnits} ${i.commodityId} are for sale right now (you would need ${i.unitsPerDay}/day). The state supplier fills the gap at a premium, which shrinks the margin.`);
    if (saturation >= 9_000) warnings.push(`The market is ${Math.min(100, Math.round(saturation / 100))}% served: expect a price fight with existing ${nm}s.`);
    if (profit <= 0) warnings.push('At default settings the forecast is a loss: you would need a better price, cheaper inputs, or fewer staff.');
    if (total > wallet.b - wallet.r) warnings.push(`Startup needs ${total / 100} EC and you have ${(wallet.b - wallet.r) / 100} EC.`);
    if (!freeLots.length) warnings.push(`No vacant ${spec.plot_width}×${spec.plot_depth} lot is free.`);
    const risk: Opportunity['risk'] = profit <= 0 || saturation >= 12_000 ? 'high' : saturation >= 8_000 || lowStock.length > 0 || margin < 1_000 ? 'medium' : 'low';
    // Opportunity finder v2: labels and metrics come straight from recorded data; they describe the market, they never promise a profit.
    const sold = (from: number, to: number) => db.get<{ u: number }>("SELECT COALESCE(SUM(s.units_sold),0) u FROM company_tick_stats s JOIN companies c ON c.id = s.company_id WHERE c.industry_id = ? AND c.owner_kind <> 'state' AND s.tick > ? AND s.tick <= ?", spec.industry_id, from, to)!.u;
    const recentU = sold(t - WINDOW, t), priorU = sold(t - 2 * WINDOW, t - WINDOW);
    const growthBps = priorU > 0 ? Math.round(((recentU - priorU) * 10_000) / priorU) : 0;
    const failures = db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE industry_id = ? AND owner_kind <> 'state' AND bankrupt_tick IS NOT NULL AND bankrupt_tick > ?", spec.industry_id, t - 30)!.n;
    const entrants = db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE industry_id = ? AND owner_kind <> 'state' AND created_tick > ?", spec.industry_id, t - 30)?.n ?? 0;
    const labels: Opportunity['labels'] = [];
    if (demand > 0 && unmet * 10 >= demand * 2) labels.push('High unmet demand');
    if (t >= 14 && growthBps >= 1_000 && recentU > 0) labels.push('Growing market');
    if (rivals.length >= 3 || saturation >= 9_000) labels.push('Competitive');
    if (demand > 0 && saturation >= 15_000) labels.push('Oversupplied');
    if (failures >= 1 || profit <= 0 || saturation >= 12_000) labels.push('High risk');
    const metrics: Opportunity['metrics'] = { unmetDemandBps: demand > 0 ? Math.floor((unmet * 10_000) / demand) : 0, growthBps, concentrationBps: supply > 0 ? Math.floor((leader * 10_000) / Math.max(1, supply)) : 0, recentFailures: failures, newEntrants: entrants };
    out.push({
      industry: spec.industry_id, label: spec.label, tagline: spec.tagline, sells: spec.sells,
      forecast: { label: 'FORECAST', unitsPerDay: units, pricePerUnitMinor: price, revenueMinor: revenue, inputsMinor, energyMinor, wagesMinor: wages, rentMinor: rent, feesMinor: fees, profitMinor: profit, marginBps: margin, paybackDays: profit > 0 ? Math.ceil(sunk / profit) : null },
      startup: { totalMinor: total, licenceMinor: spec.licence_fee_minor, premisesMinor: tier.fitout_minor, equipmentMinor: spec.equipment_minor, workingCapitalMinor: spec.working_capital_minor },
      market: { demandUnitsPerDay: demand, supplyUnitsPerDay: supply, unmetUnitsPerDay: unmet, saturationBps: saturation, competitors: rivals.length, leaderUnitsPerDay: leader, referencePriceMinor: ref },
      labels, metrics, inputs, risk, score: profit * 100 + unmet * 10 - rivals.length * 50, headline: '', reasons, warnings,
      tiers: db.all<Tier>('SELECT * FROM industry_tiers WHERE industry_id = ? ORDER BY tier', spec.industry_id).filter((x) => x.tier <= 2).map((x) => ({ tier: x.tier, name: x.name, fitoutMinor: x.fitout_minor, capacity: x.capacity_batches * recipe.output_units, staff: x.max_employees })),
    });
  }
  out.sort((a, b) => b.score - a.score);
  const best = out[0];
  out.forEach((o, i) => {
    o.headline = o.forecast.profitMinor > 0 ? `${i === 0 ? 'Best forecast: ' : ''}about ${(o.forecast.profitMinor / 100).toFixed(2)} EC/day profit, ${o.market.competitors} competitor${o.market.competitors === 1 ? '' : 's'}` : `Forecast loss of ${(-o.forecast.profitMinor / 100).toFixed(2)} EC/day at default settings`;
    if (best && o !== best && o.sells === 'consumers' && best.sells === 'businesses' && best.forecast.profitMinor > o.forecast.profitMinor)
      o.reasons.push(`A ${best.label.toLowerCase()} forecasts more (${(best.forecast.profitMinor / 100).toFixed(2)} vs ${(o.forecast.profitMinor / 100).toFixed(2)} EC/day): it faces ${best.market.competitors} rival${best.market.competitors === 1 ? '' : 's'} against ${o.market.competitors} here, and its customers are businesses that must buy to keep producing.`);
  });
  return out;
}

/** Lots with the daily rent each industry would pay there (district property index × industry base × premises tier). */
export function lots(db: Sql): LotInfo[] {
  const specs = startable(db);
  return db.all<{ id: string; col: number; row: number; width: number; depth: number; district_id: string | null; company_id: string | null; asset_id: string | null; name: string | null; idx: number | null }>(`SELECT p.id, p.col, p.row, p.width, p.depth, p.district_id, p.company_id, p.asset_id, d.name, d.property_index_bps idx FROM plots p LEFT JOIN districts d ON d.id = p.district_id WHERE ${LOT_SQL} ORDER BY p.row, p.col`).map((p) => {
    const fit = specs.filter((s) => s.plot_width === p.width && s.plot_depth === p.depth);
    return { id: p.id, column: p.col, row: p.row, width: p.width, depth: p.depth, district: p.district_id ?? '', districtName: p.name ?? '', propertyIndexBps: p.idx ?? 10_000, status: p.company_id || p.asset_id ? 'taken' as const : 'vacant' as const, fits: fit.map((s) => s.industry_id), rentFrom: Object.fromEntries(fit.map((s) => [s.industry_id, rentFor(db, s, tierOf(db, s.industry_id, 1)!, p.district_id)])) };
  });
}

/** Local rankings by 7-day average units sold. Ties break on reputation, then id, so the order is deterministic. */
export function rankings(db: Sql): Ranking[] {
  const t = lastTick(db), days = daysOf(db);
  return startable(db).map((spec) => {
    const rows = db.all<{ id: string; name: string; reputation_bps: number; price_minor: number; owner_kind: string; owner_id: string; u: number; ask: number | null }>(`SELECT c.id, c.name, c.reputation_bps, c.price_minor, c.owner_kind, c.owner_id, MAX(0, COALESCE((SELECT SUM(s.units_sold) FROM company_tick_stats s WHERE s.company_id = c.id AND s.tick > ? AND s.tick > 0),0) - ${washSql('qty', 'c.id')}) u, (SELECT ask_price_minor FROM production_lines WHERE company_id = c.id LIMIT 1) ask FROM companies c WHERE c.industry_id = ? AND c.owner_kind <> 'state' AND c.bankrupt_tick IS NULL ORDER BY u DESC, c.reputation_bps DESC, c.id`, t - WINDOW, t - WINDOW, t, spec.industry_id);
    const total = rows.reduce((a, r) => a + r.u, 0);
    return { industry: spec.industry_id, label: spec.label, total: rows.length, unitsPerDay: avgOver(total, days), rows: rows.map((r, i) => ({ rank: i + 1, companyId: r.id, name: r.name, unitsPerDay: avgOver(r.u, days), shareBps: total > 0 ? Math.floor((r.u * 10_000) / total) : 0, reputationBps: r.reputation_bps, priceMinor: spec.sells === 'consumers' ? r.price_minor : (r.ask ?? r.price_minor), mine: r.owner_kind === 'player' && r.owner_id === PLAYER_ID })) };
  });
}


export function management(db: Sql, companyId: string): Management | null {
  const c = db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', companyId);
  if (!c || c.owner_kind === 'state') return null;
  const cfg = loadConfig(db), t = lastTick(db);
  const tier = tierOf(db, c.industry_id, c.premises_tier);
  const line = linesOf(db, companyId)[0];
  const condFactor = 5_000 + Math.floor(c.condition_bps / 2);
  const staffNeeded = (planned: number) => {
    const denom = c.capacity_batches * condFactor * (10_000 + c.productivity_bps);
    return denom === 0 ? 0 : Math.max(1, Math.min(c.max_employees, Math.ceil((planned * c.max_employees * 10_000 * 10_000) / denom)));
  };
  const sameDay = c.staff_change_tick === t;
  const staffFactor = c.max_employees === 0 ? 0 : Math.min(10_000, Math.floor((c.employees * (10_000 + c.productivity_bps)) / c.max_employees));
  const effBatches = Math.round((Math.floor((c.capacity_batches * staffFactor) / 10_000) * condFactor) / 10_000);
  const log = db.all<{ tick: number; planned_batches: number; produced_batches: number; limited_by: string; output_units: number }>('SELECT * FROM production_log WHERE company_id = ? ORDER BY tick DESC LIMIT 14', companyId);
  const lastLimit = log[0]?.limited_by;
  const chain = line ? recipeInputs(db, line.recipe_id).map((i) => {
    const asks = db.get<{ p: number | null; q: number }>("SELECT MIN(price_minor) p, COALESCE(SUM(qty_remaining),0) q FROM orders WHERE commodity_id = ? AND side='sell' AND status='open' AND company_id <> ?", i.commodity_id, companyId)!;
    const inStock = db.get<{ q: number }>('SELECT COALESCE(SUM(qty - reserved),0) q FROM inventory WHERE company_id = ? AND commodity_id = ?', companyId, i.commodity_id)!.q;
    const ref = db.get<{ p: number }>('SELECT reference_price_minor p FROM commodities WHERE id = ?', i.commodity_id)!.p;
    return { commodityId: i.commodity_id, perBatch: inputUnitsPerBatch(cfg, c.quality, i.units), inStock, forSale: asks.q, bestAskMinor: asks.p, stateFallbackMinor: Math.floor((ref * (10_000 + cfg.stateSupplyMarkupBps)) / 10_000) };
  }) : [];
  const rk = rankings(db).find((r) => r.industry === c.industry_id);
  const mineRow = rk?.rows.find((r) => r.companyId === companyId);
  const st = db.get<{ revenue_minor: number; cogs_minor: number; labour_minor: number; property_minor: number; marketing_minor: number; net_profit_minor: number; units_sold: number; units_produced: number; energy_paid_minor: number; fees_minor: number }>('SELECT * FROM company_tick_stats WHERE company_id = ? AND tick = ?', companyId, t);
  const diag: Management['diagnosis'] = [];
  const live = c.bankrupt_tick === null;
  if (!live) diag.push({ kind: 'bad', text: 'This company went bankrupt and was liquidated by the state administrator. Its records are kept and the lot is free again.' });
  else if (c.status === 'insolvent') diag.push({ kind: 'bad', text: 'The company cannot pay its bills. Add cash and reopen it, or it will be liquidated.' });
  if (st && live) {
    const exp = st.revenue_minor - st.net_profit_minor;
    if (st.net_profit_minor > 0) diag.push({ kind: 'good', text: `Profitable: ${(st.revenue_minor / 100).toFixed(2)} EC in revenue covered ${(exp / 100).toFixed(2)} EC of costs.` });
    else if (st.net_profit_minor < 0) {
      const parts: [string, number][] = [['cost of goods', st.cogs_minor], ['wages', st.labour_minor], ['rent', st.property_minor], ['advertising', st.marketing_minor], ['energy', st.energy_paid_minor], ['fees', st.fees_minor]];
      const worst = parts.sort((a, b) => b[1] - a[1])[0]!;
      diag.push({ kind: 'bad', text: `Losing ${(-st.net_profit_minor / 100).toFixed(2)} EC/day. The biggest cost is ${worst[0]} (${(worst[1] / 100).toFixed(2)} EC) against ${(st.revenue_minor / 100).toFixed(2)} EC of sales.` });
    }
    const lowest = rk?.rows.filter((r) => r.companyId !== companyId && r.priceMinor > 0).sort((a, b) => a.priceMinor - b.priceMinor)[0];
    const myPrice = rk?.rows.find((r) => r.companyId === companyId)?.priceMinor ?? 0;
    if (lowest && myPrice > lowest.priceMinor && st.units_sold < st.units_produced) diag.push({ kind: 'warn', text: `A competitor undercuts you: ${lowest.name} sells at ${(lowest.priceMinor / 100).toFixed(2)} EC against your ${(myPrice / 100).toFixed(2)} EC, and buyers favour the lower price.` });
    if (st.units_produced > 0 && st.units_sold === 0) diag.push({ kind: 'warn', text: 'You produced goods but sold none: check your price against competitors, or your reputation and advertising.' });
  }
  if (lastLimit && lastLimit !== 'plan' && live) {
    const why: Record<string, string> = { staff: 'You do not have enough staff to run the planned batches. Hire, or lower the target.', storage: 'Unsold stock has piled up (storage is full, or about 5 days of output is sitting in the store). Lower your price or your production target.', inputs: 'Ingredients ran out. Buy supplies or turn on auto-purchasing.', cash: 'The company ran short of cash for ingredients.', supply: 'Nobody could sell the company enough ingredients.', condition: 'Worn equipment is cutting output. Service it.', closed: 'The company was closed.' };
    diag.push({ kind: 'warn', text: why[lastLimit] ?? `Production limited by ${lastLimit}.` });
  }
  if (c.condition_bps < 5_000 && live) diag.push({ kind: 'warn', text: `Equipment is at ${Math.round(c.condition_bps / 100)}% condition; output is reduced until it is serviced.` });
  if (line && live && c.employees > 1 && c.employees > staffNeeded(line.planned_batches)) diag.push({ kind: 'warn', text: `You employ ${c.employees} people but ${staffNeeded(line.planned_batches)} would run today’s production target. Extra wages add no output.` });
  if (rk && mineRow && rk.total > 1 && live) diag.push({ kind: mineRow.rank === 1 ? 'good' : 'warn', text: `Ranked #${mineRow.rank} of ${rk.total} ${rk.label.toLowerCase()}s in Bristol with a ${Math.round(mineRow.shareBps / 100)}% share.` });
  const ownedSet = new Set(db.all<{ upgrade_id: string }>('SELECT upgrade_id FROM company_upgrades WHERE company_id = ?', companyId).map((r) => r.upgrade_id));
  const cash = db.get<{ a: number }>('SELECT balance_minor - reserved_minor a FROM accounts WHERE id = ?', c.treasury_account_id)!.a;
  const effect = (u: UpgradeRow) => u.kind === 'tier' ? 'Moves you to the next premises tier: more capacity, staff and storage, but higher rent.' : [u.d_capacity_batches ? `+${u.d_capacity_batches} batches/day` : '', u.d_storage ? `+${u.d_storage} storage` : '', u.d_productivity_bps ? `+${u.d_productivity_bps / 100}% staff productivity` : '', u.d_energy_saving_bps ? `−${u.d_energy_saving_bps / 100}% energy use` : ''].filter(Boolean).join(', ');
  const upgrades = db.all<UpgradeRow>('SELECT * FROM upgrade_catalog WHERE industry_id = ? ORDER BY sort, id', c.industry_id).map((u) => ({ id: u.id, name: u.name, description: u.description, kind: u.kind, costMinor: u.cost_minor, effect: effect(u), installed: ownedSet.has(u.id), blocker: upgradeBlocker(db, c, u, ownedSet), affordable: cash >= u.cost_minor }));
  return {
    companyId, rank: mineRow && rk ? { rank: mineRow.rank, of: rk.total, label: rk.label } : null, diagnosis: diag,
    staff: { employees: c.employees, max: c.max_employees, needed: line ? staffNeeded(line.planned_batches) : 0, wagePerDayMinor: c.wage_minor, changesLeftToday: { hire: Math.max(0, cfg.staffChangesPerDay - (sameDay ? c.hires_in_tick : 0)), dismiss: Math.max(0, cfg.staffChangesPerDay - (sameDay ? c.dismissals_in_tick : 0)) }, changeFeeMinor: c.wage_minor },
    equipment: { conditionBps: c.condition_bps, serviceCostMinor: Math.ceil((c.equipment_cost_minor * (10_000 - c.condition_bps) * cfg.serviceCostBps) / 100_000_000), capacityFactorBps: condFactor, wearBpsPerDay: cfg.wearBpsPerTick },
    production: { recipeId: line?.recipe_id ?? '', plannedBatches: line?.planned_batches ?? 0, effectiveBatches: effBatches, outputUnits: line ? line.planned_batches * line.output_units : 0, outputPerBatch: line?.output_units ?? 0, limitedBy: lastLimit && lastLimit !== 'plan' ? lastLimit : null,
      log: log.map((l) => ({ tick: l.tick, gameDate: gameDate(cfg, l.tick), planned: l.planned_batches, produced: l.produced_batches, limitedBy: l.limited_by, outputUnits: l.output_units })).reverse() },
    supplyChain: chain,
    advertising: { spendPerDayMinor: c.marketing_minor, awarenessBps: c.awareness_bps, maxAwarenessBps: cfg.awarenessMaxBps },
    quality: { current: c.quality, inputMultiplierBps: cfg.qualityInputBps },
    upgrades, autoProcure: c.auto_procure === 1, premisesTier: c.premises_tier, tierName: tier?.name ?? '', assetId: c.asset_id ?? tier?.asset_id ?? c.industry_id,
    closed: live ? null : { bankrupt: true, writtenOffMinor: c.written_off_minor },
  };
}

export type { LotInfo, Management, Opportunity, RankRow, Ranking };

/** Per-commodity market gaps for the opportunity finder. Demand = funded consumer budgets + production plans that use it; supply = what producers plan to make; all computed live. */
export function marketShortages(db: Sql): MarketShortage[] {
  const cfg = loadConfig(db), tick = lastTick(db);
  const out: MarketShortage[] = [];
  for (const d of directoryRows(db)) {
    const producers = db.all<{ company: string; u: number; ind: string; owner: string }>("SELECT c.id company, SUM(l.planned_batches * r.output_units) u, c.industry_id ind, c.owner_kind owner FROM production_lines l JOIN recipes r ON r.id = l.recipe_id JOIN companies c ON c.id = l.company_id WHERE r.output_commodity_id = ? AND c.bankrupt_tick IS NULL AND c.status = 'operating' GROUP BY c.id", d.commodityId);
    const real = producers.filter((p) => p.owner !== 'state');
    const supply = real.reduce((a, p) => a + p.u, 0) + (d.commodityId === 'energy' ? 0 : 0);
    const spec = db.get<Spec & { rid: string }>('SELECT s.*, s.primary_recipe_id rid FROM industry_specs s JOIN recipes r ON r.id = s.primary_recipe_id WHERE s.startable = 1 AND r.output_commodity_id = ?', d.commodityId);
    const demand = d.demandUnitsPerDay;
    const shortage = Math.max(0, demand - supply);
    const price = d.vwap7dMinor ?? d.lastTradePriceMinor ?? d.referencePriceMinor;
    const rec = spec ? db.get<{ energy_units: number; output_units: number }>('SELECT energy_units, output_units FROM recipes WHERE id = ?', spec.primary_recipe_id) : undefined;
    const inputCost = spec ? recipeInputs(db, spec.primary_recipe_id).reduce((a, i) => a + inputUnitsPerBatch(cfg, 'standard', i.units) * Math.max(db.get<{ p: number }>('SELECT reference_price_minor p FROM commodities WHERE id = ?', i.commodity_id)!.p, db.get<{ p: number | null }>("SELECT MIN(price_minor) p FROM orders WHERE commodity_id = ? AND side='sell' AND status='open'", i.commodity_id)?.p ?? 0), 0) : 0;
    const energyRef = db.get<{ p: number }>('SELECT reference_price_minor p FROM commodities WHERE id = ?', cfg.energyCommodityId)?.p ?? 0;
    const unitCost = rec && rec.output_units > 0 ? Math.ceil((inputCost + rec.energy_units * energyRef) / rec.output_units) : 0;
    const status: MarketShortage['status'] = demand > 0 && shortage * 10 >= demand * 2 ? 'shortage' : demand > 0 && supply * 10 >= demand * 15 ? 'surplus' : 'balanced';
    out.push({
      commodityId: d.commodityId, label: d.name, industry: spec?.industry_id ?? null, industryLabel: spec?.label ?? null, demandUnitsPerDay: demand, supplyUnitsPerDay: supply, shortageUnitsPerDay: shortage, listedUnits: d.listedUnits, competitors: real.length,
      recentPriceMinor: price, priceBasis: d.vwap7dMinor !== null || d.lastTradePriceMinor !== null ? 'trades' : 'reference', unitCostMinor: unitCost, unitProfitMinor: unitCost > 0 ? price - unitCost : 0, status,
      explanation: `Bristol ${d.name.toLowerCase()} market: demand ${demand.toLocaleString('en-GB')}/day, producers plan ${supply.toLocaleString('en-GB')}/day${shortage > 0 ? `, a shortage of ${shortage.toLocaleString('en-GB')}/day` : ''}; ${d.listedUnits.toLocaleString('en-GB')} units are listed for sale now.`,
    });
  }
  void tick;
  return out.sort((a, b) => b.shortageUnitsPerDay - a.shortageUnitsPerDay || a.commodityId.localeCompare(b.commodityId));
}

export type { MarketShortage };
