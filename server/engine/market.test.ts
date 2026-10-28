// @vitest-environment node
import { balance, reconcile, supply } from './ledger';
import { MarketError, cancelOrder, placeOrder } from './market';
import { freeStock, stock } from './inventory';
import { memWorld, one } from '../test/helpers';
import { EXCHANGE_ACCOUNT, companyAccount } from '../seed/bristol';

const ctx = { tick: 0, gameDate: 'x', actor: 't' };
const FARM = 'co-severn-farm', MILL = 'co-brunel-mill', PIZZA = 'co-mad-slices';
const place = (db: ReturnType<typeof memWorld>, o: Parameters<typeof placeOrder>[3]) => placeOrder(db, ctx, 100, o);

describe('order book', () => {
  it('reserves seller stock and buyer coins before anything can match', () => {
    const db = memWorld();
    place(db, { company: FARM, commodity: 'wheat', side: 'sell', price: 60, qty: 150 });
    expect(stock(db, FARM, 'wheat')).toMatchObject({ qty: 200, reserved: 150 });
    place(db, { company: MILL, commodity: 'wheat', side: 'buy', price: 40, qty: 50 });          // too cheap: rests
    expect(one<{ r: number }>(db, 'SELECT reserved_minor r FROM accounts WHERE id = ?', companyAccount(MILL)).r).toBe(2_000);
    expect(reconcile(db).ok).toBe(true);
  });
  it('cannot sell stock you do not have (no phantom inventory) or the same stock twice', () => {
    const db = memWorld();
    expect(() => place(db, { company: FARM, commodity: 'wheat', side: 'sell', price: 60, qty: 201 })).toThrow(MarketError);
    place(db, { company: FARM, commodity: 'wheat', side: 'sell', price: 60, qty: 150 });
    expect(() => place(db, { company: FARM, commodity: 'wheat', side: 'sell', price: 61, qty: 60 })).toThrow(/cannot reserve/);
    expect(freeStock(db, FARM, 'wheat')).toBe(50);
  });
  it('cannot bid with coins you do not have, and a refused order leaves no trace', () => {
    const db = memWorld(); const before = one<{ n: number }>(db, 'SELECT COUNT(*) n FROM orders').n;
    expect(() => place(db, { company: PIZZA, commodity: 'wheat', side: 'buy', price: 100_000, qty: 1_000 })).toThrow(/INSUFFICIENT|cannot reserve/i);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM orders').n).toBe(before);
    expect(one<{ r: number }>(db, 'SELECT reserved_minor r FROM accounts WHERE id = ?', companyAccount(PIZZA)).r).toBe(0);
  });
  it('settles atomically: goods and coins swap, the seller pays the fee, the fee is destroyed, nothing is created', () => {
    const db = memWorld(); const s0 = supply(db);
    place(db, { company: FARM, commodity: 'wheat', side: 'sell', price: 60, qty: 100 });
    const r = place(db, { company: MILL, commodity: 'wheat', side: 'buy', price: 70, qty: 40 });
    expect(r.fills).toHaveLength(1); expect(r.fills[0]).toMatchObject({ qty: 40, price: 60, fee: 24 });   // executes at the RESTING price, 1% fee
    expect(balance(db, companyAccount(MILL))).toBe(800_000 - 2_400);
    expect(balance(db, companyAccount(FARM))).toBe(800_000 + 2_400 - 24);
    expect(stock(db, MILL, 'wheat').qty).toBe(240); expect(stock(db, FARM, 'wheat')).toMatchObject({ qty: 160, reserved: 60 });
    expect(supply(db)).toEqual({ issued: s0.issued, destroyed: 0, circulating: s0.circulating });   // fee is a transfer to the exchange
    expect(balance(db, EXCHANGE_ACCOUNT)).toBe(24);
    expect(one<{ r: number }>(db, 'SELECT reserved_minor r FROM accounts WHERE id = ?', companyAccount(MILL)).r).toBe(0);      // surplus reservation released
    expect(reconcile(db)).toMatchObject({ ok: true });
  });
  it('matches by price then time, supports partial fills, and never trades with itself', () => {
    const db = memWorld();
    place(db, { company: FARM, commodity: 'wheat', side: 'sell', price: 60, qty: 30 });
    place(db, { company: FARM, commodity: 'wheat', side: 'sell', price: 55, qty: 30 });
    const r = place(db, { company: MILL, commodity: 'wheat', side: 'buy', price: 60, qty: 50 });
    expect(r.fills.map((f) => [f.qty, f.price])).toEqual([[30, 55], [20, 60]]);
    expect(r.order.status).toBe('filled');
    const self = place(db, { company: FARM, commodity: 'wheat', side: 'buy', price: 99, qty: 5 });
    expect(self.fills).toEqual([]);                                                                 // own asks are skipped
    expect(self.order.status).toBe('open');
  });
  it('cancellation releases exactly what is still reserved, and only once', () => {
    const db = memWorld();
    const sell = place(db, { company: FARM, commodity: 'wheat', side: 'sell', price: 60, qty: 100 });
    place(db, { company: MILL, commodity: 'wheat', side: 'buy', price: 60, qty: 30 });             // fills 30
    cancelOrder(db, sell.order.id);
    expect(stock(db, FARM, 'wheat')).toMatchObject({ qty: 170, reserved: 0 });
    expect(() => cancelOrder(db, sell.order.id)).toThrow(/cancelled/);
    const bid = place(db, { company: MILL, commodity: 'milk', side: 'buy', price: 50, qty: 10 });
    expect(one<{ r: number }>(db, 'SELECT reserved_minor r FROM accounts WHERE id = ?', companyAccount(MILL)).r).toBe(500);
    cancelOrder(db, bid.order.id);
    expect(one<{ r: number }>(db, 'SELECT reserved_minor r FROM accounts WHERE id = ?', companyAccount(MILL)).r).toBe(0);
    expect(reconcile(db).ok).toBe(true);
  });
  it('only the owner may cancel', () => {
    const db = memWorld(); const o = place(db, { company: FARM, commodity: 'wheat', side: 'sell', price: 60, qty: 10 });
    expect(() => cancelOrder(db, o.order.id, MILL)).toThrow(/Not your order/);
  });
  it('order placement is idempotent per key, and a key cannot be reused for a different order', () => {
    const db = memWorld();
    const a = place(db, { company: FARM, commodity: 'wheat', side: 'sell', price: 60, qty: 10, key: 'k1' });
    const b = place(db, { company: FARM, commodity: 'wheat', side: 'sell', price: 60, qty: 10, key: 'k1' });
    expect(b.duplicate).toBe(true); expect(b.order.id).toBe(a.order.id); expect(stock(db, FARM, 'wheat').reserved).toBe(10);
    expect(() => place(db, { company: FARM, commodity: 'wheat', side: 'sell', price: 61, qty: 10, key: 'k1' })).toThrow(/reused/);
  });
  it('rejects fractional, zero and negative terms', () => {
    const db = memWorld();
    for (const bad of [{ price: 0, qty: 1 }, { price: 1, qty: 0 }, { price: 1.5, qty: 1 }, { price: 1, qty: 2.5 }, { price: -1, qty: 1 }]) expect(() => place(db, { company: FARM, commodity: 'wheat', side: 'sell', ...bad })).toThrow(MarketError);
  });
});
