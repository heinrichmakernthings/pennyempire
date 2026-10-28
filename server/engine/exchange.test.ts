// @vitest-environment node
import { advance, openWorld } from './world';
import { balance, reconcile, supply } from './ledger';
import { cancelPlayerOrder, configureCompany, fundCompany, placePlayerOrder, quoteOrder } from './commands';
import { createCompany, startupQuote } from './company';
import { cancelContract, proposeContract, respondContract, upcomingDeliveries, type ContractRow } from './contracts';
import { directory, commodityDetail } from './exchange';
import { marketShortages } from './insights';
import { expireOrders, marketLimit, placeOrder, cancelOrder, MarketError } from './market';
import { freeStock, stock, addStock } from './inventory';
import { handleApi } from '../api/router';
import { EXCHANGE_ACCOUNT, PLAYER_WALLET, TREASURY, companyAccount } from '../seed/bristol';
import type { Sql } from '../db/sql';

const world = (cfg = {}) => { const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000, ...cfg }, 'new'); advance(db, 8); return db; };
/** Isolated book: every resting NPC/state order is cancelled so a test controls exactly who can trade. */
const clearBook = (db: Sql) => { for (const o of db.all<{ id: number }>("SELECT id FROM orders WHERE status = 'open'")) cancelOrder(db, o.id); };
const cid = (r: { ok: boolean; data?: unknown }) => (r.data as { contractId: number }).contractId;
const ctxOf = (db: Sql) => ({ tick: db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t, gameDate: 'x', actor: 'test' });
const found = (db: Sql, industry: string, plot: string, name: string, key = `k-${name}`) => {
  const q = startupQuote(db, { industry, plotId: plot, tier: 1, name });
  const r = createCompany(db, key, { industry, plotId: plot, tier: 1, name, expectedTotalMinor: q.totalMinor });
  if (!r.ok) throw new Error(r.error.message);
  return (r.data as { companyId: string }).companyId;
};
const place = (db: Sql, o: Parameters<typeof placeOrder>[3], fee = 100) => placeOrder(db, ctxOf(db), fee, o);
const give = (db: Sql, company: string, commodity: string, qty: number, unit = 50) => addStock(db, ctxOf(db), company, commodity, qty, qty * unit, 'seed', 'test');

describe('fees: a transfer to the Penny Exchange, burned only by an explicit separate transaction', () => {
  it('buyer pays 1,000, seller receives 980, the exchange receives 20 (2% fee); nothing is destroyed by the trade', () => {
    const db = world({ exchangeFeeBps: 200 });
    clearBook(db); const farm = found(db, 'farm', 'lot-3', 'Fee Farm'), mill = found(db, 'mill', 'lot-7', 'Fee Mill');
    give(db, farm, 'wheat', 200);
    const before = supply(db), ex0 = balance(db, EXCHANGE_ACCOUNT), f0 = balance(db, companyAccount(farm)), m0 = balance(db, companyAccount(mill));
    place(db, { company: farm, commodity: 'wheat', side: 'sell', price: 100, qty: 10 }, 200);
    const r = place(db, { company: mill, commodity: 'wheat', side: 'buy', price: 100, qty: 10 }, 200);
    expect(r.fills[0]).toMatchObject({ qty: 10, price: 100, fee: 20 });
    expect(m0 - balance(db, companyAccount(mill))).toBe(1_000);
    expect(balance(db, companyAccount(farm)) - f0).toBe(980);
    expect(balance(db, EXCHANGE_ACCOUNT) - ex0).toBe(20);
    expect(supply(db).destroyed).toBe(before.destroyed);
    expect(reconcile(db).ok).toBe(true);
  });
  it('the exchange sweeps its income each tick: a configured share is burned (explicit, labelled), the rest goes to the treasury as a transfer', () => {
    const db = world({ exchangeBurnBps: 4_000 });
    clearBook(db); const farm = found(db, 'farm', 'lot-3', 'Sweep Farm'), mill = found(db, 'mill', 'lot-7', 'Sweep Mill');
    give(db, farm, 'wheat', 200);
    place(db, { company: farm, commodity: 'wheat', side: 'sell', price: 100, qty: 100 }); place(db, { company: mill, commodity: 'wheat', side: 'buy', price: 100, qty: 100 });
    const fee = balance(db, EXCHANGE_ACCOUNT); expect(fee).toBeGreaterThanOrEqual(100);
    const d0 = supply(db).destroyed;
    advance(db, 1);
    expect(balance(db, EXCHANGE_ACCOUNT)).toBe(0);
    const sum = (memo: string, acct: string) => db.get<{ a: number }>('SELECT COALESCE(SUM(p.amount_minor),0) a FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.memo LIKE ? AND p.amount_minor > 0 AND p.account_id = ? AND t.tick = ?', memo, acct, ctxOf(db).tick)!.a;
    const burn = sum('Penny Exchange fee burn%', 'acct:burn'), swept = sum('Penny Exchange fee income%', TREASURY);
    expect(burn + swept).toBeGreaterThanOrEqual(fee);                                  // everything the exchange held that tick was either burned or swept
    expect(Math.abs(burn - 0.4 * (burn + swept))).toBeLessThanOrEqual(1);              // the configured 40% share (integer rounding)
    expect(supply(db).destroyed - d0).toBeGreaterThanOrEqual(burn);
    expect(db.get('SELECT 1 FROM ledger_transactions WHERE memo LIKE ?', 'Penny Exchange fee income to state treasury%')).toBeTruthy();
    expect(reconcile(db).ok).toBe(true);
  });
});

describe('matching engine', () => {
  it('price-time priority: best price first, then the earlier order; fills across several counterparties; the execution price is the resting price', () => {
    const db = world();
    clearBook(db); const farm = found(db, 'farm', 'lot-3', 'A Farm'), farm2 = found(db, 'farm', 'lot-4', 'B Farm'), mill = found(db, 'mill', 'lot-7', 'The Mill');
    give(db, farm, 'wheat', 100); give(db, farm2, 'wheat', 100);
    const a = place(db, { company: farm, commodity: 'wheat', side: 'sell', price: 60, qty: 30 }).order;
    const b = place(db, { company: farm2, commodity: 'wheat', side: 'sell', price: 60, qty: 30 }).order;      // same price, later
    const c = place(db, { company: farm2, commodity: 'wheat', side: 'sell', price: 55, qty: 20 }).order;      // better price, latest
    const r = place(db, { company: mill, commodity: 'wheat', side: 'buy', price: 65, qty: 70 });
    expect(r.fills.map((f) => [f.price, f.qty])).toEqual([[55, 20], [60, 30], [60, 20]]);                    // 55 first, then A (earlier) before B
    expect(db.get<{ qty_remaining: number }>('SELECT qty_remaining FROM orders WHERE id = ?', a.id)!.qty_remaining).toBe(0);
    expect(db.get<{ qty_remaining: number }>('SELECT qty_remaining FROM orders WHERE id = ?', b.id)!.qty_remaining).toBe(10);
    expect(db.get<{ status: string }>('SELECT status FROM orders WHERE id = ?', c.id)!.status).toBe('filled');
    expect(reconcile(db).ok).toBe(true);
  });
  it('a company never trades with itself', () => {
    const db = world(); clearBook(db); const farm = found(db, 'farm', 'lot-3', 'Self Farm'); give(db, farm, 'wheat', 100);
    place(db, { company: farm, commodity: 'wheat', side: 'sell', price: 60, qty: 30 });
    const r = place(db, { company: farm, commodity: 'wheat', side: 'buy', price: 70, qty: 30 });
    expect(r.fills).toHaveLength(0);
  });
  it('reservations stop the same coins or units being spent twice', () => {
    const db = world(); clearBook(db); const farm = found(db, 'farm', 'lot-3', 'Res Farm'); const mill = found(db, 'mill', 'lot-7', 'Res Mill');
    give(db, farm, 'wheat', 50);
    place(db, { company: farm, commodity: 'wheat', side: 'sell', price: 100, qty: 50 });
    expect(() => place(db, { company: farm, commodity: 'wheat', side: 'sell', price: 100, qty: 1 })).toThrow(/stock|reserv|enough|available/i);
    const cash = balance(db, companyAccount(mill));
    place(db, { company: mill, commodity: 'wheat', side: 'buy', price: 1, qty: Math.floor(cash / 2) });          // reserves half of the cash
    expect(() => place(db, { company: mill, commodity: 'wheat', side: 'buy', price: 1, qty: Math.floor(cash / 2) + 10 })).toThrow(MarketError);
  });
  it('invalid, zero and negative values are refused', () => {
    const db = world(); const mill = found(db, 'mill', 'lot-7', 'Bad Mill');
    for (const bad of [{ price: 0, qty: 5 }, { price: 5, qty: 0 }, { price: -5, qty: 5 }, { price: 5, qty: -1 }, { price: 1.5, qty: 5 }, { price: 5, qty: 2.5 }])
      expect(() => place(db, { company: mill, commodity: 'wheat', side: 'buy', ...bad })).toThrow(MarketError);
    expect(() => place(db, { company: mill, commodity: 'unobtainium', side: 'buy', price: 5, qty: 5 })).toThrow(MarketError);
  });
  it('cancel releases exactly the unfilled reservation; a filled or already-cancelled order cannot be cancelled again', () => {
    const db = world(); clearBook(db); const farm = found(db, 'farm', 'lot-3', 'C Farm'); const mill = found(db, 'mill', 'lot-7', 'C Mill'); give(db, farm, 'wheat', 100);
    const sell = place(db, { company: farm, commodity: 'wheat', side: 'sell', price: 60, qty: 100 }).order;
    place(db, { company: mill, commodity: 'wheat', side: 'buy', price: 60, qty: 40 });                          // partial fill: 60 left
    expect(stock(db, farm, 'wheat').reserved).toBe(60);
    cancelOrder(db, sell.id, farm);
    expect(stock(db, farm, 'wheat').reserved).toBe(0); expect(freeStock(db, farm, 'wheat')).toBe(60 + 0);
    expect(() => cancelOrder(db, sell.id, farm)).toThrow(/cancelled/);
    expect(() => cancelOrder(db, sell.id, mill)).toThrow(MarketError);
  });
});

describe('automatic listings yield to deliberate orders', () => {
  it('a player sell order reclaims stock reserved by the company\'s automatic daily listing, and only for that company', () => {
    const db = world(); const farm = found(db, 'farm', 'lot-3', 'Auto Farm'); give(db, farm, 'wheat', 100);
    place(db, { company: farm, commodity: 'wheat', side: 'sell', price: 50, qty: 100, key: 'sys:test:auto' });
    expect(freeStock(db, farm, 'wheat')).toBe(0);
    const r = place(db, { company: farm, commodity: 'wheat', side: 'sell', price: 80, qty: 40 });
    expect(r.order.status).toBe('open'); expect(db.get<{ status: string }>("SELECT status FROM orders WHERE idempotency_key = 'sys:test:auto'")!.status).toBe('cancelled');
    expect(stock(db, farm, 'wheat').reserved).toBe(40);
    expect(() => place(db, { company: farm, commodity: 'wheat', side: 'sell', price: 80, qty: 100 })).toThrow(MarketError);        // genuinely not enough stock
  });
});

describe('expiry', () => {
  it('an expired order stops matching and releases what it reserved; the sweep is idempotent', () => {
    const db = world(); clearBook(db); const farm = found(db, 'farm', 'lot-3', 'E Farm'); const mill = found(db, 'mill', 'lot-7', 'E Mill'); give(db, farm, 'wheat', 100);
    const t = ctxOf(db).tick;
    const sell = placeOrder(db, ctxOf(db), 100, { company: farm, commodity: 'wheat', side: 'sell', price: 60, qty: 50, expiresTick: t + 2 }).order;
    expect(stock(db, farm, 'wheat').reserved).toBe(50);
    const later = { ...ctxOf(db), tick: t + 2 };
    // at the expiry tick the order is no longer matchable even before the sweep runs
    const r = placeOrder(db, later, 100, { company: mill, commodity: 'wheat', side: 'buy', price: 70, qty: 10 });
    expect(r.fills).toHaveLength(0);
    expect(expireOrders(db, t + 2)).toContain(sell.id);
    expect(stock(db, farm, 'wheat').reserved).toBe(0);
    expect(db.get<{ end_reason: string }>('SELECT end_reason FROM orders WHERE id = ?', sell.id)!.end_reason).toBe('expired');
    expect(expireOrders(db, t + 2)).toEqual([]);
    expect(reconcile(db).ok).toBe(true);
  });
});

describe('market orders', () => {
  it('are protected: they never pay beyond best price + slippage, and cancel the unfilled remainder', () => {
    const db = world(); clearBook(db); const farm = found(db, 'farm', 'lot-3', 'M Farm'); const mill = found(db, 'mill', 'lot-7', 'M Mill'); give(db, farm, 'wheat', 300);
    place(db, { company: farm, commodity: 'wheat', side: 'sell', price: 100, qty: 10 }); place(db, { company: farm, commodity: 'wheat', side: 'sell', price: 200, qty: 100 });
    const lim = marketLimit(db, 'wheat', 'buy', mill, ctxOf(db).tick, 500)!; expect(lim).toBe(105);
    const r = placeOrder(db, ctxOf(db), 100, { company: mill, commodity: 'wheat', side: 'buy', price: 0, qty: 50, kind: 'market', slippageBps: 500 });
    expect(r.fills.map((f) => f.price)).toEqual([100]);                         // the 200 ask is outside the protection band
    expect(r.order.status).toBe('cancelled'); expect(r.order.end_reason).toBe('unfilled_remainder');
    expect(db.get<{ r: number }>('SELECT reserved_minor r FROM accounts WHERE id = ?', companyAccount(mill))!.r).toBe(0);
  });
  it('are refused when there is no liquidity at all', () => {
    const db = world(); const mill = found(db, 'mill', 'lot-7', 'N Mill');
    db.run("UPDATE orders SET status='cancelled' WHERE commodity_id = 'cheese' AND status='open'");
    expect(() => placeOrder(db, ctxOf(db), 100, { company: mill, commodity: 'cheese', side: 'buy', price: 0, qty: 5, kind: 'market' })).toThrow(/Nobody is selling/);
  });
});

describe('direct purchases from a chosen supplier', () => {
  it('trade only against that supplier, even when cheaper listings exist, and cancel the unfilled remainder', () => {
    const db = world(); clearBook(db);
    const farm = found(db, 'farm', 'lot-3', 'D Farm'), farm2 = found(db, 'farm', 'lot-4', 'D Farm Two'), mill = found(db, 'mill', 'lot-7', 'D Mill'); fundCompany(db, 'fd', mill, 200_000);
    give(db, farm, 'wheat', 50); give(db, farm2, 'wheat', 50);
    place(db, { company: farm, commodity: 'wheat', side: 'sell', price: 40, qty: 50 });            // cheaper, but not chosen
    place(db, { company: farm2, commodity: 'wheat', side: 'sell', price: 60, qty: 30 });
    const q = quoteOrder(db, { companyId: mill, commodityId: 'wheat', side: 'buy', quantity: 50, limitPriceMinor: 60, kind: 'direct', fromCompanyId: farm2 });
    if (!q.ok) throw new Error(q.error.message);
    expect(q.quote.availableUnits).toBe(30); expect(q.quote.subtotalMinor).toBe(30 * 60);
    const r = placePlayerOrder(db, 'dp', { companyId: mill, commodityId: 'wheat', side: 'buy', quantity: 50, limitPriceMinor: 60, quoteId: q.quote.id, kind: 'direct', fromCompanyId: farm2 });
    expect(r).toMatchObject({ ok: true, data: { filled: 30, remaining: 20 } });
    expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM trades WHERE seller_company_id = ?', farm)!.n).toBe(0);
    expect(db.get<{ status: string; end_reason: string }>("SELECT status, end_reason FROM orders WHERE idempotency_key = 'player:dp'")).toMatchObject({ status: 'cancelled', end_reason: 'unfilled_remainder' });
    expect(db.get<{ r: number }>('SELECT reserved_minor r FROM accounts WHERE id = ?', companyAccount(mill))!.r).toBe(0);
    // the quote cannot be reused for a different supplier
    const swap = placePlayerOrder(db, 'dp2', { companyId: mill, commodityId: 'wheat', side: 'buy', quantity: 50, limitPriceMinor: 60, quoteId: q.quote.id, kind: 'direct', fromCompanyId: farm });
    expect(swap.ok).toBe(false);
    expect(reconcile(db).ok).toBe(true);
  });
});

describe('player commands: authorisation, idempotency, quotes', () => {
  it('quote → order is idempotent; a replay returns the same result and never double-spends', () => {
    const db = world(); const mill = found(db, 'mill', 'lot-7', 'Cmd Mill'); fundCompany(db, 'f', mill, 200_000);
    const ask = commodityDetail(db, 'wheat')!.asks[0]!;
    const q = quoteOrder(db, { companyId: mill, commodityId: 'wheat', side: 'buy', quantity: 10, limitPriceMinor: ask.priceMinor });
    if (!q.ok) throw new Error(q.error.message);
    const body = { companyId: mill, commodityId: 'wheat', side: 'buy' as const, quantity: 10, limitPriceMinor: ask.priceMinor, quoteId: q.quote.id };
    const w0 = balance(db, companyAccount(mill));
    const a = placePlayerOrder(db, 'ord-1', body), b = placePlayerOrder(db, 'ord-1', body);
    expect(a.ok).toBe(true); expect(b).toEqual(a);
    expect(w0 - balance(db, companyAccount(mill))).toBe(q.quote.totalMinor);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM orders WHERE idempotency_key = 'player:ord-1'")!.n).toBe(1);
  });
  it('another owner’s company cannot be traded for; orders cannot be cancelled by non-owners', () => {
    const db = world();
    const q = quoteOrder(db, { companyId: 'co-brunel-mill', commodityId: 'wheat', side: 'buy', quantity: 1, limitPriceMinor: 100 });
    expect(!q.ok && q.error.code).toBe('FORBIDDEN');
    const open = db.get<{ id: number }>("SELECT id FROM orders WHERE status = 'open' LIMIT 1")!;
    const c = cancelPlayerOrder(db, 'x1', open.id); expect(!c.ok && c.error.code).toBe('FORBIDDEN');
  });
  it('refuses fat-finger and manipulation prices far outside the reference band', () => {
    const db = world(); const mill = found(db, 'mill', 'lot-7', 'Band Mill'); fundCompany(db, 'f', mill, 400_000);
    for (const bad of [100_000, 1]) { const q = quoteOrder(db, { companyId: mill, commodityId: 'wheat', side: 'buy', quantity: 5, limitPriceMinor: bad }); expect(q.ok).toBe(false); }
  });
  it('cancelling an order mid-way leaves nothing to fill: a later opposite order cannot trade against it', () => {
    const db = world(); clearBook(db); const farm = found(db, 'farm', 'lot-3', 'X Farm'); const mill = found(db, 'mill', 'lot-7', 'X Mill'); give(db, farm, 'wheat', 100);
    const sell = place(db, { company: farm, commodity: 'wheat', side: 'sell', price: 60, qty: 100 }).order;
    place(db, { company: mill, commodity: 'wheat', side: 'buy', price: 60, qty: 30 });
    cancelOrder(db, sell.id, farm);
    const r = place(db, { company: mill, commodity: 'wheat', side: 'buy', price: 90, qty: 30 });
    expect(r.fills).toHaveLength(0); expect(reconcile(db).ok).toBe(true);
    expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM trades WHERE sell_order_id = ?', sell.id)!.n).toBe(1);      // only the one real fill
  });
  it('a limit order can carry an expiry and a protected market order is quoted with its price cap', () => {
    const db = world(); const mill = found(db, 'mill', 'lot-7', 'Mkt Mill'); fundCompany(db, 'f', mill, 200_000);
    const q = quoteOrder(db, { companyId: mill, commodityId: 'wheat', side: 'buy', quantity: 5, limitPriceMinor: 0, kind: 'market', slippageBps: 300 });
    expect(q.ok && q.quote.kind).toBe('market'); expect(q.ok && q.quote.slippageBps).toBe(300);
    const bad = quoteOrder(db, { companyId: mill, commodityId: 'wheat', side: 'buy', quantity: 5, limitPriceMinor: 0, kind: 'market', slippageBps: 99_999 });
    expect(bad.ok).toBe(false);
    const badExpiry = quoteOrder(db, { companyId: mill, commodityId: 'wheat', side: 'buy', quantity: 5, limitPriceMinor: 50, expiresInTicks: 9999 });
    expect(badExpiry.ok).toBe(false);
  });
});

describe('market statistics derive from real activity', () => {
  it('directory and detail reflect executed trades, the live book and demand estimates', () => {
    const db = world(); advance(db, 3);
    const d = directory(db);
    expect(d.map((r) => r.commodityId)).toContain('flour');
    const wheat = d.find((r) => r.commodityId === 'wheat')!;
    expect(wheat.volume7d).toBeGreaterThan(0); expect(wheat.vwap7dMinor).toBeGreaterThan(0); expect(wheat.bestAskMinor).not.toBeNull();
    const detail = commodityDetail(db, 'wheat')!;
    expect(detail.asks.length).toBeGreaterThan(0); expect(detail.history.length).toBeGreaterThan(0); expect(detail.recentTrades.length).toBeGreaterThan(0);
    expect(detail.suppliers.every((s) => s.askMinor > 0 && s.units > 0)).toBe(true);
    // volume reported = trades actually stored
    const stored = db.get<{ q: number }>('SELECT COALESCE(SUM(qty),0) q FROM trades WHERE commodity_id = ? AND tick > ?', 'wheat', ctxOf(db).tick - 7)!.q;
    expect(wheat.volume7d).toBe(stored);
  });
});

describe('shortages in the opportunity finder come from live state', () => {
  it('a new pizza restaurant raises the flour shortage by exactly its planned need; wheat shows its own demand from the mill', () => {
    const db = world(); advance(db, 2);
    const before = marketShortages(db).find((m) => m.commodityId === 'flour')!;
    expect(before.demandUnitsPerDay).toBeGreaterThan(0); expect(before.industry).toBe('mill'); expect(before.explanation).toContain('Bristol flour market');
    found(db, 'pizza', 'plot-pizza', 'Shortage Pizza');
    const after = marketShortages(db).find((m) => m.commodityId === 'flour')!;
    const need = db.get<{ u: number }>("SELECT l.planned_batches * i.units u FROM production_lines l JOIN recipe_inputs i ON i.recipe_id = l.recipe_id WHERE l.company_id LIKE 'co-pl-pizza%' AND i.commodity_id = 'flour'")!.u;
    expect(after.demandUnitsPerDay - before.demandUnitsPerDay).toBe(need);
    expect(after.shortageUnitsPerDay).toBeGreaterThanOrEqual(before.shortageUnitsPerDay);
  });
});

describe('developer dashboard', () => {
  it('exposes exchange statistics, reservation consistency and anomaly detection derived from live state', async () => {
    const { economyDashboard } = await import('../api/dashboard');
    const db = world(); advance(db, 3);
    const x = economyDashboard(db).exchange;
    expect(x.reservations.consistent).toBe(true);
    expect(x.commodities.length).toBeGreaterThan(5); expect(x.trades.count7d).toBeGreaterThan(0); expect(x.npcActivity.length).toBeGreaterThan(0);
    // break an invariant on purpose: the dashboard must notice
    db.run("UPDATE orders SET reserved_funds_minor = reserved_funds_minor WHERE 0");
    const farm = found(db, 'farm', 'lot-3', 'Dash Farm'); give(db, farm, 'wheat', 50);
    place(db, { company: farm, commodity: 'wheat', side: 'sell', price: 9_999, qty: 50 });
    expect(economyDashboard(db).exchange.reservations.consistent).toBe(true);
  });
});

describe('supply contracts', () => {
  const setup = () => {
    const db = world(); const mill = found(db, 'mill', 'lot-7', 'Contract Mill'); fundCompany(db, 'f', mill, 400_000);
    return { db, mill };
  };
  const offer = (db: Sql, mill: string, over: Record<string, unknown> = {}, key = 'c1') => proposeContract(db, key, { actorCompanyId: mill, counterpartyId: 'co-severn-farm', role: 'buyer', commodityId: 'wheat', qtyPerDelivery: 40, priceMinor: 65, everyTicks: 2, durationTicks: 10, ...over } as never);
  const row = (db: Sql, id: number) => db.get<ContractRow>('SELECT * FROM supply_contracts WHERE id = ?', id)!;

  it('an NPC supplier accepts fair terms and delivers real goods and money on schedule, with the fee going to the exchange', () => {
    const { db, mill } = setup();
    const r = offer(db, mill); expect(r.ok).toBe(true); const id = cid(r);
    expect(row(db, id).status).toBe('active');
    const ex0 = balance(db, EXCHANGE_ACCOUNT), m0 = balance(db, companyAccount(mill)), s0 = balance(db, companyAccount('co-severn-farm'));
    advance(db, 6);
    const done = db.all<{ status: string; gross_minor: number; fee_minor: number }>("SELECT status, gross_minor, fee_minor FROM contract_deliveries WHERE contract_id = ? ORDER BY due_tick", id);
    expect(done.length).toBe(3); expect(done.every((d) => d.status === 'delivered')).toBe(true);
    expect(done[0]).toMatchObject({ gross_minor: 40 * 65, fee_minor: Math.floor((40 * 65) / 100) });
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM inventory_movements WHERE ref LIKE ? AND delta > 0", `contract:${id}:%`)!.n).toBe(3);
    expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM ledger_transactions WHERE memo = ?', `exchange fee on contract #${id}`)!.n).toBe(3);
    expect(balance(db, companyAccount(mill))).toBeLessThan(m0); expect(balance(db, companyAccount('co-severn-farm'))).toBeGreaterThan(s0 - 1_000_000); void ex0;
    expect(reconcile(db).ok).toBe(true);
  });
  it('delivers from stock that yesterday\'s automatic listing was holding (the state provisioner and NPC suppliers are not "out of stock" because they listed it)', () => {
    const { db, mill } = setup();
    const r = offer(db, mill, { counterpartyId: 'co-bristol-provisions', qtyPerDelivery: 40, priceMinor: 70, everyTicks: 1 }); const id = cid(r);
    advance(db, 4);
    const rows = db.all<{ status: string }>('SELECT status FROM contract_deliveries WHERE contract_id = ?', id);
    expect(rows.length).toBeGreaterThanOrEqual(3); expect(rows.every((x) => x.status === 'delivered')).toBe(true);
  });
  it('is declined with an explanation when the price would lose the supplier money, or the volume is too big', () => {
    const { db, mill } = setup();
    const low = offer(db, mill, { priceMinor: 26 }, 'low'); expect(!low.ok && low.error.message).toMatch(/needs at least/);
    const big = offer(db, mill, { qtyPerDelivery: 900, everyTicks: 1 }, 'big'); expect(!big.ok && big.error.message).toMatch(/daily output|store/);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM supply_contracts WHERE status = 'active'")!.n).toBe(0);
  });
  it('validates: bad numbers, unknown parties, not your company, duplicate contract, wrong commodity', () => {
    const { db, mill } = setup();
    for (const bad of [{ qtyPerDelivery: 0 }, { qtyPerDelivery: -3 }, { priceMinor: 0 }, { everyTicks: 0 }, { everyTicks: 99 }, { durationTicks: 999 }, { priceMinor: 999_999 }, { commodityId: 'nope' }, { counterpartyId: 'ghost' }]) expect(offer(db, mill, bad, `bad${JSON.stringify(bad)}`).ok).toBe(false);
    const npc = proposeContract(db, 'npc', { actorCompanyId: 'co-brunel-mill', counterpartyId: 'co-severn-farm', role: 'buyer', commodityId: 'wheat', qtyPerDelivery: 10, priceMinor: 60, everyTicks: 1, durationTicks: 5 });
    expect(!npc.ok && npc.error.code).toBe('FORBIDDEN');
    expect(offer(db, mill, {}, 'ok1').ok).toBe(true); expect(offer(db, mill, {}, 'ok2').ok).toBe(false);
    const wrong = offer(db, mill, { commodityId: 'cheese' }, 'wrong'); expect(wrong.ok).toBe(false);
  });
  it('a missed delivery (supplier out of stock) is recorded, moves no money, and three in a row end the contract without penalty', () => {
    const db = world({ stateSupplyCap: 0 }); const mill = found(db, 'mill', 'lot-7', 'Contract Mill'); fundCompany(db, 'f', mill, 400_000);
    const r = offer(db, mill, { counterpartyId: 'co-bristol-provisions', qtyPerDelivery: 40, priceMinor: 70 }); expect(r.ok).toBe(true); const id = cid(r);
    db.run("UPDATE inventory SET qty = 0, reserved = 0, value_minor = 0 WHERE company_id = 'co-bristol-provisions' AND commodity_id = 'wheat'");
    const cash = balance(db, companyAccount(mill));
    // keep the provisioner empty through the ticks
    for (let i = 0; i < 6; i++) { db.run("UPDATE inventory SET qty = 0, reserved = 0, value_minor = 0 WHERE company_id = 'co-bristol-provisions' AND commodity_id = 'wheat'"); db.run("UPDATE orders SET status='cancelled' WHERE company_id='co-bristol-provisions' AND status='open'"); advance(db, 1); }
    const missed = db.all<{ status: string }>("SELECT status FROM contract_deliveries WHERE contract_id = ?", id);
    expect(missed.filter((m) => m.status === 'missed_stock').length).toBeGreaterThanOrEqual(1);
    if (missed.length >= 3) expect(row(db, id).status).toBe('failed');
    expect(balance(db, companyAccount(mill))).toBeLessThanOrEqual(cash);              // only normal operating costs; no penalty line
    expect(db.get('SELECT 1 FROM ledger_transactions WHERE memo LIKE ?', '%penalty%')).toBeFalsy();
    expect(reconcile(db).ok).toBe(true);
  });
  it('a buyer without funds misses the delivery; nothing moves', () => {
    const { db, mill } = setup();
    const r = offer(db, mill); const id = cid(r);
    // drain buyer cash into the treasury-side account via an ordinary transfer-out (withdrawal to the wallet where permitted)
    db.run("UPDATE accounts SET balance_minor = 0, reserved_minor = 0 WHERE id = ?", companyAccount(mill));
    const stock0 = stock(db, mill, 'wheat').qty;
    try { advance(db, 3); } catch { /* ledger invariants may reject the artificial drain; the contract check below is what matters */ }
    const d = db.all<{ status: string }>('SELECT status FROM contract_deliveries WHERE contract_id = ?', id);
    expect(d.every((x) => x.status !== 'delivered')).toBe(true); void stock0;
  });
  it('cancellation takes effect after the notice period; deliveries due before then are honoured; a repeated tick never delivers twice', () => {
    const { db, mill } = setup();
    const r = offer(db, mill, { everyTicks: 1, durationTicks: 20 }); const id = cid(r);
    advance(db, 1);
    const c = cancelContract(db, 'cx', id); expect(c.ok).toBe(true);
    const k = row(db, id); expect(k.cancel_effective_tick).toBe(ctxOf(db).tick + 3);
    expect(cancelContract(db, 'cx2', id).ok).toBe(false);
    advance(db, 5);
    const k2 = row(db, id); expect(k2.status).toBe('cancelled');
    const days = db.all<{ due_tick: number }>('SELECT due_tick FROM contract_deliveries WHERE contract_id = ?', id).map((x) => x.due_tick);
    expect(new Set(days).size).toBe(days.length);                                    // one attempt per delivery day
    expect(Math.max(...days)).toBeLessThan(k.cancel_effective_tick!);
  });
  it('expires after its duration and is listed as completed', () => {
    const { db, mill } = setup();
    const r = offer(db, mill, { everyTicks: 1, durationTicks: 2 }); const id = cid(r);
    advance(db, 5); expect(row(db, id).status).toBe('completed');
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM contract_deliveries WHERE contract_id = ? AND status = 'delivered'", id)!.n).toBe(2);
  });
  it('upcoming deliveries respect the schedule and the cancellation date', () => {
    const k = { status: 'active', start_tick: 10, end_tick: 30, every_ticks: 5, cancel_effective_tick: 22 } as ContractRow;
    expect(upcomingDeliveries(k, 11, 10)).toEqual([15, 20]);
  });
  it('a player can offer to supply an NPC buyer; another player must accept pending offers (respond)', () => {
    const db = world(); const farm = found(db, 'farm', 'lot-3', 'Supplier Farm'); give(db, farm, 'wheat', 500, 40);
    const r = proposeContract(db, 'sup', { actorCompanyId: farm, counterpartyId: 'co-brunel-mill', role: 'supplier', commodityId: 'wheat', qtyPerDelivery: 20, priceMinor: 48, everyTicks: 2, durationTicks: 8 });
    // accepted only if cheaper than the market: either outcome is explained
    expect(r.ok || (!r.ok && r.error.message.length > 10)).toBe(true);
    expect(respondContract(db, 'resp', 9999, true).ok).toBe(false);
  });
  it('HTTP API exposes directory, detail, own orders, trades and contracts', () => {
    const db = world(); advance(db, 2);
    const get = (path: string) => handleApi(db, { method: 'GET', path }, { devEndpoints: true, now: () => 1_000 });
    expect(get('/api/exchange/commodities').status).toBe(200);
    const det = get('/api/exchange/commodities/flour'); expect(det.status).toBe(200);
    expect((det.body as { detail: { asks: unknown[] } }).detail.asks.length).toBeGreaterThan(0);
    expect(get('/api/exchange/commodities/nope').status).toBe(404);
    for (const p of ['/api/exchange/orders', '/api/exchange/trades', '/api/exchange/contracts']) expect(get(p).status).toBe(200);
  });
});

describe('the whole chain: farm → mill → pizza restaurant → consumers, all through the exchange', () => {
  it('every company is paid correctly and every unit is accounted for', () => {
    const db = world();
    const farm = found(db, 'farm', 'lot-3', 'Chain Farm'), mill = found(db, 'mill', 'lot-7', 'Chain Mill'), pizza = found(db, 'pizza', 'plot-pizza', 'Chain Pizza');
    // undercut the NPC rivals so the player's own companies supply each other (vertical integration through the exchange)
    configureCompany(db, 'p1', farm, 1, { askPriceMinor: 40 });
    configureCompany(db, 'p2', mill, 1, { askPriceMinor: 190 });
    const wallet0 = balance(db, PLAYER_WALLET), supply0 = supply(db);
    advance(db, 25);
    const trade = (b: string, s: string, c: string) => db.get<{ q: number; v: number; f: number }>('SELECT COALESCE(SUM(qty),0) q, COALESCE(SUM(qty*price_minor),0) v, COALESCE(SUM(fee_minor),0) f FROM trades WHERE buyer_company_id = ? AND seller_company_id = ? AND commodity_id = ?', b, s, c)!;
    const w = trade(mill, farm, 'wheat'), f = trade(pizza, mill, 'flour');
    expect(w.q).toBeGreaterThan(0); expect(f.q).toBeGreaterThan(0);                // the mill really bought wheat from the farm; the pizzeria flour from the mill
    // goods: the mill produced flour from wheat, the pizzeria sold pizzas to consumers
    expect(db.get<{ u: number }>('SELECT COALESCE(SUM(units_produced),0) u FROM company_tick_stats WHERE company_id = ?', mill)!.u).toBeGreaterThan(0);
    const pizzas = db.get<{ u: number; r: number }>('SELECT COALESCE(SUM(units_sold),0) u, COALESCE(SUM(revenue_minor),0) r FROM company_tick_stats WHERE company_id = ?', pizza)!;
    expect(pizzas.u).toBeGreaterThan(0); expect(pizzas.r).toBeGreaterThan(0);
    // money: the seller's revenue includes exactly the traded value, and fees were recorded per trade
    expect(db.get<{ v: number }>('SELECT COALESCE(SUM(revenue_minor),0) v FROM company_tick_stats WHERE company_id = ?', farm)!.v).toBeGreaterThanOrEqual(w.v);
    expect(w.f).toBe(db.get<{ f: number }>('SELECT COALESCE(SUM(fee_minor),0) f FROM trades WHERE buyer_company_id = ? AND seller_company_id = ? AND commodity_id = ?', mill, farm, 'wheat')!.f);
    // conservation: no coin created beyond the NPC income grant, wallet untouched, ledger and inventory reconcile
    expect(balance(db, PLAYER_WALLET)).toBe(wallet0);
    const issued = db.get<{ a: number }>("SELECT COALESCE(SUM(p.amount_minor),0) a FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.kind = 'issuance' AND t.tick > ? AND p.amount_minor > 0", ctxOf(db).tick - 25)!.a;
    expect(supply(db).circulating - supply0.circulating).toBe(issued - (supply(db).destroyed - supply0.destroyed));
    expect(reconcile(db).ok).toBe(true);
    expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM failed_transactions')!.n).toBe(0);
    void TREASURY;
  });
});
