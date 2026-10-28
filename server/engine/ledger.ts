import type { Sql } from '../db/sql';

/** The mint and the burn. Issuance is the only account allowed to go negative; Burn only ever receives. */
export const ISSUANCE = 'acct:issuance';
export const BURN = 'acct:burn';

export type LedgerKind = 'issuance' | 'transfer' | 'state_payment' | 'sink' | 'sink_fee' | 'operating_cost' | 'consumer_sale' | 'trade_settlement' | 'capital_injection' | 'owner_withdrawal';
export interface Posting { account: string; amount: number }
export interface TickCtx { tick: number; gameDate: string; actor: string }

export type LedgerErrorCode = 'INSUFFICIENT_FUNDS' | 'UNKNOWN_ACCOUNT' | 'UNBALANCED' | 'INVALID_AMOUNT' | 'IDEMPOTENCY_MISMATCH' | 'FORBIDDEN';
export class LedgerError extends Error {
  constructor(public readonly code: LedgerErrorCode, message: string) { super(message); this.name = 'LedgerError'; }
}

export interface PostResult { txId: number; duplicate: boolean }

const isMoney = (n: number) => Number.isSafeInteger(n) && n !== 0;

/**
 * The only function that moves coins. Atomic (own savepoint), balanced (postings sum to zero), idempotent (same key + same
 * postings = no-op; same key + different postings = error), and rule-checked:
 *  - only `issuance` transactions may debit the mint account; nothing may ever credit it;
 *  - only `sink`/`sink_fee` transactions may credit the burn account; nothing may debit it;
 *  - no other account may spend below its reserved amount or go negative.
 * Sinks (coins leave the economy) and transfers to state companies (coins stay in circulation) are different kinds on purpose.
 */
export function post(db: Sql, ctx: TickCtx, key: string, kind: LedgerKind, memo: string, postings: Posting[]): PostResult {
  return db.transaction(() => {
    const merged = new Map<string, number>();
    for (const p of postings) {
      if (!isMoney(p.amount)) throw new LedgerError('INVALID_AMOUNT', `Posting amount must be a non-zero safe integer (${p.account}: ${p.amount})`);
      merged.set(p.account, (merged.get(p.account) ?? 0) + p.amount);
    }
    const lines = [...merged].filter(([, a]) => a !== 0).sort(([a], [b]) => (a < b ? -1 : 1));
    const existing = db.get<{ id: number; kind: string }>('SELECT id, kind FROM ledger_transactions WHERE idempotency_key = ?', key);
    if (existing) {
      const prior = db.all<{ account_id: string; amount_minor: number }>('SELECT account_id, amount_minor FROM ledger_postings WHERE tx_id = ? ORDER BY account_id', existing.id);
      const same = existing.kind === kind && prior.length === lines.length && prior.every((p, i) => p.account_id === lines[i]![0] && p.amount_minor === lines[i]![1]);
      if (!same) throw new LedgerError('IDEMPOTENCY_MISMATCH', `Idempotency key ${key} was already used for a different transaction`);
      return { txId: existing.id, duplicate: true };
    }
    if (lines.length < 2) throw new LedgerError('UNBALANCED', 'A transaction needs at least two non-zero postings');
    if (lines.reduce((a, [, n]) => a + n, 0) !== 0) throw new LedgerError('UNBALANCED', `Postings do not sum to zero for ${key}`);
    for (const [acct, amount] of lines) {
      const row = db.get<{ kind: string; balance_minor: number; reserved_minor: number }>('SELECT kind, balance_minor, reserved_minor FROM accounts WHERE id = ?', acct);
      if (!row) throw new LedgerError('UNKNOWN_ACCOUNT', `Unknown account ${acct}`);
      if (acct === ISSUANCE && !(kind === 'issuance' && amount < 0)) throw new LedgerError('FORBIDDEN', 'Only issuance transactions may debit the mint, and nothing may credit it');
      if (acct === BURN && !((kind === 'sink' || kind === 'sink_fee') && amount > 0)) throw new LedgerError('FORBIDDEN', 'Only sink transactions may credit the burn account, and nothing may debit it');
      if (kind === 'issuance' && !lines.some(([a, n]) => a === ISSUANCE && n < 0)) throw new LedgerError('FORBIDDEN', 'Issuance must debit the mint');
      if ((kind === 'sink' || kind === 'sink_fee') && !lines.some(([a, n]) => a === BURN && n > 0)) throw new LedgerError('FORBIDDEN', 'A sink must credit the burn account');
      if (kind !== 'issuance' && kind !== 'sink' && kind !== 'sink_fee' && (lines.some(([a]) => a === ISSUANCE || a === BURN))) throw new LedgerError('FORBIDDEN', `${kind} may not touch the mint or burn accounts`);
      if (amount < 0 && acct !== ISSUANCE && row.balance_minor - row.reserved_minor + amount < 0) {
        throw new LedgerError('INSUFFICIENT_FUNDS', `${acct} has ${row.balance_minor - row.reserved_minor} available, needs ${-amount}`);
      }
    }
    const tx = db.run('INSERT INTO ledger_transactions (idempotency_key, kind, tick, memo, actor, created_at) VALUES (?,?,?,?,?,?)', key, kind, ctx.tick, memo, ctx.actor, ctx.gameDate);
    for (const [acct, amount] of lines) {
      db.run('INSERT INTO ledger_postings (tx_id, account_id, amount_minor) VALUES (?,?,?)', tx.lastInsertRowid, acct, amount);
      db.run('UPDATE accounts SET balance_minor = balance_minor + ? WHERE id = ?', amount, acct);
    }
    return { txId: tx.lastInsertRowid, duplicate: false };
  });
}

/* Convenience wrappers: each names the economic meaning of the movement. */
export const issue = (db: Sql, ctx: TickCtx, key: string, to: string, amount: number, memo: string) => post(db, ctx, key, 'issuance', memo, [{ account: ISSUANCE, amount: -amount }, { account: to, amount }]);
export const destroy = (db: Sql, ctx: TickCtx, key: string, from: string, amount: number, memo: string, kind: 'sink' | 'sink_fee' = 'sink') => post(db, ctx, key, kind, memo, [{ account: from, amount: -amount }, { account: BURN, amount }]);
export const transfer = (db: Sql, ctx: TickCtx, key: string, from: string, to: string, amount: number, kind: Exclude<LedgerKind, 'issuance' | 'sink' | 'sink_fee'>, memo: string) => post(db, ctx, key, kind, memo, [{ account: from, amount: -amount }, { account: to, amount }]);

export function createAccount(db: Sql, id: string, kind: 'player' | 'company' | 'state_treasury' | 'households' | 'issuance' | 'destroyed', label: string) {
  db.run('INSERT OR IGNORE INTO accounts (id, kind, label) VALUES (?,?,?)', id, kind, label);
}

export const balance = (db: Sql, account: string): number => db.get<{ b: number }>('SELECT balance_minor b FROM accounts WHERE id = ?', account)?.b ?? 0;
export const available = (db: Sql, account: string): number => { const r = db.get<{ b: number; r: number }>('SELECT balance_minor b, reserved_minor r FROM accounts WHERE id = ?', account); return r ? r.b - r.r : 0; };

/** Buyer fund reservation: earmarks coins on an account so they cannot be spent elsewhere until released or settled. */
export function reserveFunds(db: Sql, account: string, amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new LedgerError('INVALID_AMOUNT', 'Reservation must be a positive integer');
  if (available(db, account) < amount) throw new LedgerError('INSUFFICIENT_FUNDS', `${account} cannot reserve ${amount}`);
  db.run('UPDATE accounts SET reserved_minor = reserved_minor + ? WHERE id = ?', amount, account);
}
export function releaseFunds(db: Sql, account: string, amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new LedgerError('INVALID_AMOUNT', 'Release must be a non-negative integer');
  if (amount === 0) return;
  const r = db.get<{ r: number }>('SELECT reserved_minor r FROM accounts WHERE id = ?', account);
  if (!r || r.r < amount) throw new LedgerError('FORBIDDEN', `${account} has less reserved than ${amount}`);
  db.run('UPDATE accounts SET reserved_minor = reserved_minor - ? WHERE id = ?', amount, account);
}

export interface SupplyStats { issued: number; destroyed: number; circulating: number }
export function supply(db: Sql): SupplyStats {
  const issued = -balance(db, ISSUANCE), destroyed = balance(db, BURN);
  const circulating = db.get<{ s: number }>("SELECT COALESCE(SUM(balance_minor),0) s FROM accounts WHERE kind NOT IN ('issuance','destroyed')")!.s;
  return { issued, destroyed, circulating };
}

export interface Reconciliation { ok: boolean; problems: string[]; checked: { transactions: number; accounts: number } }
/** Re-derives everything from the immutable log and compares to the materialised columns. Any problem is a bug or tampering. */
export function reconcile(db: Sql): Reconciliation {
  const problems: string[] = [];
  const unbalanced = db.all<{ tx_id: number; s: number }>('SELECT tx_id, SUM(amount_minor) s FROM ledger_postings GROUP BY tx_id HAVING s <> 0');
  for (const u of unbalanced) problems.push(`transaction ${u.tx_id} does not sum to zero (${u.s})`);
  const orphans = db.get<{ n: number }>('SELECT COUNT(*) n FROM ledger_transactions t WHERE NOT EXISTS (SELECT 1 FROM ledger_postings p WHERE p.tx_id = t.id)')!.n;
  if (orphans) problems.push(`${orphans} ledger transactions have no postings`);
  for (const a of db.all<{ id: string; balance_minor: number; derived: number }>('SELECT a.id, a.balance_minor, COALESCE((SELECT SUM(amount_minor) FROM ledger_postings p WHERE p.account_id = a.id),0) derived FROM accounts a')) {
    if (a.balance_minor !== a.derived) problems.push(`account ${a.id} balance ${a.balance_minor} != ledger ${a.derived}`);
  }
  const total = db.get<{ s: number }>('SELECT COALESCE(SUM(balance_minor),0) s FROM accounts')!.s;
  if (total !== 0) problems.push(`sum of all accounts is ${total}, expected 0 (coins created or lost outside issue/destroy)`);
  const s = supply(db);
  if (s.circulating !== s.issued - s.destroyed) problems.push(`circulating ${s.circulating} != issued ${s.issued} - destroyed ${s.destroyed}`);
  for (const r of db.all<{ id: string; reserved: number; held: number }>("SELECT a.id, a.reserved_minor reserved, COALESCE((SELECT SUM(o.reserved_funds_minor) FROM orders o JOIN companies c ON c.id = o.company_id WHERE c.treasury_account_id = a.id AND o.status = 'open' AND o.side = 'buy'),0) + COALESCE((SELECT SUM(so.reserved_funds_minor) FROM share_orders so JOIN investors i ON i.id = so.investor_id WHERE i.account_id = a.id AND so.status = 'open' AND so.side = 'buy'),0) + COALESCE((SELECT SUM(d.total_minor - d.paid_minor) FROM dividends d JOIN companies c2 ON c2.id = d.company_id WHERE c2.treasury_account_id = a.id AND d.status = 'declared'),0) held FROM accounts a WHERE a.reserved_minor <> 0 OR EXISTS (SELECT 1 FROM orders o JOIN companies c ON c.id = o.company_id WHERE c.treasury_account_id = a.id AND o.status='open' AND o.side='buy')")) {
    if (r.reserved !== r.held) problems.push(`account ${r.id} reserved ${r.reserved} != open buy orders, share orders and declared dividends ${r.held}`);
  }
  for (const i of db.all<{ company_id: string; commodity_id: string; qty: number; moved: number }>('SELECT i.company_id, i.commodity_id, i.qty, COALESCE((SELECT SUM(delta) FROM inventory_movements m WHERE m.company_id = i.company_id AND m.commodity_id = i.commodity_id),0) moved FROM inventory i')) {
    if (i.qty !== i.moved) problems.push(`inventory ${i.company_id}/${i.commodity_id} qty ${i.qty} != movement log ${i.moved}`);
  }
  for (const i of db.all<{ company_id: string; commodity_id: string; reserved: number; open: number }>("SELECT i.company_id, i.commodity_id, i.reserved, COALESCE((SELECT SUM(qty_remaining) FROM orders o WHERE o.company_id = i.company_id AND o.commodity_id = i.commodity_id AND o.side='sell' AND o.status='open'),0) open FROM inventory i")) {
    if (i.reserved !== i.open) problems.push(`inventory ${i.company_id}/${i.commodity_id} reserved ${i.reserved} != open sell orders ${i.open}`);
  }
  const txs = db.get<{ n: number }>('SELECT COUNT(*) n FROM ledger_transactions')!.n;
  const accts = db.get<{ n: number }>('SELECT COUNT(*) n FROM accounts')!.n;
  return { ok: problems.length === 0, problems, checked: { transactions: txs, accounts: accts } };
}
