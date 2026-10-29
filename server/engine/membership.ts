import type { Sql } from '../db/sql';
import { CASH, EXP, GbpError, PAYABLE, REV, audit, postGbp, type GbpCtx } from './gbpLedger';
import { LedgerError, type TickCtx } from './ledger';

/**
 * Premium membership (MOCK provider). A configurable example plan (£2.99 per 30 game days). The mock provider "charges" a simulated card: the ledger records the simulated cash,
 * the premium revenue and the simulated processing fee, all labelled simulated. Nothing is collected from a real person and the provider has no network access. Each renewal
 * period has a unique provider reference, so a renewal can never be charged twice; cancelling stops renewal but keeps the benefits until the paid period ends.
 */
export const PLAN = { id: 'premium', name: 'Penny Empire Premium', pricePence: 299, periodTicks: 30, feeFixedPence: 20, feeBps: 140 } as const;
export const BENEFITS: { id: string; label: string; free: string; premium: string }[] = [
  { id: 'themes', label: 'Company customisation themes', free: '2 themes', premium: '8 themes' },
  { id: 'analytics', label: 'Analytics', free: 'Standard dashboard', premium: 'Extended 90-day charts and exports' },
  { id: 'profile', label: 'Profile decoration', free: 'Plain frame', premium: 'Premium frame and badge' },
  { id: 'cosmetics', label: 'Exclusive cosmetics', free: '—', premium: 'Premium-only decorations (cosmetic)' },
  { id: 'automation', label: 'Management conveniences', free: 'Manual restock reminders', premium: 'One-tap restock-all and saved price presets' },
  { id: 'ads', label: 'Display advertising', free: 'Simulated ad placements', premium: 'Placements hidden' },
];
export const NOT_INCLUDED = 'Premium never sells coins, cash, prizes, leaderboard rank or any advantage in a withdrawable-prize contest.';
export type MembershipStatus = 'none' | 'active' | 'cancelled' | 'expired';
const fee = (amount: number) => PLAN.feeFixedPence + Math.round((amount * PLAN.feeBps) / 10_000);

function charge(db: Sql, gctx: GbpCtx, ownerId: string, period: number, shouldFail: boolean): boolean {
  const ref = `mock_sub_${ownerId}_${period}`;
  if (db.get('SELECT 1 FROM membership_payments WHERE provider_ref = ?', ref)) return true;        // already charged for this period: never twice
  if (shouldFail) { db.run("INSERT INTO membership_payments (owner_id, period, amount_pence, tick, status, provider_ref) VALUES (?,?,?,?,'failed',?)", ownerId, period, PLAN.pricePence, gctx.tick, ref); audit(db, gctx.ms, gctx.actor, 'membership.payment_failed', ownerId, { period }, false); return false; }
  const tx = postGbp(db, gctx, `sub:${ref}`, 'premium_payment', `Premium membership period ${period} (simulated card)`, [{ account: CASH, amount: PLAN.pricePence }, { account: REV.premium, amount: -PLAN.pricePence }], ref);
  postGbp(db, gctx, `sub:${ref}:fee`, 'deposit_fee', `Simulated processing fee on ${ref}`, [{ account: EXP.fees, amount: fee(PLAN.pricePence) }, { account: PAYABLE, amount: -fee(PLAN.pricePence) }], ref);
  db.run("INSERT INTO membership_payments (owner_id, period, amount_pence, ledger_tx_id, tick, status, provider_ref) VALUES (?,?,?,?,?,'paid',?)", ownerId, period, PLAN.pricePence, tx.txId, gctx.tick, ref);
  return true;
}
const failNext = (db: Sql) => { const r = db.run("DELETE FROM meta WHERE key = 'mock_sub_fail_next'"); return r.changes > 0; };
/** Developer switch: the mock provider declines the next charge (to test payment failure). */
export const setMockDecline = (db: Sql) => db.run("INSERT INTO meta (key, value) VALUES ('mock_sub_fail_next','1') ON CONFLICT(key) DO UPDATE SET value = '1'");

export function subscribe(db: Sql, ctx: TickCtx, gctx: GbpCtx, ownerId: string): { status: MembershipStatus; periodEndTick: number; duplicate: boolean } {
  return db.transaction(() => {
    const m = db.get<{ status: string; period_end_tick: number; periods_paid: number }>('SELECT status, period_end_tick, periods_paid FROM memberships WHERE owner_id = ?', ownerId);
    if (m && (m.status === 'active' || m.status === 'cancelled') && m.period_end_tick > ctx.tick) return { status: m.status as MembershipStatus, periodEndTick: m.period_end_tick, duplicate: true };   // already a member: no second charge
    if (!db.get('SELECT 1 FROM players WHERE id = ?', ownerId)) throw new LedgerError('FORBIDDEN', 'Unknown player.');
    const period = (m?.periods_paid ?? 0) + 1;
    if (!charge(db, gctx, ownerId, period, failNext(db))) throw new GbpError('FORBIDDEN', 'The (simulated) payment was declined. You have not been charged.');
    const end = ctx.tick + PLAN.periodTicks;
    db.run("INSERT INTO memberships (owner_id, plan, status, started_tick, period_end_tick, auto_renew, price_pence, periods_paid) VALUES (?,?,'active',?,?,1,?,?) ON CONFLICT(owner_id) DO UPDATE SET status = 'active', period_end_tick = excluded.period_end_tick, auto_renew = 1, price_pence = excluded.price_pence, periods_paid = excluded.periods_paid", ownerId, PLAN.id, ctx.tick, end, PLAN.pricePence, period);
    audit(db, gctx.ms, gctx.actor, 'membership.subscribed', ownerId, { period }); return { status: 'active' as const, periodEndTick: end, duplicate: false };
  });
}
export function cancelMembership(db: Sql, ctx: TickCtx, gctx: GbpCtx, ownerId: string) {
  const m = db.get<{ status: string }>('SELECT status FROM memberships WHERE owner_id = ?', ownerId); if (!m || m.status === 'expired') throw new LedgerError('FORBIDDEN', 'You have no active membership.');
  db.run("UPDATE memberships SET status = 'cancelled', auto_renew = 0 WHERE owner_id = ?", ownerId); audit(db, gctx.ms, gctx.actor, 'membership.cancelled', ownerId, { tick: ctx.tick });
}
/** Daily: renews paid-up auto-renewing members whose period ended (one charge per period, ever) and expires the rest. Deterministic: no clock, no randomness. */
export function runMembershipRenewals(db: Sql, ctx: TickCtx, gctx: GbpCtx) {
  for (const m of db.all<{ owner_id: string; status: string; period_end_tick: number; auto_renew: number; periods_paid: number }>("SELECT * FROM memberships WHERE status IN ('active','cancelled') AND period_end_tick <= ? ORDER BY owner_id", ctx.tick)) {
    if (m.status === 'active' && m.auto_renew === 1) {
      const period = m.periods_paid + 1;
      if (charge(db, gctx, m.owner_id, period, failNext(db))) db.run('UPDATE memberships SET period_end_tick = period_end_tick + ?, periods_paid = ? WHERE owner_id = ?', PLAN.periodTicks, period, m.owner_id);
      else db.run("UPDATE memberships SET status = 'expired', auto_renew = 0 WHERE owner_id = ?", m.owner_id);
    } else db.run("UPDATE memberships SET status = 'expired', auto_renew = 0 WHERE owner_id = ?", m.owner_id);
  }
}
export const hasPremium = (db: Sql, ownerId: string, tick: number) => !!db.get("SELECT 1 FROM memberships WHERE owner_id = ? AND status IN ('active','cancelled') AND period_end_tick > ?", ownerId, tick);
export function membershipView(db: Sql, ownerId: string, tick: number) {
  const m = db.get<{ status: string; period_end_tick: number; auto_renew: number; periods_paid: number; started_tick: number }>('SELECT * FROM memberships WHERE owner_id = ?', ownerId);
  const status: MembershipStatus = !m ? 'none' : m.status === 'expired' || m.period_end_tick <= tick ? 'expired' : (m.status as MembershipStatus);
  return {
    plan: { ...PLAN }, benefits: BENEFITS, notIncluded: NOT_INCLUDED, mode: 'SIMULATED', status, active: status === 'active' || status === 'cancelled', renewsAtTick: m && status === 'active' && m.auto_renew ? m.period_end_tick : null, endsAtTick: m && status !== 'none' ? m.period_end_tick : null, daysLeft: m ? Math.max(0, m.period_end_tick - tick) : 0, autoRenew: !!m && m.auto_renew === 1 && status === 'active', periodsPaid: m?.periods_paid ?? 0,
    payments: db.all('SELECT period, amount_pence amountPence, status, tick, provider_ref providerRef FROM membership_payments WHERE owner_id = ? ORDER BY id DESC LIMIT 20', ownerId),
  };
}
