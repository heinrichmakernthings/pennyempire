// @vitest-environment node
import { advance } from '../engine/world';
import { handleApi, type ApiRequest } from './router';
import { balance, reconcile, supply } from '../engine/ledger';
import { reconcileGbp } from '../engine/gbpLedger';
import { found, world } from '../test/shareHelpers';
import { PLAYER_WALLET } from '../seed/bristol';
import { runScheduledServices } from '../engine/services';
import type { Sql } from '../db/sql';

const TOKEN = 'correct-horse-battery';
let clock = 10_000_000_000;
const call = (db: Sql, r: ApiRequest, dev = true) => handleApi(db, { ...r, headers: { 'x-admin-token': TOKEN, ...(r.headers ?? {}) } }, { devEndpoints: dev, adminToken: TOKEN, now: () => clock });
const get = (db: Sql, path: string) => call(db, { method: 'GET', path }).body as any;
let n = 0;
const cmd = (db: Sql, body: Record<string, unknown>, key = `j-${n++}`) => call(db, { method: 'POST', path: '/api/command', body: { idempotencyKey: key, expectedRevision: 0, ...body } });
const dev = (db: Sql, action: string, body: Record<string, unknown> = {}) => call(db, { method: 'POST', path: `/api/dev/treasury/${action}`, body });

describe('the final gameplay journey (every system, end to end, through the real API)', () => {
  it('pizza restaurant → luxury car → boost → rewarded ad → 50p deposit → £5 prize → £5 withdrawal → settlement, with every balance and ledger reconciling', () => {
    const db = world(); clock = 10_000_000_000;
    // 1. a profitable Bristol restaurant earns Empire Coins from genuine sales
    const co = found(db, 'pizza', 'lot-1', 'Quay Pizza'); advance(db, 20);
    const coinsBefore = balance(db, PLAYER_WALLET); const company = (db.get<{ c: number }>('SELECT balance_minor c FROM accounts WHERE id = ?', `acct:company:${co}`) ?? { c: 0 });
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM company_tick_stats WHERE company_id = ? AND revenue_minor > 0", co)!.n).toBeGreaterThan(0); void company;
    // 2. buys a luxury car with Empire Coins: coins are burned, ownership recorded, visible in the collection
    const burned0 = supply(db).destroyed; const buy = cmd(db, { type: 'prestige.buy', itemId: 'veh-sports' }); expect(buy.status).toBe(200);
    expect(balance(db, PLAYER_WALLET)).toBe(coinsBefore - 900_000); expect(supply(db).destroyed - burned0).toBeGreaterThanOrEqual(900_000);
    advance(db, 8); expect(get(db, '/api/prestige').inventory.map((i: any) => i.id)).toEqual(['veh-sports#1']); expect(get(db, '/api/prestige').score.items).toBe(60);
    // 3. temporary production upgrade (disclosed boost) that changes real output
    const boost = cmd(db, { type: 'boost.buy', offerId: 'boost-production-3' }); expect(boost.status).toBe(200); advance(db, 3);
    expect(get(db, '/api/prestige').boosts.active[0]).toMatchObject({ kind: 'production', bps: 300 });
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM inventory_movements WHERE reason = 'production_output' AND ref LIKE '%:boost'")!.n).toBe(0);   // boosts add capacity, never input-free output
    // 4. watches a simulated rewarded ad: a frontend claim without proof gets nothing, the provider-attested completion pays once
    const start = cmd(db, { type: 'ad.reward.start', rewardId: 'ad-coins' }); expect(start.status).toBe(200); const sessionId = (start.body as any).data.sessionId;
    const cheat = cmd(db, { type: 'ad.reward.complete', sessionId, token: 'i-totally-watched-it' }); expect(cheat.status).toBe(422);
    const early = call(db, { method: 'POST', path: '/api/ads/attest', body: { sessionId } }); expect(early.status).toBe(422);
    expect((db.get<{ status: string }>('SELECT status FROM ad_view_sessions WHERE id = ?', sessionId))!.status).toBe('rejected');   // the cheated session is burned and recorded
    const s2 = cmd(db, { type: 'ad.reward.start', rewardId: 'ad-coins' }); expect(s2.status).toBe(200); const sid = (s2.body as any).data.sessionId; clock += 16_000;
    const att = call(db, { method: 'POST', path: '/api/ads/attest', body: { sessionId: sid } }); expect(att.status).toBe(200);
    const w1 = balance(db, PLAYER_WALLET); const done = cmd(db, { type: 'ad.reward.complete', sessionId: sid, token: (att.body as any).token }); expect(done.status).toBe(200); expect(balance(db, PLAYER_WALLET) - w1).toBe(5_000);
    const replay = cmd(db, { type: 'ad.reward.complete', sessionId: sid, token: (att.body as any).token }); expect((replay.body as any).data.duplicate).toBe(true); expect(balance(db, PLAYER_WALLET) - w1).toBe(5_000);
    // 5. 50p simulated deposit into the separate GBP_TEST wallet; Empire Coins are unaffected
    const coinsMid = balance(db, PLAYER_WALLET); const dep = cmd(db, { type: 'wallet.testDeposit', amountMinor: 50 }); expect(dep.status).toBe(200); expect(balance(db, PLAYER_WALLET)).toBe(coinsMid);
    expect(get(db, '/api/wallet').availablePence).toBe(50);
    // 6. a properly funded test reward programme pays a simulated £5 prize
    expect(dev(db, 'fund', { amountPence: 100_000 }).status).toBe(200);
    expect(dev(db, 'create_program', { id: 'launch-prize', name: 'Launch prize (simulated)', source: 'achievement', rules: [{ kind: 'min_companies', value: 1 }], awardPence: 500, budgetPence: 500 }).status).toBe(200);
    expect(dev(db, 'award', { programId: 'launch-prize' }).status).toBe(422);                       // not funded yet: the programme cannot pay
    expect(dev(db, 'fund_program', { id: 'launch-prize', amountPence: 500 }).status).toBe(200);
    expect(dev(db, 'award', { programId: 'launch-prize' }).status).toBe(200); expect((dev(db, 'award', { programId: 'launch-prize' }).body as any).message).toContain('Already awarded');
    expect(get(db, '/api/wallet').availablePence).toBe(550); expect(get(db, '/api/wallet').rewards[0].program).toContain('Launch prize');
    // 7. requests a £5 withdrawal (the £5 minimum is enforced); funds are reserved; double requests cannot spend them twice
    expect(cmd(db, { type: 'wallet.testWithdraw', amountMinor: 499 }).status).toBe(422);
    const wd = cmd(db, { type: 'wallet.testWithdraw', amountMinor: 500 }); expect(wd.status).toBe(200); const wid = (wd.body as any).data.withdrawalId;
    expect(get(db, '/api/wallet')).toMatchObject({ availablePence: 50, pendingPence: 500 }); expect(cmd(db, { type: 'wallet.testWithdraw', amountMinor: 500 }).status).toBe(422);
    // 8. the mock payment system approves and settles it
    expect(dev(db, 'withdrawal', { id: wid, action: 'approve' }).status).toBe(200); expect(dev(db, 'withdrawal', { id: wid, action: 'pay_duplicate' }).status).toBe(200);
    const final = get(db, '/api/wallet'); expect(final).toMatchObject({ availablePence: 50, pendingPence: 0 }); expect(final.withdrawals[0].status).toBe('paid');
    // everything reconciles: both ledgers, ownership, rewards; the two currencies never mixed
    runScheduledServices(db, clock);
    const rec = reconcileGbp(db); expect(rec.problems).toEqual([]); expect(reconcile(db).ok).toBe(true);
    const t = get(db, '/api/dev/treasury').treasury; expect(t.reconciles).toBe(true); expect(t.rewards.issuedPence).toBe(500); expect(t.playerFunds.walletLiabilitiesPence).toBe(50); expect(t.revenue.totalPence).toBe(0);   // deposits and prizes are not revenue
    expect(t.cash.coverageOfPlayerFundsPence).toBeGreaterThanOrEqual(0);
    expect(db.get("SELECT 1 FROM gbp_accounts WHERE id LIKE 'acct:%'")).toBeUndefined();
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM prestige_owned")!.n).toBe(1);
  });
});

describe('exploit and permission tests through the API', () => {
  it('treasury and admin actions are unavailable to players: no token, a wrong token, or deployment mode (dev endpoints off)', () => {
    const db = world(); const anon = { method: 'POST', path: '/api/admin/treasury/fund', body: { amountPence: 100 } } as ApiRequest;
    expect(handleApi(db, anon, { devEndpoints: false, adminToken: TOKEN }).status).toBe(403); expect(handleApi(db, { ...anon, headers: { 'x-admin-token': 'nope-nope-nope-nope' } }, { devEndpoints: false, adminToken: TOKEN }).status).toBe(403);
    expect(handleApi(db, { ...anon, path: '/api/dev/treasury/fund' }, { devEndpoints: false, adminToken: TOKEN }).status).toBe(404); expect(handleApi(db, { method: 'GET', path: '/api/dev/treasury' }, { devEndpoints: false }).status).toBe(404);   // developer endpoints do not exist in deployment
    expect(handleApi(db, { ...anon, headers: { 'x-admin-token': TOKEN } }, { devEndpoints: false, adminToken: TOKEN }).status).toBe(200);   // the right token works even in deployment
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM gbp_audit WHERE ok = 0")!.n).toBe(0); expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM admin_log WHERE ok = 0")!.n).toBeGreaterThanOrEqual(2);
  });
  it('a player cannot mint GBP: there is no command that credits the wallet except a (simulated) deposit through the provider and funded rewards', () => {
    const db = world(); for (const type of ['wallet.credit', 'wallet.setBalance', 'gbp.mint', 'wallet.convertCoins', 'prestige.sell', 'reward.claim']) expect(cmd(db, { type, amountMinor: 1_000_000 }).status).toBeGreaterThanOrEqual(400);
    expect(get(db, '/api/wallet').availablePence).toBe(0); expect(call(db, { method: 'POST', path: '/api/admin/balance', body: { amount: 5 } }).status).toBe(404);
  });
  it('currency separation: coin purchases never touch GBP, GBP actions never touch coins, and neither converts to the other', () => {
    const db = world({}, 5_000_000); const coins = balance(db, PLAYER_WALLET);
    cmd(db, { type: 'wallet.testDeposit', amountMinor: 1_000 }); cmd(db, { type: 'membership.subscribe' }); expect(balance(db, PLAYER_WALLET)).toBe(coins);
    const gbp = get(db, '/api/wallet').availablePence; cmd(db, { type: 'prestige.buy', itemId: 'veh-executive' }); cmd(db, { type: 'boost.buy', offerId: 'boost-marketing-5' }); cmd(db, { type: 'lottery.buy', lotteryId: get(db, '/api/rewards').lotteries[0].id, count: 1 });
    expect(get(db, '/api/wallet').availablePence).toBe(gbp); expect(reconcileGbp(db).ok).toBe(true);
  });
  it('a repeated command with the same key is returned from the log: no second purchase, boost, ticket, deposit or withdrawal', () => {
    const db = world({}, 5_000_000); dev(db, 'fund', { amountPence: 10_000 });
    for (const [t, body] of [['prestige.buy', { itemId: 'veh-executive' }], ['boost.buy', { offerId: 'boost-production-3' }], ['wallet.testDeposit', { amountMinor: 1_000 }], ['membership.subscribe', {}]] as const) { const a = cmd(db, { type: t, ...body }, `same-${t}`), b = cmd(db, { type: t, ...body }, `same-${t}`); expect(b.body).toEqual(a.body); }
    cmd(db, { type: 'wallet.testWithdraw', amountMinor: 500 }, 'wd-same'); cmd(db, { type: 'wallet.testWithdraw', amountMinor: 500 }, 'wd-same');
    expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM prestige_owned')!.n).toBe(1); expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM boosts')!.n).toBe(1); expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM gbp_deposits')!.n).toBe(1);
    expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM gbp_withdrawals')!.n).toBe(1); expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM membership_payments')!.n).toBe(1); expect(reconcileGbp(db).ok).toBe(true);
  });
  it('developer provider scenarios: failed, cancelled and duplicate-webhook deposits behave and reconcile', () => {
    const db = world(); for (const [o, amt] of [['succeeded', 50], ['failed', 100], ['cancelled', 200], ['duplicate', 500]] as const) expect(dev(db, 'deposit', { amountPence: amt, outcome: o }).status).toBe(200);
    expect(get(db, '/api/wallet').availablePence).toBe(550); expect(get(db, '/api/wallet').deposits.map((d: any) => d.status).sort()).toEqual(['cancelled', 'failed', 'succeeded', 'succeeded']);
    expect(dev(db, 'deposit', { amountPence: 49, outcome: 'succeeded' }).status).toBe(422); expect(reconcileGbp(db).ok).toBe(true);
  });
  it('mass-withdrawal and simultaneous-reward stress: the books stay balanced and nothing overspends', () => {
    const db = world(); dev(db, 'fund', { amountPence: 50_000 }); dev(db, 'create_program', { id: 'burst', name: 'Burst', source: 'promotion', rules: [{ kind: 'open' }], awardPence: 500, budgetPence: 2_000, perPlayerMax: 1 }); dev(db, 'fund_program', { id: 'burst', amountPence: 2_000 });
    const results = Array.from({ length: 20 }, (_, i) => { const r = dev(db, 'award', { programId: 'burst', key: `claim-${i % 5}` }).body as any; return String(r.message ?? r.error?.message); });
    expect(results.filter((m) => m.startsWith('Awarded')).length).toBe(1);               // one player, one award, however many simultaneous claims and keys
    for (let i = 0; i < 6; i++) dev(db, 'deposit', { amountPence: 1_000, outcome: 'succeeded', key: `d${i}` });
    const ids = Array.from({ length: 3 }, (_, i) => (cmd(db, { type: 'wallet.testWithdraw', amountMinor: 1_000 }, `mw${i}`).body as any)?.data?.withdrawalId).filter(Boolean);
    for (const id of ids) { dev(db, 'withdrawal', { id, action: 'approve' }); dev(db, 'withdrawal', { id, action: 'pay' }); }
    const t = get(db, '/api/dev/treasury').treasury; expect(t.reconciles).toBe(true); expect(t.cash.coverageOfPlayerFundsPence).toBeGreaterThanOrEqual(0); expect(t.problems).toEqual([]);
  });
  it('the commercial scenarios are labelled assumption-based and book nothing; recorded revenue stays zero until a statement is entered', () => {
    const db = world(); const t = get(db, '/api/dev/treasury').treasury; expect(t.scenarios.length).toBe(3); expect(t.scenarios[0].label).toContain('NOT A FORECAST'); expect(t.revenue.totalPence).toBe(0); expect(t.impressions.estimatedRevenuePence).toBeNull();
    dev(db, 'fund', { amountPence: 1_000 }); dev(db, 'record_revenue', { stream: 'advertising', amountPence: 123 }); expect(get(db, '/api/dev/treasury').treasury.revenue.advertising).toBe(123);
    expect(dev(db, 'record_expense', { kind: 'hosting', amountPence: 10 ** 9 }).status).toBe(422);
    for (const s of t.scenarios) { expect(s.netRevenuePence).toBeLessThanOrEqual(s.grossRevenuePence); expect(s.sustainableRewardBudgetPence).toBeLessThanOrEqual(Math.max(0, s.operatingProfitPence)); }
  });
});
