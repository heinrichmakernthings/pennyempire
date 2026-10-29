import type { Sql } from '../db/sql';
import type { TickCtx } from './ledger';

export type InvReason = 'production_output' | 'production_input' | 'consumer_purchase' | 'public_works' | 'state_supply' | 'trade_in' | 'trade_out' | 'seed';
export class InventoryError extends Error {
  constructor(public readonly code: 'INSUFFICIENT_STOCK' | 'INVALID_QTY' | 'OVER_RESERVED', message: string) { super(message); this.name = 'InventoryError'; }
}
export interface StockRow { qty: number; reserved: number; value_minor: number }

export function stock(db: Sql, company: string, commodity: string): StockRow {
  return db.get<StockRow>('SELECT qty, reserved, value_minor FROM inventory WHERE company_id = ? AND commodity_id = ?', company, commodity) ?? { qty: 0, reserved: 0, value_minor: 0 };
}
export const freeStock = (db: Sql, company: string, commodity: string) => { const s = stock(db, company, commodity); return s.qty - s.reserved; };

const posInt = (n: number) => Number.isSafeInteger(n) && n > 0;

/** Adds units (and their cost basis) and writes the immutable movement. Goods are only ever created via an explicit reason. */
export function addStock(db: Sql, ctx: TickCtx, company: string, commodity: string, qty: number, costMinor: number, reason: InvReason, ref: string | null = null) {
  if (!posInt(qty) || !Number.isSafeInteger(costMinor) || costMinor < 0) throw new InventoryError('INVALID_QTY', `Invalid stock addition ${qty}/${costMinor}`);
  db.run('INSERT INTO inventory (company_id, commodity_id, qty, reserved, value_minor) VALUES (?,?,?,0,?) ON CONFLICT(company_id, commodity_id) DO UPDATE SET qty = qty + excluded.qty, value_minor = value_minor + excluded.value_minor', company, commodity, qty, costMinor);
  db.run('INSERT INTO inventory_movements (tick, company_id, commodity_id, delta, reason, ref) VALUES (?,?,?,?,?,?)', ctx.tick, company, commodity, qty, reason, ref);
}

/** Removes free (unreserved) units and returns the cost basis removed (proportional, integer; the last unit takes the remainder). */
export function removeStock(db: Sql, ctx: TickCtx, company: string, commodity: string, qty: number, reason: InvReason, ref: string | null = null, opts: { fromReserved?: boolean } = {}): number {
  if (!posInt(qty)) throw new InventoryError('INVALID_QTY', `Invalid stock removal ${qty}`);
  const s = stock(db, company, commodity);
  const free = opts.fromReserved ? s.qty : s.qty - s.reserved;
  if (qty > free || (opts.fromReserved && qty > s.reserved)) throw new InventoryError('INSUFFICIENT_STOCK', `${company} has ${free} ${commodity} available, needs ${qty}`);
  const cost = qty === s.qty ? s.value_minor : Math.floor((s.value_minor * qty) / s.qty);
  db.run(`UPDATE inventory SET qty = qty - ?, value_minor = value_minor - ?, reserved = reserved - ? WHERE company_id = ? AND commodity_id = ?`, qty, cost, opts.fromReserved ? qty : 0, company, commodity);
  db.run('INSERT INTO inventory_movements (tick, company_id, commodity_id, delta, reason, ref) VALUES (?,?,?,?,?,?)', ctx.tick, company, commodity, -qty, reason, ref);
  return cost;
}

export function reserveStock(db: Sql, company: string, commodity: string, qty: number) {
  if (!posInt(qty)) throw new InventoryError('INVALID_QTY', 'Invalid reservation');
  if (freeStock(db, company, commodity) < qty) throw new InventoryError('INSUFFICIENT_STOCK', `${company} cannot reserve ${qty} ${commodity}`);
  db.run('UPDATE inventory SET reserved = reserved + ? WHERE company_id = ? AND commodity_id = ?', qty, company, commodity);
}
export function releaseStock(db: Sql, company: string, commodity: string, qty: number) {
  if (qty === 0) return;
  const s = stock(db, company, commodity);
  if (!posInt(qty) || s.reserved < qty) throw new InventoryError('OVER_RESERVED', `${company} has only ${s.reserved} ${commodity} reserved`);
  db.run('UPDATE inventory SET reserved = reserved - ? WHERE company_id = ? AND commodity_id = ?', qty, company, commodity);
}
