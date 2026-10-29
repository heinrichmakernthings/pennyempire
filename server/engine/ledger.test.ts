// @vitest-environment node
import { openNodeSqlite } from '../db/nodeSqlite';
import { migrate } from '../db/migrate';
import { BURN, ISSUANCE, LedgerError, available, balance, createAccount, destroy, issue, post, reconcile, releaseFunds, reserveFunds, supply, transfer } from './ledger';

const ctx = { tick: 1, gameDate: '2026-10-29', actor: 'test' };
function fresh() {
  const db = openNodeSqlite(':memory:'); migrate(db);
  createAccount(db, ISSUANCE, 'issuance', 'Mint'); createAccount(db, BURN, 'destroyed', 'Burn');
  for (const id of ['a', 'b', 'state']) createAccount(db, id, id === 'state' ? 'state_treasury' : 'player', id);
  return db;
}
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as LedgerError).code ?? (e as Error).message; } return 'no error'; };

describe('ledger', () => {
  it('issues, transfers and destroys with exact conservation', () => {
    const db = fresh();
    issue(db, ctx, 'i1', 'a', 10_000, 'grant');
    transfer(db, ctx, 't1', 'a', 'b', 2_500, 'transfer', 'pay');
    transfer(db, ctx, 't2', 'b', 'state', 500, 'state_payment', 'licence fee to state company');
    destroy(db, ctx, 'd1', 'state', 200, 'upkeep');
    expect([balance(db, 'a'), balance(db, 'b'), balance(db, 'state')]).toEqual([7_500, 2_000, 300]);
    expect(supply(db)).toEqual({ issued: 10_000, destroyed: 200, circulating: 9_800 });
    expect(reconcile(db).ok).toBe(true);
  });
  it('a transfer to a state treasury is NOT a sink; only a burn reduces supply', () => {
    const db = fresh(); issue(db, ctx, 'i', 'a', 1_000, 'g');
    transfer(db, ctx, 't', 'a', 'state', 1_000, 'state_payment', 'tax');
    expect(supply(db).circulating).toBe(1_000); expect(supply(db).destroyed).toBe(0);
    destroy(db, ctx, 'd', 'state', 1_000, 'burn');
    expect(supply(db).circulating).toBe(0); expect(supply(db).destroyed).toBe(1_000);
  });
  it('rejects overdrafts and never leaves partial postings', () => {
    const db = fresh(); issue(db, ctx, 'i', 'a', 100, 'g');
    expect(code(() => transfer(db, ctx, 't', 'a', 'b', 101, 'transfer', 'x'))).toBe('INSUFFICIENT_FUNDS');
    expect(balance(db, 'a')).toBe(100); expect(balance(db, 'b')).toBe(0);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM ledger_transactions WHERE idempotency_key='t'")!.n).toBe(0);
  });
  it('the database itself refuses a negative balance even if code is bypassed', () => {
    const db = fresh();
    expect(() => db.run("UPDATE accounts SET balance_minor = -1 WHERE id = 'a'")).toThrow();
  });
  it('idempotency: replaying the same key is a no-op; reusing it for a different transaction is an error', () => {
    const db = fresh(); issue(db, ctx, 'i', 'a', 500, 'g');
    const first = transfer(db, ctx, 'k', 'a', 'b', 100, 'transfer', 'x');
    const again = transfer(db, ctx, 'k', 'a', 'b', 100, 'transfer', 'x');
    expect(again).toEqual({ txId: first.txId, duplicate: true });
    expect(balance(db, 'b')).toBe(100);
    expect(code(() => transfer(db, ctx, 'k', 'a', 'b', 200, 'transfer', 'x'))).toBe('IDEMPOTENCY_MISMATCH');
    expect(code(() => issue(db, ctx, 'i', 'a', 501, 'g'))).toBe('IDEMPOTENCY_MISMATCH');
    expect(balance(db, 'b')).toBe(100);
  });
  it('protects the mint and the burn account', () => {
    const db = fresh(); issue(db, ctx, 'i', 'a', 500, 'g');
    expect(code(() => post(db, ctx, 'x1', 'transfer', 'steal from mint', [{ account: ISSUANCE, amount: -100 }, { account: 'a', amount: 100 }]))).toBe('FORBIDDEN');
    expect(code(() => post(db, ctx, 'x2', 'transfer', 'hide coins in burn', [{ account: 'a', amount: -100 }, { account: BURN, amount: 100 }]))).toBe('FORBIDDEN');
    destroy(db, ctx, 'd', 'a', 100, 'burn');
    expect(code(() => post(db, ctx, 'x3', 'transfer', 'resurrect', [{ account: BURN, amount: -100 }, { account: 'a', amount: 100 }]))).toBe('FORBIDDEN');
    expect(code(() => post(db, ctx, 'x4', 'sink', 'un-issue', [{ account: 'a', amount: -50 }, { account: ISSUANCE, amount: 50 }]))).toBe('FORBIDDEN');
    expect(reconcile(db).ok).toBe(true);
  });
  it('rejects unbalanced, zero, fractional and unsafe amounts', () => {
    const db = fresh(); issue(db, ctx, 'i', 'a', 500, 'g');
    expect(code(() => post(db, ctx, 'u', 'transfer', 'x', [{ account: 'a', amount: -10 }, { account: 'b', amount: 9 }]))).toBe('UNBALANCED');
    expect(code(() => transfer(db, ctx, 'z', 'a', 'b', 0, 'transfer', 'x'))).toBe('INVALID_AMOUNT');
    expect(code(() => transfer(db, ctx, 'f', 'a', 'b', 1.5, 'transfer', 'x'))).toBe('INVALID_AMOUNT');
    expect(code(() => transfer(db, ctx, 's', 'a', 'b', Number.MAX_SAFE_INTEGER + 2, 'transfer', 'x'))).toBe('INVALID_AMOUNT');
    expect(code(() => transfer(db, ctx, 'q', 'a', 'nobody', 5, 'transfer', 'x'))).toBe('UNKNOWN_ACCOUNT');
  });
  it('the ledger is immutable', () => {
    const db = fresh(); issue(db, ctx, 'i', 'a', 500, 'g');
    expect(() => db.run('UPDATE ledger_postings SET amount_minor = 999')).toThrow(/immutable/);
    expect(() => db.run('DELETE FROM ledger_postings')).toThrow(/immutable/);
    expect(() => db.run("UPDATE ledger_transactions SET memo = 'edited'")).toThrow(/immutable/);
    expect(() => db.run('DELETE FROM ledger_transactions')).toThrow(/immutable/);
  });
  it('reservations block spending and are conserved', () => {
    const db = fresh(); issue(db, ctx, 'i', 'a', 1_000, 'g');
    reserveFunds(db, 'a', 700);
    expect(available(db, 'a')).toBe(300);
    expect(code(() => transfer(db, ctx, 't', 'a', 'b', 400, 'transfer', 'x'))).toBe('INSUFFICIENT_FUNDS');
    expect(code(() => reserveFunds(db, 'a', 301))).toBe('INSUFFICIENT_FUNDS');
    releaseFunds(db, 'a', 700);
    transfer(db, ctx, 't', 'a', 'b', 400, 'transfer', 'x');
    expect(code(() => releaseFunds(db, 'a', 1))).toBe('FORBIDDEN');
  });
  it('reconciliation detects tampering with materialised balances', () => {
    const db = fresh(); issue(db, ctx, 'i', 'a', 500, 'g');
    db.run("UPDATE accounts SET balance_minor = balance_minor + 7 WHERE id = 'a'");
    const r = reconcile(db);
    expect(r.ok).toBe(false); expect(r.problems.join()).toMatch(/account a balance 507 != ledger 500/);
    expect(r.problems.join()).toMatch(/sum of all accounts is 7/);
  });
  it('a failed multi-step unit of work rolls back every posting', () => {
    const db = fresh(); issue(db, ctx, 'i', 'a', 500, 'g');
    expect(() => db.transaction(() => { transfer(db, ctx, 't1', 'a', 'b', 100, 'transfer', 'x'); transfer(db, ctx, 't2', 'a', 'b', 9_999, 'transfer', 'x'); })).toThrow();
    expect(balance(db, 'a')).toBe(500); expect(balance(db, 'b')).toBe(0);
  });
});
