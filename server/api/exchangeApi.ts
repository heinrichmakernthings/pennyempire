import type { Sql } from '../db/sql';
import { gameDate, loadConfig } from '../engine/config';
import { upcomingDeliveries, type ContractRow } from '../engine/contracts';
import { PLAYER_ID } from '../seed/bristol';
import type { ContractDto, Holding, OwnOrder, OwnTrade } from '../../src/shared/exchange';

const tickOf = (db: Sql) => db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
const mineSql = "(SELECT id FROM companies WHERE owner_kind = 'player' AND owner_id = ?)";

export function ownOrders(db: Sql, commodity?: string, limit = 60): OwnOrder[] {
  const cfg = loadConfig(db);
  const rows = db.all<{ id: number; company_id: string; name: string; commodity_id: string; side: 'buy' | 'sell'; kind: 'limit' | 'market' | 'direct'; price_minor: number; qty_original: number; qty_remaining: number; reserved_funds_minor: number; status: 'open' | 'filled' | 'cancelled'; end_reason: string | null; created_tick: number; expires_tick: number | null }>(
    `SELECT o.*, c.name FROM orders o JOIN companies c ON c.id = o.company_id WHERE o.company_id IN ${mineSql} ${commodity ? 'AND o.commodity_id = ?' : ''} ORDER BY (o.status = 'open') DESC, o.id DESC LIMIT ?`, PLAYER_ID, ...(commodity ? [commodity] : []), limit);
  return rows.map((o) => {
    const f = db.get<{ q: number; v: number }>('SELECT COALESCE(SUM(qty),0) q, COALESCE(SUM(qty * price_minor),0) v FROM trades WHERE buy_order_id = ? OR sell_order_id = ?', o.id, o.id)!;
    const filled = o.qty_original - o.qty_remaining;
    return {
      id: o.id, companyId: o.company_id, companyName: o.name, commodityId: o.commodity_id, side: o.side, kind: o.kind, priceMinor: o.price_minor, unitsOriginal: o.qty_original, unitsRemaining: o.status === 'open' ? o.qty_remaining : 0, unitsFilled: filled,
      avgFillMinor: f.q > 0 ? Math.floor(f.v / f.q) : null, reservedFundsMinor: o.reserved_funds_minor, reservedUnits: o.side === 'sell' && o.status === 'open' ? o.qty_remaining : 0,
      status: o.status === 'open' ? (filled > 0 ? 'partial' : 'open') : o.status === 'cancelled' ? (o.end_reason === 'expired' ? 'expired' : 'cancelled') : 'filled',
      endReason: o.end_reason, createdTick: o.created_tick, expiresTick: o.expires_tick, createdDate: gameDate(cfg, o.created_tick),
    };
  });
}

export function ownTrades(db: Sql, commodity?: string, limit = 60): OwnTrade[] {
  const cfg = loadConfig(db);
  return db.all<{ id: number; tick: number; commodity_id: string; qty: number; price_minor: number; fee_minor: number; ledger_tx_id: number | null; buyer_company_id: string; seller_company_id: string; bn: string; sn: string; mine_buy: number }>(
    `SELECT t.*, b.name bn, s.name sn, (t.buyer_company_id IN ${mineSql}) mine_buy FROM trades t JOIN companies b ON b.id = t.buyer_company_id JOIN companies s ON s.id = t.seller_company_id
     WHERE (t.buyer_company_id IN ${mineSql} OR t.seller_company_id IN ${mineSql}) ${commodity ? 'AND t.commodity_id = ?' : ''} ORDER BY t.id DESC LIMIT ?`, PLAYER_ID, PLAYER_ID, PLAYER_ID, ...(commodity ? [commodity] : []), limit)
    .map((t) => { const gross = t.qty * t.price_minor, bought = t.mine_buy === 1; return { id: t.id, tick: t.tick, gameDate: gameDate(cfg, t.tick), commodityId: t.commodity_id, role: bought ? 'bought' : 'sold', counterparty: bought ? t.sn : t.bn, companyId: bought ? t.buyer_company_id : t.seller_company_id, qty: t.qty, priceMinor: t.price_minor, grossMinor: gross, feeMinor: bought ? 0 : t.fee_minor, netMinor: bought ? -gross : gross - t.fee_minor, ledgerTxId: t.ledger_tx_id }; });
}

export function holdings(db: Sql, commodity: string): Holding[] {
  return db.all<{ id: string; name: string; qty: number | null; reserved: number | null; b: number; r: number; sys: number }>(
    `SELECT c.id, c.name, i.qty, i.reserved, a.balance_minor b, a.reserved_minor r, (SELECT COALESCE(SUM(o.qty_remaining),0) FROM orders o WHERE o.company_id = c.id AND o.commodity_id = ? AND o.side = 'sell' AND o.status = 'open' AND o.idempotency_key LIKE 'sys:%') sys FROM companies c JOIN accounts a ON a.id = c.treasury_account_id LEFT JOIN inventory i ON i.company_id = c.id AND i.commodity_id = ? WHERE c.id IN ${mineSql} AND c.bankrupt_tick IS NULL ORDER BY c.id`, commodity, commodity, PLAYER_ID)
    .map((h) => ({ companyId: h.id, companyName: h.name, commodityId: commodity, units: h.qty ?? 0, reservedUnits: (h.reserved ?? 0) - h.sys, autoListedUnits: h.sys, freeUnits: (h.qty ?? 0) - (h.reserved ?? 0) + h.sys, cashMinor: h.b, availableCashMinor: h.b - h.r }));
}

export function contracts(db: Sql): ContractDto[] {
  const cfg = loadConfig(db), tick = tickOf(db);
  const rows = db.all<ContractRow & { bn: string; sn: string; mine_buyer: number }>(`SELECT k.*, b.name bn, s.name sn, (k.buyer_company_id IN ${mineSql}) mine_buyer FROM supply_contracts k JOIN companies b ON b.id = k.buyer_company_id JOIN companies s ON s.id = k.supplier_company_id
    WHERE k.buyer_company_id IN ${mineSql} OR k.supplier_company_id IN ${mineSql} ORDER BY (k.status IN ('active','pending')) DESC, k.id DESC LIMIT 50`, PLAYER_ID, PLAYER_ID, PLAYER_ID);
  return rows.map((k) => {
    const hist = db.all<{ due_tick: number; status: string; qty: number; gross_minor: number; fee_minor: number }>('SELECT due_tick, status, qty, gross_minor, fee_minor FROM contract_deliveries WHERE contract_id = ? ORDER BY due_tick DESC LIMIT 10', k.id);
    const agg = db.get<{ d: number; m: number; u: number; p: number }>("SELECT COALESCE(SUM(status = 'delivered'),0) d, COALESCE(SUM(status <> 'delivered'),0) m, COALESCE(SUM(CASE WHEN status = 'delivered' THEN qty ELSE 0 END),0) u, COALESCE(SUM(gross_minor),0) p FROM contract_deliveries WHERE contract_id = ?", k.id)!;
    return {
      id: k.id, status: k.status, role: k.mine_buyer === 1 ? 'buyer' : 'supplier', buyerId: k.buyer_company_id, buyerName: k.bn, supplierId: k.supplier_company_id, supplierName: k.sn, commodityId: k.commodity_id, qtyPerDelivery: k.qty_per_delivery, priceMinor: k.price_minor, everyTicks: k.every_ticks,
      startTick: k.start_tick, endTick: k.end_tick, startDate: gameDate(cfg, k.start_tick), endDate: gameDate(cfg, k.end_tick), noticeTicks: k.notice_ticks, cancelEffectiveTick: k.cancel_effective_tick, proposedBy: k.proposed_by, reason: k.decision_reason, consecutiveMisses: k.consecutive_misses, maxMisses: k.max_misses,
      upcoming: upcomingDeliveries(k, tick + 1).map((t) => ({ tick: t, gameDate: gameDate(cfg, t), grossMinor: k.qty_per_delivery * k.price_minor })),
      history: hist.map((h) => ({ tick: h.due_tick, gameDate: gameDate(cfg, h.due_tick), status: h.status, qty: h.qty, grossMinor: h.gross_minor, feeMinor: h.fee_minor })),
      delivered: agg.d, missed: agg.m, deliveredUnits: agg.u, totalPaidMinor: agg.p,
    };
  });
}

/** Contract counterparties: companies that make the commodity (suppliers) or that use it (buyers), with the numbers the counterparty's own rules use. */
export function contractCandidates(db: Sql, commodity: string) {
  const cfg = loadConfig(db);
  const ref = db.get<{ p: number }>('SELECT reference_price_minor p FROM commodities WHERE id = ?', commodity)?.p ?? 0;
  const suppliers = db.all<{ id: string; name: string; owner_kind: string; cap: number; ask: number | null }>(`SELECT c.id, c.name, c.owner_kind, CASE WHEN c.industry_id = 'wholesale' THEN ? ELSE COALESCE(SUM(l.planned_batches * r.output_units),0) END cap, MIN(l.ask_price_minor) ask
    FROM companies c LEFT JOIN production_lines l ON l.company_id = c.id LEFT JOIN recipes r ON r.id = l.recipe_id AND r.output_commodity_id = ? WHERE c.bankrupt_tick IS NULL AND c.status = 'operating' AND c.owner_kind <> 'player' AND (c.industry_id = 'wholesale' OR r.id IS NOT NULL) GROUP BY c.id ORDER BY c.id`, cfg.stateSupplyPerTick, commodity)
    .filter((s) => s.cap > 0).map((s) => ({ companyId: s.id, name: s.name, ownerKind: s.owner_kind, dailyOutput: s.cap, askMinor: s.owner_kind === 'state' ? Math.floor((ref * cfg.stateSupplyMarkupBps) / 10_000) : s.ask ?? ref, maxPerDay: Math.floor((s.cap * cfg.contractShareBps) / 10_000) }));
  const buyers = db.all<{ id: string; name: string; owner_kind: string; need: number }>(`SELECT c.id, c.name, c.owner_kind, SUM(l.planned_batches * i.units) need FROM companies c JOIN production_lines l ON l.company_id = c.id JOIN recipe_inputs i ON i.recipe_id = l.recipe_id AND i.commodity_id = ?
    WHERE c.bankrupt_tick IS NULL AND c.status = 'operating' AND c.owner_kind = 'npc' GROUP BY c.id ORDER BY c.id`, commodity)
    .map((b) => ({ companyId: b.id, name: b.name, ownerKind: b.owner_kind, dailyNeed: b.need, maxPerDay: Math.floor((b.need * cfg.contractShareBps) / 10_000) }));
  return { referencePriceMinor: ref, suppliers, buyers, limits: { maxTicks: cfg.contractMaxTicks, noticeTicks: cfg.contractNoticeTicks, maxMisses: cfg.contractMaxMisses, shareBps: cfg.contractShareBps } };
}

export type { ContractDto, Holding, OwnOrder, OwnTrade };
