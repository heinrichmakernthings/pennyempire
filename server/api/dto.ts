import type { City, Commodity, Company, History, Holding, Listing, Money, Order, Owner, Player, Plot, Recipe, ScreenState, Trade } from '../../src/contracts/game-state';
import type { CompanySummary, PortfolioState } from '../../src/data/types';
import type { Sql } from '../db/sql';
import { gameDate, loadConfig } from '../engine/config';
import { balance } from '../engine/ledger';
import { PLAYER_ID } from '../seed/bristol';

const ec = (minor: number): Money => ({ currency: 'EC', minor });
const lastTick = (db: Sql) => db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
const CONTRACT_INDUSTRIES = new Set(['farm', 'mill', 'dairy', 'pizza', 'cafe', 'timber']);

interface CoRow {
  id: string; name: string; city_id: string; plot_id: string | null; industry_id: string; asset_id: string | null; owner_kind: 'player' | 'npc' | 'state'; owner_id: string; owner_name: string; treasury_account_id: string;
  level: number; status: 'operating' | 'paused' | 'insolvent'; retail_commodity_id: string | null; price_minor: number; min_price_minor: number; max_price_minor: number; quality: 'basic' | 'standard' | 'premium';
  employees: number; max_employees: number; wage_minor: number; capacity_batches: number; storage_cap_units: number; property_minor: number; marketing_minor: number; reputation_bps: number; unpaid_minor: number; revision: number; bankrupt_tick: number | null; premises_tier: number;
}
const COMPANY_SQL = 'SELECT c.*, o.name owner_name FROM companies c JOIN owners o ON o.id = c.owner_id';
const owner = (c: Pick<CoRow, 'owner_id' | 'owner_name' | 'owner_kind'>): Owner => ({ id: c.owner_id, name: c.owner_name, kind: c.owner_kind });

export function asOf(db: Sql) { const t = lastTick(db); return { tick: t, asOf: gameDate(loadConfig(db), t) }; }

function history(db: Sql, companyId: string, col: string, limit = 30): History {
  const cfg = loadConfig(db);
  const rows = db.all<{ tick: number; v: number }>(`SELECT tick, ${col} v FROM company_tick_stats WHERE company_id = ? AND tick > 0 ORDER BY tick DESC LIMIT ?`, companyId, limit).reverse();
  return { currency: 'EC', interval: 'day', points: rows.map((r) => ({ at: gameDate(cfg, r.tick), valueMinor: r.v })), complete: true };
}

export function playerDto(db: Sql): Player {
  const p = db.get<{ id: string; display_name: string; city_id: string; wallet_account_id: string }>('SELECT * FROM players WHERE id = ?', PLAYER_ID)!;
  const w = db.get<{ b: number; r: number }>('SELECT balance_minor b, reserved_minor r FROM accounts WHERE id = ?', p.wallet_account_id)!;
  const t = lastTick(db);
  const mine = db.all<{ treasury_account_id: string; id: string }>("SELECT id, treasury_account_id FROM companies WHERE owner_kind = 'player' AND owner_id = ?", PLAYER_ID);
  const book = mine.reduce((a, c) => a + balance(db, c.treasury_account_id) + (db.get<{ v: number }>('SELECT COALESCE(SUM(value_minor),0) v FROM inventory WHERE company_id = ?', c.id)!.v), 0);
  const profit = db.get<{ s: number }>("SELECT COALESCE(SUM(s.net_profit_minor),0) s FROM company_tick_stats s JOIN companies c ON c.id = s.company_id WHERE s.tick = ? AND c.owner_kind = 'player' AND c.owner_id = ?", t, PLAYER_ID)!.s;
  const unread = db.get<{ n: number }>("SELECT COUNT(*) n FROM economic_events WHERE tick > ? AND severity IN ('warning','error') AND subject IN (SELECT id FROM companies WHERE owner_kind='player')", Math.max(0, t - 3))!.n;
  // No tradable shares exist yet, so portfolioValue is 0; net worth = wallet + the book value (cash + stock at cost) of companies you own.
  return { id: p.id, displayName: p.display_name, cityId: p.city_id, coins: ec(w.b - w.r), reservedCoins: ec(w.r), portfolioValue: ec(0), netWorth: ec(w.b + book), dailyProfit: ec(profit), unreadNotifications: unread };
}

export function directory(db: Sql): CompanySummary[] {
  return db.all<CoRow>(`${COMPANY_SQL} WHERE c.owner_kind <> 'state' AND c.bankrupt_tick IS NULL ORDER BY c.id`).filter((c) => CONTRACT_INDUSTRIES.has(c.industry_id))
    .map((c) => ({ id: c.id, name: c.name, plotId: c.plot_id ?? '', industry: c.industry_id as Company['industry'], owner: owner(c), level: c.level, status: c.status }));
}

export function cityDto(db: Sql): City {
  const cityRow = db.get<{ id: string; name: string }>('SELECT id, name FROM cities LIMIT 1')!;
  const t = lastTick(db), cfg = loadConfig(db);
  const plots: Plot[] = db.all<{ id: string; col: number; row: number; width: number; depth: number; terrain: Plot['terrain']; road_mask: number; quay_mask: number; asset_id: string | null; company_id: string | null }>('SELECT * FROM plots ORDER BY id').map((p) => {
    const co = p.company_id ? db.get<CoRow>(`${COMPANY_SQL} WHERE c.id = ?`, p.company_id) : undefined;
    return { id: p.id, column: p.col, row: p.row, width: p.width, depth: p.depth, terrain: p.terrain, roadMask: p.road_mask, quayMask: p.quay_mask, companyId: p.company_id, assetId: p.asset_id, owner: co ? owner(co) : null, purchasable: false, price: null };
  });
  const demand = db.all<{ commodity_id: string; wanted: number; sold: number; ref: number }>('SELECT r.commodity_id, COALESCE(s.units_wanted, 0) wanted, COALESCE(s.units_sold, 0) sold, c.reference_price_minor ref FROM demand_rules r JOIN commodities c ON c.id = r.commodity_id LEFT JOIN demand_tick_stats s ON s.rule_id = r.id AND s.tick = ? ORDER BY r.id', t)
    .map((d) => ({ commodityId: d.commodity_id, wantedUnits: d.wanted, suppliedUnits: d.sold, referencePrice: ec(d.ref) }));
  const events = db.all<{ id: number; tick: number; severity: string; message: string }>("SELECT id, tick, severity, message FROM economic_events WHERE kind <> 'seeded' ORDER BY id DESC LIMIT 6")
    .map((e) => ({ id: `ev-${e.id}`, title: `Day ${e.tick}: ${e.message}`, severity: (e.severity === 'info' ? 'info' : 'warning') as 'info' | 'warning', startsAt: gameDate(cfg, e.tick), endsAt: null }));
  return { id: cityRow.id, name: cityRow.name, plots, demand, events };
}

export function recipesDto(db: Sql): Recipe[] {
  return db.all<{ id: string; output_commodity_id: string; output_units: number; energy_units: number }>('SELECT * FROM recipes ORDER BY id').map((r) => ({
    id: r.id, output: { commodityId: r.output_commodity_id, units: r.output_units }, durationSeconds: 86_400, energyUnits: r.energy_units,
    inputs: db.all<{ commodity_id: string; units: number }>('SELECT commodity_id, units FROM recipe_inputs WHERE recipe_id = ? ORDER BY commodity_id', r.id).map((i) => ({ commodityId: i.commodity_id, units: i.units })),
  }));
}

export function companyDto(db: Sql, id: string): Company | null {
  const c = db.get<CoRow>(`${COMPANY_SQL} WHERE c.id = ?`, id);
  if (!c || !CONTRACT_INDUSTRIES.has(c.industry_id)) return null;
  const t = lastTick(db);
  const st = db.get<{ revenue_minor: number; net_profit_minor: number; units_sold: number }>('SELECT * FROM company_tick_stats WHERE tick = ? AND company_id = ?', t, id);
  const revenue = st?.revenue_minor ?? 0, profit = st?.net_profit_minor ?? 0;
  const lines = db.all<{ recipe_id: string; planned_batches: number; output_units: number; output_commodity_id: string }>('SELECT l.recipe_id, l.planned_batches, r.output_units, r.output_commodity_id FROM production_lines l JOIN recipes r ON r.id = l.recipe_id WHERE l.company_id = ? ORDER BY l.recipe_id', id);
  const planned = lines.reduce((a, l) => a + l.planned_batches * l.output_units, 0);
  const effBatches = c.max_employees === 0 ? 0 : Math.floor((c.capacity_batches * c.employees) / c.max_employees);
  const perTickUse = new Map<string, number>();
  for (const l of lines) for (const i of db.all<{ commodity_id: string; units: number }>('SELECT * FROM recipe_inputs WHERE recipe_id = ?', l.recipe_id)) perTickUse.set(i.commodity_id, (perTickUse.get(i.commodity_id) ?? 0) + i.units * l.planned_batches);
  // Companies buy inputs just-in-time each day, so input stock is normally ~0 at day end. Only report "hours remaining" when it is meaningful:
  // stock covers less than a day AND production actually fell short last tick (otherwise the supply chain is working and there is nothing to warn about).
  const producedLast = st ? db.get<{ u: number }>('SELECT units_produced u FROM company_tick_stats WHERE tick = ? AND company_id = ?', t, id)?.u ?? 0 : 0;
  const inventory = db.all<{ commodity_id: string; qty: number; reserved: number; value_minor: number }>('SELECT * FROM inventory WHERE company_id = ? ORDER BY commodity_id', id).map((i) => {
    const use = perTickUse.get(i.commodity_id) ?? 0;
    const hours = use > 0 ? Math.floor((i.qty * 24) / use) : null;
    return { commodityId: i.commodity_id, availableUnits: i.qty - i.reserved, reservedUnits: i.reserved, capacityUnits: c.storage_cap_units, estimatedHoursRemaining: hours !== null && hours < 24 && producedLast > 0 && i.qty === 0 ? null : hours };
  });
  const cash = balance(db, c.treasury_account_id);
  const stockValue = db.get<{ v: number }>('SELECT COALESCE(SUM(value_minor),0) v FROM inventory WHERE company_id = ?', id)!.v;
  const sector = db.get<{ s: number }>('SELECT COALESCE(SUM(units_sold),0) s FROM company_tick_stats t JOIN companies k ON k.id = t.company_id WHERE t.tick = ? AND k.industry_id = ?', t, c.industry_id)!.s;
  const mine = c.owner_kind === 'player' && c.owner_id === PLAYER_ID;
  return {
    id: c.id, name: c.name, cityId: c.city_id, plotId: c.plot_id ?? '', industry: c.industry_id as Company['industry'], owner: owner(c), level: c.level, assetId: c.asset_id ?? c.industry_id,
    status: c.status, revision: c.revision, valuation: ec(cash + stockValue), cash: ec(cash),
    dailyRevenue: ec(revenue), dailyExpenses: ec(revenue - profit), dailyProfit: ec(profit), customersToday: st?.units_sold ?? 0, marketShareBps: sector > 0 ? Math.floor(((st?.units_sold ?? 0) * 10_000) / sector) : 0,
    price: ec(c.retail_commodity_id ? c.price_minor : (db.get<{ a: number }>('SELECT ask_price_minor a FROM production_lines WHERE company_id = ? ORDER BY recipe_id LIMIT 1', id)?.a ?? c.price_minor)), minPrice: ec(c.min_price_minor), maxPrice: ec(c.max_price_minor),
    employees: c.employees, maxEmployees: c.max_employees, wagePerTick: ec(c.wage_minor), quality: c.quality, reputationBps: c.reputation_bps,
    capacityPerTick: effBatches * (lines[0]?.output_units ?? 0), plannedUnitsPerTick: planned, marketingPerTick: ec(c.marketing_minor), inventory, recipeId: lines[0]?.recipe_id ?? '',
    ownership: [{ owner: owner(c), shares: 10_000, ownershipBps: 10_000 }],
    upgrades: db.all<{ id: string; name: string; cost_minor: number; requires_tier: number; kind: string; to_tier: number | null }>('SELECT * FROM upgrade_catalog WHERE industry_id = ? ORDER BY sort, id', c.industry_id)
      .filter((u) => !db.get('SELECT 1 FROM company_upgrades WHERE company_id = ? AND upgrade_id = ?', id, u.id))
      .map((u) => ({ id: u.id, name: u.name, cost: ec(u.cost_minor), requirements: u.kind === 'tier' ? [`Premises tier ${(u.to_tier ?? 2) - 1}`] : [`Premises tier ${u.requires_tier}`], available: c.bankrupt_tick === null && (u.kind === 'tier' ? c.premises_tier + 1 === u.to_tier : c.premises_tier >= u.requires_tier), resultingAssetId: c.asset_id ?? c.industry_id })),
    profitHistory: history(db, id, 'net_profit_minor'), revenueHistory: history(db, id, 'revenue_minor'), expenseHistory: history(db, id, 'revenue_minor - net_profit_minor'),
    permissions: { manage: mine && c.status !== 'insolvent' && c.bankrupt_tick === null, buySupplies: mine && c.status === 'operating', upgrade: mine && c.status === 'operating' && c.bankrupt_tick === null },
  };
}

export function companiesScreen(db: Sql): ScreenState['companies'] {
  const items = db.all<{ id: string }>("SELECT id FROM companies WHERE owner_kind = 'player' AND owner_id = ? ORDER BY id", PLAYER_ID).map((r) => companyDto(db, r.id)).filter((c): c is Company => !!c);
  return { player: playerDto(db), companies: { items, nextCursor: null }, recipes: recipesDto(db) };
}

export function cityScreen(db: Sql) { return { player: playerDto(db), city: cityDto(db), selectedCompany: null, directory: directory(db) }; }

const orderDto = (db: Sql, o: { id: number; commodity_id: string; company_id: string; side: 'buy' | 'sell'; price_minor: number; qty_original: number; qty_remaining: number; status: string; created_tick: number }): Order => {
  const co = db.get<CoRow>(`${COMPANY_SQL} WHERE c.id = ?`, o.company_id)!;
  return { id: String(o.id), commodityId: o.commodity_id, cityId: co.city_id, companyId: o.company_id, supplier: owner(co), side: o.side, pricePerUnit: ec(o.price_minor), originalUnits: o.qty_original, remainingUnits: o.qty_remaining, status: o.status === 'open' && o.qty_remaining < o.qty_original ? 'partial' : (o.status as Order['status']), createdAt: gameDate(loadConfig(db), o.created_tick) };
};

export function commoditiesScreen(db: Sql): ScreenState['commodities'] {
  const t = lastTick(db), cfg = loadConfig(db);
  const commodities: Commodity[] = db.all<{ id: string; name: string; unit_label: string; reference_price_minor: number }>("SELECT * FROM commodities WHERE id <> 'energy' ORDER BY id").map((c) => {
    const px = (tick: number) => {
      const tr = db.get<{ v: number; q: number }>('SELECT SUM(price_minor * qty) v, SUM(qty) q FROM trades WHERE tick = ? AND commodity_id = ?', tick, c.id);
      if (tr && tr.q) return Math.floor(tr.v / tr.q);
      const rule = db.get<{ s: number; u: number }>('SELECT SUM(s.spent_minor) s, SUM(s.units_sold) u FROM demand_tick_stats s JOIN demand_rules r ON r.id = s.rule_id WHERE s.tick = ? AND r.commodity_id = ?', tick, c.id);
      return rule && rule.u ? Math.floor(rule.s / rule.u) : null;
    };
    const now = px(t) ?? c.reference_price_minor, then = px(Math.max(0, t - 7)) ?? now;
    const points: { at: string; valueMinor: number }[] = [];
    for (let k = Math.max(1, t - 29); k <= t; k++) { const v = px(k); if (v !== null) points.push({ at: gameDate(cfg, k), valueMinor: v }); }
    const sold = db.get<{ u: number }>("SELECT COALESCE(SUM(-delta),0) u FROM inventory_movements WHERE tick = ? AND commodity_id = ? AND reason IN ('trade_out','consumer_purchase','public_works')", t, c.id)!.u;
    const unmet = db.get<{ u: number }>('SELECT COALESCE(SUM(s.unmet_units),0) u FROM demand_tick_stats s JOIN demand_rules r ON r.id = s.rule_id WHERE s.tick = ? AND r.commodity_id = ?', t, c.id)!.u;
    const offered = db.get<{ q: number }>("SELECT COALESCE(SUM(qty_remaining),0) q FROM orders WHERE commodity_id = ? AND side = 'sell' AND status = 'open'", c.id)!.q;
    return { id: c.id, name: c.name, unitLabel: c.unit_label, iconAssetId: c.id === 'cafe-drink' ? 'delivery' : c.id === 'timber' ? 'timber-item' : c.id === 'pizza' ? 'pizza-item' : c.id, referencePrice: ec(now), changeBps: then > 0 ? Math.max(-10_000, Math.min(10_000, Math.round(((now - then) * 10_000) / then))) : 0, localSupplyUnits: sold + offered, localDemandUnits: sold + unmet, history: { currency: 'EC', interval: 'day', points, complete: true } };
  });
  const sell = db.all<Parameters<typeof orderDto>[1]>("SELECT * FROM orders WHERE status = 'open' AND side = 'sell' ORDER BY commodity_id, price_minor, id LIMIT 200").map((o) => orderDto(db, o));
  const mineIds = "(SELECT id FROM companies WHERE owner_kind='player' AND owner_id = ?)";
  const own = db.all<Parameters<typeof orderDto>[1]>(`SELECT * FROM orders WHERE status = 'open' AND company_id IN ${mineIds} ORDER BY id DESC LIMIT 50`, PLAYER_ID).map((o) => orderDto(db, o));
  const trades: Trade[] = db.all<{ id: number; tick: number; order_id: number; commodity_id: string; qty: number; price_minor: number; fee_minor: number }>(`SELECT id, tick, CASE WHEN buyer_company_id IN ${mineIds} THEN buy_order_id ELSE sell_order_id END order_id, commodity_id, qty, price_minor, fee_minor FROM trades WHERE buyer_company_id IN ${mineIds} OR seller_company_id IN ${mineIds} ORDER BY id DESC LIMIT 50`, PLAYER_ID, PLAYER_ID, PLAYER_ID)
    .map((r) => ({ id: `trd-${r.id}`, orderId: String(r.order_id), commodityId: r.commodity_id, quantity: r.qty, pricePerUnit: ec(r.price_minor), fee: ec(r.fee_minor), settledAt: gameDate(cfg, r.tick) }));
  const first = db.get<{ id: string }>("SELECT id FROM companies WHERE owner_kind='player' AND owner_id = ? ORDER BY id LIMIT 1", PLAYER_ID);
  return { player: playerDto(db), cityId: 'city-bristol', commodities, orders: { items: sell, nextCursor: null }, ownOrders: { items: own, nextCursor: null }, history: { items: trades, nextCursor: null }, selectedCompany: first ? companyDto(db, first.id) : null, quote: null };
}

export function portfolioScreen(db: Sql): PortfolioState { return { player: playerDto(db), holdings: [] as Holding[], listings: [] as Listing[] }; }

export interface FinancialRow { tick: number; gameDate: string; revenue: number; cogs: number; labour: number; property: number; marketing: number; fees: number; tax: number; energyPaid: number; inputPurchases: number; grossProfit: number; netProfit: number; cash: number; inventoryValue: number; unitsProduced: number; unitsSold: number; unpaid: number; status: string }
export function financials(db: Sql, companyId: string, limit = 30): FinancialRow[] {
  const cfg = loadConfig(db);
  return db.all<Record<string, number | string>>('SELECT * FROM company_tick_stats WHERE company_id = ? AND tick > 0 ORDER BY tick DESC LIMIT ?', companyId, Math.min(100, limit)).reverse().map((r) => ({
    tick: r.tick as number, gameDate: gameDate(cfg, r.tick as number), revenue: r.revenue_minor as number, cogs: r.cogs_minor as number, labour: r.labour_minor as number, property: r.property_minor as number, marketing: r.marketing_minor as number, fees: r.fees_minor as number, tax: r.tax_minor as number,
    energyPaid: r.energy_paid_minor as number, inputPurchases: r.input_purchases_minor as number, grossProfit: r.gross_profit_minor as number, netProfit: r.net_profit_minor as number, cash: r.cash_end_minor as number, inventoryValue: r.inventory_value_minor as number, unitsProduced: r.units_produced as number, unitsSold: r.units_sold as number, unpaid: r.unpaid_end_minor as number, status: r.status as string,
  }));
}
