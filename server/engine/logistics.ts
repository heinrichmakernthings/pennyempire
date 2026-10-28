import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { currentMods } from './economyState';
import { addStock, freeStock, removeStock } from './inventory';
import type { TickCtx } from './ledger';
import { chargeService, providerOf } from './stateServices';

/**
 * Penny Logistics. Every trade and every contract delivery becomes a SHIPMENT (the reusable model: ref + commodity is unique, so nothing is ever shipped or billed twice).
 * Settlement itself is never touched: goods and coins already changed hands when the trade filled. Logistics runs afterwards, once per tick:
 *   • the SELLER pays a delivery fee (base + per unit, scaled by distance, capped at a share of the sale) to Penny Logistics, through the shared state-service interface;
 *   • normally the goods are simply delivered; when the day's capacity is exceeded or an event adds delay, the buyer's goods are held IN TRANSIT and arrive on the due day;
 *   • goods in transit are real: they are removed from the buyer's stock and returned on arrival, so they can neither be used nor sold meanwhile, and are never duplicated.
 * Fees only apply to trades made after the service started (cursors): no retroactive charges.
 */
interface Sale { ref: string; commodity: string; seller: string; buyer: string; qty: number; gross: number; basis: number }

const tileOf = (db: Sql, companyId: string) => db.get<{ col: number; row: number }>('SELECT p.col col, p.row row FROM companies c JOIN plots p ON p.id = COALESCE(c.lot_id, c.plot_id) WHERE c.id = ?', companyId) ?? db.get<{ col: number; row: number }>('SELECT p.col col, p.row row FROM companies c JOIN plots p ON p.id = c.plot_id WHERE c.id = ?', companyId);
export const distanceBetween = (db: Sql, a: string, b: string) => { const x = tileOf(db, a), y = tileOf(db, b); return x && y ? Math.abs(x.col - y.col) + Math.abs(x.row - y.row) : 0; };

export function deliveryFee(cfg: EngineConfig, qty: number, gross: number, distance: number, feeBps: number): number {
  const raw = Math.ceil(((cfg.logisticsBaseFeeMinor + qty * cfg.logisticsRatePerUnitMinor) * (10_000 + distance * cfg.logisticsPerTileBps)) / 10_000);
  const scaled = Math.ceil((raw * feeBps) / 10_000);
  return Math.max(0, Math.min(scaled, Math.floor((gross * cfg.logisticsMaxFeeBps) / 10_000)));
}

const meta = (db: Sql, k: string) => Number(db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', k)?.value ?? 0);
const setMeta = (db: Sql, k: string, v: number) => db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(v));
/** Marks everything that exists today as already shipped: used when the service is introduced to an existing world. */
export function startLogisticsCursors(db: Sql) {
  setMeta(db, 'logistics_trade_cursor', db.get<{ m: number }>('SELECT COALESCE(MAX(id),0) m FROM trades')!.m);
  setMeta(db, 'logistics_start_tick', db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t);
}

export interface LogisticsHooks { onFee?: (sellerId: string, amount: number) => void }
export function runLogistics(db: Sql, ctx: TickCtx, cfg: EngineConfig, hooks: LogisticsHooks = {}): { shipments: number; delayed: number; delivered: number; feeMinor: number } {
  const provider = providerOf(db, 'logistics'); if (!provider) return { shipments: 0, delayed: 0, delivered: 0, feeMinor: 0 };
  const mods = currentMods(db);
  const capacity = Math.floor((cfg.logisticsCapacityUnits * mods.logisticsCapacityBps) / 10_000);
  let used = 0, delayed = 0, delivered = 0, feeTotal = 0, created = 0;

  // 1. Goods in transit whose day has come arrive first (they used yesterday's capacity); none is ever delivered twice (status flips in the same statement).
  for (const s of db.all<{ id: number; to_company_id: string; commodity_id: string; qty: number; cost_basis_minor: number }>("SELECT * FROM shipments WHERE status = 'delayed' AND due_tick <= ? ORDER BY due_tick, id", ctx.tick)) {
    const r = db.run("UPDATE shipments SET status = 'delivered', delivered_tick = ? WHERE id = ? AND status = 'delayed'", ctx.tick, s.id);
    if (r.changes !== 1) continue;
    addStock(db, ctx, s.to_company_id, s.commodity_id, s.qty, s.cost_basis_minor, 'trade_in', `shipment:${s.id}`); delivered++;
  }

  // 2. New sales since the cursors.
  const sales: Sale[] = [];
  const tc = meta(db, 'logistics_trade_cursor'), startTick = meta(db, 'logistics_start_tick');
  for (const t of db.all<{ id: number; commodity_id: string; seller_company_id: string; buyer_company_id: string; qty: number; price_minor: number }>('SELECT id, commodity_id, seller_company_id, buyer_company_id, qty, price_minor FROM trades WHERE id > ? ORDER BY id', tc))
    sales.push({ ref: `trade:${t.id}`, commodity: t.commodity_id, seller: t.seller_company_id, buyer: t.buyer_company_id, qty: t.qty, gross: t.qty * t.price_minor, basis: t.qty * t.price_minor });
  for (const d of db.all<{ id: number; commodity_id: string; supplier: string; buyer: string; qty: number; gross_minor: number }>("SELECT d.id, k.commodity_id, k.supplier_company_id supplier, k.buyer_company_id buyer, d.qty, d.gross_minor FROM contract_deliveries d JOIN supply_contracts k ON k.id = d.contract_id WHERE d.settled_tick > ? AND d.status = 'delivered' AND NOT EXISTS (SELECT 1 FROM shipments x WHERE x.ref = 'delivery:' || d.id) ORDER BY d.id", startTick))
    sales.push({ ref: `delivery:${d.id}`, commodity: d.commodity_id, seller: d.supplier, buyer: d.buyer, qty: d.qty, gross: d.gross_minor, basis: d.gross_minor });
  setMeta(db, 'logistics_trade_cursor', db.get<{ m: number }>('SELECT COALESCE(MAX(id),0) m FROM trades')!.m);

  for (const s of sales) {
    if (s.seller === s.buyer || db.get('SELECT 1 FROM shipments WHERE ref = ? AND commodity_id = ?', s.ref, s.commodity)) continue;
    const dist = distanceBetween(db, s.seller, s.buyer);
    const fee = deliveryFee(cfg, s.qty, s.gross, dist, mods.logisticsFeeBps);
    const sellerAcct = db.get<{ a: string }>('SELECT treasury_account_id a FROM companies WHERE id = ?', s.seller)!.a;
    const paid = fee > 0 ? chargeService(db, ctx, { service: 'logistics', payerAccount: sellerAcct, payerCompanyId: s.seller, amount: fee, quantity: s.qty, unitPrice: Math.round(fee / Math.max(1, s.qty)), ref: s.ref, key: `ship:${s.ref}:${s.commodity}`, memo: `delivery fee ${s.qty} ${s.commodity}` }).charged : 0;
    if (paid > 0) { hooks.onFee?.(s.seller, paid); feeTotal += paid; }
    used += s.qty;
    // Held in transit only when there is a reason (over capacity / event delay) and the buyer still holds those goods unreserved; otherwise delivered on the spot.
    const reason = used > capacity ? 'capacity' : mods.logisticsDelayTicks > 0 ? 'disruption' : null;
    const canHold = reason !== null && freeStock(db, s.buyer, s.commodity) >= s.qty;
    const due = ctx.tick + (reason === 'capacity' ? 1 : Math.max(1, mods.logisticsDelayTicks));
    const info = db.run("INSERT INTO shipments (ref, from_company_id, to_company_id, commodity_id, qty, cost_basis_minor, distance_tiles, origin_city_id, dest_city_id, fee_minor, status, depart_tick, due_tick, delivered_tick, delay_reason, fee_tx_id) VALUES (?,?,?,?,?,?,?, 'city-bristol','city-bristol',?,?,?,?,?,?,NULL)",
      s.ref, s.seller, s.buyer, s.commodity, s.qty, s.basis, dist, paid, canHold ? 'delayed' : 'delivered', ctx.tick, canHold ? due : ctx.tick, canHold ? null : ctx.tick, canHold ? reason : null);
    created++;
    if (canHold) { removeStock(db, ctx, s.buyer, s.commodity, s.qty, 'trade_out', `shipment:${info.lastInsertRowid}`); delayed++; } else delivered++;
  }
  return { shipments: created, delayed, delivered, feeMinor: feeTotal };
}

export interface LogisticsReport { capacityUnits: number; baseCapacityUnits: number; shippedUnits7: number; shipments7: number; delayedNow: number; delayedUnitsNow: number; deliveredOnTimePct: number; feeRevenue7Minor: number; avgFeeMinor: number; recent: { id: number; ref: string; commodity: string; qty: number; from: string; to: string; feeMinor: number; status: string; departTick: number; dueTick: number; reason: string | null }[] }
export function logisticsReport(db: Sql, cfg: EngineConfig, tick: number): LogisticsReport {
  const mods = currentMods(db);
  const w = db.get<{ u: number; n: number; f: number }>('SELECT COALESCE(SUM(qty),0) u, COUNT(*) n, COALESCE(SUM(fee_minor),0) f FROM shipments WHERE depart_tick > ?', tick - 7)!;
  const late = db.get<{ n: number }>("SELECT COUNT(*) n FROM shipments WHERE depart_tick > ? AND (status = 'delayed' OR delay_reason IS NOT NULL)", tick - 7)!.n;
  const now = db.get<{ n: number; u: number }>("SELECT COUNT(*) n, COALESCE(SUM(qty),0) u FROM shipments WHERE status = 'delayed'")!;
  return {
    capacityUnits: Math.floor((cfg.logisticsCapacityUnits * mods.logisticsCapacityBps) / 10_000), baseCapacityUnits: cfg.logisticsCapacityUnits, shippedUnits7: w.u, shipments7: w.n, delayedNow: now.n, delayedUnitsNow: now.u,
    deliveredOnTimePct: w.n === 0 ? 100 : Math.round(((w.n - late) * 100) / w.n), feeRevenue7Minor: w.f, avgFeeMinor: w.n === 0 ? 0 : Math.round(w.f / w.n),
    recent: db.all<{ id: number; ref: string; commodity_id: string; qty: number; f: string; t: string; fee_minor: number; status: string; depart_tick: number; due_tick: number; delay_reason: string | null }>('SELECT s.id, s.ref, s.commodity_id, s.qty, a.name f, b.name t, s.fee_minor, s.status, s.depart_tick, s.due_tick, s.delay_reason FROM shipments s JOIN companies a ON a.id = s.from_company_id JOIN companies b ON b.id = s.to_company_id ORDER BY s.id DESC LIMIT 15')
      .map((r) => ({ id: r.id, ref: r.ref, commodity: r.commodity_id, qty: r.qty, from: r.f, to: r.t, feeMinor: r.fee_minor, status: r.status, departTick: r.depart_tick, dueTick: r.due_tick, reason: r.delay_reason })),
  };
}
