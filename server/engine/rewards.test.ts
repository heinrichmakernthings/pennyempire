// @vitest-environment node
import { advance } from './world';
import { balance, createAccount, issue, reconcile, supply } from './ledger';
import { found, now, sane, world } from '../test/shareHelpers';
import { PLAYER_ID, PLAYER_WALLET } from '../seed/bristol';
import { AD_REWARDS, MAX_SESSIONS_PER_DAY, SESSION_TTL_MS, awardReward, completeAdView, createDraw, createProgram, enterDraw, executeDraw, fundProgram, providerAttest, rewardAvailability, startAdView, recordImpression } from './rewards';
import { activeBoosts } from './boosts';
import { LOTTERY, buyTickets, drawDueLotteries, ensureOpenLottery, lotteryView, publishedOdds } from './lottery';
import { PLAN, cancelMembership, hasPremium, membershipView, runMembershipRenewals, setMockDecline, subscribe } from './membership';
import { CASH, GbpError, ensureGbpBooks, ensureWallet, reconcileGbp, availablePence, type GbpCtx } from './gbpLedger';
import { fundTreasury, requestWithdrawal, walletView } from './gbpWallet';
import { runScheduledServices } from './services';
import type { Sql } from '../db/sql';

const one = <T>(db: Sql, sql: string, ...a: (string | number)[]) => db.get<T>(sql, ...a)!;
const g = (db: Sql, ms = 1_000_000): GbpCtx => ({ tick: now(db).tick, ms, actor: 'test' });
const gw = () => { const db = world({}, 5_000_000); ensureGbpBooks(db); ensureWallet(db, PLAYER_ID); return db; };
const addPlayer = (db: Sql, id: string, coins = 5_000_000) => { createAccount(db, `acct:player:${id}`, 'player', id); db.run("INSERT INTO players (id, display_name, city_id, wallet_account_id) VALUES (?,?,'city-bristol',?)", id, id, `acct:player:${id}`); issue(db, now(db), `grant:${id}`, `acct:player:${id}`, coins, 'test'); return id; };
const denied = (fn: () => unknown, re?: RegExp) => { try { fn(); } catch (e) { if (re) expect((e as Error).message).toMatch(re); return; } throw new Error('expected refusal'); };

describe('rewarded video advertisements (simulated provider)', () => {
  const watch = (db: Sql, t0: number, rewardId = 'ad-coins', player = PLAYER_ID) => {
    const s = startAdView(db, now(db), t0, { playerId: player, rewardId }); const { token } = providerAttest(db, t0 + 20_000, s.sessionId);
    return completeAdView(db, now(db), t0 + 21_000, { playerId: player, sessionId: s.sessionId, token });
  };
  it('a verified view issues the reward exactly once: coins via a labelled issuance, replay returns the same grant', () => {
    const db = world(); const w0 = balance(db, PLAYER_WALLET), i0 = supply(db).issued;
    const s = startAdView(db, now(db), 1_000, { playerId: PLAYER_ID, rewardId: 'ad-coins' }); const { token } = providerAttest(db, 30_000, s.sessionId);
    const a = completeAdView(db, now(db), 31_000, { playerId: PLAYER_ID, sessionId: s.sessionId, token }), b = completeAdView(db, now(db), 32_000, { playerId: PLAYER_ID, sessionId: s.sessionId, token });
    expect(a.duplicate).toBe(false); expect(b.duplicate).toBe(true); expect(balance(db, PLAYER_WALLET) - w0).toBe(5_000); expect(supply(db).issued - i0).toBe(5_000);
    expect(one<{ memo: string }>(db, `SELECT memo FROM ledger_transactions WHERE idempotency_key = 'adreward:${s.sessionId}'`).memo).toContain('simulated provider'); sane(db);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM ad_rewards_granted').n).toBe(1);
  });
  it('fraud: a frontend that says "completed" without the provider proof, too early, with a forged or another session\'s token gets nothing', () => {
    const db = world(); const w0 = balance(db, PLAYER_WALLET);
    const s1 = startAdView(db, now(db), 1_000, { playerId: PLAYER_ID, rewardId: 'ad-coins' });
    denied(() => providerAttest(db, 2_000, s1.sessionId), /not finished/);                                         // the provider refuses an early attestation
    denied(() => completeAdView(db, now(db), 2_000, { playerId: PLAYER_ID, sessionId: s1.sessionId, token: 'anything' }), /before the minimum/);
    expect(one<{ status: string }>(db, 'SELECT status FROM ad_view_sessions WHERE id = ?', s1.sessionId).status).toBe('rejected');   // a failed attempt burns the session
    const s2 = startAdView(db, now(db), 100_000, { playerId: PLAYER_ID, rewardId: 'ad-coins' });
    denied(() => completeAdView(db, now(db), 130_000, { playerId: PLAYER_ID, sessionId: s2.sessionId, token: 'forged' }), /proof/);
    const s3 = startAdView(db, now(db), 300_000, { playerId: PLAYER_ID, rewardId: 'ad-coins' }); const good = providerAttest(db, 330_000, s3.sessionId).token;
    const s4 = startAdView(db, now(db), 900_000, { playerId: PLAYER_ID, rewardId: 'ad-coins' }); denied(() => completeAdView(db, now(db), 930_000, { playerId: PLAYER_ID, sessionId: s4.sessionId, token: good }), /proof/);   // token of another session
    const other = addPlayer(db, 'thief'); denied(() => completeAdView(db, now(db), 340_000, { playerId: other, sessionId: s3.sessionId, token: good }), /No such/);                                        // someone else's session
    expect(balance(db, PLAYER_WALLET)).toBe(w0); expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM ad_rewards_granted').n).toBe(0);
  });
  it('expired sessions pay nothing; starting twice resumes the same session (no double reward)', () => {
    const db = world(); const s = startAdView(db, now(db), 1_000, { playerId: PLAYER_ID, rewardId: 'ad-coins' }); expect(startAdView(db, now(db), 5_000, { playerId: PLAYER_ID, rewardId: 'ad-coins' }).sessionId).toBe(s.sessionId);
    const { token } = providerAttest(db, 20_000, s.sessionId); denied(() => completeAdView(db, now(db), 1_000 + SESSION_TTL_MS + 1, { playerId: PLAYER_ID, sessionId: s.sessionId, token }), /expired/);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM ad_rewards_granted').n).toBe(0);
  });
  it('daily limits and cooldowns hold, and a new game day resets the daily count', () => {
    const db = world(); let t = 1_000_000; const grant = () => { const r = watch(db, t); t += 40_000; return r; };
    grant(); denied(() => startAdView(db, now(db), t, { playerId: PLAYER_ID, rewardId: 'ad-coins' }), /Next reward/);       // cooldown
    const cd = AD_REWARDS[0]!.cooldownMs; for (let i = 1; i < AD_REWARDS[0]!.dailyLimit; i++) { t += cd; grant(); }
    t += cd; denied(() => startAdView(db, now(db), t, { playerId: PLAYER_ID, rewardId: 'ad-coins' }), /all of today/);
    expect(rewardAvailability(db, now(db), t, PLAYER_ID).find((r) => r.id === 'ad-coins')!.remainingToday).toBe(0);
    advance(db, 1); expect(startAdView(db, now(db), t, { playerId: PLAYER_ID, rewardId: 'ad-coins' }).sessionId).toBeTruthy();
    expect(MAX_SESSIONS_PER_DAY).toBeGreaterThan(AD_REWARDS[0]!.dailyLimit);
  });
  it('a boost reward is granted as a capped, non-stacking boost; simultaneous claims by two players each get exactly one', () => {
    const db = world(); const r = watch(db, 1_000_000, 'ad-boost-production'); expect(r.granted.kind).toBe('boost');
    expect(activeBoosts(db, PLAYER_ID, now(db).tick).map((b) => [b.kind, b.bps, b.source])).toEqual([['production', 200, 'rewarded_ad']]);
    const p2 = addPlayer(db, 'p2'), p3 = addPlayer(db, 'p3'); const s2 = startAdView(db, now(db), 5_000_000, { playerId: p2, rewardId: 'ad-coins' }), s3 = startAdView(db, now(db), 5_000_000, { playerId: p3, rewardId: 'ad-coins' });
    const t2 = providerAttest(db, 5_030_000, s2.sessionId).token, t3 = providerAttest(db, 5_030_000, s3.sessionId).token;
    completeAdView(db, now(db), 5_031_000, { playerId: p2, sessionId: s2.sessionId, token: t2 }); completeAdView(db, now(db), 5_031_000, { playerId: p3, sessionId: s3.sessionId, token: t3 });
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM ad_rewards_granted').n).toBe(3); sane(db);
  });
  it('impressions are counted per slot and unknown slots are refused', () => { const db = world(); recordImpression(db, now(db), 'sidebar'); recordImpression(db, now(db), 'sidebar'); expect(one<{ count: number }>(db, "SELECT count FROM ad_impressions WHERE slot = 'sidebar'").count).toBe(2); denied(() => recordImpression(db, now(db), 'popup')); });
});

describe('cash reward programmes (simulated treasury)', () => {
  const funded = (budget = 1_000, award = 500) => { const db = gw(); fundTreasury(db, g(db), 'f', 100_000, 'dev-funded'); createProgram(db, g(db), { id: 'prog', name: 'Test programme', source: 'achievement', rules: [{ kind: 'open' }], awardPence: award, budgetPence: budget, perPlayerMax: 1 }); fundProgram(db, g(db), 'prog', budget); return db; };
  it('pays from the prize reserve into the wallet with a full audit record, and reconciles', () => {
    const db = funded(); const r = awardReward(db, g(db), { programId: 'prog', playerId: PLAYER_ID, key: 'a1' });
    expect(r.amountPence).toBe(500); expect(availablePence(db, PLAYER_ID)).toBe(500);
    const a = one<{ audit_json: string; ledger_tx_id: number; player_id: string; issued_ms: number }>(db, 'SELECT * FROM reward_awards'); expect(JSON.parse(a.audit_json).funding).toBe('prize_reserve'); expect(a.ledger_tx_id).toBe(r.ledgerTxId);
    expect(walletView(db, PLAYER_ID).rewards[0]!.program).toBe('Test programme'); const rec = reconcileGbp(db); expect(rec.problems).toEqual([]);
  });
  it('is idempotent and enforces per-player maximums (no payout duplication)', () => {
    const db = funded(2_000, 500); expect(awardReward(db, g(db), { programId: 'prog', playerId: PLAYER_ID, key: 'k' }).duplicate).toBe(false); expect(awardReward(db, g(db), { programId: 'prog', playerId: PLAYER_ID, key: 'k' }).duplicate).toBe(true);
    denied(() => awardReward(db, g(db), { programId: 'prog', playerId: PLAYER_ID, key: 'k2' }), /maximum/); expect(availablePence(db, PLAYER_ID)).toBe(500);
  });
  it('budget exhaustion and an unfunded reserve stop payouts; the reserve can never go negative', () => {
    const db = funded(1_000, 500); for (const [i, p] of ['p1', 'p2'].entries()) { addPlayer(db, p); awardReward(db, g(db), { programId: 'prog', playerId: p, key: `b${i}` }); }
    addPlayer(db, 'p3'); denied(() => awardReward(db, g(db), { programId: 'prog', playerId: 'p3', key: 'b3' }), /budget is exhausted/);
    const db2 = gw(); fundTreasury(db2, g(db2), 'f', 100_000, 'x'); createProgram(db2, g(db2), { id: 'u', name: 'Unfunded', source: 'promotion', rules: [{ kind: 'open' }], awardPence: 500, budgetPence: 1_000 });
    denied(() => awardReward(db2, g(db2), { programId: 'u', playerId: PLAYER_ID, key: 'x' }), /reserve cannot cover/);
    expect(reconcileGbp(db).ok && reconcileGbp(db2).ok).toBe(true);
  });
  it('eligibility is enforced, loss-based rules cannot even be defined, NPCs are never paid, and funding cannot exceed the budget', () => {
    const db = gw(); fundTreasury(db, g(db), 'f', 100_000, 'x');
    denied(() => createProgram(db, g(db), { id: 'bad', name: 'Pity bonus', source: 'promotion', rules: [{ kind: 'min_losses', value: 1 } as never], awardPence: 100, budgetPence: 1_000 }), /never on losses/);
    createProgram(db, g(db), { id: 'rich', name: 'Prestige prize', source: 'achievement', rules: [{ kind: 'min_prestige', value: 500 }], awardPence: 500, budgetPence: 500 }); fundProgram(db, g(db), 'rich', 500);
    denied(() => awardReward(db, g(db), { programId: 'rich', playerId: PLAYER_ID, key: 'r' }), /Not eligible/); denied(() => awardReward(db, g(db), { programId: 'rich', playerId: 'co-clifton-slice', key: 'r2' }), /human players/);
    denied(() => fundProgram(db, g(db), 'rich', 1), /exceed the programme budget/);
    createProgram(db, g(db), { id: 'co', name: 'Profit prize', source: 'achievement', rules: [{ kind: 'min_companies', value: 1 }], awardPence: 500, budgetPence: 500 }); fundProgram(db, g(db), 'co', 500);
    denied(() => awardReward(db, g(db), { programId: 'co', playerId: PLAYER_ID, key: 'c' }), /Not eligible/); found(db, 'pizza', 'lot-1', 'Prize Pizza'); expect(awardReward(db, g(db), { programId: 'co', playerId: PLAYER_ID, key: 'c2' }).amountPence).toBe(500);
  });
  it('free-entry prize draw: free, one entry each, secure random pick, committed entry hash, winner paid once from the reserve', () => {
    const db = funded(500, 500); db.run("UPDATE reward_programs SET source = 'prize_draw'"); const p2 = addPlayer(db, 'p2');
    createDraw(db, g(db), { id: 'draw1', programId: 'prog', name: 'Free draw', closesTick: 2 });
    expect(enterDraw(db, now(db), 1, PLAYER_ID, 'draw1').duplicate).toBe(false); expect(enterDraw(db, now(db), 2, PLAYER_ID, 'draw1').duplicate).toBe(true); enterDraw(db, now(db), 3, p2, 'draw1');
    denied(() => executeDraw(db, g(db), 'draw1'), /not closed/); advance(db, 2);
    const r = executeDraw(db, g(db), 'draw1', () => 0); expect(r.winnerId).toBe(p2);   // entries are sorted, so index 0 is p2 expect(r.awarded).toBe(true);
    expect(executeDraw(db, g(db), 'draw1').winnerId).toBe(p2);          // re-running a drawn draw changes nothing
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM reward_awards').n).toBe(1); expect(one<{ h: string }>(db, 'SELECT entries_hash h FROM prize_draws').h).toHaveLength(64);
    denied(() => enterDraw(db, now(db), 4, PLAYER_ID, 'draw1'), /closed/); expect(reconcileGbp(db).ok).toBe(true);
  });
  it('simultaneous reward claims and a reward-budget stress run never overspend the budget or the reserve', () => {
    const db = gw(); fundTreasury(db, g(db), 'f', 1_000_000, 'x'); createProgram(db, g(db), { id: 's', name: 'Stress', source: 'promotion', rules: [{ kind: 'open' }], awardPence: 100, budgetPence: 5_000 }); fundProgram(db, g(db), 's', 5_000);
    let paid = 0; for (let i = 0; i < 200; i++) { const p = addPlayer(db, `s${i}`, 1_000); for (const k of [`a${i}`, `a${i}`, `b${i}`]) { try { if (!awardReward(db, g(db), { programId: 's', playerId: p, key: k }).duplicate) paid++; } catch (e) { if (!(e instanceof GbpError)) throw e; } } }
    expect(paid).toBe(50); expect(one<{ s: number }>(db, 'SELECT spent_pence s FROM reward_programs').s).toBe(5_000); expect(reconcileGbp(db).problems).toEqual([]);
  });
  it('weekly leaderboard awards go to funded top-prestige players once per week', () => {
    const db = gw(); fundTreasury(db, g(db), 'f', 100_000, 'x'); createProgram(db, g(db), { id: 'weekly', name: 'Weekly top prestige', source: 'weekly_leaderboard', rules: [{ kind: 'weekly_top_prestige', rank: 1 }], awardPence: 500, budgetPence: 1_500, perPlayerMax: 3 }); fundProgram(db, g(db), 'weekly', 1_500);
    found(db, 'pizza', 'lot-1', 'Weekly Pizza'); advance(db, 14); const before = one<{ n: number }>(db, 'SELECT COUNT(*) n FROM reward_awards').n;
    runScheduledServices(db, 1_000_000); runScheduledServices(db, 1_000_000); expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM reward_awards').n).toBeLessThanOrEqual(before + 1);
    expect(reconcileGbp(db).ok).toBe(true);
  });
});

describe('fictional coin lotteries', () => {
  const lot = (db: Sql) => one<{ id: string }>(db, "SELECT id FROM lotteries WHERE status = 'open'").id;
  const open = () => { const db = world({}, 1_000); ensureOpenLottery(db, now(db)); return db; };
  it('sells tickets with published odds, enforces per-player limits and idempotency, and keeps ticket numbers unique', () => {
    const db = open(); const id = lot(db); const t = buyTickets(db, now(db), { playerId: PLAYER_ID, lotteryId: id, count: 3, key: 'k1' }); expect(t.numbers).toEqual([1, 2, 3]);
    expect(buyTickets(db, now(db), { playerId: PLAYER_ID, lotteryId: id, count: 3, key: 'k1' })).toEqual({ numbers: [1, 2, 3], duplicate: true });
    denied(() => buyTickets(db, now(db), { playerId: PLAYER_ID, lotteryId: id, count: LOTTERY.maxPerPlayer, key: 'k2' }), /At most/); denied(() => buyTickets(db, now(db), { playerId: PLAYER_ID, lotteryId: id, count: 0, key: 'k3' }));
    const v = lotteryView(db, PLAYER_ID, now(db).tick)[0]!; expect(v.myTickets).toEqual([1, 2, 3]); expect(v.odds.firstPrize).toBe(1); expect(v.notice).toContain('cannot be withdrawn');
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM (SELECT number FROM lottery_tickets GROUP BY lottery_id, number HAVING COUNT(*) > 1)').n).toBe(0); sane(db);
  });
  it('draw integrity: distinct winners, prizes + rake = pool, the rake is burned, the pool empties, results recorded; a second run draws nothing', () => {
    const db = open(); const id = lot(db); const players = ['a', 'b', 'c', 'd', 'e'].map((p) => addPlayer(db, p, 100_000)); players.forEach((p, i) => buyTickets(db, now(db), { playerId: p, lotteryId: id, count: 2, key: `t${i}` }));
    const pool = 10 * LOTTERY.ticketPriceMinor, burned0 = supply(db).destroyed; advance(db, 7);
    const r = drawDueLotteries(db, now(db), () => 0); expect(r.drawn).toEqual([id]);
    const res = db.all<{ place: number; ticket_number: number; prize_minor: number; owner_id: string }>('SELECT * FROM lottery_results ORDER BY place'); expect(res.length).toBe(3); expect(new Set(res.map((x) => x.ticket_number)).size).toBe(3);
    const rake = Math.floor((pool * LOTTERY.rakeBps) / 10_000); expect(res.reduce((a, x) => a + x.prize_minor, 0)).toBe(pool - rake); expect(one<{ b: number }>(db, "SELECT COALESCE(SUM(p.amount_minor),0) b FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.memo LIKE 'lottery rake%' AND p.account_id = 'acct:burn'").b).toBe(rake); expect(supply(db).destroyed).toBeGreaterThanOrEqual(burned0 + rake);
    expect(balance(db, `acct:lottery:${id}`)).toBe(0); expect(drawDueLotteries(db, now(db)).drawn).toEqual([]); expect(one<{ c: string }>(db, 'SELECT draw_commit c FROM lotteries WHERE id = ?', id).c).toHaveLength(64); sane(db); expect(reconcile(db).ok).toBe(true);
  });
  it('too few tickets: the draw is cancelled and everyone is refunded in full; late purchases are refused', () => {
    const db = open(); const id = lot(db); const w0 = balance(db, PLAYER_WALLET); buyTickets(db, now(db), { playerId: PLAYER_ID, lotteryId: id, count: 2, key: 'k' }); advance(db, 7);
    expect(drawDueLotteries(db, now(db)).cancelled).toEqual([id]); expect(balance(db, PLAYER_WALLET)).toBe(w0); denied(() => buyTickets(db, now(db), { playerId: PLAYER_ID, lotteryId: id, count: 1, key: 'late' }), /closed/); sane(db);
  });
  it('uses the secure generator by default and the exact hypergeometric odds; no GBP is involved', () => {
    expect(publishedOdds(10, 2, 3).firstPrize).toBeCloseTo(0.2, 10); expect(publishedOdds(10, 2, 3).anyPrize).toBeCloseTo(1 - (8 / 10) * (7 / 9) * (6 / 8), 10); expect(publishedOdds(0, 1, 3).anyPrize).toBe(0);
    const db = open(); const id = lot(db); ['a', 'b', 'c', 'd'].forEach((p, i) => { addPlayer(db, p, 100_000); buyTickets(db, now(db), { playerId: p, lotteryId: id, count: 1, key: `s${i}` }); }); advance(db, 7);
    expect(drawDueLotteries(db, now(db)).drawn.length).toBe(1); expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'gbp%' AND sql LIKE '%lottery%'").n).toBe(0);
  });
});

describe('premium membership (mock provider)', () => {
  const setup = () => { const db = world(); ensureGbpBooks(db); return db; };
  it('subscribes once, records simulated revenue and fee, shows renewal status, and a repeated click does not charge twice', () => {
    const db = setup(); const a = subscribe(db, now(db), g(db), PLAYER_ID), b = subscribe(db, now(db), g(db), PLAYER_ID);
    expect(a.duplicate).toBe(false); expect(b.duplicate).toBe(true); expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM membership_payments').n).toBe(1);
    expect(one<{ b: number }>(db, "SELECT balance_pence b FROM gbp_accounts WHERE id = 'gbp:rev:premium'").b).toBe(-PLAN.pricePence);
    expect(hasPremium(db, PLAYER_ID, now(db).tick)).toBe(true); expect(membershipView(db, PLAYER_ID, now(db).tick).renewsAtTick).toBe(a.periodEndTick); expect(reconcileGbp(db).ok).toBe(true);
    expect(balance(db, PLAYER_WALLET)).toBeGreaterThan(0); expect(availablePence(db, PLAYER_ID)).toBe(0);     // GBP wallet untouched; coins untouched
  });
  it('renews exactly once per period, cancelling keeps benefits to the end then expires, and a declined payment expires without charging', () => {
    const db = setup(); subscribe(db, now(db), g(db), PLAYER_ID); advance(db, PLAN.periodTicks + 1);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM membership_payments WHERE status = 'paid'").n).toBe(2); runMembershipRenewals(db, now(db), g(db)); runMembershipRenewals(db, now(db), g(db));
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM membership_payments WHERE status = 'paid'").n).toBe(2);        // re-running the renewal pass never charges again
    cancelMembership(db, now(db), g(db), PLAYER_ID); expect(hasPremium(db, PLAYER_ID, now(db).tick)).toBe(true); expect(membershipView(db, PLAYER_ID, now(db).tick).renewsAtTick).toBeNull();
    advance(db, PLAN.periodTicks + 1); expect(hasPremium(db, PLAYER_ID, now(db).tick)).toBe(false); expect(membershipView(db, PLAYER_ID, now(db).tick).status).toBe('expired');
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM membership_payments WHERE status = 'paid'").n).toBe(2);
    const d2 = setup(); setMockDecline(d2); denied(() => subscribe(d2, now(d2), g(d2), PLAYER_ID), /declined/); expect(hasPremium(d2, PLAYER_ID, now(d2).tick)).toBe(false); expect(one<{ n: number }>(d2, "SELECT COUNT(*) n FROM membership_payments WHERE status = 'paid'").n).toBe(0);
  });
  it('premium revenue is recognised only when a (simulated) payment happened; the wallet is separate', () => {
    const db = setup(); expect(one<{ b: number }>(db, "SELECT balance_pence b FROM gbp_accounts WHERE id = 'gbp:rev:premium'").b).toBe(0);
    expect(() => requestWithdrawal(db, g(db), { playerId: PLAYER_ID, amountPence: 500, key: 'w' })).toThrow(); expect(one<{ b: number }>(db, "SELECT balance_pence b FROM gbp_accounts WHERE id = ?", CASH).b).toBe(0);
  });
});
