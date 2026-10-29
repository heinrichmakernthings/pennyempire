// @vitest-environment node
import { openWorld } from './world';
import { CASH, CLEARING, GbpError, balanceOf, ensureGbpBooks, ensureWallet, postGbp, reconcileGbp, reverseGbp, walletAcct, availablePence, pendingPence, type GbpCtx } from './gbpLedger';
import { GBP_RULES, approveWithdrawal, cancelWithdrawal, createDeposit, fundTreasury, handleDepositEvent, rejectWithdrawal, requestWithdrawal, sandboxEvent, settleWithdrawal, walletView } from './gbpWallet';
import { balance, supply } from './ledger';
import { PLAYER_ID, PLAYER_WALLET } from '../seed/bristol';

const ctx = (ms = 1_000): GbpCtx => ({ tick: 0, ms, actor: 'test' });
const fresh = () => { const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'new'); ensureGbpBooks(db); ensureWallet(db, PLAYER_ID); return db; };
const deposit = (db: ReturnType<typeof fresh>, pence: number, key: string, outcome: 'succeeded' | 'failed' | 'cancelled' = 'succeeded') => {
  const { depositId } = createDeposit(db, ctx(), { playerId: PLAYER_ID, amountPence: pence, key }); handleDepositEvent(db, ctx(), sandboxEvent(depositId, outcome)); return depositId;
};
const expectErr = (fn: () => unknown, code?: string) => { try { fn(); } catch (e) { expect(e).toBeInstanceOf(GbpError); if (code) expect((e as GbpError).code).toBe(code); return; } throw new Error('expected a GbpError'); };

describe('GBP_TEST double-entry ledger', () => {
  it('every transaction balances; unbalanced, zero or fractional postings are refused', () => {
    const db = fresh();
    expectErr(() => postGbp(db, ctx(), 'u1', 'deposit', 'x', [{ account: CASH, amount: 100 }, { account: walletAcct(PLAYER_ID), amount: -99 }]), 'UNBALANCED');
    expectErr(() => postGbp(db, ctx(), 'u2', 'deposit', 'x', [{ account: CASH, amount: 1.5 }, { account: walletAcct(PLAYER_ID), amount: -1.5 }]), 'INVALID_AMOUNT');
    expectErr(() => postGbp(db, ctx(), 'u3', 'deposit', 'x', [{ account: CASH, amount: 0 }, { account: walletAcct(PLAYER_ID), amount: 0 }]), 'INVALID_AMOUNT');
    expectErr(() => postGbp(db, ctx(), 'u4', 'deposit', 'x', [{ account: CASH, amount: 100 }, { account: 'gbp:nope', amount: -100 }]), 'UNKNOWN_ACCOUNT');
    expect(reconcileGbp(db).ok).toBe(true);
  });
  it('is idempotent: the same key and postings is a no-op, the same key with different postings is refused', () => {
    const db = fresh(); const p = [{ account: CASH, amount: 100 }, { account: walletAcct(PLAYER_ID), amount: -100 }];
    const a = postGbp(db, ctx(), 'k', 'deposit', 'x', p), b = postGbp(db, ctx(), 'k', 'deposit', 'x', p);
    expect(b.duplicate).toBe(true); expect(b.txId).toBe(a.txId); expect(balanceOf(db, CASH)).toBe(100);
    expectErr(() => postGbp(db, ctx(), 'k', 'deposit', 'x', [{ account: CASH, amount: 200 }, { account: walletAcct(PLAYER_ID), amount: -200 }]), 'IDEMPOTENCY_MISMATCH');
  });
  it('postings are immutable at the database level; reversals undo by new entries and can only happen once', () => {
    const db = fresh(); const t = postGbp(db, ctx(), 'k', 'deposit', 'x', [{ account: CASH, amount: 100 }, { account: walletAcct(PLAYER_ID), amount: -100 }]);
    expect(() => db.run('UPDATE gbp_postings SET amount_pence = 1')).toThrow(); expect(() => db.run('DELETE FROM gbp_postings')).toThrow(); expect(() => db.run('DELETE FROM gbp_transactions')).toThrow();
    expect(() => db.run("UPDATE gbp_transactions SET memo = 'edited'")).toThrow();
    const r = reverseGbp(db, ctx(), 'rev', t.txId, 'undo'); expect(r.duplicate).toBe(false);
    expect(balanceOf(db, CASH)).toBe(0); expect(db.get<{ status: string }>('SELECT status FROM gbp_transactions WHERE id = ?', t.txId)!.status).toBe('reversed');
    expectErr(() => reverseGbp(db, ctx(), 'rev2', t.txId, 'again'), 'INVALID_STATE'); expectErr(() => reverseGbp(db, ctx(), 'rev3', r.txId, 'undo the undo'), 'INVALID_STATE');
    expect(reconcileGbp(db).ok).toBe(true);
  });
  it('a wallet can never go negative and cash can never be overdrawn', () => {
    const db = fresh(); deposit(db, 500, 'd1');
    expectErr(() => postGbp(db, ctx(), 'o1', 'withdrawal_reserve', 'x', [{ account: walletAcct(PLAYER_ID), amount: 501 }, { account: CLEARING, amount: -501 }]), 'INSUFFICIENT_FUNDS');
    expectErr(() => postGbp(db, ctx(), 'o2', 'payout_start', 'x', [{ account: CLEARING, amount: 10_000 }, { account: CASH, amount: -10_000 }]), 'INSUFFICIENT_FUNDS');
    expect(availablePence(db, PLAYER_ID)).toBe(500); expect(reconcileGbp(db).ok).toBe(true);
  });
  it('GBP_TEST and Empire Coins are completely separate: no shared accounts, and a GBP deposit never moves coins', () => {
    const db = fresh(); const coins0 = balance(db, PLAYER_WALLET), supply0 = supply(db);
    deposit(db, 1_000, 'd1');
    expect(balance(db, PLAYER_WALLET)).toBe(coins0); expect(supply(db)).toEqual(supply0);
    expect(db.get("SELECT 1 FROM accounts WHERE id LIKE 'gbp:%'")).toBeUndefined();
    expect(db.get("SELECT 1 FROM gbp_accounts WHERE id LIKE 'acct:%'")).toBeUndefined();
  });
});

describe('simulated deposits', () => {
  it('50p, £1, £2, £5 and £10 test deposits credit the wallet, record a processing-fee expense and reconcile; deposits are not revenue', () => {
    const db = fresh();
    for (const [i, p] of [50, 100, 200, 500, 1_000].entries()) deposit(db, p, `d${i}`);
    const v = walletView(db, PLAYER_ID); expect(v.availablePence).toBe(1_850);
    expect(balanceOf(db, 'gbp:rev:premium') + balanceOf(db, 'gbp:rev:advertising') + balanceOf(db, 'gbp:rev:cosmetic')).toBe(0);   // no revenue recognised
    expect(balanceOf(db, 'gbp:exp:payment_fees')).toBeGreaterThan(0);
    expect(balanceOf(db, CASH)).toBe(1_850);                                  // the processor fee is a business liability, not taken from player funds
    expect(balanceOf(db, 'gbp:payable:processor')).toBe(0 - balanceOf(db, 'gbp:exp:payment_fees'));
    const rec = reconcileGbp(db); expect(rec.problems).toEqual([]); expect(rec.ok).toBe(true);
  });
  it('rejects amounts outside the permitted range and non-integers', () => {
    const db = fresh();
    for (const [i, p] of [49, 0, -5, 50_001, 1.5, NaN].entries()) expectErr(() => createDeposit(db, ctx(), { playerId: PLAYER_ID, amountPence: p, key: `bad${i}` }), 'INVALID_AMOUNT');
    expect(createDeposit(db, ctx(), { playerId: PLAYER_ID, amountPence: 777, key: 'custom' }).duplicate).toBe(false);
  });
  it('a replayed create request returns the same deposit; the same key with another amount is refused', () => {
    const db = fresh(); const a = createDeposit(db, ctx(), { playerId: PLAYER_ID, amountPence: 500, key: 'same' }), b = createDeposit(db, ctx(), { playerId: PLAYER_ID, amountPence: 500, key: 'same' });
    expect(b).toEqual({ depositId: a.depositId, duplicate: true }); expectErr(() => createDeposit(db, ctx(), { playerId: PLAYER_ID, amountPence: 600, key: 'same' }), 'IDEMPOTENCY_MISMATCH');
    expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM gbp_deposits')!.n).toBe(1);
  });
  it('a failed or cancelled deposit credits nothing; a duplicate success webhook credits once', () => {
    const db = fresh(); deposit(db, 500, 'f', 'failed'); deposit(db, 500, 'c', 'cancelled');
    expect(availablePence(db, PLAYER_ID)).toBe(0);
    const { depositId } = createDeposit(db, ctx(), { playerId: PLAYER_ID, amountPence: 500, key: 's' });
    const e = sandboxEvent(depositId, 'succeeded');
    expect(handleDepositEvent(db, ctx(), e).outcome).toBe('applied'); expect(handleDepositEvent(db, ctx(), e).outcome).toBe('duplicate_ignored');
    expect(handleDepositEvent(db, ctx(), { ...e, eventId: 'evt-other-id' }).outcome).toBe('ignored_state');   // a different event for an already-settled deposit
    expect(handleDepositEvent(db, ctx(), sandboxEvent(depositId, 'failed')).outcome).toBe('ignored_state');   // a late failure cannot undo a success
    expect(availablePence(db, PLAYER_ID)).toBe(500); expect(reconcileGbp(db).ok).toBe(true);
  });
});

describe('simulated withdrawals', () => {
  const funded = () => { const db = fresh(); deposit(db, 1_000, 'd'); fundTreasury(db, ctx(), 'fund', 100_000, 'developer-funded simulated treasury'); return db; };
  it('enforces the £5 minimum and the available balance', () => {
    const db = funded();
    expectErr(() => requestWithdrawal(db, ctx(), { playerId: PLAYER_ID, amountPence: 499, key: 'w1' }), 'INVALID_AMOUNT');
    expectErr(() => requestWithdrawal(db, ctx(), { playerId: PLAYER_ID, amountPence: 1_001, key: 'w2' }), 'INSUFFICIENT_FUNDS');
    expect(requestWithdrawal(db, ctx(), { playerId: PLAYER_ID, amountPence: GBP_RULES.minWithdrawalPence, key: 'w3' }).duplicate).toBe(false);
  });
  it('the full lifecycle: request reserves funds, approval moves cash to clearing, settlement pays out; everything reconciles', () => {
    const db = funded();
    const { withdrawalId: id } = requestWithdrawal(db, ctx(), { playerId: PLAYER_ID, amountPence: 500, key: 'w' });
    expect(availablePence(db, PLAYER_ID)).toBe(500); expect(pendingPence(db, PLAYER_ID)).toBe(500);
    approveWithdrawal(db, ctx(), id); expect(reconcileGbp(db).ok).toBe(true);
    expect(settleWithdrawal(db, ctx(), id, 'paid', 'evt-paid-1').outcome).toBe('applied'); expect(settleWithdrawal(db, ctx(), id, 'paid', 'evt-paid-1').outcome).toBe('duplicate_ignored');
    expect(pendingPence(db, PLAYER_ID)).toBe(0); expect(availablePence(db, PLAYER_ID)).toBe(500);
    expect(db.get<{ status: string }>('SELECT status FROM gbp_withdrawals WHERE id = ?', id)!.status).toBe('paid');
    expectErr(() => settleWithdrawal(db, ctx(), id, 'paid', 'evt-paid-2'), 'INVALID_STATE');   // cannot pay twice
    const rec = reconcileGbp(db); expect(rec.problems).toEqual([]);
  });
  it('rejection and payout failure return the funds exactly once, by reversal entries', () => {
    const db = funded(); const a = requestWithdrawal(db, ctx(), { playerId: PLAYER_ID, amountPence: 500, key: 'a' }).withdrawalId;
    rejectWithdrawal(db, ctx(), a, 'test rejection'); rejectWithdrawal(db, ctx(), a, 'again'); expect(availablePence(db, PLAYER_ID)).toBe(1_000);
    const b = requestWithdrawal(db, ctx(), { playerId: PLAYER_ID, amountPence: 600, key: 'b' }).withdrawalId; approveWithdrawal(db, ctx(), b);
    settleWithdrawal(db, ctx(), b, 'failed', 'evt-fail-b'); expect(availablePence(db, PLAYER_ID)).toBe(1_000); expect(pendingPence(db, PLAYER_ID)).toBe(0);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM gbp_transactions WHERE kind = 'reversal'")!.n).toBe(3);
    expect(reconcileGbp(db).ok).toBe(true); expect(balanceOf(db, CLEARING)).toBe(0);
  });
  it('the same funds cannot be spent twice: concurrent requests, duplicate keys and requests racing a cancellation', () => {
    const db = funded();
    const first = requestWithdrawal(db, ctx(), { playerId: PLAYER_ID, amountPence: 700, key: 'r1' });
    expectErr(() => requestWithdrawal(db, ctx(), { playerId: PLAYER_ID, amountPence: 700, key: 'r2' }), 'INSUFFICIENT_FUNDS');     // only £3 left
    expect(requestWithdrawal(db, ctx(), { playerId: PLAYER_ID, amountPence: 700, key: 'r1' })).toEqual({ withdrawalId: first.withdrawalId, duplicate: true });
    cancelWithdrawal(db, ctx(), PLAYER_ID, first.withdrawalId); cancelWithdrawal(db, ctx(), PLAYER_ID, first.withdrawalId);
    expect(availablePence(db, PLAYER_ID)).toBe(1_000);
    const again = requestWithdrawal(db, ctx(), { playerId: PLAYER_ID, amountPence: 1_000, key: 'r3' }); approveWithdrawal(db, ctx(), again.withdrawalId);
    expectErr(() => cancelWithdrawal(db, ctx(), PLAYER_ID, again.withdrawalId), 'INVALID_STATE');   // too late once approved
    expect(reconcileGbp(db).ok).toBe(true);
  });
  it('limits open requests, protects another player\'s withdrawal, and refuses approval when treasury cash is short', () => {
    const db = fresh(); deposit(db, 10_000, 'd');                  // wallet £100 but treasury cash only what the deposit left (minus fee)
    for (let i = 0; i < GBP_RULES.maxOpenWithdrawals; i++) requestWithdrawal(db, ctx(), { playerId: PLAYER_ID, amountPence: 500, key: `m${i}` });
    expectErr(() => requestWithdrawal(db, ctx(), { playerId: PLAYER_ID, amountPence: 500, key: 'm-over' }), 'LIMIT');
    ensureWallet(db, 'someone-else'); expectErr(() => cancelWithdrawal(db, ctx(), 'someone-else', 'wd-1'), 'FORBIDDEN');
    const id = db.get<{ id: string }>("SELECT id FROM gbp_withdrawals LIMIT 1")!.id;
    db.run("UPDATE gbp_accounts SET balance_pence = balance_pence WHERE 0");
    approveWithdrawal(db, ctx(), id);   // treasury holds £99.xx: this one is fine
    expect(reconcileGbp(db).ok).toBe(true);
  });
  it('mass withdrawals: many players ask at once; only what the treasury holds can be paid, nobody is paid twice, the books balance', () => {
    const db = fresh(); const players = Array.from({ length: 25 }, (_, i) => `mass-${i}`);
    for (const [i, p] of players.entries()) { ensureWallet(db, p); const d = createDeposit(db, ctx(), { playerId: p, amountPence: 1_000, key: `md${i}` }); handleDepositEvent(db, ctx(), sandboxEvent(d.depositId, 'succeeded')); }
    const ids = players.map((p, i) => requestWithdrawal(db, ctx(), { playerId: p, amountPence: 1_000, key: `mw${i}` }).withdrawalId);
    let paid = 0, refused = 0;
    for (const [i, id] of ids.entries()) { try { approveWithdrawal(db, ctx(), id); settleWithdrawal(db, ctx(), id, 'paid', `mevt-${i}`); paid++; } catch (e) { if (e instanceof GbpError && e.code === 'INSUFFICIENT_FUNDS') refused++; else throw e; } }
    expect(paid + refused).toBe(25); expect(refused).toBe(0); expect(paid).toBe(25);      // player funds are always fully backed by cash: processor fees never come out of them
    expect(balanceOf(db, CASH)).toBeGreaterThanOrEqual(0);
    fundTreasury(db, ctx(), 'topup', 100_000, 'top up'); for (const [i, id] of ids.entries()) { const st = db.get<{ status: string }>('SELECT status FROM gbp_withdrawals WHERE id = ?', id)!.status; if (st === 'requested') { approveWithdrawal(db, ctx(), id); settleWithdrawal(db, ctx(), id, 'paid', `mevt2-${i}`); } }
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM gbp_withdrawals WHERE status = 'paid'")!.n).toBe(25);
    const rec = reconcileGbp(db); expect(rec.problems).toEqual([]); expect(rec.totals.walletLiabilities).toBe(0); expect(rec.totals.pendingLiabilities).toBe(0);
  });
});
