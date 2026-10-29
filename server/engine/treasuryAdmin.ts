import type { Sql } from '../db/sql';
import { loadConfig, gameDate } from './config';
import { CASH, EQUITY, EXP, GbpError, PRIZE_RESERVE, REV, audit, ensureWallet, postGbp, type GbpCtx } from './gbpLedger';
import { approveWithdrawal, createDeposit, fundTreasury, handleDepositEvent, rejectWithdrawal, sandboxEvent, settleProcessorFees, settleWithdrawal, freeCashPence } from './gbpWallet';
import { awardReward, createDraw, createProgram, executeDraw, fundProgram, type EligibilityRule, type RewardSource } from './rewards';
import { setAssumptions, type Assumptions } from './commercial';
import { setMockDecline } from './membership';
import { PLAYER_ID } from '../seed/bristol';

/**
 * Treasury and sandbox-provider actions. Reached ONLY through (a) /api/admin/* with the administrator token, or (b) /api/dev/* on developer builds (disabled in deployment).
 * They are the developer's controls for the simulated payment providers and the simulated treasury: they never edit a balance directly — every one posts balanced ledger
 * entries (or drives a provider event) and writes the account-level audit trail.
 */
export interface ActionResult { ok: boolean; message: string; detail?: unknown }
const ctxOf = (db: Sql, nowMs: number, actor: string): GbpCtx => ({ tick: db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t, ms: nowMs, actor });
const asInt = (v: unknown, name: string) => { if (!Number.isSafeInteger(v)) throw new GbpError('INVALID_AMOUNT', `${name} must be a whole number`); return v as number; };

export function treasuryAction(db: Sql, nowMs: number, actor: string, action: string, b: Record<string, unknown>): ActionResult {
  const g = ctxOf(db, nowMs, actor);
  try {
    return db.transaction((): ActionResult => {
      switch (action) {
        case 'fund': { const n = asInt(b.amountPence, 'amountPence'); if (n <= 0 || n > 100_000_000) throw new GbpError('INVALID_AMOUNT', 'Funding must be £0.01–£1,000,000'); fundTreasury(db, g, `fund:${String(b.key ?? nowMs)}`, n, `Developer-funded simulated treasury (${actor})`); audit(db, nowMs, actor, 'treasury.fund', null, { n }); return { ok: true, message: `Treasury funded with £${(n / 100).toFixed(2)} (simulated).` }; }
        case 'record_revenue': { const n = asInt(b.amountPence, 'amountPence'); const s = String(b.stream); if (!['advertising', 'premium', 'cosmetic'].includes(s)) throw new GbpError('FORBIDDEN', 'Unknown revenue stream'); if (n <= 0) throw new GbpError('INVALID_AMOUNT', 'Amount must be positive'); postGbp(db, g, `rev:${String(b.key ?? nowMs)}`, 'ad_revenue', `Recorded ${s} revenue from provider statement (simulated)`, [{ account: CASH, amount: n }, { account: REV[s as keyof typeof REV], amount: -n }]); audit(db, nowMs, actor, 'treasury.record_revenue', s, { n }); return { ok: true, message: `Recorded £${(n / 100).toFixed(2)} ${s} revenue (simulated statement).` }; }
        case 'record_expense': { const n = asInt(b.amountPence, 'amountPence'); const k = String(b.kind); if (!['hosting', 'fees'].includes(k)) throw new GbpError('FORBIDDEN', 'Unknown expense'); if (n <= 0 || n > freeCashPence(db)) throw new GbpError('INSUFFICIENT_FUNDS', 'Expenses are paid from the business’s own cash only, never from player funds.'); postGbp(db, g, `exp:${String(b.key ?? nowMs)}`, 'operating_expense', `Recorded ${k} expense`, [{ account: EXP[k as keyof typeof EXP], amount: n }, { account: CASH, amount: -n }]); audit(db, nowMs, actor, 'treasury.record_expense', k, { n }); return { ok: true, message: `Recorded £${(n / 100).toFixed(2)} ${k} expense.` }; }
        case 'settle_fees': { settleProcessorFees(db, g, `settle:${String(b.key ?? nowMs)}`, asInt(b.amountPence, 'amountPence')); return { ok: true, message: 'Processor fees settled from business cash.' }; }
        case 'allocate_reserve': { const n = asInt(b.amountPence, 'amountPence'); postGbp(db, g, `alloc:${String(b.key ?? nowMs)}`, 'prize_allocation', 'Prize reserve allocation', [{ account: EQUITY, amount: n }, { account: PRIZE_RESERVE, amount: -n }]); return { ok: true, message: 'Prize reserve allocated from owner equity.' }; }
        case 'create_program': { createProgram(db, g, { id: String(b.id), name: String(b.name), source: String(b.source) as RewardSource, rules: (b.rules ?? [{ kind: 'open' }]) as EligibilityRule[], awardPence: asInt(b.awardPence, 'awardPence'), budgetPence: asInt(b.budgetPence, 'budgetPence'), perPlayerMax: b.perPlayerMax === undefined ? 1 : asInt(b.perPlayerMax, 'perPlayerMax') }); return { ok: true, message: `Programme ${String(b.id)} created (unfunded).` }; }
        case 'fund_program': { fundProgram(db, g, String(b.id), asInt(b.amountPence, 'amountPence')); return { ok: true, message: `Programme ${String(b.id)} funded from the prize reserve.` }; }
        case 'award': { const r = awardReward(db, g, { programId: String(b.programId), playerId: String(b.playerId ?? PLAYER_ID), key: String(b.key ?? `admin:${b.programId}:${b.playerId ?? PLAYER_ID}`) }); return { ok: true, message: r.duplicate ? 'Already awarded (duplicate ignored).' : `Awarded £${(r.amountPence / 100).toFixed(2)}.`, detail: r }; }
        case 'create_draw': { createDraw(db, g, { id: String(b.id), programId: String(b.programId), name: String(b.name), closesTick: asInt(b.closesTick, 'closesTick') }); return { ok: true, message: 'Prize draw created.' }; }
        case 'run_draw': { const r = executeDraw(db, g, String(b.id)); return { ok: true, message: r.winnerId ? `Winner ${r.winnerId}${r.awarded ? ' (paid)' : ' (not paid: see audit)'}` : 'No entries.', detail: r }; }
        case 'deposit': {      // developer-simulated deposit with a chosen provider outcome
          const amt = asInt(b.amountPence, 'amountPence'); const outcome = String(b.outcome ?? 'succeeded'); ensureWallet(db, String(b.playerId ?? PLAYER_ID));
          const d = createDeposit(db, g, { playerId: String(b.playerId ?? PLAYER_ID), amountPence: amt, key: String(b.key ?? `dev-dep-${nowMs}-${amt}`) });
          const o = outcome === 'duplicate' ? 'succeeded' : (outcome as 'succeeded' | 'failed' | 'cancelled'); const e = sandboxEvent(d.depositId, o, outcome === 'failed' ? 'card declined (sandbox)' : undefined);
          const first = handleDepositEvent(db, g, e); const second = outcome === 'duplicate' ? handleDepositEvent(db, g, e) : null;
          return { ok: true, message: `Deposit ${d.depositId} ${o}${second ? `; duplicate webhook ${second.outcome}` : ''}.`, detail: { first, second } };
        }
        case 'deposit_event': { const e = sandboxEvent(String(b.depositId), String(b.outcome) as 'succeeded' | 'failed' | 'cancelled'); const r = handleDepositEvent(db, g, e); return { ok: true, message: `Webhook ${r.outcome}.`, detail: r }; }
        case 'withdrawal': {
          const id = String(b.id); const act = String(b.action);
          if (act === 'approve') approveWithdrawal(db, g, id); else if (act === 'reject') rejectWithdrawal(db, g, id, String(b.reason ?? 'rejected by developer'));
          else if (act === 'pay') settleWithdrawal(db, g, id, 'paid', `evt_pay_${id}`); else if (act === 'fail') settleWithdrawal(db, g, id, 'failed', `evt_fail_${id}`, 'payout failed (sandbox)');
          else if (act === 'pay_duplicate') { settleWithdrawal(db, g, id, 'paid', `evt_pay_${id}`); settleWithdrawal(db, g, id, 'paid', `evt_pay_${id}`); } else throw new GbpError('FORBIDDEN', 'Unknown withdrawal action');
          return { ok: true, message: `Withdrawal ${id}: ${act} done.` };
        }
        case 'set_assumptions': { setAssumptions(db, b.scenarios as Assumptions[]); audit(db, nowMs, actor, 'treasury.assumptions', null, {}); return { ok: true, message: 'Commercial assumptions saved (scenarios only; nothing is booked).' }; }
        case 'decline_next_subscription': { setMockDecline(db); return { ok: true, message: 'The mock subscription provider will decline the next charge.' }; }
        default: throw new GbpError('FORBIDDEN', `Unknown treasury action ${action}`);
      }
    });
  } catch (e) {
    if (e instanceof GbpError || (e as Error).name === 'LedgerError') { audit(db, nowMs, actor, `treasury.${action}.refused`, null, { error: (e as Error).message }, false); return { ok: false, message: (e as Error).message }; }
    throw e;
  }
}
export const gameDateOf = (db: Sql) => gameDate(loadConfig(db), db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t);
