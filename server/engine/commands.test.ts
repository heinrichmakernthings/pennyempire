// @vitest-environment node
import { balance, reconcile, supply } from './ledger';
import { cancelPlayerOrder, configureCompany, fundCompany, placePlayerOrder, quoteOrder, reopenCompany, withdrawFromCompany } from './commands';
import { advance } from './world';
import { stock } from './inventory';
import { memWorld, one } from '../test/helpers';
import { EXCHANGE_ACCOUNT, companyAccount } from '../seed/bristol';

const W = 'acct:player:demo', MS = 'co-mad-slices', MILL = 'co-brunel-mill';
const rev = (db: ReturnType<typeof memWorld>, id = MS) => one<{ r: number }>(db, 'SELECT revision r FROM companies WHERE id = ?', id).r;

describe('company.configure', () => {
  it('applies valid settings, bumps the revision, and logs an event', () => {
    const db = memWorld();
    const r = configureCompany(db, 'c1', MS, 1, { priceMinor: 1_100, employees: 5, quality: 'premium', marketingMinorPerTick: 5_000, plannedUnitsPerTick: 50 });
    expect(r).toMatchObject({ ok: true, revision: 2 });
    expect(one(db, "SELECT price_minor, employees, quality, marketing_minor FROM companies WHERE id = 'co-mad-slices'")).toEqual({ price_minor: 1_100, employees: 5, quality: 'premium', marketing_minor: 5_000 });
    expect(one<{ p: number }>(db, "SELECT planned_batches p FROM production_lines WHERE company_id = 'co-mad-slices'").p).toBe(5);
  });
  it('is idempotent: a replay returns the stored answer and applies nothing twice', () => {
    const db = memWorld();
    const a = configureCompany(db, 'dup', MS, 1, { priceMinor: 1_100 });
    const b = configureCompany(db, 'dup', MS, 1, { priceMinor: 1_100 });
    expect(b).toEqual(a); expect(rev(db)).toBe(2);
    expect(configureCompany(db, 'dup', MS, 1, { priceMinor: 1_200 })).toEqual(a);          // even a changed body cannot re-run the key
    expect(one<{ p: number }>(db, "SELECT price_minor p FROM companies WHERE id='co-mad-slices'").p).toBe(1_100);
  });
  it('refuses stale revisions, other people’s companies, and out-of-range values', () => {
    const db = memWorld();
    configureCompany(db, 'a', MS, 1, { priceMinor: 1_100 });
    expect(configureCompany(db, 'b', MS, 1, { priceMinor: 900 })).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    expect(configureCompany(db, 'c', MILL, 1, { priceMinor: 300 })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const bad = configureCompany(db, 'd', MS, 2, { priceMinor: 99_999, employees: 99, plannedUnitsPerTick: 99_999 });
    expect(bad).toMatchObject({ ok: false, error: { code: 'VALIDATION', fieldErrors: { priceMinor: expect.any(String), employees: expect.any(String), plannedUnitsPerTick: expect.any(String) } } });
    expect(configureCompany(db, 'e', MS, 2, { priceMinor: 1.5 })).toMatchObject({ ok: false });
    expect(rev(db)).toBe(2);
  });
  it('a key cannot be reused for a different command', () => {
    const db = memWorld(); configureCompany(db, 'x', MS, 1, { priceMinor: 1_100 });
    expect(fundCompany(db, 'x', MS, 100)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});

describe('moving coins between player and company', () => {
  it('capital injection moves coins exactly once even if submitted repeatedly', () => {
    const db = memWorld(); const s = supply(db); const w = balance(db, W), c = balance(db, companyAccount(MS));
    for (let i = 0; i < 5; i++) expect(fundCompany(db, 'fund-1', MS, 250_000)).toMatchObject({ ok: true });
    expect(balance(db, W)).toBe(w - 250_000); expect(balance(db, companyAccount(MS))).toBe(c + 250_000);
    expect(supply(db)).toEqual(s); expect(reconcile(db).ok).toBe(true);
  });
  it('refuses overdrafts and non-integer amounts', () => {
    const db = memWorld();
    expect(fundCompany(db, 'f1', MS, 999_999_999)).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_FUNDS' } });
    expect(fundCompany(db, 'f2', MS, 10.5)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(fundCompany(db, 'f3', MS, -5)).toMatchObject({ ok: false });
    expect(fundCompany(db, 'f4', MILL, 100)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
  it('withdrawals leave a day of operating cash and are blocked while arrears are owed', () => {
    const db = memWorld(); const cash = balance(db, companyAccount(MS));
    expect(withdrawFromCompany(db, 'w1', MS, cash)).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_FUNDS' } });
    expect(withdrawFromCompany(db, 'w2', MS, 100_000)).toMatchObject({ ok: true });
    expect(balance(db, W)).toBe(1_500_000 + 100_000);
    db.run("UPDATE companies SET unpaid_minor = 5 WHERE id = ?", MS);
    expect(withdrawFromCompany(db, 'w3', MS, 100)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(reconcile(db).ok).toBe(true);
  });
  it('an insolvent company can be reopened only after arrears are paid to the state', () => {
    const db = memWorld({ npcPayoutBps: 0 });
    withdrawFromCompany(db, 'drain', 'co-harbour-bean', 240_000);
    db.run("UPDATE demand_rules SET amount = 0 WHERE commodity_id = 'cafe-drink'"); db.run("UPDATE production_lines SET planned_batches = 0 WHERE company_id = 'co-harbour-bean'");
    advance(db, 4);
    expect(one<{ s: string }>(db, "SELECT status s FROM companies WHERE id = 'co-harbour-bean'").s).toBe('insolvent');
    expect(reopenCompany(db, 'r1', 'co-harbour-bean')).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_FUNDS' } });
    fundCompany(db, 'refill', 'co-harbour-bean', 100_000);
    expect(reopenCompany(db, 'r2', 'co-harbour-bean')).toMatchObject({ ok: true });
    expect(one(db, "SELECT status, unpaid_minor FROM companies WHERE id = 'co-harbour-bean'")).toEqual({ status: 'operating', unpaid_minor: 0 });
    expect(reconcile(db).ok).toBe(true);
  });
});

describe('player market orders', () => {
  const q = (db: ReturnType<typeof memWorld>, o: Partial<Parameters<typeof quoteOrder>[1]> = {}) => quoteOrder(db, { companyId: MS, commodityId: 'flour', side: 'buy', quantity: 10, limitPriceMinor: 400, ...o });
  it('quotes from the live book, then fills and settles exactly as quoted', () => {
    const db = memWorld(); advance(db, 1);
    const quote = q(db); if (!quote.ok) throw new Error('quote failed');
    expect(quote.quote.availableUnits).toBe(10); expect(quote.quote.feeMinor).toBe(0); expect(quote.quote.totalMinor).toBe(quote.quote.subtotalMinor);
    const flour0 = stock(db, MS, 'flour').qty, cash0 = balance(db, companyAccount(MS)), s0 = supply(db), ex0 = balance(db, EXCHANGE_ACCOUNT);
    const res = placePlayerOrder(db, 'o1', { companyId: MS, commodityId: 'flour', side: 'buy', quantity: 10, limitPriceMinor: 400, quoteId: quote.quote.id });
    expect(res).toMatchObject({ ok: true, data: { filled: 10, remaining: 0 } });
    expect(stock(db, MS, 'flour').qty).toBe(flour0 + 10);
    expect(cash0 - balance(db, companyAccount(MS))).toBe(quote.quote.totalMinor);
    expect(supply(db).destroyed - s0.destroyed).toBe(0);                                                  // the fee is a transfer to the Penny Exchange, not a burn
    expect(balance(db, EXCHANGE_ACCOUNT) - ex0).toBe(Math.floor(quote.quote.subtotalMinor / 100));
    expect(reconcile(db).ok).toBe(true);
  });
  it('quotes expire when the tick advances and must match the order', () => {
    const db = memWorld(); advance(db, 1);
    const quote = q(db); if (!quote.ok) throw new Error('x');
    expect(placePlayerOrder(db, 'o2', { companyId: MS, commodityId: 'flour', side: 'buy', quantity: 11, limitPriceMinor: 400, quoteId: quote.quote.id })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    advance(db, 1);
    expect(placePlayerOrder(db, 'o3', { companyId: MS, commodityId: 'flour', side: 'buy', quantity: 10, limitPriceMinor: 400, quoteId: quote.quote.id })).toMatchObject({ ok: false, error: { code: 'QUOTE_EXPIRED' } });
  });
  it('a double-submitted order fills once', () => {
    const db = memWorld(); advance(db, 1); const quote = q(db); if (!quote.ok) throw new Error('x');
    const o = { companyId: MS, commodityId: 'flour', side: 'buy' as const, quantity: 10, limitPriceMinor: 400, quoteId: quote.quote.id };
    const f0 = stock(db, MS, 'flour').qty;
    const a = placePlayerOrder(db, 'dbl', o), b = placePlayerOrder(db, 'dbl', o);
    expect(b).toEqual(a); expect(stock(db, MS, 'flour').qty).toBe(f0 + 10);
  });
  it('resting orders reserve funds and can be cancelled by the owner only', () => {
    const db = memWorld(); advance(db, 1);
    const quote = q(db, { limitPriceMinor: 50, quantity: 5 }); if (!quote.ok) throw new Error('x');
    const placed = placePlayerOrder(db, 'rest', { companyId: MS, commodityId: 'flour', side: 'buy', quantity: 5, limitPriceMinor: 50, quoteId: quote.quote.id });
    if (!placed.ok || !placed.data) throw new Error('place failed');
    expect(one<{ r: number }>(db, 'SELECT reserved_minor r FROM accounts WHERE id = ?', companyAccount(MS)).r).toBe(250);
    expect(cancelPlayerOrder(db, 'cx1', placed.data.orderId)).toMatchObject({ ok: true });
    expect(one<{ r: number }>(db, 'SELECT reserved_minor r FROM accounts WHERE id = ?', companyAccount(MS)).r).toBe(0);
    const npcOrder = one<{ id: number }>(db, "SELECT id FROM orders WHERE company_id = 'co-brunel-mill' AND status = 'open' LIMIT 1").id;
    expect(cancelPlayerOrder(db, 'cx2', npcOrder)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});
