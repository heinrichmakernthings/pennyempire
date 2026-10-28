import type { Sql } from '../db/sql';
import { gameDate, loadConfig, type EngineConfig } from './config';
import { available, destroy, transfer, type TickCtx } from './ledger';
import { EXCHANGE_ACCOUNT } from '../seed/bristol';

const CITY = 'city-bristol';

/** Penny Exchange income: a share is destroyed in one explicit, auditable burn; the rest is swept to the state treasury as a transfer. */
export function sweepExchange(db: Sql, ctx: TickCtx, cfg: EngineConfig, treasury: string): { burned: number; swept: number } {
  const bal = available(db, EXCHANGE_ACCOUNT);
  if (bal <= 0) return { burned: 0, swept: 0 };
  const burned = Math.floor((bal * cfg.exchangeBurnBps) / 10_000), swept = bal - burned;
  if (burned > 0) destroy(db, ctx, `t${ctx.tick}:exchange:burn`, EXCHANGE_ACCOUNT, burned, 'Penny Exchange fee burn (explicit)', 'sink_fee');
  if (swept > 0) transfer(db, ctx, `t${ctx.tick}:exchange:sweep`, EXCHANGE_ACCOUNT, treasury, swept, 'state_payment', 'Penny Exchange fee income to state treasury');
  return { burned, swept };
}

/** Units per day the city wants of a commodity: consumers (funded budgets) + what production lines plan to consume. Estimates, labelled as such in the UI. */
export function demandFor(db: Sql, commodity: string, tick: number): { consumer: number; business: number; total: number } {
  const consumer = db.get<{ w: number }>('SELECT COALESCE(SUM(s.units_wanted),0) w FROM demand_tick_stats s JOIN demand_rules r ON r.id = s.rule_id WHERE r.commodity_id = ? AND s.tick = ?', commodity, tick)!.w;
  const business = db.get<{ n: number }>("SELECT COALESCE(SUM(l.planned_batches * i.units),0) n FROM production_lines l JOIN recipe_inputs i ON i.recipe_id = l.recipe_id JOIN companies c ON c.id = l.company_id WHERE i.commodity_id = ? AND c.bankrupt_tick IS NULL AND c.status <> 'insolvent'", commodity)!.n;
  return { consumer, business, total: consumer + business };
}

/** Closes the day's market statistics for every commodity. Everything is read from executed trades, contract deliveries and the book as it stands. */
export function recordMarketStats(db: Sql, tick: number): void {
  for (const c of db.all<{ id: string }>('SELECT id FROM commodities ORDER BY id')) {
    const t = db.get<{ n: number; q: number; v: number; f: number }>('SELECT COUNT(*) n, COALESCE(SUM(qty),0) q, COALESCE(SUM(qty * price_minor),0) v, COALESCE(SUM(fee_minor),0) f FROM trades WHERE tick = ? AND commodity_id = ? AND city_id = ?', tick, c.id, CITY)!;
    const px = (order: string) => db.get<{ p: number }>(`SELECT price_minor p FROM trades WHERE tick = ? AND commodity_id = ? ORDER BY id ${order} LIMIT 1`, tick, c.id)?.p ?? null;
    const hl = db.get<{ hi: number | null; lo: number | null }>('SELECT MAX(price_minor) hi, MIN(price_minor) lo FROM trades WHERE tick = ? AND commodity_id = ?', tick, c.id)!;
    const book = (side: 'buy' | 'sell') => db.get<{ p: number | null; q: number }>(`SELECT ${side === 'sell' ? 'MIN' : 'MAX'}(price_minor) p, COALESCE(SUM(qty_remaining),0) q FROM orders WHERE commodity_id = ? AND side = ? AND status = 'open' AND qty_remaining > 0 AND (expires_tick IS NULL OR expires_tick > ?)`, c.id, side, tick)!;
    const ask = book('sell'), bid = book('buy');
    const cons = db.get<{ u: number }>('SELECT COALESCE(SUM(s.units_sold),0) u FROM demand_tick_stats s JOIN demand_rules r ON r.id = s.rule_id WHERE r.commodity_id = ? AND s.tick = ?', c.id, tick)!.u;
    const contractUnits = db.get<{ u: number }>("SELECT COALESCE(SUM(d.qty),0) u FROM contract_deliveries d JOIN supply_contracts k ON k.id = d.contract_id WHERE d.due_tick = ? AND d.status = 'delivered' AND k.commodity_id = ?", tick, c.id)!.u;
    db.run('INSERT OR REPLACE INTO market_stats (tick, city_id, commodity_id, trades, volume, value_minor, fees_minor, open_minor, high_minor, low_minor, close_minor, vwap_minor, best_bid_minor, best_ask_minor, listed_units, bid_units, demand_units, consumer_units, contract_units) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      tick, CITY, c.id, t.n, t.q, t.v, t.f, px('ASC'), hl.hi, hl.lo, px('DESC'), t.q > 0 ? Math.floor(t.v / t.q) : null, bid.p, ask.p, ask.q, bid.q, demandFor(db, c.id, tick).total, cons, contractUnits);
  }
}

export interface DirectoryRow {
  commodityId: string; name: string; unitLabel: string; referencePriceMinor: number;
  lastTradePriceMinor: number | null; vwap7dMinor: number | null; bestBidMinor: number | null; bestAskMinor: number | null; spreadMinor: number | null;
  volumeToday: number; volume7d: number; value7dMinor: number; listedUnits: number; bidUnits: number; demandUnitsPerDay: number; consumerUnitsToday: number; contractUnitsToday: number;
  shortageUnits: number; surplusUnits: number; status: 'shortage' | 'balanced' | 'surplus' | 'no-market'; changeBps: number; basis: 'trades' | 'reference';
}

/** Directory of every tradable commodity with statistics derived from stored market_stats. `status` compares listed supply with estimated demand (an ESTIMATE, labelled in the UI). */
export function directory(db: Sql): DirectoryRow[] {
  const tick = db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
  return db.all<{ id: string; name: string; unit_label: string; reference_price_minor: number }>("SELECT * FROM commodities WHERE id <> 'energy' ORDER BY id").map((c) => {
    const today = db.get<{ volume: number; consumer_units: number; contract_units: number; best_bid_minor: number | null; best_ask_minor: number | null; listed_units: number; bid_units: number; demand_units: number }>('SELECT * FROM market_stats WHERE tick = ? AND commodity_id = ?', tick, c.id);
    const w = db.get<{ v: number; q: number; value: number }>('SELECT COALESCE(SUM(volume),0) q, COALESCE(SUM(value_minor),0) value, 0 v FROM market_stats WHERE commodity_id = ? AND tick > ?', c.id, tick - 7)!;
    const last = db.get<{ p: number }>('SELECT price_minor p FROM trades WHERE commodity_id = ? ORDER BY id DESC LIMIT 1', c.id)?.p ?? null;
    const prev = db.get<{ p: number | null }>('SELECT vwap_minor p FROM market_stats WHERE commodity_id = ? AND tick <= ? AND vwap_minor IS NOT NULL ORDER BY tick DESC LIMIT 1 OFFSET 6', c.id, tick)?.p ?? null;
    const vwap = w.q > 0 ? Math.floor(w.value / w.q) : null;
    const listed = today?.listed_units ?? db.get<{ q: number }>("SELECT COALESCE(SUM(qty_remaining),0) q FROM orders WHERE commodity_id = ? AND side='sell' AND status='open'", c.id)!.q;
    const bestAsk = today?.best_ask_minor ?? null, bestBid = today?.best_bid_minor ?? null;
    const demand = today?.demand_units ?? demandFor(db, c.id, tick).total;
    const shortage = Math.max(0, demand - listed), surplus = Math.max(0, listed - demand);
    const status: DirectoryRow['status'] = demand === 0 && listed === 0 ? 'no-market' : shortage * 10 >= demand * 2 ? 'shortage' : surplus * 10 >= Math.max(1, demand) * 5 ? 'surplus' : 'balanced';
    const price = last ?? c.reference_price_minor;
    return { commodityId: c.id, name: c.name, unitLabel: c.unit_label, referencePriceMinor: c.reference_price_minor, lastTradePriceMinor: last, vwap7dMinor: vwap, bestBidMinor: bestBid, bestAskMinor: bestAsk, spreadMinor: bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null,
      volumeToday: today?.volume ?? 0, volume7d: w.q, value7dMinor: w.value, listedUnits: listed, bidUnits: today?.bid_units ?? 0, demandUnitsPerDay: demand, consumerUnitsToday: today?.consumer_units ?? 0, contractUnitsToday: today?.contract_units ?? 0,
      shortageUnits: shortage, surplusUnits: surplus, status, changeBps: prev && prev > 0 ? Math.max(-10_000, Math.min(10_000, Math.round(((price - prev) * 10_000) / prev))) : 0, basis: last === null ? 'reference' : 'trades' };
  });
}

export interface BookLevel { priceMinor: number; units: number; orders: number; suppliers: number }
export interface CommodityDetail {
  commodityId: string; asks: BookLevel[]; bids: BookLevel[];
  history: { tick: number; gameDate: string; open: number | null; high: number | null; low: number | null; close: number | null; vwap: number | null; volume: number; bestBid: number | null; bestAsk: number | null; listed: number; demand: number }[];
  recentTrades: { id: number; tick: number; gameDate: string; qty: number; priceMinor: number; feeMinor: number; buyer: string; seller: string }[];
  suppliers: SupplierRow[];
}
export interface SupplierRow { companyId: string; name: string; ownerKind: 'player' | 'npc' | 'state'; askMinor: number; units: number; reputationBps: number; sold7d: number; delivered7d: number; missed7d: number; contractable: boolean; industry: string }

export function commodityDetail(db: Sql, commodity: string, viewer?: string): CommodityDetail | null {
  if (!db.get('SELECT 1 FROM commodities WHERE id = ?', commodity)) return null;
  const cfg = loadConfig(db); const tick = db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
  const levels = (side: 'sell' | 'buy'): BookLevel[] => db.all<{ p: number; u: number; n: number; s: number }>(`SELECT price_minor p, SUM(qty_remaining) u, COUNT(*) n, COUNT(DISTINCT company_id) s FROM orders WHERE commodity_id = ? AND side = ? AND status = 'open' AND qty_remaining > 0 AND (expires_tick IS NULL OR expires_tick > ?) GROUP BY price_minor ORDER BY price_minor ${side === 'sell' ? 'ASC' : 'DESC'} LIMIT 12`, commodity, side, tick)
    .map((r) => ({ priceMinor: r.p, units: r.u, orders: r.n, suppliers: r.s }));
  const history = db.all<{ tick: number; open_minor: number | null; high_minor: number | null; low_minor: number | null; close_minor: number | null; vwap_minor: number | null; volume: number; best_bid_minor: number | null; best_ask_minor: number | null; listed_units: number; demand_units: number }>('SELECT * FROM market_stats WHERE commodity_id = ? AND tick > 0 ORDER BY tick DESC LIMIT 30', commodity).reverse()
    .map((r) => ({ tick: r.tick, gameDate: gameDate(cfg, r.tick), open: r.open_minor, high: r.high_minor, low: r.low_minor, close: r.close_minor, vwap: r.vwap_minor, volume: r.volume, bestBid: r.best_bid_minor, bestAsk: r.best_ask_minor, listed: r.listed_units, demand: r.demand_units }));
  const recentTrades = db.all<{ id: number; tick: number; qty: number; price_minor: number; fee_minor: number; b: string; s: string }>('SELECT t.id, t.tick, t.qty, t.price_minor, t.fee_minor, b.name b, s.name s FROM trades t JOIN companies b ON b.id = t.buyer_company_id JOIN companies s ON s.id = t.seller_company_id WHERE t.commodity_id = ? ORDER BY t.id DESC LIMIT 20', commodity)
    .map((r) => ({ id: r.id, tick: r.tick, gameDate: gameDate(cfg, r.tick), qty: r.qty, priceMinor: r.price_minor, feeMinor: r.fee_minor, buyer: r.b, seller: r.s }));
  // suppliers: every company with live sell orders, best price per company, with real track record from trades and contract deliveries
  const sup = db.all<{ id: string; name: string; owner_kind: 'player' | 'npc' | 'state'; ask: number; units: number; rep: number; industry: string }>(`SELECT c.id, c.name, c.owner_kind, MIN(o.price_minor) ask, SUM(o.qty_remaining) units, c.reputation_bps rep, c.industry_id industry FROM orders o JOIN companies c ON c.id = o.company_id
    WHERE o.commodity_id = ? AND o.side = 'sell' AND o.status = 'open' AND o.qty_remaining > 0 AND (o.expires_tick IS NULL OR o.expires_tick > ?) AND c.bankrupt_tick IS NULL GROUP BY c.id ORDER BY ask ASC, c.id`, commodity, tick);
  const suppliers: SupplierRow[] = sup.map((s) => ({
    companyId: s.id, name: s.name, ownerKind: s.owner_kind, askMinor: s.ask, units: s.units, reputationBps: s.rep, industry: s.industry,
    sold7d: db.get<{ q: number }>('SELECT COALESCE(SUM(qty),0) q FROM trades WHERE seller_company_id = ? AND commodity_id = ? AND tick > ?', s.id, commodity, tick - 7)!.q,
    delivered7d: db.get<{ n: number }>("SELECT COUNT(*) n FROM contract_deliveries d JOIN supply_contracts k ON k.id = d.contract_id WHERE k.supplier_company_id = ? AND k.commodity_id = ? AND d.status = 'delivered' AND d.due_tick > ?", s.id, commodity, tick - 7)!.n,
    missed7d: db.get<{ n: number }>("SELECT COUNT(*) n FROM contract_deliveries d JOIN supply_contracts k ON k.id = d.contract_id WHERE k.supplier_company_id = ? AND k.commodity_id = ? AND d.status = 'missed_stock' AND d.due_tick > ?", s.id, commodity, tick - 7)!.n,
    contractable: s.id !== viewer,
  }));
  return { commodityId: commodity, asks: levels('sell'), bids: levels('buy'), history, recentTrades, suppliers };
}
