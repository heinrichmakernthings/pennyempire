import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { currentMods } from './economyState';
import { LedgerError, transfer, available, type TickCtx } from './ledger';
import { logEvent } from './stats';
import { STATE_PROVIDERS, chargeService, providerOf } from './stateServices';
import type { CompanyRow } from './operations';

export interface LeaseRow { id: number; company_id: string; plot_id: string | null; tier: number; kind: 'lease' | 'owned'; base_rent_minor: number; service_charge_bps: number; index_linked: number; start_tick: number; end_tick: number | null; status: 'active' | 'ended'; purchase_price_minor: number | null; note: string | null }
export const activeLease = (db: Sql, companyId: string) => db.get<LeaseRow>("SELECT * FROM leases WHERE company_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1", companyId);

/**
 * Keeps the lease record in step with the company's premises. A new or upgraded premises opens a NEW lease at today's terms (including the standard service charge);
 * the previous lease ends. Companies that existed before leases did were migrated with their rent unchanged and NO service charge (explicit grandfathering).
 */
export function syncLease(db: Sql, ctx: TickCtx, cfg: EngineConfig, companyId: string, note = 'premises changed') {
  const c = db.get<{ owner_kind: string; property_minor: number; premises_tier: number; plot_id: string | null; lot_id: string | null }>('SELECT owner_kind, property_minor, premises_tier, plot_id, lot_id FROM companies WHERE id = ?', companyId);
  if (!c || c.owner_kind === 'state') return;
  const cur = activeLease(db, companyId);
  if (c.property_minor === 0) { if (cur) db.run("UPDATE leases SET status = 'ended', end_tick = ?, note = COALESCE(note,'') || ' [company closed]' WHERE id = ?", ctx.tick, cur.id); return; }
  if (cur && cur.kind === 'owned') { if (cur.base_rent_minor !== c.property_minor) db.run('UPDATE leases SET base_rent_minor = ? WHERE id = ?', c.property_minor, cur.id); return; }
  if (cur && cur.base_rent_minor === c.property_minor && cur.tier === c.premises_tier) return;
  if (cur) db.run("UPDATE leases SET status = 'ended', end_tick = ? WHERE id = ?", ctx.tick, cur.id);
  db.run("INSERT INTO leases (company_id, plot_id, tier, kind, base_rent_minor, service_charge_bps, index_linked, start_tick, status, note) VALUES (?,?,?,'lease',?,?,1,?,'active',?)", companyId, c.lot_id ?? c.plot_id, c.premises_tier, c.property_minor, cfg.propertyServiceChargeBps, ctx.tick, note);
}

export interface RentCharge { rentMinor: number; serviceMinor: number; totalMinor: number; kind: 'lease' | 'owned' | 'none' }
/** What a company owes Central Property today: index-linked rent plus its lease's service charge; an owner-occupier pays only rates. */
export function rentCharge(db: Sql, cfg: EngineConfig, c: Pick<CompanyRow, 'id' | 'owner_kind' | 'property_minor'>): RentCharge {
  if (c.owner_kind === 'state') return { rentMinor: c.property_minor, serviceMinor: 0, totalMinor: c.property_minor, kind: 'none' };
  const lease = activeLease(db, c.id); const mods = currentMods(db);
  if (!lease) return { rentMinor: c.property_minor, serviceMinor: 0, totalMinor: c.property_minor, kind: 'none' };
  if (lease.kind === 'owned') { const rates = Math.floor((lease.base_rent_minor * cfg.propertyOwnedRatesBps) / 10_000); return { rentMinor: rates, serviceMinor: 0, totalMinor: rates, kind: 'owned' }; }
  const rent = lease.index_linked ? Math.floor((lease.base_rent_minor * mods.rentBps) / 10_000) : lease.base_rent_minor;
  const service = Math.floor((rent * lease.service_charge_bps) / 10_000);
  return { rentMinor: rent, serviceMinor: service, totalMinor: rent + service, kind: 'lease' };
}

export const purchasePrice = (cfg: EngineConfig, lease: Pick<LeaseRow, 'base_rent_minor'>) => lease.base_rent_minor * cfg.propertyBuyMultiple;

/** Buys the premises outright: one transfer to Central Property (not a sink); afterwards the company pays rates only. Refused if the lease is already owned or funds are short. */
export function buyPremises(db: Sql, ctx: TickCtx, cfg: EngineConfig, companyId: string, key: string): { priceMinor: number } {
  const c = db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', companyId)!;
  const lease = activeLease(db, companyId);
  if (!lease) throw new LedgerError('FORBIDDEN', 'This company has no premises record.');
  if (lease.kind === 'owned') throw new LedgerError('FORBIDDEN', 'The company already owns its premises.');
  const price = purchasePrice(cfg, lease);
  if (price <= 0) throw new LedgerError('INVALID_AMOUNT', 'These premises are not for sale.');
  const p = providerOf(db, 'property'); if (!p) throw new LedgerError('FORBIDDEN', 'Central Property is not operating.');
  if (available(db, c.treasury_account_id) < price) throw new LedgerError('INSUFFICIENT_FUNDS', `Buying the premises costs ${price / 100} EC; the company has ${available(db, c.treasury_account_id) / 100} EC.`);
  const r = chargeService(db, ctx, { service: 'property', payerAccount: c.treasury_account_id, payerCompanyId: companyId, amount: price, ref: `purchase:${lease.id}`, key, memo: `premises purchase: ${c.name}` });
  if (r.charged !== price) throw new LedgerError('INSUFFICIENT_FUNDS', 'The company could not pay the purchase price.');
  db.run("UPDATE leases SET status = 'ended', end_tick = ? WHERE id = ?", ctx.tick, lease.id);
  db.run("INSERT INTO leases (company_id, plot_id, tier, kind, base_rent_minor, service_charge_bps, index_linked, start_tick, status, purchase_price_minor, note) VALUES (?,?,?,'owned',?,0,0,?,'active',?,?)", companyId, lease.plot_id, lease.tier, lease.base_rent_minor, ctx.tick, price, 'bought outright from Central Property');
  logEvent(db, ctx.tick, 'premises_bought', 'info', companyId, `${c.name} bought its premises from Central Property for ${(price / 100).toFixed(2)} EC`, { priceMinor: price });
  return { priceMinor: price };
}

/** Records tick-level property revenue for reporting (rent actually paid is already in service_charges via the expense settlement). */
export const PROPERTY_PROVIDER = STATE_PROVIDERS.property.id;
export { transfer };
