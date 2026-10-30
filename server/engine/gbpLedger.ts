import type { Sql } from '../db/sql';

/**
 * GBP_TEST: the SIMULATED pound ledger. A separate, immutable double-entry book in integer pence. It shares no table, account or code path with Empire Coins, and no function
 * here converts between the two. Debit is positive and credit negative; every transaction sums to zero. Cash and clearing are assets (never overdrawn); wallet balances are
 * liabilities owed to players (a credit balance that can never be overspent); revenue, expense and equity complete the books so deposits are never mistaken for revenue.
 * History is never edited: a mistake or a failed payout is undone by a REVERSAL transaction that references the original.
 */
export type GbpKind = 'deposit' | 'deposit_fee' | 'withdrawal_reserve' | 'withdrawal_release' | 'payout_start' | 'payout_settle' | 'reward' | 'prize_allocation' | 'treasury_funding' | 'premium_payment' | 'cosmetic_payment' | 'ad_revenue' | 'operating_expense' | 'reversal';
export interface GbpCtx { tick: number; ms: number; actor: string }
export interface GbpPosting { account: string; amount: number }
export class GbpError extends Error { constructor(public readonly code: 'INSUFFICIENT_FUNDS' | 'UNBALANCED' | 'INVALID_AMOUNT' | 'UNKNOWN_ACCOUNT' | 'IDEMPOTENCY_MISMATCH' | 'FORBIDDEN' | 'INVALID_STATE' | 'LIMIT', message: string) { super(message); this.name = 'GbpError'; } }

export const CASH = 'gbp:cash', CLEARING = 'gbp:payout_clearing';
export const REV = { advertising: 'gbp:rev:advertising', premium: 'gbp:rev:premium', cosmetic: 'gbp:rev:cosmetic' } as const;
export const EXP = { fees: 'gbp:exp:payment_fees', hosting: 'gbp:exp:hosting', rewards: 'gbp:exp:rewards' } as const;
export const PAYABLE = 'gbp:payable:processor';
export const EQUITY = 'gbp:equity:owner', PRIZE_RESERVE = 'gbp:equity:prize_reserve';
export const walletAcct = (p: string) => `gbp:wallet:${p}`;
export const pendingAcct = (p: string) => `gbp:pending:${p}`;
const isPence = (n: number) => Number.isSafeInteger(n) && n !== 0;

/** Creates the chart of accounts (idempotent). */
export function ensureGbpBooks(db: Sql) {
  const add = (id: string, kind: string, label: string, owner: string | null = null) => db.run('INSERT OR IGNORE INTO gbp_accounts (id, kind, label, owner_id) VALUES (?,?,?,?)', id, kind, label, owner);
  add(CASH, 'asset', 'Cash held (simulated)'); add(CLEARING, 'asset', 'Payout clearing (simulated)');
  add(REV.advertising, 'revenue', 'Advertising revenue (simulated)'); add(REV.premium, 'revenue', 'Premium membership revenue (simulated)'); add(REV.cosmetic, 'revenue', 'Cosmetic revenue (simulated)');
  add(EXP.fees, 'expense', 'Payment processing fees'); add(EXP.hosting, 'expense', 'Hosting and operations'); add(EXP.rewards, 'expense', 'Rewards paid');
  add(PAYABLE, 'liability', 'Owed to the payment processor (fees)');
  add(EQUITY, 'equity', 'Owner funding and retained earnings'); add(PRIZE_RESERVE, 'equity', 'Reserved prize funds (restricted)');
}
export function ensureWallet(db: Sql, playerId: string) {
  db.run('INSERT OR IGNORE INTO gbp_accounts (id, kind, label, owner_id) VALUES (?,?,?,?)', walletAcct(playerId), 'liability', `Wallet of ${playerId} (GBP_TEST)`, playerId);
  db.run('INSERT OR IGNORE INTO gbp_accounts (id, kind, label, owner_id) VALUES (?,?,?,?)', pendingAcct(playerId), 'liability', `Pending withdrawals of ${playerId} (GBP_TEST)`, playerId);
}

export interface GbpPostResult { txId: number; duplicate: boolean }
/** The only function that moves simulated pounds: atomic, balanced, idempotent, and unable to overdraw cash or overspend a wallet. */
export function postGbp(db: Sql, ctx: GbpCtx, key: string, kind: GbpKind, memo: string, postings: GbpPosting[], ref: string | null = null, reverses: number | null = null): GbpPostResult {
  return db.transaction(() => {
    const merged = new Map<string, number>();
    for (const p of postings) { if (!isPence(p.amount)) throw new GbpError('INVALID_AMOUNT', `Posting must be a non-zero whole number of pence (${p.account}: ${p.amount})`); merged.set(p.account, (merged.get(p.account) ?? 0) + p.amount); }
    const lines = [...merged].filter(([, a]) => a !== 0).sort(([a], [b]) => (a < b ? -1 : 1));
    const existing = db.get<{ id: number; kind: string }>('SELECT id, kind FROM gbp_transactions WHERE idempotency_key = ?', key);
    if (existing) {
      const prior = db.all<{ account_id: string; amount_pence: number }>('SELECT account_id, amount_pence FROM gbp_postings WHERE tx_id = ? ORDER BY account_id', existing.id);
      const same = existing.kind === kind && prior.length === lines.length && prior.every((p, i) => p.account_id === lines[i]![0] && p.amount_pence === lines[i]![1]);
      if (!same) throw new GbpError('IDEMPOTENCY_MISMATCH', `Key ${key} was already used for a different transaction`);
      return { txId: existing.id, duplicate: true };
    }
    if (lines.length < 2) throw new GbpError('UNBALANCED', 'A transaction needs at least two postings');
    if (lines.reduce((a, [, n]) => a + n, 0) !== 0) throw new GbpError('UNBALANCED', `Postings do not sum to zero for ${key}`);
    for (const [acct, amount] of lines) {
      const row = db.get<{ kind: string; balance_pence: number }>('SELECT kind, balance_pence FROM gbp_accounts WHERE id = ?', acct);
      if (!row) throw new GbpError('UNKNOWN_ACCOUNT', `Unknown account ${acct}`);
      const next = row.balance_pence + amount;
      if (row.kind === 'asset' && next < 0) throw new GbpError('INSUFFICIENT_FUNDS', `${acct} cannot go below zero`);
      if (row.kind === 'liability' && next > 0) throw new GbpError('INSUFFICIENT_FUNDS', `${acct} has only ${-row.balance_pence} pence available`);
    }
    const tx = db.run('INSERT INTO gbp_transactions (idempotency_key, kind, status, memo, actor, tick, created_ms, reverses_tx, ref) VALUES (?,?,?,?,?,?,?,?,?)', key, kind, 'posted', memo, ctx.actor, ctx.tick, ctx.ms, reverses, ref);
    for (const [acct, amount] of lines) { db.run('INSERT INTO gbp_postings (tx_id, account_id, amount_pence) VALUES (?,?,?)', tx.lastInsertRowid, acct, amount); db.run('UPDATE gbp_accounts SET balance_pence = balance_pence + ? WHERE id = ?', amount, acct); }
    return { txId: Number(tx.lastInsertRowid), duplicate: false };
  });
}

/** Undoes a posted transaction with equal and opposite postings (never by deleting). A transaction can be reversed once, and a reversal cannot itself be reversed. */
export function reverseGbp(db: Sql, ctx: GbpCtx, key: string, originalTxId: number, memo: string): GbpPostResult {
  return db.transaction(() => {
    const dup = db.get<{ id: number }>('SELECT id FROM gbp_transactions WHERE idempotency_key = ?', key); if (dup) return { txId: dup.id, duplicate: true };
    const o = db.get<{ status: string; kind: string; reverses_tx: number | null }>('SELECT status, kind, reverses_tx FROM gbp_transactions WHERE id = ?', originalTxId);
    if (!o) throw new GbpError('INVALID_STATE', 'No such transaction to reverse');
    if (o.status === 'reversed') throw new GbpError('INVALID_STATE', 'This transaction was already reversed');
    if (o.reverses_tx !== null) throw new GbpError('INVALID_STATE', 'A reversal cannot be reversed');
    const lines = db.all<{ account_id: string; amount_pence: number }>('SELECT account_id, amount_pence FROM gbp_postings WHERE tx_id = ?', originalTxId);
    const r = postGbp(db, ctx, key, 'reversal', memo, lines.map((l) => ({ account: l.account_id, amount: -l.amount_pence })), null, originalTxId);
    db.run("UPDATE gbp_transactions SET status = 'reversed' WHERE id = ?", originalTxId);
    return r;
  });
}

export const balanceOf = (db: Sql, account: string) => db.get<{ b: number }>('SELECT balance_pence b FROM gbp_accounts WHERE id = ?', account)?.b ?? 0;
export const availablePence = (db: Sql, playerId: string) => 0 - balanceOf(db, walletAcct(playerId));
export const pendingPence = (db: Sql, playerId: string) => 0 - balanceOf(db, pendingAcct(playerId));

export function audit(db: Sql, ms: number, actor: string, action: string, subject: string | null, detail: unknown, ok = true) {
  db.run('INSERT INTO gbp_audit (ms, actor, action, subject, detail_json, ok) VALUES (?,?,?,?,?,?)', ms, actor, action, subject, JSON.stringify(detail), ok ? 1 : 0);
}

export interface GbpReconciliation { ok: boolean; problems: string[]; totals: { cash: number; clearing: number; walletLiabilities: number; pendingLiabilities: number; revenue: number; expenses: number; equity: number }; transactions: number }
/** Every invariant the book must satisfy: postings sum to zero, cached balances equal the posting sums, solvency, and every deposit/withdrawal record ties to its transactions. */
export function reconcileGbp(db: Sql): GbpReconciliation {
  const problems: string[] = [];
  const sum = db.get<{ s: number }>('SELECT COALESCE(SUM(amount_pence),0) s FROM gbp_postings')!.s; if (sum !== 0) problems.push(`postings sum to ${sum}, not zero`);
  for (const t of db.all<{ id: number; s: number }>('SELECT tx_id id, SUM(amount_pence) s FROM gbp_postings GROUP BY tx_id HAVING s <> 0')) problems.push(`transaction ${t.id} is unbalanced (${t.s})`);
  for (const a of db.all<{ id: string; balance_pence: number; s: number }>('SELECT a.id, a.balance_pence, COALESCE((SELECT SUM(amount_pence) FROM gbp_postings p WHERE p.account_id = a.id),0) s FROM gbp_accounts a')) if (a.balance_pence !== a.s) problems.push(`${a.id}: balance ${a.balance_pence} ≠ postings ${a.s}`);
  const by = (kind: string) => db.get<{ s: number }>('SELECT COALESCE(SUM(balance_pence),0) s FROM gbp_accounts WHERE kind = ?', kind)!.s;
  const wallet = 0 - db.get<{ s: number }>("SELECT COALESCE(SUM(balance_pence),0) s FROM gbp_accounts WHERE id LIKE 'gbp:wallet:%'")!.s, pending = 0 - db.get<{ s: number }>("SELECT COALESCE(SUM(balance_pence),0) s FROM gbp_accounts WHERE id LIKE 'gbp:pending:%'")!.s;
  const cash = balanceOf(db, CASH), clearing = balanceOf(db, CLEARING);
  if (cash + clearing < wallet + pending) problems.push(`insolvent: cash+clearing ${cash + clearing} < player liabilities ${wallet + pending}`);
  const dep = db.get<{ s: number }>("SELECT COALESCE(SUM(amount_pence),0) s FROM gbp_deposits WHERE status = 'succeeded'")!.s;
  const depLedger = db.get<{ s: number }>("SELECT COALESCE(SUM(p.amount_pence),0) s FROM gbp_postings p JOIN gbp_transactions t ON t.id = p.tx_id WHERE t.kind = 'deposit' AND p.account_id = ? AND t.status = 'posted'", CASH)!.s;
  if (dep !== depLedger) problems.push(`succeeded deposits ${dep} ≠ deposit transactions ${depLedger}`);
  const wd = db.get<{ s: number }>("SELECT COALESCE(SUM(amount_pence),0) s FROM gbp_withdrawals WHERE status = 'paid'")!.s;
  const wdLedger = db.get<{ s: number }>("SELECT COALESCE(-SUM(p.amount_pence),0) s FROM gbp_postings p JOIN gbp_transactions t ON t.id = p.tx_id WHERE t.kind = 'payout_settle' AND p.account_id = ? AND t.status = 'posted'", CLEARING)!.s;
  if (wd !== wdLedger) problems.push(`paid withdrawals ${wd} ≠ settled payouts ${wdLedger}`);
  const open = db.get<{ s: number }>("SELECT COALESCE(SUM(amount_pence),0) s FROM gbp_withdrawals WHERE status IN ('requested','approved')")!.s;
  if (open !== pending) problems.push(`open withdrawals ${open} ≠ pending liabilities ${pending}`);
  for (const r of db.all<{ id: number }>("SELECT r.id FROM gbp_transactions r WHERE r.reverses_tx IS NOT NULL AND (SELECT status FROM gbp_transactions o WHERE o.id = r.reverses_tx) <> 'reversed'")) problems.push(`reversal ${r.id} points at a transaction not marked reversed`);
  return { ok: problems.length === 0, problems, totals: { cash, clearing, walletLiabilities: wallet, pendingLiabilities: pending, revenue: 0 - by('revenue'), expenses: by('expense'), equity: 0 - by('equity') }, transactions: db.get<{ n: number }>('SELECT COUNT(*) n FROM gbp_transactions')!.n };
}
