import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { available, destroy, issue, type TickCtx } from './ledger';
import { logEvent } from './stats';
import { STATE_PROVIDERS, providerOf } from './stateServices';
import { depositsTotal } from './bank';
import { inflationBps, latestCpi } from './inflation';

/**
 * Penny Central Bank. Everything it does is a RULE with a recorded reason:
 *  • every `cbReviewEveryTicks` days it compares 30-day basket inflation with its target ± band and moves the base rate one step (up when prices rise too fast, down when
 *    they rise too slowly), within [0, cbRateMaxBps]. Each decision lands in `policy_log` with the data it was based on;
 *  • liquidity: it NEVER lends because a borrower asks. Only if the National Bank's cash falls below its reserve requirement can it issue one `liquidity step`, at most once
 *    a week and only while inflation is not above target + band; when inflation is high and the bank holds surplus reserves it DRAINS a step (an explicit burn).
 *    Both are `monetary_ops` rows and the ledger shows them as issuance / sink, so coin creation and destruction stay distinguishable from transfers.
 * The base rate then acts through real mechanisms: loan and deposit rates (bank.ts), debt-service tests for new loans, and the valuation discount (valuation.ts).
 */
export interface CentralBankRow { base_rate_bps: number; inflation_target_bps: number; reserve_req_bps: number; liquidity_step_minor: number; drain_step_minor: number; last_review_tick: number; stance: string; rule_enabled: number }
export const centralBank = (db: Sql) => db.get<CentralBankRow>('SELECT * FROM central_bank WHERE id = 1')!;

export function logPolicy(db: Sql, tick: number, actor: string, kind: string, oldV: number | null, newV: number | null, reason: string, data: unknown = {}) {
  db.run('INSERT INTO policy_log (tick, actor, kind, old_value, new_value, reason, inflation_bps, data_json) VALUES (?,?,?,?,?,?,?,?)', tick, actor, kind, oldV, newV, reason, inflationBps(db), JSON.stringify(data));
}

export function reviewPolicy(db: Sql, ctx: TickCtx, cfg: EngineConfig): { changed: boolean } {
  const cb = centralBank(db);
  if (!cb.rule_enabled || ctx.tick - cb.last_review_tick < cfg.cbReviewEveryTicks) return { changed: false };
  const cpi = latestCpi(db);
  db.run('UPDATE central_bank SET last_review_tick = ? WHERE id = 1', ctx.tick);
  if (!cpi || ctx.tick < 31) { logPolicy(db, ctx.tick, 'rule', 'review', cb.base_rate_bps, cb.base_rate_bps, 'Too little price history for a decision: rate held.'); return { changed: false }; }
  const infl = cpi.change_30d_bps;
  let next = cb.base_rate_bps, stance = 'neutral', why = `30-day inflation ${(infl / 100).toFixed(2)}% is within ${(cb.inflation_target_bps / 100).toFixed(2)}% ± ${(cfg.cbBandBps / 100).toFixed(2)}%: rate held.`;
  if (infl > cb.inflation_target_bps + cfg.cbBandBps) { next = Math.min(cfg.cbRateMaxBps, cb.base_rate_bps + cfg.cbRateStepBps); stance = 'tightening'; why = `30-day inflation ${(infl / 100).toFixed(2)}% is above target ${(cb.inflation_target_bps / 100).toFixed(2)}% + band: rate raised.`; }
  else if (infl < cb.inflation_target_bps - cfg.cbBandBps) { next = Math.max(0, cb.base_rate_bps - cfg.cbRateStepBps); stance = 'easing'; why = `30-day inflation ${(infl / 100).toFixed(2)}% is below target ${(cb.inflation_target_bps / 100).toFixed(2)}% - band: rate lowered.`; }
  db.run('UPDATE central_bank SET base_rate_bps = ?, stance = ? WHERE id = 1', next, stance);
  logPolicy(db, ctx.tick, 'rule', next === cb.base_rate_bps ? 'review' : 'base_rate', cb.base_rate_bps, next, why, { cpiBps: cpi.index_bps });
  if (next !== cb.base_rate_bps) logEvent(db, ctx.tick, 'rate_decision', 'info', null, `Penny Central Bank ${next > cb.base_rate_bps ? 'raised' : 'cut'} the base rate to ${(next / 100).toFixed(2)}% from ${(cb.base_rate_bps / 100).toFixed(2)}%. ${why}`, { from: cb.base_rate_bps, to: next });
  return { changed: next !== cb.base_rate_bps };
}

/** Rule-bound liquidity operations (see header). At most one per 7 days. */
export function liquidityOps(db: Sql, ctx: TickCtx, cfg: EngineConfig): { issued: number; drained: number } {
  const cb = centralBank(db), bank = providerOf(db, 'banking'); const none = { issued: 0, drained: 0 };
  if (!cb.rule_enabled || !bank) return none;
  const last = db.get<{ t: number }>('SELECT COALESCE(MAX(tick),-99) t FROM monetary_ops')!.t;
  if (ctx.tick - last < 7) return none;
  const infl = inflationBps(db);
  const cash = available(db, bank.treasury), required = Math.floor((depositsTotal(db) * cb.reserve_req_bps) / 10_000);
  const floor = Math.floor(cfg.bankSeedMinor / 20);   // 5% of founding capital: the bank must always be able to lend something
  if (cash < Math.max(required, floor) && infl <= cb.inflation_target_bps + cfg.cbBandBps) {
    const amt = cb.liquidity_step_minor;
    const tx = issue(db, ctx, `t${ctx.tick}:cb:liquidity`, bank.treasury, amt, 'Penny Central Bank liquidity operation (rule-based issuance)');
    db.run('INSERT INTO monetary_ops (tick, kind, amount_minor, counterparty, ledger_tx_id, reason) VALUES (?,?,?,?,?,?)', ctx.tick, 'liquidity_issue', amt, STATE_PROVIDERS.banking.id, tx.txId, `Bank cash ${cash} below required ${Math.max(required, floor)}; inflation ${infl}bps within limits`);
    logPolicy(db, ctx.tick, 'rule', 'liquidity_issue', null, amt, 'National Bank reserves below requirement', { cash, required });
    return { issued: amt, drained: 0 };
  }
  if (infl > cb.inflation_target_bps + cfg.cbBandBps && cash > Math.max(required, floor) + 2 * cb.drain_step_minor) {
    const amt = cb.drain_step_minor;
    destroy(db, ctx, `t${ctx.tick}:cb:drain`, bank.treasury, amt, 'Penny Central Bank liquidity drain (explicit burn)');
    db.run('INSERT INTO monetary_ops (tick, kind, amount_minor, counterparty, ledger_tx_id, reason) VALUES (?,?,?,?,NULL,?)', ctx.tick, 'liquidity_drain', amt, STATE_PROVIDERS.banking.id, `Inflation ${infl}bps above target; surplus reserves drained`);
    logPolicy(db, ctx.tick, 'rule', 'liquidity_drain', null, amt, 'Inflation above target with surplus reserves', { cash, required });
    return { issued: 0, drained: amt };
  }
  return none;
}
