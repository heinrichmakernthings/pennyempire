import { actingPlayer } from './actor';
import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { loadConfig } from './config';
import { type CommandErr, type CommandResponse, runCommand } from './commands';
import { addStock, freeStock, removeStock, stock } from './inventory';
import { available, transfer, type TickCtx } from './ledger';
import { logEvent } from './stats';
import { EXCHANGE_ACCOUNT } from '../seed/bristol';
import { feeFromBps } from '../../src/domain/money';

export interface ContractRow {
  id: number; city_id: string; buyer_company_id: string; supplier_company_id: string; commodity_id: string; qty_per_delivery: number; price_minor: number; every_ticks: number; start_tick: number; end_tick: number;
  status: 'pending' | 'active' | 'declined' | 'cancelled' | 'completed' | 'failed'; proposed_by: 'buyer' | 'supplier'; decision_reason: string | null; notice_ticks: number;
  cancel_requested_tick: number | null; cancel_effective_tick: number | null; cancelled_by: string | null; consecutive_misses: number; max_misses: number; created_tick: number; ended_tick: number | null;
}
interface Co { id: string; name: string; owner_kind: 'player' | 'npc' | 'state'; owner_id: string; status: string; bankrupt_tick: number | null; treasury_account_id: string; industry_id: string; storage_cap_units: number }

const err = (code: CommandErr['error']['code'], message: string, fieldErrors?: Record<string, string>): CommandErr => ({ ok: false, error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } });
const co = (db: Sql, id: string) => db.get<Co>('SELECT id, name, owner_kind, owner_id, status, bankrupt_tick, treasury_account_id, industry_id, storage_cap_units FROM companies WHERE id = ?', id);
const refOf = (db: Sql, c: string) => db.get<{ p: number }>('SELECT reference_price_minor p FROM commodities WHERE id = ?', c)?.p;

/** Units per day a company makes of a commodity (plan), or the state provisioner's fallback rate. */
const dailyOutput = (db: Sql, cfg: EngineConfig, c: Co, commodity: string) => {
  if (c.industry_id === 'wholesale') return cfg.stateSupplyPerTick;
  return db.get<{ u: number }>('SELECT COALESCE(SUM(l.planned_batches * r.output_units),0) u FROM production_lines l JOIN recipes r ON r.id = l.recipe_id WHERE l.company_id = ? AND r.output_commodity_id = ?', c.id, commodity)!.u;
};
/** Units per day a company plans to consume of a commodity. */
const dailyNeed = (db: Sql, c: Co, commodity: string) =>
  db.get<{ u: number }>('SELECT COALESCE(SUM(l.planned_batches * i.units),0) u FROM production_lines l JOIN recipe_inputs i ON i.recipe_id = l.recipe_id WHERE l.company_id = ? AND i.commodity_id = ?', c.id, commodity)!.u;

export interface ProposeInput { actorCompanyId: string; counterpartyId: string; role: 'buyer' | 'supplier'; commodityId: string; qtyPerDelivery: number; priceMinor: number; everyTicks: number; durationTicks: number }

/** How the counterparty decides. Deterministic, explained, and bounded: NPC and state firms never accept terms that lose them money or exceed what they can deliver. */
export function evaluateTerms(db: Sql, cfg: EngineConfig, tick: number, buyer: Co, supplier: Co, p: Pick<ProposeInput, 'commodityId' | 'qtyPerDelivery' | 'priceMinor' | 'everyTicks'>, responder: 'buyer' | 'supplier'): { accept: boolean | 'human'; reason: string } {
  const who = responder === 'supplier' ? supplier : buyer;
  if (who.owner_kind === 'player') return { accept: 'human', reason: `${who.name} must accept the offer.` };
  const perDay = p.qtyPerDelivery / p.everyTicks;
  if (responder === 'supplier') {
    const cap = dailyOutput(db, cfg, supplier, p.commodityId);
    if (cap <= 0) return { accept: false, reason: `${supplier.name} does not make ${p.commodityId}.` };
    if (perDay * 10_000 > cap * cfg.contractShareBps) return { accept: false, reason: `That is more than ${cfg.contractShareBps / 100}% of ${supplier.name}'s daily output (${cap} per day); it will not commit that much.` };
    const inv = stock(db, supplier.id, p.commodityId);
    const ref = refOf(db, p.commodityId)!;
    const cost = inv.qty > 0 ? Math.floor(inv.value_minor / inv.qty) : Math.floor(ref / 2);
    const ask = supplier.industry_id === 'wholesale' ? Math.floor((ref * cfg.stateSupplyMarkupBps) / 10_000)
      : db.get<{ a: number }>('SELECT ask_price_minor a FROM production_lines l JOIN recipes r ON r.id = l.recipe_id WHERE l.company_id = ? AND r.output_commodity_id = ? LIMIT 1', supplier.id, p.commodityId)?.a ?? ref;
    const floor = Math.max(Math.ceil((cost * 102) / 100), supplier.industry_id === 'wholesale' ? ask : Math.floor((ask * 90) / 100));
    if (p.priceMinor < floor) return { accept: false, reason: `${supplier.name} needs at least ${(floor / 100).toFixed(2)} EC per unit (its costs and current asking price); you offered ${(p.priceMinor / 100).toFixed(2)} EC.` };
    return { accept: true, reason: `${supplier.name} accepts: price covers its costs and volume is within its capacity.` };
  }
  const need = dailyNeed(db, buyer, p.commodityId);
  if (need <= 0) return { accept: false, reason: `${buyer.name} does not use ${p.commodityId}.` };
  if (perDay * 10_000 > need * cfg.contractShareBps) return { accept: false, reason: `${buyer.name} will not commit to more than ${cfg.contractShareBps / 100}% of its daily need (${need} per day).` };
  const asks = db.get<{ p: number | null }>("SELECT MIN(price_minor) p FROM orders WHERE commodity_id = ? AND side = 'sell' AND status = 'open' AND qty_remaining > 0 AND company_id <> ? AND (expires_tick IS NULL OR expires_tick > ?)", p.commodityId, supplier.id, tick)?.p;
  const ref = refOf(db, p.commodityId)!;
  const ceiling = Math.min(asks ?? Math.floor((ref * cfg.procurementLimitBps) / 10_000), Math.floor((ref * cfg.procurementLimitBps) / 10_000));
  if (p.priceMinor > ceiling) return { accept: false, reason: `${buyer.name} can already buy at ${(ceiling / 100).toFixed(2)} EC; it will not pay ${(p.priceMinor / 100).toFixed(2)} EC.` };
  return { accept: true, reason: `${buyer.name} accepts: your price beats what it can buy on the exchange.` };
}

const validate = (db: Sql, cfg: EngineConfig, i: ProposeInput): { error: CommandErr } | { buyer: Co; supplier: Co } => {
  const fe: Record<string, string> = {};
  const isInt = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isSafeInteger(n) && n >= lo && n <= hi;
  if (!isInt(i.qtyPerDelivery, 1, 1_000_000)) fe.qtyPerDelivery = 'Quantity must be a whole number of units, at least 1.';
  if (!isInt(i.priceMinor, 1, 100_000_000)) fe.priceMinor = 'Price must be a positive amount.';
  if (!isInt(i.everyTicks, 1, 30)) fe.everyTicks = 'Deliver every 1 to 30 days.';
  if (!isInt(i.durationTicks, 1, cfg.contractMaxTicks) || (isInt(i.everyTicks, 1, 30) && i.durationTicks < i.everyTicks)) fe.durationTicks = `Duration must be between the delivery interval and ${cfg.contractMaxTicks} days.`;
  const ref = refOf(db, i.commodityId);
  if (ref === undefined) fe.commodityId = 'Unknown commodity.';
  else if (isInt(i.priceMinor, 1, 100_000_000) && (i.priceMinor < Math.floor(ref / 2) || i.priceMinor > ref * 3)) fe.priceMinor = `Price must be within 50% to 300% of the ${(ref / 100).toFixed(2)} EC reference price.`;
  if (Object.keys(fe).length) return { error: err('VALIDATION', 'Some contract terms are invalid.', fe) };
  const actor = co(db, i.actorCompanyId), other = co(db, i.counterpartyId);
  if (!actor || !other) return { error: err('VALIDATION', 'Unknown company.') };
  if (actor.owner_kind !== 'player' || actor.owner_id !== actingPlayer()) return { error: err('FORBIDDEN', 'You do not own that company.') };
  if (other.id === actor.id) return { error: err('VALIDATION', 'A company cannot contract with itself.') };
  for (const c of [actor, other]) if (c.status !== 'operating' || c.bankrupt_tick !== null) return { error: err('VALIDATION', `${c.name} is not trading.`) };
  const buyer = i.role === 'buyer' ? actor : other, supplier = i.role === 'buyer' ? other : actor;
  if (buyer.owner_kind === 'state') return { error: err('VALIDATION', 'State enterprises do not buy under contract.') };
  if (dailyNeed(db, buyer, i.commodityId) <= 0 && buyer.owner_kind === 'player') return { error: err('VALIDATION', `${buyer.name} does not use ${i.commodityId} in production, so it could not use the delivery.`) };
  if (dailyOutput(db, cfg, supplier, i.commodityId) <= 0) return { error: err('VALIDATION', `${supplier.name} does not make ${i.commodityId}.`) };
  if (i.qtyPerDelivery > buyer.storage_cap_units) return { error: err('VALIDATION', `${buyer.name} could not store that much (capacity ${buyer.storage_cap_units}).`) };
  return { buyer, supplier };
};

/** contract.propose — the player offers terms as buyer or as supplier. The counterparty answers by rule (NPC/state) or must accept (another player). */
export function proposeContract(db: Sql, key: string, i: ProposeInput): CommandResponse<{ contractId: number; status: string; reason: string }> {
  return runCommand(db, key, 'contract.propose', (ctx) => {
    const cfg = loadConfig(db);
    const v = validate(db, cfg, i); if ('error' in v) return v.error;
    const { buyer, supplier } = v;
    const open = db.get<{ n: number }>("SELECT COUNT(*) n FROM supply_contracts WHERE status IN ('pending','active') AND ((buyer_company_id = ? AND supplier_company_id = ?) AND commodity_id = ?)", buyer.id, supplier.id, i.commodityId)!.n;
    if (open > 0) return err('VALIDATION', 'You already have a contract with this supplier for that commodity. Cancel it first.');
    const verdict = evaluateTerms(db, cfg, ctx.tick, buyer, supplier, i, i.role === 'buyer' ? 'supplier' : 'buyer');
    const status = verdict.accept === 'human' ? 'pending' : verdict.accept ? 'active' : 'declined';
    const start = ctx.tick + 1;
    const id = db.run(`INSERT INTO supply_contracts (buyer_company_id, supplier_company_id, commodity_id, qty_per_delivery, price_minor, every_ticks, start_tick, end_tick, status, proposed_by, decision_reason, notice_ticks, max_misses, created_tick, idempotency_key, ended_tick)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, buyer.id, supplier.id, i.commodityId, i.qtyPerDelivery, i.priceMinor, i.everyTicks, start, start + i.durationTicks - 1, status, i.role, verdict.reason, cfg.contractNoticeTicks, cfg.contractMaxMisses, ctx.tick, `cmd:${key}`, status === 'declined' ? ctx.tick : null).lastInsertRowid;
    logEvent(db, ctx.tick, `contract_${status}`, status === 'declined' ? 'warning' : 'info', buyer.id, `Contract #${id}: ${i.qtyPerDelivery} ${i.commodityId} every ${i.everyTicks} day(s) at ${(i.priceMinor / 100).toFixed(2)} EC: ${verdict.reason}`);
    if (status === 'declined') return { ok: false, error: { code: 'VALIDATION', message: verdict.reason } } as CommandErr;
    return { ok: true, revision: ctx.tick, transactionId: String(id), refreshScreens: ['commodities', 'companies'], data: { contractId: id, status, reason: verdict.reason } };
  }) as CommandResponse<{ contractId: number; status: string; reason: string }>;
}

/** contract.respond — the other player accepts or declines a pending offer. */
export function respondContract(db: Sql, key: string, contractId: number, accept: boolean): CommandResponse {
  return runCommand(db, key, 'contract.respond', (ctx) => {
    const k = db.get<ContractRow>('SELECT * FROM supply_contracts WHERE id = ?', contractId);
    if (!k) return err('VALIDATION', `No contract ${contractId}`);
    if (k.status !== 'pending') return err('VALIDATION', `Contract is ${k.status}.`);
    const responderId = k.proposed_by === 'buyer' ? k.supplier_company_id : k.buyer_company_id; const r = co(db, responderId);
    if (!r || r.owner_kind !== 'player' || r.owner_id !== actingPlayer()) return err('FORBIDDEN', 'Only the other party can answer this offer.');
    db.run('UPDATE supply_contracts SET status = ?, decision_reason = ?, ended_tick = ? WHERE id = ?', accept ? 'active' : 'declined', accept ? 'Accepted.' : 'Declined.', accept ? null : ctx.tick, contractId);
    return { ok: true, revision: ctx.tick, transactionId: String(contractId), refreshScreens: ['commodities'] };
  });
}

/** contract.cancel — either party may cancel. A pending offer ends at once; an active contract ends after the notice period, and deliveries due before then are still honoured. */
export function cancelContract(db: Sql, key: string, contractId: number): CommandResponse {
  return runCommand(db, key, 'contract.cancel', (ctx) => {
    const k = db.get<ContractRow>('SELECT * FROM supply_contracts WHERE id = ?', contractId);
    if (!k) return err('VALIDATION', `No contract ${contractId}`);
    const mine = [k.buyer_company_id, k.supplier_company_id].map((id) => co(db, id)).find((c) => c && c.owner_kind === 'player' && c.owner_id === actingPlayer());
    if (!mine) return err('FORBIDDEN', 'You are not a party to this contract.');
    if (k.status === 'pending') { db.run("UPDATE supply_contracts SET status = 'cancelled', ended_tick = ?, cancelled_by = ? WHERE id = ?", ctx.tick, mine.id, contractId); return { ok: true, revision: ctx.tick, transactionId: String(contractId), refreshScreens: ['commodities'] }; }
    if (k.status !== 'active') return err('VALIDATION', `Contract is already ${k.status}.`);
    if (k.cancel_effective_tick !== null) return err('VALIDATION', `Cancellation is already scheduled for day ${k.cancel_effective_tick}.`);
    const eff = ctx.tick + k.notice_ticks;
    db.run('UPDATE supply_contracts SET cancel_requested_tick = ?, cancel_effective_tick = ?, cancelled_by = ? WHERE id = ?', ctx.tick, eff, mine.id, contractId);
    logEvent(db, ctx.tick, 'contract_cancel_requested', 'info', k.buyer_company_id, `Contract #${contractId} will end on day ${eff} (${k.notice_ticks} days' notice)`);
    return { ok: true, revision: ctx.tick, transactionId: String(contractId), refreshScreens: ['commodities'], data: { effectiveTick: eff } };
  });
}

/** Delivery days of a contract, from `fromTick` on, up to `limit`; honours the cancellation date. Used for "upcoming deliveries". */
export function upcomingDeliveries(k: ContractRow, fromTick: number, limit = 5): number[] {
  if (k.status !== 'active') return [];
  const out: number[] = [];
  for (let t = Math.max(k.start_tick, fromTick); t <= k.end_tick && out.length < limit; t++) {
    if ((t - k.start_tick) % k.every_ticks !== 0) continue;
    if (k.cancel_effective_tick !== null && t >= k.cancel_effective_tick) break;
    out.push(t);
  }
  return out;
}

export interface DeliveryOutcome { buyer?: string; supplier?: string; costMinor?: number; contractId: number; status: 'delivered' | 'missed_stock' | 'missed_funds' | 'missed_storage'; qty: number; grossMinor: number; feeMinor: number }
/**
 * Tick phase: attempts every contract delivery due today, in contract-id order. Each delivery is one atomic settlement (money, fee and goods together) or a recorded miss —
 * nothing partial. Misses never create or destroy coins; enough consecutive misses end the contract, with no monetary penalty.
 */
export function runContractDeliveries(db: Sql, ctx: TickCtx, cfg: EngineConfig, safe: (kind: string, subject: string, fn: () => void) => void): DeliveryOutcome[] {
  const out: DeliveryOutcome[] = [];
  for (const k of db.all<ContractRow>("SELECT * FROM supply_contracts WHERE status = 'active' ORDER BY id")) {
    if (k.cancel_effective_tick !== null && ctx.tick >= k.cancel_effective_tick) { db.run("UPDATE supply_contracts SET status = 'cancelled', ended_tick = ? WHERE id = ?", ctx.tick, k.id); continue; }
    if (ctx.tick > k.end_tick) { db.run("UPDATE supply_contracts SET status = 'completed', ended_tick = ? WHERE id = ?", ctx.tick, k.id); continue; }
    if (ctx.tick < k.start_tick || (ctx.tick - k.start_tick) % k.every_ticks !== 0) continue;
    if (db.get('SELECT 1 FROM contract_deliveries WHERE contract_id = ? AND due_tick = ?', k.id, ctx.tick)) continue;   // repeated tick: never deliver twice
    safe('contract_delivery', `contract:${k.id}`, () => {
      const buyer = co(db, k.buyer_company_id)!, supplier = co(db, k.supplier_company_id)!;
      const gross = k.qty_per_delivery * k.price_minor, fee = feeFromBps(gross, cfg.exchangeFeeBps);
      const held = db.get<{ q: number }>('SELECT COALESCE(SUM(qty),0) q FROM inventory WHERE company_id = ?', buyer.id)!.q;
      let miss: DeliveryOutcome['status'] | null = null;
      // Loan covenant (as on the exchange): no related-party deliveries while either sister company owes the National Bank.
      const owes = (id: string) => !!db.get("SELECT 1 FROM loans WHERE borrower_id = ? AND status IN ('active','defaulted') AND outstanding_minor > 0", id);
      const covenant = buyer.owner_kind !== 'state' && buyer.owner_kind === supplier.owner_kind && buyer.owner_id === supplier.owner_id && (owes(buyer.id) || owes(supplier.id));
      if (covenant) miss = 'missed_funds';
      else if (supplier.status !== 'operating' || freeStock(db, supplier.id, k.commodity_id) < k.qty_per_delivery) miss = 'missed_stock';
      else if (available(db, buyer.treasury_account_id) < gross) miss = 'missed_funds';
      else if (held + k.qty_per_delivery > buyer.storage_cap_units) miss = 'missed_storage';
      if (miss) {
        db.run('INSERT INTO contract_deliveries (contract_id, due_tick, status, qty, price_minor, settled_tick) VALUES (?,?,?,?,?,?)', k.id, ctx.tick, miss, k.qty_per_delivery, k.price_minor, ctx.tick);
        const misses = k.consecutive_misses + 1;
        db.run('UPDATE supply_contracts SET consecutive_misses = ? WHERE id = ?', misses, k.id);
        const why = { missed_stock: `${supplier.name} had too little ${k.commodity_id} in stock`, missed_funds: covenant ? 'deliveries between sister companies are suspended while one of them owes the National Bank' : `${buyer.name} could not afford ${(gross / 100).toFixed(2)} EC`, missed_storage: `${buyer.name} had no room to store the delivery` }[miss];
        logEvent(db, ctx.tick, 'contract_missed', 'warning', miss === 'missed_stock' ? supplier.id : buyer.id, `Contract #${k.id}: delivery missed — ${why} (${misses} in a row)`);
        if (misses >= k.max_misses) { db.run("UPDATE supply_contracts SET status = 'failed', ended_tick = ? WHERE id = ?", ctx.tick, k.id); logEvent(db, ctx.tick, 'contract_failed', 'warning', k.buyer_company_id, `Contract #${k.id} ended after ${misses} missed deliveries`); }
        out.push({ contractId: k.id, status: miss, qty: k.qty_per_delivery, grossMinor: 0, feeMinor: 0 });
        return;
      }
      const ref = `contract:${k.id}:${ctx.tick}`;
      const tx = transfer(db, ctx, `${ref}:settle`, buyer.treasury_account_id, supplier.treasury_account_id, gross, 'trade_settlement', `contract #${k.id}: ${k.qty_per_delivery} ${k.commodity_id} @ ${k.price_minor}`);
      if (fee > 0) transfer(db, ctx, `${ref}:fee`, supplier.treasury_account_id, EXCHANGE_ACCOUNT, fee, 'state_payment', `exchange fee on contract #${k.id}`);
      const cost = removeStock(db, ctx, supplier.id, k.commodity_id, k.qty_per_delivery, 'trade_out', ref, { fromReserved: false });
      addStock(db, ctx, buyer.id, k.commodity_id, k.qty_per_delivery, gross, 'trade_in', ref);
      db.run('INSERT INTO contract_deliveries (contract_id, due_tick, status, qty, price_minor, gross_minor, fee_minor, ledger_tx_id, settled_tick) VALUES (?,?,?,?,?,?,?,?,?)', k.id, ctx.tick, 'delivered', k.qty_per_delivery, k.price_minor, gross, fee, tx.txId, ctx.tick);
      db.run('UPDATE supply_contracts SET consecutive_misses = 0 WHERE id = ?', k.id);
      out.push({ contractId: k.id, status: 'delivered', qty: k.qty_per_delivery, grossMinor: gross, feeMinor: fee, buyer: buyer.id, supplier: supplier.id, costMinor: cost });
    });
  }
  return out;
}
