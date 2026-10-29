import type { Sql } from '../db/sql';
import { grantBoost, type BoostKind } from './boosts';
import { LedgerError, available as _avail, issue, type TickCtx } from './ledger';
import { GbpError, PRIZE_RESERVE, audit, ensureWallet, postGbp, walletAcct, type GbpCtx } from './gbpLedger';
import { allocatePrizeReserve, prizeReservePence } from './gbpWallet';
import { prestigeOf } from './prestige';
import { hmacSha256, randomToken, safeEqual, secureRandomInt, sha256 } from './sha256';

/* ═════════════ Rewarded video advertising (simulated provider) ═════════════
 * The browser can only ASK to watch an advertisement and later present the provider's proof. The server decides everything else:
 *  1. start: the server checks the daily limit and cooldown, then opens a session with a secret nonce and a minimum watch time;
 *  2. attest: the (mock) provider — server side — refuses before the minimum time has elapsed, then signs `session:nonce` with a server-only key;
 *  3. complete: the server verifies the signature, that the session is open, unexpired and unused, and only then issues the reward, exactly once (session id is unique).
 * A frontend that merely says "I watched it" gets nothing. A real provider would replace step 2 with its server-to-server verified completion event. */
export type AdRewardKind = 'coins' | 'boost';
export interface AdReward { id: string; kind: AdRewardKind; label: string; description: string; amountMinor?: number; boost?: { kind: BoostKind; bps: number; days: number }; dailyLimit: number; cooldownMs: number; minWatchMs: number }
export const AD_REWARDS: AdReward[] = [
  { id: 'ad-coins', kind: 'coins', label: '50 Empire Coins', description: 'A small, capped faucet of fictional coins (these are not money and cannot be withdrawn).', amountMinor: 5_000, dailyLimit: 5, cooldownMs: 10 * 60_000, minWatchMs: 15_000 },
  { id: 'ad-boost-production', kind: 'boost', label: 'Production +2% for 3 days', description: 'A small production boost. It never stacks with other boosts of the same kind.', boost: { kind: 'production', bps: 200, days: 3 }, dailyLimit: 2, cooldownMs: 30 * 60_000, minWatchMs: 15_000 },
];
export const SESSION_TTL_MS = 10 * 60_000, MAX_SESSIONS_PER_DAY = 12;
const reward = (id: string) => AD_REWARDS.find((r) => r.id === id);
const secret = (db: Sql) => { let s = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'ad_provider_secret'")?.value; if (!s) { s = randomToken(32); db.run("INSERT INTO meta (key, value) VALUES ('ad_provider_secret', ?)", s); } return s; };
const day = (ctx: TickCtx) => ctx.tick; void _avail;

export function rewardAvailability(db: Sql, ctx: TickCtx, nowMs: number, playerId: string) {
  return AD_REWARDS.map((r) => {
    const today = db.get<{ n: number }>('SELECT COUNT(*) n FROM ad_rewards_granted WHERE player_id = ? AND reward_id = ? AND tick = ?', playerId, r.id, day(ctx))!.n;
    const last = db.get<{ ms: number | null }>("SELECT MAX(s.completed_ms) ms FROM ad_view_sessions s WHERE s.player_id = ? AND s.reward_id = ? AND s.status = 'verified'", playerId, r.id)?.ms ?? null;
    const waitMs = last === null ? 0 : Math.max(0, last + r.cooldownMs - nowMs);
    const open = db.get<{ id: string }>("SELECT id FROM ad_view_sessions WHERE player_id = ? AND reward_id = ? AND status = 'started' AND ? - started_ms < ?", playerId, r.id, nowMs, SESSION_TTL_MS);
    return { ...r, grantedToday: today, remainingToday: Math.max(0, r.dailyLimit - today), cooldownRemainingMs: waitMs, openSessionId: open?.id ?? null, available: today < r.dailyLimit && waitMs === 0 };
  });
}
export function startAdView(db: Sql, ctx: TickCtx, nowMs: number, a: { playerId: string; rewardId: string }): { sessionId: string; minWatchMs: number } {
  return db.transaction(() => {
    const r = reward(a.rewardId); if (!r) throw new LedgerError('FORBIDDEN', 'Unknown reward.');
    const av = rewardAvailability(db, ctx, nowMs, a.playerId).find((x) => x.id === r.id)!;
    if (av.openSessionId) return { sessionId: av.openSessionId, minWatchMs: r.minWatchMs };      // resume the open session: starting twice never makes two rewards
    if (av.remainingToday <= 0) throw new LedgerError('FORBIDDEN', 'You have used all of today’s rewards of this type. Come back tomorrow (next game day).');
    if (av.cooldownRemainingMs > 0) throw new LedgerError('FORBIDDEN', `Next reward available in ${Math.ceil(av.cooldownRemainingMs / 60_000)} min.`);
    if (db.get<{ n: number }>('SELECT COUNT(*) n FROM ad_view_sessions WHERE player_id = ? AND tick = ?', a.playerId, day(ctx))!.n >= MAX_SESSIONS_PER_DAY) throw new LedgerError('FORBIDDEN', 'Too many advertisement sessions today.');
    const id = `adv-${db.get<{ n: number }>('SELECT COUNT(*) n FROM ad_view_sessions')!.n + 1}`;
    db.run("INSERT INTO ad_view_sessions (id, player_id, reward_id, status, nonce, started_ms, min_ms, tick, provider) VALUES (?,?,?,'started',?,?,?,?,'mock-video')", id, a.playerId, r.id, randomToken(16), nowMs, r.minWatchMs, day(ctx));
    return { sessionId: id, minWatchMs: r.minWatchMs };
  });
}
/** The MOCK provider: signs a completion only if the server's own clock says the minimum viewing time has passed. */
export function providerAttest(db: Sql, nowMs: number, sessionId: string): { token: string } {
  const s = db.get<{ id: string; status: string; nonce: string; started_ms: number; min_ms: number }>('SELECT id, status, nonce, started_ms, min_ms FROM ad_view_sessions WHERE id = ?', sessionId);
  if (!s || s.status !== 'started') throw new LedgerError('FORBIDDEN', 'No open advertisement session.');
  if (nowMs - s.started_ms < s.min_ms) throw new LedgerError('FORBIDDEN', 'The advertisement has not finished playing yet.');
  return { token: hmacSha256(secret(db), `${s.id}:${s.nonce}`) };
}
class AdFraud extends LedgerError { constructor(public readonly sessionId: string, public readonly why: string) { super('FORBIDDEN', `Reward refused: ${why}`); } }
/** Verifies and (at most once) grants. A failed verification burns the session — recorded outside the rolled-back transaction, so a fraud attempt leaves a trace. */
export function completeAdView(db: Sql, ctx: TickCtx, nowMs: number, a: { playerId: string; sessionId: string; token: string }): { granted: { kind: AdRewardKind; amountMinor?: number; boostId?: number }; duplicate: boolean } {
  try { return completeInner(db, ctx, nowMs, a); } catch (e) {
    if (e instanceof AdFraud) { db.run("UPDATE ad_view_sessions SET status = 'rejected', fraud_reason = ? WHERE id = ? AND status = 'started'", e.why, e.sessionId); throw new LedgerError('FORBIDDEN', e.message); }
    throw e;
  }
}
function completeInner(db: Sql, ctx: TickCtx, nowMs: number, a: { playerId: string; sessionId: string; token: string }): { granted: { kind: AdRewardKind; amountMinor?: number; boostId?: number }; duplicate: boolean } {
  return db.transaction(() => {
    const s = db.get<{ id: string; player_id: string; reward_id: string; status: string; nonce: string; started_ms: number; min_ms: number; tick: number }>('SELECT * FROM ad_view_sessions WHERE id = ?', a.sessionId);
    if (!s || s.player_id !== a.playerId) throw new LedgerError('FORBIDDEN', 'No such advertisement session.');
    const prior = db.get<{ kind: string; amount: number; boost_id: number | null }>('SELECT kind, amount, boost_id FROM ad_rewards_granted WHERE session_id = ?', s.id);
    if (prior) return { granted: { kind: prior.kind as AdRewardKind, amountMinor: prior.kind === 'coins' ? prior.amount : undefined, boostId: prior.boost_id ?? undefined }, duplicate: true };   // replay: the same single reward, nothing new
    const reject = (why: string): never => { throw new AdFraud(s.id, why); };
    if (s.status !== 'started') throw new LedgerError('FORBIDDEN', `This session is ${s.status}.`);
    if (nowMs - s.started_ms > SESSION_TTL_MS) { db.run("UPDATE ad_view_sessions SET status = 'expired' WHERE id = ?", s.id); throw new LedgerError('FORBIDDEN', 'This advertisement session expired.'); }
    if (nowMs - s.started_ms < s.min_ms) return reject('completion reported before the minimum viewing time');
    if (!a.token || !safeEqual(a.token, hmacSha256(secret(db), `${s.id}:${s.nonce}`))) return reject('the provider’s proof of completion is missing or invalid');
    const r = reward(s.reward_id)!;
    const gate = rewardAvailability(db, ctx, nowMs, a.playerId).find((x) => x.id === r.id)!;
    if (gate.remainingToday <= 0) return reject('daily limit reached');
    let amount = 0, ledgerTx: number | null = null, boostId: number | null = null;
    if (r.kind === 'coins') {
      const wallet = db.get<{ w: string }>('SELECT wallet_account_id w FROM players WHERE id = ?', a.playerId)!.w;
      ledgerTx = issue(db, ctx, `adreward:${s.id}`, wallet, r.amountMinor!, `rewarded advertisement ${s.id} (simulated provider; capped faucet)`).txId; amount = r.amountMinor!;
    } else boostId = grantBoost(db, ctx, { ownerId: a.playerId, kind: r.boost!.kind, bps: r.boost!.bps, days: r.boost!.days, source: 'rewarded_ad', key: `adreward:${s.id}` });
    db.run("UPDATE ad_view_sessions SET status = 'verified', completed_ms = ? WHERE id = ?", nowMs, s.id);
    db.run('INSERT INTO ad_rewards_granted (session_id, player_id, reward_id, kind, amount, tick, ledger_tx_id, boost_id) VALUES (?,?,?,?,?,?,?,?)', s.id, a.playerId, r.id, r.kind, amount, ctx.tick, ledgerTx, boostId);
    return { granted: { kind: r.kind, amountMinor: r.kind === 'coins' ? amount : undefined, boostId: boostId ?? undefined }, duplicate: false };
  });
}
export const adRewardHistory = (db: Sql, playerId: string) => db.all('SELECT g.id, g.reward_id rewardId, g.kind, g.amount amountMinor, g.tick, s.completed_ms completedMs FROM ad_rewards_granted g JOIN ad_view_sessions s ON s.id = g.session_id WHERE g.player_id = ? ORDER BY g.id DESC LIMIT 30', playerId);
export function recordImpression(db: Sql, ctx: TickCtx, slot: string) {
  if (!['top-banner', 'sidebar', 'in-flow', 'mobile-banner'].includes(slot)) throw new LedgerError('FORBIDDEN', 'Unknown ad slot.');
  db.run('INSERT INTO ad_impressions (day, slot, count) VALUES (?,?,1) ON CONFLICT(day, slot) DO UPDATE SET count = MIN(count + 1, 100000)', ctx.tick, slot);
}

/* ═════════════ Cash reward programmes (simulated treasury) ═════════════
 * Every award has a source, eligibility rule, funding allocation, amount, transaction id, player id, timestamp and audit record. A programme can only pay from the restricted
 * PRIZE RESERVE (funded by the developer), never beyond its own budget, never twice for one idempotency key, and eligibility can only use positive, non-loss-based facts. */
export type EligibilityRule = { kind: 'min_prestige'; value: number } | { kind: 'min_companies'; value: number } | { kind: 'profitable_company'; days: number } | { kind: 'weekly_top_prestige'; rank: number } | { kind: 'draw_winner' } | { kind: 'open' };
const RULE_KINDS = ['min_prestige', 'min_companies', 'profitable_company', 'weekly_top_prestige', 'draw_winner', 'open'];
export type RewardSource = 'achievement' | 'city_competition' | 'weekly_leaderboard' | 'promotion' | 'prize_draw' | 'developer';
export function createProgram(db: Sql, ctx: GbpCtx, a: { id: string; name: string; source: RewardSource; rules: EligibilityRule[]; awardPence: number; budgetPence: number; perPlayerMax?: number }) {
  for (const r of a.rules) if (!RULE_KINDS.includes(r.kind)) throw new GbpError('FORBIDDEN', `Eligibility rule ${String((r as { kind: string }).kind)} is not allowed: rewards may only depend on positive achievements, never on losses.`);
  if (!Number.isSafeInteger(a.awardPence) || a.awardPence <= 0 || !Number.isSafeInteger(a.budgetPence) || a.budgetPence < a.awardPence) throw new GbpError('INVALID_AMOUNT', 'Award and budget must be whole pence, and the budget must cover at least one award.');
  db.run('INSERT INTO reward_programs (id, name, source, eligibility_json, award_pence, budget_pence, per_player_max, created_ms) VALUES (?,?,?,?,?,?,?,?)', a.id, a.name, a.source, JSON.stringify(a.rules), a.awardPence, a.budgetPence, a.perPlayerMax ?? 1, ctx.ms);
  audit(db, ctx.ms, ctx.actor, 'program.created', a.id, a);
}
/** Funds a programme: the budget must be backed by the prize reserve. The reserve is allocated from owner equity, which must exist as cash. */
export function fundProgram(db: Sql, ctx: GbpCtx, programId: string, amountPence: number) {
  const p = db.get<{ budget_pence: number; funded_pence: number }>('SELECT budget_pence, funded_pence FROM reward_programs WHERE id = ?', programId); if (!p) throw new GbpError('INVALID_STATE', 'Unknown programme');
  if (p.funded_pence + amountPence > p.budget_pence) throw new GbpError('LIMIT', 'Funding would exceed the programme budget.');
  allocatePrizeReserve(db, ctx, `fund:${programId}:${p.funded_pence}:${amountPence}`, amountPence, `Prize reserve allocated to ${programId}`);
  db.run('UPDATE reward_programs SET funded_pence = funded_pence + ? WHERE id = ?', amountPence, programId); audit(db, ctx.ms, ctx.actor, 'program.funded', programId, { amountPence });
}
export function eligible(db: Sql, tick: number, playerId: string, rules: EligibilityRule[], ctxExtra: { drawWinner?: boolean; weeklyRank?: number } = {}): { ok: boolean; why: string[] } {
  const why: string[] = [];
  for (const r of rules) {
    if (r.kind === 'min_prestige' && prestigeOf(db, playerId, tick).total < r.value) why.push(`prestige below ${r.value}`);
    if (r.kind === 'min_companies' && db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE owner_id = ? AND status = 'operating'", playerId)!.n < r.value) why.push(`fewer than ${r.value} operating companies`);
    if (r.kind === 'profitable_company' && !db.get<{ c: string }>("SELECT c.id c FROM companies c WHERE c.owner_id = ? AND c.status = 'operating' AND (SELECT COUNT(*) FROM company_tick_stats s WHERE s.company_id = c.id AND s.tick > ? AND s.net_profit_minor > 0) >= ?", playerId, tick - r.days - 3, Math.max(1, r.days - 1))) why.push(`no company profitable for ${r.days} days`);
    if (r.kind === 'draw_winner' && !ctxExtra.drawWinner) why.push('not the draw winner');
    if (r.kind === 'weekly_top_prestige' && !(ctxExtra.weeklyRank !== undefined && ctxExtra.weeklyRank <= r.rank)) why.push(`not in the top ${r.rank}`);
  }
  return { ok: why.length === 0, why };
}
export interface AwardResult { awardId: number; ledgerTxId: number; amountPence: number; duplicate: boolean }
/** Issues one award. Every check is repeated inside the transaction, so two simultaneous claims cannot both pass. */
export function awardReward(db: Sql, ctx: GbpCtx, a: { programId: string; playerId: string; key: string; drawWinner?: boolean; weeklyRank?: number }): AwardResult {
  return db.transaction(() => {
    const dup = db.get<{ id: number; ledger_tx_id: number; amount_pence: number }>('SELECT id, ledger_tx_id, amount_pence FROM reward_awards WHERE idempotency_key = ?', a.key);
    if (dup) return { awardId: dup.id, ledgerTxId: dup.ledger_tx_id, amountPence: dup.amount_pence, duplicate: true };
    const p = db.get<{ id: string; name: string; source: string; eligibility_json: string; award_pence: number; budget_pence: number; spent_pence: number; per_player_max: number; active: number }>('SELECT * FROM reward_programs WHERE id = ?', a.programId);
    if (!p || !p.active) throw new GbpError('FORBIDDEN', 'That reward programme is not active.');
    if (!db.get('SELECT 1 FROM players WHERE id = ?', a.playerId)) throw new GbpError('FORBIDDEN', 'Rewards are paid to human players only.');
    const ev = eligible(db, ctx.tick, a.playerId, JSON.parse(p.eligibility_json) as EligibilityRule[], { drawWinner: a.drawWinner, weeklyRank: a.weeklyRank });
    if (!ev.ok) throw new GbpError('FORBIDDEN', `Not eligible: ${ev.why.join('; ')}.`);
    if (db.get<{ n: number }>('SELECT COUNT(*) n FROM reward_awards WHERE program_id = ? AND player_id = ?', p.id, a.playerId)!.n >= p.per_player_max) throw new GbpError('LIMIT', 'This reward has already been awarded to you the maximum number of times.');
    if (p.spent_pence + p.award_pence > p.budget_pence) throw new GbpError('LIMIT', 'This reward programme’s budget is exhausted.');
    if (prizeReservePence(db) < p.award_pence) throw new GbpError('INSUFFICIENT_FUNDS', 'The prize reserve cannot cover this award.');
    ensureWallet(db, a.playerId);
    const tx = postGbp(db, ctx, `reward:${a.key}`, 'reward', `Reward: ${p.name}`, [{ account: PRIZE_RESERVE, amount: p.award_pence }, { account: walletAcct(a.playerId), amount: -p.award_pence }], p.id);
    db.run('UPDATE reward_programs SET spent_pence = spent_pence + ? WHERE id = ? AND spent_pence + ? <= budget_pence', p.award_pence, p.id, p.award_pence);
    const r = db.run('INSERT INTO reward_awards (program_id, player_id, amount_pence, ledger_tx_id, idempotency_key, issued_ms, audit_json) VALUES (?,?,?,?,?,?,?)', p.id, a.playerId, p.award_pence, tx.txId, a.key, ctx.ms, JSON.stringify({ source: p.source, eligibility: JSON.parse(p.eligibility_json), funding: 'prize_reserve', verified: ev }));
    audit(db, ctx.ms, ctx.actor, 'reward.awarded', a.playerId, { programId: p.id, amountPence: p.award_pence, txId: tx.txId });
    return { awardId: Number(r.lastInsertRowid), ledgerTxId: tx.txId, amountPence: p.award_pence, duplicate: false };
  });
}
export const programs = (db: Sql) => db.all('SELECT id, name, source, eligibility_json eligibility, award_pence awardPence, budget_pence budgetPence, spent_pence spentPence, funded_pence fundedPence, per_player_max perPlayerMax, active FROM reward_programs ORDER BY created_ms, id');

/* ═════════════ Free-entry prize draws ═════════════ */
export function createDraw(db: Sql, ctx: GbpCtx, a: { id: string; programId: string; name: string; closesTick: number }) {
  if (!db.get("SELECT 1 FROM reward_programs WHERE id = ? AND source = 'prize_draw'", a.programId)) throw new GbpError('INVALID_STATE', 'A prize draw needs a programme with source prize_draw.');
  db.run("INSERT INTO prize_draws (id, program_id, name, closes_tick, status) VALUES (?,?,?,?, 'open')", a.id, a.programId, a.name, a.closesTick); audit(db, ctx.ms, ctx.actor, 'draw.created', a.id, a);
}
/** Entering is free and unconditional (no purchase, no stake): one entry per player, enforced by the primary key. */
export function enterDraw(db: Sql, ctx: TickCtx, nowMs: number, playerId: string, drawId: string): { duplicate: boolean } {
  const d = db.get<{ status: string; closes_tick: number }>('SELECT status, closes_tick FROM prize_draws WHERE id = ?', drawId);
  if (!d || d.status !== 'open' || ctx.tick >= d.closes_tick) throw new LedgerError('FORBIDDEN', 'That draw is closed.');
  if (!db.get('SELECT 1 FROM players WHERE id = ?', playerId)) throw new LedgerError('FORBIDDEN', 'Unknown player.');
  const r = db.run('INSERT OR IGNORE INTO prize_draw_entries (draw_id, player_id, entered_ms) VALUES (?,?,?)', drawId, playerId, nowMs); return { duplicate: r.changes === 0 };
}
/** Executes a due draw with secure randomness. The entry list is hashed before the pick, and the winner is paid through the same budget-checked award path (idempotent by draw id). */
export function executeDraw(db: Sql, ctx: GbpCtx, drawId: string, rng: (n: number) => number = secureRandomInt): { winnerId: string | null; awarded: boolean } {
  return db.transaction(() => {
    const d = db.get<{ id: string; program_id: string; status: string; winner_id: string | null; closes_tick: number }>('SELECT * FROM prize_draws WHERE id = ?', drawId); if (!d) throw new GbpError('INVALID_STATE', 'Unknown draw');
    if (d.status === 'drawn') return { winnerId: d.winner_id, awarded: d.winner_id !== null };
    if (d.status !== 'open') throw new GbpError('INVALID_STATE', 'That draw is not open.');
    if (ctx.tick < d.closes_tick) throw new GbpError('INVALID_STATE', 'That draw has not closed yet.');
    const entries = db.all<{ player_id: string }>('SELECT player_id FROM prize_draw_entries WHERE draw_id = ? ORDER BY player_id', drawId).map((e) => e.player_id);
    const hash = sha256(entries.join('|')); let winner: string | null = null, awarded = false;
    if (entries.length > 0) { winner = entries[rng(entries.length)]!; try { awardReward(db, ctx, { programId: d.program_id, playerId: winner, key: `draw:${drawId}`, drawWinner: true }); awarded = true; } catch (e) { if (!(e instanceof GbpError)) throw e; audit(db, ctx.ms, ctx.actor, 'draw.award_refused', drawId, { winner, reason: e.message }, false); } }
    db.run("UPDATE prize_draws SET status = 'drawn', winner_id = ?, drawn_ms = ?, entries_hash = ? WHERE id = ?", winner, ctx.ms, hash, drawId);
    audit(db, ctx.ms, ctx.actor, 'draw.executed', drawId, { entries: entries.length, winner, entriesHash: hash }); return { winnerId: winner, awarded };
  });
}
