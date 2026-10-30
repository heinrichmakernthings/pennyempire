// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { advance, openWorld } from '../engine/world';
import { reconcile } from '../engine/ledger';
import { reconcileGbp } from '../engine/gbpLedger';
import { client, order, player } from '../test/http';

const dir = mkdtempSync(join(tmpdir(), 'pe-alpha-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const inv = (db: ReturnType<typeof openWorld>, co: string, c: string) => db.get<{ q: number; r: number }>('SELECT qty q, reserved r FROM inventory WHERE company_id = ? AND commodity_id = ?', co, c) ?? { q: 0, r: 0 };

describe('two-player private-alpha playtest (Prompt 10 §19)', () => {
  it('farm → wheat → mill → flour → pizza, shares, dividends, prestige, an economic event, simulated GBP reward and withdrawal, and persistence', async () => {
    const path = join(dir, 'world.db');
    let db = openWorld(path, { realMsPerTick: 3_600_000_000 }, 'new');
    const admin = await player(db, 'organiser', 'admin'); const A = await player(db, 'alice'); const B = await player(db, 'bob');
    const log: string[] = []; const note = (s: string) => log.push(s);

    // 1. Player A starts a farm and produces wheat
    const fq = (await A.get('/api/startup-quote?industry=farm&plotId=lot-3&tier=1')).quote;
    const farm = (await A.cmd({ type: 'company.create', industry: 'farm', plotId: 'lot-3', tier: 1, name: 'Alice Acres', expectedTotalMinor: fq.totalMinor })).body.data.companyId as string;
    advance(db, 3);
    note(`farm wheat after 3 days: ${inv(db, farm, 'wheat').q}`);
    expect(inv(db, farm, 'wheat').q).toBeGreaterThan(0);

    // 2. Player B starts a mill and buys A's wheat directly (player-to-player trade)
    const mq = (await B.get('/api/startup-quote?industry=mill&plotId=lot-4&tier=1')).quote;
    const mill = (await B.cmd({ type: 'company.create', industry: 'mill', plotId: 'lot-4', tier: 1, name: 'Bob Mills', expectedTotalMinor: mq.totalMinor })).body.data.companyId as string;
    const sell = await order(A, farm, 'wheat', 'sell', 40, 55); expect(sell.status).toBe(200);
    const buy = await order(B, mill, 'wheat', 'buy', 40, 55, { orderKind: 'direct', fromCompanyId: farm });
    note(`direct buy: ${JSON.stringify(buy.body.data ?? buy.body.error)}`);
    expect(buy.body.data.filled).toBe(40);
    expect(db.get<{ n: number }>('SELECT SUM(qty) n FROM trades WHERE seller_company_id = ? AND buyer_company_id = ?', farm, mill)!.n).toBe(40);
    advance(db, 3);
    note(`mill flour after 3 days: ${inv(db, mill, 'flour').q}`);
    expect(inv(db, mill, 'flour').q).toBeGreaterThan(0);

    // 3. Player A opens a pizza restaurant, buys B's flour directly and cheese on the open market, and sells pizza to Bristol households
    const pq = (await A.get('/api/startup-quote?industry=pizza&plotId=plot-pizza&tier=1')).quote;
    const pizza = (await A.cmd({ type: 'company.create', industry: 'pizza', plotId: 'plot-pizza', tier: 1, name: 'Alice Slices', expectedTotalMinor: pq.totalMinor })).body.data.companyId as string;
    const flourAsk = 230;
    expect((await order(B, mill, 'flour', 'sell', 60, flourAsk)).status).toBe(200);
    const fb = await order(A, pizza, 'flour', 'buy', 60, flourAsk, { orderKind: 'direct', fromCompanyId: mill });
    note(`flour direct buy: ${JSON.stringify(fb.body.data ?? fb.body.error)}`); expect(fb.body.data.filled).toBe(60);
    const cb = await order(A, pizza, 'cheese', 'buy', 60, 400); note(`cheese buy: ${JSON.stringify(cb.body.data ?? cb.body.error)}`);
    for (const [c, co] of [[A, pizza], [A, farm], [B, mill]] as const) expect((await c.cmd({ type: 'company.configure', companyId: co, expectedRevision: (await c.get(`/api/companies/${co}`)).envelope.revision, autoProcure: true })).status).toBe(200);
    advance(db, 16);
    const rev = db.get<{ r: number; u: number }>('SELECT COALESCE(SUM(revenue_minor),0) r, COALESCE(SUM(units_sold),0) u FROM company_tick_stats WHERE company_id = ?', pizza)!;
    note(`pizza after 16 days: ${rev.u} pizzas sold, revenue ${rev.r / 100} EC, status ${db.get<{ s: string }>('SELECT status s FROM companies WHERE id = ?', pizza)!.s}`);
    expect(rev.u).toBeGreaterThan(0);

    // 4. Player A lists the pizza company; player B buys shares; A declares a dividend that B receives
    const lq = (await A.get(`/api/securities/listing-quote?companyId=${pizza}&newShares=2000&offerPriceMinor=1`)).quote;
    note(`listing: eligible=${lq.eligible} failing=${JSON.stringify(lq.checks.filter((c: any) => !c.ok))} range=${JSON.stringify(lq.priceRange)}`);
    const price = lq.priceRange.fairValueMinor;
    const list = await A.cmd({ type: 'share.list', companyId: pizza, newShares: 2000, offerPriceMinor: price }); note(`list: ${JSON.stringify(list.body.data ?? list.body.error)}`); expect(list.status).toBe(200);
    advance(db, 1);
    const sb = await B.cmd({ type: 'share.order', companyId: pizza, side: 'buy', quantity: 300, limitPriceMinor: price, orderKind: 'limit' }); note(`B share buy: ${JSON.stringify(sb.body.data ?? sb.body.error)}`); expect(sb.status).toBe(200);
    advance(db, 2);
    const bHold = () => db.get<{ s: number }>('SELECT COALESCE(SUM(shares),0) s FROM share_holdings WHERE company_id = ? AND investor_id = ?', pizza, B.playerId)?.s ?? 0;
    note(`B holds ${bHold()} shares of ${pizza}`); expect(bHold()).toBeGreaterThan(0);
    const dv = await A.cmd({ type: 'dividend.declare', companyId: pizza, perShareMinor: 2 }); note(`dividend: ${JSON.stringify(dv.body.data ?? dv.body.error)}`); expect(dv.status).toBe(200);
    advance(db, 3);
    const paid = db.get<{ a: number }>("SELECT COALESCE(SUM(e.amount_minor),0) a FROM dividend_entitlements e JOIN dividends d ON d.id = e.dividend_id WHERE d.company_id = ? AND e.investor_id = ? AND d.status = 'paid'", pizza, B.playerId)!.a;
    note(`B dividend received: ${paid / 100} EC`); expect(paid).toBe(bHold() * 2);
    expect((await B.get('/api/notifications')).items.some((n: any) => n.kind === 'dividend_received')).toBe(true);

    // 5. prestige purchase (coins are destroyed, not transferred), an administrator economic event that every player sees
    const pres = await A.cmd({ type: 'prestige.buy', itemId: 'veh-executive' }); note(`prestige: ${JSON.stringify(pres.body.data ?? pres.body.error)}`); expect(pres.status).toBe(200);
    const ev = await admin.call('POST', '/api/admin/event', { type: 'recession', severity: 1, days: 5, reason: 'alpha playtest: recession drill' }); expect(ev.status).toBe(200);
    advance(db, 1);
    for (const p of [A, B]) expect((await p.get('/api/notifications')).items.some((n: any) => n.kind === 'eco_event_start')).toBe(true);

    // 6. SIMULATED GBP: funded reward programme pays A £5; A requests a £5 withdrawal; the operator approves and the mock processor pays
    const t = (action: string, body: Record<string, unknown>) => admin.call('POST', `/api/admin/treasury/${action}`, body);
    expect((await t('fund', { amountPence: 10_000, key: 'alpha-fund' })).status).toBe(200);
    expect((await t('create_program', { id: 'alpha-launch', name: 'Alpha launch prize (simulated)', source: 'achievement', rules: [{ kind: 'min_companies', value: 1 }], awardPence: 500, budgetPence: 1_000 })).status).toBe(200);
    expect((await t('fund_program', { id: 'alpha-launch', amountPence: 1_000 })).status).toBe(200);
    const aw = await t('award', { programId: 'alpha-launch', playerId: A.playerId }); note(`award: ${JSON.stringify(aw.body)}`); expect(aw.status).toBe(200);
    expect((await A.get('/api/wallet')).availablePence).toBe(500);
    expect((await B.get('/api/wallet')).availablePence).toBe(0);                                           // B's wallet is separate and untouched
    const wd = await A.cmd({ type: 'wallet.testWithdraw', amountMinor: 500 }); expect(wd.status).toBe(200);
    expect((await B.cmd({ type: 'wallet.cancelWithdrawal', withdrawalId: wd.body.data.withdrawalId })).status).toBeGreaterThanOrEqual(400);   // B cannot touch A's withdrawal
    expect((await t('withdrawal', { id: wd.body.data.withdrawalId, action: 'approve' })).status).toBe(200);
    expect((await t('withdrawal', { id: wd.body.data.withdrawalId, action: 'pay' })).status).toBe(200);
    const aw2 = await A.get('/api/wallet'); expect(aw2).toMatchObject({ availablePence: 0, pendingPence: 0 }); expect(aw2.withdrawals[0].status).toBe('paid');
    expect(reconcile(db).ok).toBe(true); expect(reconcileGbp(db).problems).toEqual([]);

    // 7. persistence: the world is closed and reopened from disk; players sign out and back in and find everything as they left it
    const snapshot = { a: (await A.get('/api/screens/portfolio')).envelope.data, bShares: bHold(), tick: db.get<{ t: number }>('SELECT last_tick t FROM engine_state')!.t };
    await A.call('POST', '/api/auth/logout'); db.close();
    db = openWorld(path, { realMsPerTick: 3_600_000_000 }, 'new');
    const A2 = client(db, 'alice'); expect((await A2.call('POST', '/api/auth/login', { username: 'alice', password: 'alice-long-password' })).status).toBe(200);
    expect((await A2.get('/api/screens/portfolio')).envelope.data).toEqual(snapshot.a);
    expect(db.get<{ t: number }>('SELECT last_tick t FROM engine_state')!.t).toBe(snapshot.tick);
    expect(bHold()).toBe(snapshot.bShares);
    const B2 = client(db, 'bob'); B2.cookie = B.cookie; expect((await B2.get('/api/auth/me')).user.username).toBe('bob');   // B's session survives the restart
    expect((await A2.get('/api/prestige')).inventory.length).toBe(1);
    expect(reconcile(db).ok).toBe(true); expect(reconcileGbp(db).ok).toBe(true);
    db.close();
    process.stdout.write('\n' + log.join('\n') + '\n');
  });
});
