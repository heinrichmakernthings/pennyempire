import type { Sql } from '../db/sql';
import { CASH, CLEARING, EQUITY, EXP, PAYABLE, GbpError, PRIZE_RESERVE, audit, availablePence, ensureWallet, pendingAcct, pendingPence, postGbp, reverseGbp, walletAcct, type GbpCtx } from './gbpLedger';

/**
 * The player's SIMULATED GBP_TEST wallet. Deposits and payouts go through MOCK providers only (no card fields, no bank details, no network): the provider is a local sandbox
 * that the developer drives with events (success, failure, cancellation, duplicate webhook). Every state change is a ledger transaction; the wallet's "available" and
 * "pending" figures are derived from the ledger, never stored separately.
 */
export const GBP_RULES = { minDepositPence: 50, maxDepositPence: 50_000, minWithdrawalPence: 500, maxOpenWithdrawals: 3, depositFeeFixedPence: 20, depositFeeBps: 140 } as const;
export const DEPOSIT_PRESETS = [50, 100, 200, 500, 1_000];
const feeFor = (amount: number) => GBP_RULES.depositFeeFixedPence + Math.round((amount * GBP_RULES.depositFeeBps) / 10_000);   // an ASSUMPTION used by the commercial model, recorded as an expense

const seq = (db: Sql, table: string) => db.get<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`)!.n + 1;

/* ───────── deposits ───────── */
export function createDeposit(db: Sql, ctx: GbpCtx, a: { playerId: string; amountPence: number; key: string }): { depositId: string; duplicate: boolean } {
  return db.transaction(() => {
    const dup = db.get<{ id: string; amount_pence: number; player_id: string }>('SELECT id, amount_pence, player_id FROM gbp_deposits WHERE idempotency_key = ?', a.key);
    if (dup) { if (dup.amount_pence !== a.amountPence || dup.player_id !== a.playerId) throw new GbpError('IDEMPOTENCY_MISMATCH', 'That key was used for a different deposit'); return { depositId: dup.id, duplicate: true }; }
    if (!Number.isSafeInteger(a.amountPence) || a.amountPence < GBP_RULES.minDepositPence || a.amountPence > GBP_RULES.maxDepositPence) throw new GbpError('INVALID_AMOUNT', `A simulated deposit is between £${GBP_RULES.minDepositPence / 100} and £${GBP_RULES.maxDepositPence / 100}.`);
    ensureWallet(db, a.playerId);
    const n = seq(db, 'gbp_deposits'), id = `dep-${n}`;
    db.run("INSERT INTO gbp_deposits (id, player_id, amount_pence, status, provider, provider_ref, idempotency_key, created_ms) VALUES (?,?,?,'pending','mock-sandbox',?,?,?)", id, a.playerId, a.amountPence, `mock_pay_${n}`, a.key, ctx.ms);
    audit(db, ctx.ms, ctx.actor, 'deposit.created', id, { amountPence: a.amountPence });
    return { depositId: id, duplicate: false };
  });
}

export type DepositOutcome = 'succeeded' | 'failed' | 'cancelled';
export interface ProviderEvent { eventId: string; kind: 'deposit.succeeded' | 'deposit.failed' | 'deposit.cancelled'; depositId: string; reason?: string }
/** Webhook entry point. Idempotent by provider event id: a duplicate delivery changes nothing. A deposit can only leave `pending` once. */
export function handleDepositEvent(db: Sql, ctx: GbpCtx, e: ProviderEvent): { outcome: 'applied' | 'duplicate_ignored' | 'ignored_state' } {
  return db.transaction(() => {
    if (db.get('SELECT 1 FROM gbp_provider_events WHERE provider_event_id = ?', e.eventId)) { audit(db, ctx.ms, ctx.actor, 'provider.duplicate_event', e.depositId, { eventId: e.eventId }); return { outcome: 'duplicate_ignored' as const }; }
    const d = db.get<{ id: string; player_id: string; amount_pence: number; status: string }>('SELECT id, player_id, amount_pence, status FROM gbp_deposits WHERE id = ?', e.depositId);
    if (!d) throw new GbpError('INVALID_STATE', 'Unknown deposit');
    const record = (outcome: string) => db.run('INSERT INTO gbp_provider_events (provider_event_id, provider, kind, subject_id, received_ms, outcome) VALUES (?,?,?,?,?,?)', e.eventId, 'mock-sandbox', e.kind, d.id, ctx.ms, outcome);
    if (d.status !== 'pending') { record('ignored_state'); audit(db, ctx.ms, ctx.actor, 'provider.late_event', d.id, { status: d.status, kind: e.kind }); return { outcome: 'ignored_state' as const }; }
    if (e.kind === 'deposit.succeeded') {
      const tx = postGbp(db, ctx, `dep:${d.id}:credit`, 'deposit', `Simulated deposit ${d.id}`, [{ account: CASH, amount: d.amount_pence }, { account: walletAcct(d.player_id), amount: -d.amount_pence }], d.id);
      const fee = feeFor(d.amount_pence);
      postGbp(db, ctx, `dep:${d.id}:fee`, 'deposit_fee', `Simulated processing fee on ${d.id}`, [{ account: EXP.fees, amount: fee }, { account: PAYABLE, amount: -fee }], d.id);   // owed to the processor by the BUSINESS: it must never be taken out of player funds
      db.run("UPDATE gbp_deposits SET status = 'succeeded', ledger_tx_id = ?, fee_pence = ?, settled_ms = ? WHERE id = ?", tx.txId, fee, ctx.ms, d.id);
    } else db.run('UPDATE gbp_deposits SET status = ?, failure_reason = ?, settled_ms = ? WHERE id = ?', e.kind === 'deposit.failed' ? 'failed' : 'cancelled', e.reason ?? null, ctx.ms, d.id);
    record('applied'); audit(db, ctx.ms, ctx.actor, `deposit.${e.kind.split('.')[1]}`, d.id, { eventId: e.eventId });
    return { outcome: 'applied' as const };
  });
}
/** The local sandbox provider: derives a deterministic event id from the deposit and outcome, so replaying the same scenario is a duplicate webhook. */
export const sandboxEvent = (depositId: string, outcome: DepositOutcome, reason?: string): ProviderEvent => ({ eventId: `evt_${depositId}_${outcome}`, kind: `deposit.${outcome}` as ProviderEvent['kind'], depositId, reason });

/* ───────── withdrawals ───────── */
export function requestWithdrawal(db: Sql, ctx: GbpCtx, a: { playerId: string; amountPence: number; key: string }): { withdrawalId: string; duplicate: boolean } {
  return db.transaction(() => {
    const dup = db.get<{ id: string; amount_pence: number; player_id: string }>('SELECT id, amount_pence, player_id FROM gbp_withdrawals WHERE idempotency_key = ?', a.key);
    if (dup) { if (dup.amount_pence !== a.amountPence || dup.player_id !== a.playerId) throw new GbpError('IDEMPOTENCY_MISMATCH', 'That key was used for a different withdrawal'); return { withdrawalId: dup.id, duplicate: true }; }
    if (!Number.isSafeInteger(a.amountPence) || a.amountPence < GBP_RULES.minWithdrawalPence) throw new GbpError('INVALID_AMOUNT', `The minimum cash-out is £${GBP_RULES.minWithdrawalPence / 100}.00 (simulated).`);
    ensureWallet(db, a.playerId);
    if (db.get<{ n: number }>("SELECT COUNT(*) n FROM gbp_withdrawals WHERE player_id = ? AND status IN ('requested','approved')", a.playerId)!.n >= GBP_RULES.maxOpenWithdrawals) throw new GbpError('LIMIT', `You can have at most ${GBP_RULES.maxOpenWithdrawals} withdrawals in progress.`);
    if (availablePence(db, a.playerId) < a.amountPence) throw new GbpError('INSUFFICIENT_FUNDS', `Your available balance is £${(availablePence(db, a.playerId) / 100).toFixed(2)}.`);
    const id = `wd-${seq(db, 'gbp_withdrawals')}`;
    // the reservation is a real transfer wallet → pending: the funds can no longer be spent, and a second request sees the reduced balance
    const tx = postGbp(db, ctx, `wd:${id}:reserve`, 'withdrawal_reserve', `Reserve for withdrawal ${id}`, [{ account: walletAcct(a.playerId), amount: a.amountPence }, { account: pendingAcct(a.playerId), amount: -a.amountPence }], id);
    db.run("INSERT INTO gbp_withdrawals (id, player_id, amount_pence, status, idempotency_key, reserve_tx_id, created_ms, updated_ms) VALUES (?,?,?,'requested',?,?,?,?)", id, a.playerId, a.amountPence, a.key, tx.txId, ctx.ms, ctx.ms);
    audit(db, ctx.ms, ctx.actor, 'withdrawal.requested', id, { amountPence: a.amountPence });
    return { withdrawalId: id, duplicate: false };
  });
}
type Wd = { id: string; player_id: string; amount_pence: number; status: string; reserve_tx_id: number; final_tx_id: number | null };
const wd = (db: Sql, id: string) => { const w = db.get<Wd>('SELECT * FROM gbp_withdrawals WHERE id = ?', id); if (!w) throw new GbpError('INVALID_STATE', 'Unknown withdrawal'); return w; };
const setWd = (db: Sql, ctx: GbpCtx, id: string, status: string, extra: Partial<{ final_tx_id: number; payout_ref: string; reason: string }> = {}) =>
  db.run('UPDATE gbp_withdrawals SET status = ?, updated_ms = ?, final_tx_id = COALESCE(?, final_tx_id), payout_ref = COALESCE(?, payout_ref), reason = COALESCE(?, reason) WHERE id = ?', status, ctx.ms, extra.final_tx_id ?? null, extra.payout_ref ?? null, extra.reason ?? null, id);

/** The player may cancel while the request has not been approved: the reservation is reversed. */
export function cancelWithdrawal(db: Sql, ctx: GbpCtx, playerId: string, id: string) {
  return db.transaction(() => {
    const w = wd(db, id); if (w.player_id !== playerId) throw new GbpError('FORBIDDEN', 'That is not your withdrawal.');
    if (w.status === 'cancelled') return { duplicate: true };
    if (w.status !== 'requested') throw new GbpError('INVALID_STATE', `A ${w.status} withdrawal can no longer be cancelled.`);
    const r = reverseGbp(db, ctx, `wd:${id}:release`, w.reserve_tx_id, `Withdrawal ${id} cancelled by the player`); setWd(db, ctx, id, 'cancelled', { final_tx_id: r.txId, reason: 'cancelled by player' });
    audit(db, ctx.ms, ctx.actor, 'withdrawal.cancelled', id, {}); return { duplicate: false };
  });
}
/** Treasury actions (admin only at the API layer). Approval moves the cash into payout clearing; it fails if the treasury cannot cover it. */
export function approveWithdrawal(db: Sql, ctx: GbpCtx, id: string) {
  return db.transaction(() => {
    const w = wd(db, id); if (w.status === 'approved') return { duplicate: true };
    if (w.status !== 'requested') throw new GbpError('INVALID_STATE', `Cannot approve a ${w.status} withdrawal.`);
    postGbp(db, ctx, `wd:${id}:start`, 'payout_start', `Payout of ${id} sent to the mock provider`, [{ account: CLEARING, amount: w.amount_pence }, { account: CASH, amount: -w.amount_pence }], id);   // fails (INSUFFICIENT_FUNDS) if cash is short
    setWd(db, ctx, id, 'approved', { payout_ref: `mock_payout_${id}` }); audit(db, ctx.ms, ctx.actor, 'withdrawal.approved', id, {}); return { duplicate: false };
  });
}
export function rejectWithdrawal(db: Sql, ctx: GbpCtx, id: string, reason: string) {
  return db.transaction(() => {
    const w = wd(db, id); if (w.status === 'rejected') return { duplicate: true };
    if (w.status !== 'requested') throw new GbpError('INVALID_STATE', `Cannot reject a ${w.status} withdrawal.`);
    const r = reverseGbp(db, ctx, `wd:${id}:release`, w.reserve_tx_id, `Withdrawal ${id} rejected: ${reason}`); setWd(db, ctx, id, 'rejected', { final_tx_id: r.txId, reason }); audit(db, ctx.ms, ctx.actor, 'withdrawal.rejected', id, { reason }); return { duplicate: false };
  });
}
/** Payout provider outcome for an approved withdrawal, idempotent by provider event id. */
export function settleWithdrawal(db: Sql, ctx: GbpCtx, id: string, outcome: 'paid' | 'failed', eventId: string, reason = 'payout failed'): { outcome: 'applied' | 'duplicate_ignored' } {
  return db.transaction(() => {
    if (db.get('SELECT 1 FROM gbp_provider_events WHERE provider_event_id = ?', eventId)) { audit(db, ctx.ms, ctx.actor, 'provider.duplicate_event', id, { eventId }); return { outcome: 'duplicate_ignored' as const }; }
    const w = wd(db, id); if (w.status !== 'approved') throw new GbpError('INVALID_STATE', `Only an approved withdrawal can settle (this one is ${w.status}).`);
    db.run('INSERT INTO gbp_provider_events (provider_event_id, provider, kind, subject_id, received_ms, outcome) VALUES (?,?,?,?,?,?)', eventId, 'mock-sandbox', `payout.${outcome}`, id, ctx.ms, 'applied');
    if (outcome === 'paid') {
      const tx = postGbp(db, ctx, `wd:${id}:settle`, 'payout_settle', `Payout ${id} settled (simulated)`, [{ account: pendingAcct(w.player_id), amount: w.amount_pence }, { account: CLEARING, amount: -w.amount_pence }], id);
      setWd(db, ctx, id, 'paid', { final_tx_id: tx.txId });
    } else {
      const start = db.get<{ id: number }>('SELECT id FROM gbp_transactions WHERE idempotency_key = ?', `wd:${id}:start`)!.id;
      reverseGbp(db, ctx, `wd:${id}:unstart`, start, `Payout ${id} failed: cash returned`);
      const r = reverseGbp(db, ctx, `wd:${id}:release`, w.reserve_tx_id, `Payout ${id} failed: funds returned to the wallet`);
      setWd(db, ctx, id, 'failed', { final_tx_id: r.txId, reason });
    }
    audit(db, ctx.ms, ctx.actor, `withdrawal.${outcome}`, id, { eventId }); return { outcome: 'applied' as const };
  });
}

/* ───────── funding, rewards, payments (used by the treasury, rewards and membership modules) ───────── */
/** Developer-funded simulated treasury: cash in, owner equity up. Not revenue. */
export function fundTreasury(db: Sql, ctx: GbpCtx, key: string, amountPence: number, memo: string) {
  return postGbp(db, ctx, key, 'treasury_funding', memo, [{ account: CASH, amount: amountPence }, { account: EQUITY, amount: -amountPence }]);
}
/** Earmarks equity for prizes: a reclassification inside equity, no cash moves. The reserve is restricted: only reward payouts may draw on it. */
export function allocatePrizeReserve(db: Sql, ctx: GbpCtx, key: string, amountPence: number, memo: string) {
  return postGbp(db, ctx, key, 'prize_allocation', memo, [{ account: EQUITY, amount: amountPence }, { account: PRIZE_RESERVE, amount: -amountPence }]);
}
export const prizeReservePence = (db: Sql) => 0 - (db.get<{ b: number }>('SELECT balance_pence b FROM gbp_accounts WHERE id = ?', PRIZE_RESERVE)?.b ?? 0);
/** Cash the business may use: cash held minus everything owed to players. Processor fees and payouts of business money are limited to this. */
export const freeCashPence = (db: Sql) => cashPence(db) - (0 - (db.get<{ s: number }>("SELECT COALESCE(SUM(balance_pence),0) s FROM gbp_accounts WHERE id LIKE 'gbp:wallet:%' OR id LIKE 'gbp:pending:%'")!.s)) + 0;
/** Pays the processor what the business owes it, from the business's own cash only. */
export function settleProcessorFees(db: Sql, ctx: GbpCtx, key: string, amountPence: number) {
  if (amountPence > freeCashPence(db)) throw new GbpError('INSUFFICIENT_FUNDS', 'The business does not have enough of its own cash to pay the processor (player funds are never used).');
  return postGbp(db, ctx, key, 'operating_expense', 'Payment processor fees settled', [{ account: PAYABLE, amount: amountPence }, { account: CASH, amount: -amountPence }]);
}
export const cashPence = (db: Sql) => db.get<{ b: number }>('SELECT balance_pence b FROM gbp_accounts WHERE id = ?', CASH)?.b ?? 0;

/* ───────── views ───────── */
export interface WalletView { playerId: string; availablePence: number; pendingPence: number; minWithdrawalPence: number; mode: 'SIMULATED'; currency: 'GBP_TEST'; deposits: Record<string, unknown>[]; withdrawals: Record<string, unknown>[]; transactions: { id: number; kind: string; memo: string; amountPence: number; status: string; ms: number; ref: string | null; balanceAfterPence: number }[]; rewards: { id: number; program: string; source: string; amountPence: number; ms: number }[]; statement: { depositedPence: number; withdrawnPence: number; rewardsPence: number; premiumPaidPence: number; feesPence: number } }
export function walletView(db: Sql, playerId: string): WalletView {
  ensureWallet(db, playerId);
  const rows = db.all<{ id: number; kind: string; memo: string; status: string; created_ms: number; ref: string | null; amount: number }>("SELECT t.id, t.kind, t.memo, t.status, t.created_ms, t.ref, p.amount_pence amount FROM gbp_transactions t JOIN gbp_postings p ON p.tx_id = t.id WHERE p.account_id = ? ORDER BY t.id", walletAcct(playerId));
  let running = 0; const tx = rows.map((r) => { running += -r.amount; return { id: r.id, kind: r.kind, memo: r.memo, amountPence: -r.amount, status: r.status, ms: r.created_ms, ref: r.ref, balanceAfterPence: running }; }).reverse();
  const sum = (kind: string) => db.get<{ s: number }>("SELECT COALESCE(SUM(-p.amount_pence),0) s FROM gbp_postings p JOIN gbp_transactions t ON t.id = p.tx_id WHERE p.account_id = ? AND t.kind = ? AND t.status = 'posted'", walletAcct(playerId), kind)!.s;
  return {
    playerId, availablePence: availablePence(db, playerId), pendingPence: pendingPence(db, playerId), minWithdrawalPence: GBP_RULES.minWithdrawalPence, mode: 'SIMULATED', currency: 'GBP_TEST',
    deposits: db.all('SELECT id, amount_pence amountPence, status, provider, fee_pence feePence, failure_reason failureReason, created_ms createdMs, settled_ms settledMs FROM gbp_deposits WHERE player_id = ? ORDER BY created_ms DESC, id DESC LIMIT 30', playerId),
    withdrawals: db.all('SELECT id, amount_pence amountPence, status, reason, created_ms createdMs, updated_ms updatedMs FROM gbp_withdrawals WHERE player_id = ? ORDER BY created_ms DESC, id DESC LIMIT 30', playerId),
    transactions: tx.slice(0, 80),
    rewards: db.all<{ id: number; program: string; source: string; amountPence: number; ms: number }>('SELECT a.id, r.name program, r.source, a.amount_pence amountPence, a.issued_ms ms FROM reward_awards a JOIN reward_programs r ON r.id = a.program_id WHERE a.player_id = ? ORDER BY a.id DESC LIMIT 30', playerId),
    statement: { depositedPence: sum('deposit'), withdrawnPence: db.get<{ s: number }>("SELECT COALESCE(SUM(amount_pence),0) s FROM gbp_withdrawals WHERE player_id = ? AND status = 'paid'", playerId)!.s, rewardsPence: sum('reward'), premiumPaidPence: db.get<{ s: number }>("SELECT COALESCE(SUM(amount_pence),0) s FROM membership_payments WHERE owner_id = ? AND status = 'paid'", playerId)!.s, feesPence: db.get<{ s: number }>("SELECT COALESCE(SUM(fee_pence),0) s FROM gbp_deposits WHERE player_id = ? AND status = 'succeeded'", playerId)!.s },
  };
}
