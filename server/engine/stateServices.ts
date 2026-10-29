import type { Sql } from '../db/sql';
import { available, destroy, transfer, type TickCtx } from './ledger';
import { logEvent } from './stats';
import type { EngineConfig } from './config';

export type ServiceKind = 'energy' | 'advertising' | 'logistics' | 'property' | 'banking' | 'exchange' | 'works';

/** The six state enterprises and what each one sells. One table, one settlement path: nobody has a private payment system. */
export const STATE_PROVIDERS: Record<ServiceKind, { id: string; name: string; label: string }> = {
  energy: { id: 'co-bristol-energy', name: 'Penny Energy', label: 'Electricity' },
  advertising: { id: 'co-bristol-media', name: 'Penny Ads', label: 'Advertising' },
  logistics: { id: 'co-penny-logistics', name: 'Penny Logistics', label: 'Delivery' },
  property: { id: 'co-bristol-estates', name: 'Central Property', label: 'Premises' },
  banking: { id: 'co-national-bank', name: 'National Bank', label: 'Banking' },
  exchange: { id: 'co-penny-exchange', name: 'Penny Exchange', label: 'Exchange' },
  works: { id: 'co-bristol-works', name: 'Bristol Works', label: 'Equipment & fit-out' },
};
export const providerOf = (db: Sql, s: ServiceKind): { id: string; treasury: string } | null => {
  const r = db.get<{ id: string; treasury_account_id: string }>('SELECT id, treasury_account_id FROM companies WHERE id = ?', STATE_PROVIDERS[s].id);
  return r ? { id: r.id, treasury: r.treasury_account_id } : null;
};

/**
 * The shared purchasing and settlement path for state services. One ledger transfer payer → provider (an `operating_cost` TRANSFER, never a sink) plus one immutable
 * `service_charges` row; the idempotency key makes a repeated charge a no-op. `maxAmount` lets callers charge only what the payer can afford and report the rest.
 */
export function chargeService(db: Sql, ctx: TickCtx, a: { service: ServiceKind; payerAccount: string; payerCompanyId: string | null; amount: number; quantity?: number; unitPrice?: number; ref: string; key: string; memo?: string }): { charged: number; txId: number | null; duplicate: boolean } {
  const dup = db.get<{ amount_minor: number; ledger_tx_id: number | null }>('SELECT amount_minor, ledger_tx_id FROM service_charges WHERE idempotency_key = ?', a.key);
  if (dup) return { charged: dup.amount_minor, txId: dup.ledger_tx_id, duplicate: true };
  const p = providerOf(db, a.service); if (!p) return { charged: 0, txId: null, duplicate: false };
  const amount = Math.min(a.amount, Math.max(0, available(db, a.payerAccount)));
  if (amount <= 0) return { charged: 0, txId: null, duplicate: false };
  const tx = transfer(db, ctx, `svc:${a.key}`, a.payerAccount, p.treasury, amount, 'operating_cost', a.memo ?? `${STATE_PROVIDERS[a.service].label.toLowerCase()} from ${STATE_PROVIDERS[a.service].name}`);
  db.run('INSERT INTO service_charges (tick, service, provider_id, payer_id, quantity, unit_price_minor, amount_minor, ref, ledger_tx_id, idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?)', ctx.tick, a.service, p.id, a.payerCompanyId, a.quantity ?? 1, a.unitPrice ?? amount, amount, a.ref, tx.txId, a.key);
  return { charged: amount, txId: tx.txId, duplicate: false };
}

/** Records a charge whose coins were already moved by the tick's operating-expense settlement (same table, same reporting). */
export function recordPaidService(db: Sql, tick: number, service: ServiceKind, payerCompanyId: string, amount: number, quantity: number, ref: string) {
  if (amount <= 0) return;
  db.run('INSERT INTO service_charges (tick, service, provider_id, payer_id, quantity, unit_price_minor, amount_minor, ref) VALUES (?,?,?,?,?,?,?,?)', tick, service, STATE_PROVIDERS[service].id, payerCompanyId, quantity, quantity > 0 ? Math.round(amount / quantity) : amount, amount, ref);
}

/** Part of a state provider's daily service revenue wears out its infrastructure: an explicit, recorded currency sink (everything else it earns stays in circulation). */
export function burnServiceWear(db: Sql, ctx: TickCtx, cfg: EngineConfig, service: ServiceKind) {
  if (cfg.stateServiceBurnBps <= 0) return 0;
  const p = providerOf(db, service); if (!p) return 0;
  const rev = db.get<{ r: number }>('SELECT COALESCE(SUM(amount_minor),0) r FROM service_charges WHERE provider_id = ? AND tick = ?', STATE_PROVIDERS[service].id, ctx.tick)!.r;
  const burn = Math.min(Math.floor((rev * cfg.stateServiceBurnBps) / 10_000), Math.max(0, available(db, p.treasury)));
  if (burn > 0) destroy(db, ctx, `t${ctx.tick}:wear:${service}`, p.treasury, burn, `${STATE_PROVIDERS[service].name} infrastructure wear (explicit burn)`);
  return burn;
}

export interface ProviderReport { service: ServiceKind; id: string; name: string; label: string; treasuryMinor: number; revenue7Minor: number; revenue30Minor: number; customers7: number; avgDaily7Minor: number; expenses7Minor: number; profit7Minor: number; burned30Minor: number }
/** Financial report of one state provider, read from its real books (service charges, wages, treasury). */
export function providerReport(db: Sql, service: ServiceKind, tick: number): ProviderReport | null {
  const c = db.get<{ id: string; treasury_account_id: string }>('SELECT id, treasury_account_id FROM companies WHERE id = ?', STATE_PROVIDERS[service].id); if (!c) return null;
  const sum = (from: number) => db.get<{ r: number; n: number }>('SELECT COALESCE(SUM(amount_minor),0) r, COUNT(DISTINCT payer_id) n FROM service_charges WHERE provider_id = ? AND tick > ?', c.id, from)!;
  const w7 = sum(tick - 7), w30 = sum(tick - 30);
  const stat = db.get<{ e: number; p: number }>('SELECT COALESCE(SUM(revenue_minor - net_profit_minor),0) e, COALESCE(SUM(net_profit_minor),0) p FROM company_tick_stats WHERE company_id = ? AND tick > ?', c.id, tick - 7)!;
  const burned = db.get<{ b: number }>("SELECT COALESCE(SUM(p.amount_minor),0) b FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.kind = 'sink' AND t.tick > ? AND t.memo LIKE ? AND p.amount_minor > 0 AND p.account_id = 'acct:burn'", tick - 30, `${STATE_PROVIDERS[service].name} infrastructure wear%`)!.b;
  return { service, id: c.id, name: STATE_PROVIDERS[service].name, label: STATE_PROVIDERS[service].label, treasuryMinor: db.get<{ b: number }>('SELECT balance_minor b FROM accounts WHERE id = ?', c.treasury_account_id)!.b, revenue7Minor: w7.r, revenue30Minor: w30.r, customers7: w7.n, avgDaily7Minor: Math.round(w7.r / 7), expenses7Minor: stat.e, profit7Minor: stat.p, burned30Minor: burned };
}
export { logEvent };
