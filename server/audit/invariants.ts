/**
 * Deep economic invariants. `reconcile()` proves the books balance; this proves every economic EVENT is backed by matching evidence:
 * each trade, share trade and dividend has exactly one ledger transaction for exactly its amount, every unit of output was paid for with
 * recipe inputs, reservations match their orders, supply caps hold, and every coin ever issued has a known reason.
 * Pure reads: safe to run against a live world.
 */
import type { Sql } from '../db/sql';
import { reconcile, supply } from '../engine/ledger';
import { reconcileGbp } from '../engine/gbpLedger';
import { checkShareIntegrity } from '../engine/capital';
import { loadConfig } from '../engine/config';

export type Severity = 'P0' | 'P1' | 'P2';
export interface Finding { id: string; severity: Severity; count: number; detail: string; sample?: unknown }
export interface AuditResult { ok: boolean; findings: Finding[]; checks: number; supply: { issued: number; destroyed: number; circulating: number }; issuanceByReason: Record<string, number>; sinksByReason: Record<string, number> }

/** Every legitimate reason coins may be created. Anything else is unexplained issuance. */
export const ISSUANCE_REASONS: [RegExp, string][] = [
  [/^opening|^demo player starting|^new player starting capital|^opening NPC household|^opening state treasury|^opening lending/, 'genesis'],
  [/^NPC citizen income grant/, 'citizen income grant'],
  [/^NPC investor seed capital/, 'NPC investor seed'],
  [/^Penny Central Bank liquidity/, 'central bank liquidity'],
  [/^rewarded advertisement/, 'rewarded ad (capped faucet)'],
  [/^test |^scenario grant|^stress grant|^test grant|^test funding/, 'test/scenario grant'],
];
const classify = (memo: string, table: [RegExp, string][]) => table.find(([re]) => re.test(memo))?.[1] ?? null;
const SINK_REASONS: [RegExp, string][] = [
  [/licence/, 'incorporation licence'], [/infrastructure upkeep/, 'city upkeep'], [/infrastructure wear/, 'state service wear'], [/exchange fee burn|Exchange fee burn/, 'exchange fee burn'],
  [/luxury purchase/, 'prestige purchase'], [/collectible trading fee/, 'collectible fee'], [/lottery rake/, 'lottery rake'], [/liquidity drain/, 'central bank drain'], [/boost|production|marketing/i, 'boost purchase'],
];

export function deepAudit(db: Sql): AuditResult {
  const findings: Finding[] = []; let checks = 0;
  const check = (id: string, severity: Severity, rows: unknown[], detail: string) => { checks++; if (rows.length) findings.push({ id, severity, count: rows.length, detail, sample: rows.slice(0, 3) }); };
  const n = (sql: string, ...a: (string | number)[]) => db.get<{ n: number }>(sql, ...a)!.n;

  // 1. The books balance (coins, reservations, inventory log), the simulated GBP book balances, the share register is consistent.
  const r = reconcile(db); check('ledger.reconcile', 'P0', r.problems, 'Empire Coin ledger does not reconcile');
  const g = reconcileGbp(db); check('gbp.reconcile', 'P0', g.problems, 'GBP_TEST ledger does not reconcile');
  check('shares.integrity', 'P0', checkShareIntegrity(db), 'Share register inconsistent with its journal');

  // 2. Commodity trades: one settlement transaction per trade, for exactly qty × price; goods moved exactly qty each way.
  check('trade.no_ledger', 'P0', db.all('SELECT id FROM trades WHERE ledger_tx_id IS NULL LIMIT 5'), 'Trade without a settlement transaction (goods moved without payment)');
  check('trade.shared_ledger', 'P0', db.all('SELECT ledger_tx_id, COUNT(*) n FROM trades WHERE ledger_tx_id IS NOT NULL GROUP BY ledger_tx_id HAVING n > 1 LIMIT 5'), 'Two trades share one payment');
  check('trade.amount', 'P0', db.all('SELECT t.id, t.qty * t.price_minor want, (SELECT SUM(amount_minor) FROM ledger_postings p WHERE p.tx_id = t.ledger_tx_id AND p.amount_minor > 0) got FROM trades t WHERE got IS NOT want LIMIT 5'), 'Trade payment differs from qty × price');
  check('trade.fee', 'P0', db.all('SELECT t.id FROM trades t WHERE t.fee_minor > 0 AND (t.fee_tx_id IS NULL OR (SELECT SUM(amount_minor) FROM ledger_postings p WHERE p.tx_id = t.fee_tx_id AND p.amount_minor > 0) <> t.fee_minor) LIMIT 5'), 'Trade fee not charged exactly');
  check('trade.goods', 'P0', db.all("SELECT t.id, t.qty, (SELECT COALESCE(SUM(delta),0) FROM inventory_movements m WHERE m.ref = 'trade:' || t.id AND m.reason = 'trade_in') i, (SELECT COALESCE(SUM(delta),0) FROM inventory_movements m WHERE m.ref = 'trade:' || t.id AND m.reason = 'trade_out') o FROM trades t WHERE i <> t.qty OR o <> -t.qty LIMIT 5"), 'Goods moved for a trade differ from its quantity');

  // 3. Orders: an open buy reserves exactly price × remaining; a closed order reserves nothing.
  check('order.reserve', 'P0', db.all("SELECT id, price_minor * qty_remaining want, reserved_funds_minor got FROM orders WHERE side = 'buy' AND status = 'open' AND reserved_funds_minor <> price_minor * qty_remaining LIMIT 5"), 'Open buy order reservation differs from price × remaining');
  check('order.closed_reserve', 'P0', db.all("SELECT id FROM orders WHERE status <> 'open' AND reserved_funds_minor <> 0 LIMIT 5"), 'Closed order still holds coins');

  // 4. Production: logged output equals output movements; every batch consumed its recipe's inputs (at least the cheapest quality ratio).
  const cfg = loadConfig(db); const minQ = Math.min(...Object.values(cfg.qualityInputBps));
  const recipes = new Map<string, { units: number; inputs: { c: string; u: number }[] }>();
  for (const rr of db.all<{ id: string; output_units: number }>('SELECT id, output_units FROM recipes')) recipes.set(rr.id, { units: rr.output_units, inputs: db.all<{ c: string; u: number }>('SELECT commodity_id c, units u FROM recipe_inputs WHERE recipe_id = ?', rr.id) });
  const logged = new Map<string, number>(), inputs = new Map<string, number>(); const short: unknown[] = [], wrongOut: unknown[] = [];
  for (const p of db.all<{ tick: number; company_id: string; recipe_id: string; produced_batches: number; output_units: number; inputs_json: string }>('SELECT tick, company_id, recipe_id, produced_batches, output_units, inputs_json FROM production_log WHERE produced_batches > 0')) {
    const rec = recipes.get(p.recipe_id)!; const used = JSON.parse(p.inputs_json) as Record<string, number>;
    if (p.output_units !== p.produced_batches * rec.units) wrongOut.push(p);
    for (const i of rec.inputs) if ((used[i.c] ?? 0) < Math.floor((p.produced_batches * i.u * minQ) / 10_000)) short.push({ ...p, commodity: i.c });
    const k = `${p.company_id}|${p.recipe_id}`; logged.set(k, (logged.get(k) ?? 0) + p.output_units);
    for (const [c, u] of Object.entries(used)) inputs.set(`${p.company_id}|${c}`, (inputs.get(`${p.company_id}|${c}`) ?? 0) + u);
  }
  check('production.output_ratio', 'P0', wrongOut, 'Logged output differs from batches × recipe output');
  check('production.inputs', 'P0', short, 'Output produced without consuming the recipe inputs');
  const outMoves = db.all<{ k: string; s: number }>("SELECT company_id || '|' || ref k, SUM(delta) s FROM inventory_movements WHERE reason = 'production_output' GROUP BY company_id, ref");
  check('production.unlogged_output', 'P0', outMoves.filter((m) => m.s !== (logged.get(m.k) ?? 0)), 'Goods created by production that the production log does not account for (free output)');
  const inMoves = db.all<{ k: string; s: number }>("SELECT company_id || '|' || commodity_id k, -SUM(delta) s FROM inventory_movements WHERE reason = 'production_input' GROUP BY company_id, commodity_id");
  check('production.input_log', 'P1', inMoves.filter((m) => m.s !== (inputs.get(m.k) ?? 0)), 'Inputs consumed differ from the production log');

  // 5. Shares and dividends.
  check('share_trade.no_ledger', 'P0', db.all('SELECT id FROM share_trades WHERE ledger_tx_id IS NULL LIMIT 5'), 'Share trade without settlement');
  check('share_trade.shared_ledger', 'P0', db.all('SELECT ledger_tx_id, COUNT(*) n FROM share_trades WHERE ledger_tx_id IS NOT NULL GROUP BY ledger_tx_id HAVING n > 1 LIMIT 5'), 'Two share trades share one payment');
  check('share_trade.amount', 'P0', db.all('SELECT s.id, s.qty * s.price_minor want, (SELECT SUM(amount_minor) FROM ledger_postings p WHERE p.tx_id = s.ledger_tx_id AND p.amount_minor > 0) got FROM share_trades s WHERE got IS NOT want LIMIT 5'), 'Share payment differs from qty × price');
  check('dividend.entitlements', 'P0', db.all("SELECT d.id, d.paid_minor, (SELECT COALESCE(SUM(amount_minor),0) FROM dividend_entitlements e WHERE e.dividend_id = d.id) s FROM dividends d WHERE d.status = 'paid' AND s <> d.paid_minor LIMIT 5"), 'Dividend paid differs from its entitlements');
  check('dividend.rate', 'P0', db.all('SELECT e.dividend_id, e.investor_id FROM dividend_entitlements e JOIN dividends d ON d.id = e.dividend_id WHERE e.amount_minor <> e.shares * d.per_share_minor LIMIT 5'), 'Entitlement differs from shares × rate');
  check('dividend.payment', 'P0', db.all("SELECT e.dividend_id, e.investor_id FROM dividend_entitlements e JOIN dividends d ON d.id = e.dividend_id WHERE d.status = 'paid' AND e.amount_minor > 0 AND (e.ledger_tx_id IS NULL OR (SELECT SUM(amount_minor) FROM ledger_postings p WHERE p.tx_id = e.ledger_tx_id AND p.amount_minor > 0) <> e.amount_minor) LIMIT 5"), 'Dividend entitlement not paid exactly once');
  check('dividend.source', 'P0', db.all("SELECT e.dividend_id FROM dividend_entitlements e JOIN dividends d ON d.id = e.dividend_id JOIN companies c ON c.id = d.company_id WHERE e.ledger_tx_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ledger_postings p WHERE p.tx_id = e.ledger_tx_id AND p.account_id = c.treasury_account_id AND p.amount_minor = -e.amount_minor) LIMIT 5"), 'Dividend not paid from the company treasury');

  // 6. Credit.
  check('loan.state', 'P1', db.all("SELECT id FROM loans WHERE outstanding_minor < 0 OR (status = 'repaid' AND outstanding_minor <> 0) LIMIT 5"), 'Loan balance inconsistent with its status');
  check('loan.disbursed', 'P0', db.all('SELECT l.id FROM loans l WHERE (SELECT SUM(amount_minor) FROM ledger_postings p WHERE p.tx_id = l.disbursement_tx_id AND p.amount_minor > 0) IS NOT l.principal_minor LIMIT 5'), 'Loan principal differs from the coins disbursed');
  check('bank.stranded_deposits', 'P1', db.all("SELECT d.company_id, d.balance_minor FROM bank_deposits d JOIN companies c ON c.id = d.company_id WHERE d.balance_minor > 0 AND c.bankrupt_tick IS NOT NULL LIMIT 5"), 'Savings of a liquidated company left behind at the bank');

  // 7. Liquidated companies hold nothing.
  check('bankrupt.assets', 'P1', db.all("SELECT c.id, c.bankrupt_tick, a.balance_minor, (SELECT GROUP_CONCAT(o.id || ':' || o.side || ':' || o.created_tick) FROM orders o WHERE o.company_id = c.id AND o.status = 'open') open FROM companies c JOIN accounts a ON a.id = c.treasury_account_id WHERE c.bankrupt_tick IS NOT NULL AND (a.balance_minor <> 0 OR EXISTS (SELECT 1 FROM orders o WHERE o.company_id = c.id AND o.status = 'open')) LIMIT 5"), 'Liquidated company still holds coins or open orders');

  // 8. Prestige and lotteries.
  check('prestige.supply', 'P0', db.all('SELECT i.id, i.minted, i.supply_cap, (SELECT COUNT(*) FROM prestige_owned o WHERE o.item_id = i.id) owned FROM prestige_items i WHERE owned <> i.minted OR (i.supply_cap IS NOT NULL AND owned > i.supply_cap) LIMIT 5'), 'Collectibles exceed their minted count or supply cap');
  check('prestige.listing', 'P0', db.all("SELECT l.id FROM prestige_listings l JOIN prestige_owned o ON o.id = l.owned_id WHERE l.status = 'open' AND (o.owner_id <> l.seller_id OR o.listed <> 1) LIMIT 5"), 'Open listing for an item the seller does not hold');
  check('lottery.pool', 'P0', db.all("SELECT l.id, l.tickets_sold * l.ticket_price_minor want, a.balance_minor got FROM lotteries l JOIN accounts a ON a.id = l.pool_account WHERE l.status = 'open' AND a.balance_minor <> l.tickets_sold * l.ticket_price_minor LIMIT 5"), 'Open lottery pool differs from tickets sold');
  check('lottery.closed_pool', 'P0', db.all("SELECT l.id, a.balance_minor FROM lotteries l JOIN accounts a ON a.id = l.pool_account WHERE l.status <> 'open' AND a.balance_minor <> 0 LIMIT 5"), 'Settled lottery pool still holds coins');

  // 9. Every coin issued has a reason; every sink is classified.
  const issuanceByReason: Record<string, number> = {}, sinksByReason: Record<string, number> = {}; const unexplained: unknown[] = [];
  for (const t of db.all<{ memo: string; a: number }>("SELECT t.memo, p.amount_minor a FROM ledger_transactions t JOIN ledger_postings p ON p.tx_id = t.id WHERE t.kind = 'issuance' AND p.amount_minor > 0")) {
    const c = classify(t.memo, ISSUANCE_REASONS); if (!c) unexplained.push(t); issuanceByReason[c ?? 'UNEXPLAINED'] = (issuanceByReason[c ?? 'UNEXPLAINED'] ?? 0) + t.a;
  }
  for (const t of db.all<{ memo: string; a: number }>("SELECT t.memo, p.amount_minor a FROM ledger_transactions t JOIN ledger_postings p ON p.tx_id = t.id WHERE t.kind IN ('sink','sink_fee') AND p.amount_minor > 0")) { const c = classify(t.memo, SINK_REASONS) ?? 'other sink'; sinksByReason[c] = (sinksByReason[c] ?? 0) + t.a; }
  check('issuance.unexplained', 'P0', unexplained, 'Coins issued for an unknown reason');
  check('accounts.negative', 'P0', db.all("SELECT id, balance_minor FROM accounts WHERE kind <> 'issuance' AND (balance_minor < 0 OR reserved_minor > balance_minor) LIMIT 5"), 'Account below zero or over-reserved');
  void n;
  const s = supply(db);
  return { ok: findings.filter((f) => f.severity !== 'P2').length === 0, findings, checks, supply: { issued: s.issued, destroyed: s.destroyed, circulating: s.circulating }, issuanceByReason, sinksByReason };
}
