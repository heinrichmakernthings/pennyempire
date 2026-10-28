import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { LedgerError, available, transfer, type TickCtx } from './ledger';
import { HOUSEHOLDS } from '../seed/bristol';

interface StaffRow { id: string; name: string; employees: number; max_employees: number; wage_minor: number; treasury_account_id: string; staff_change_tick: number; hires_in_tick: number; dismissals_in_tick: number }

/** How many people a company may still hire / dismiss today. Same limits for players and NPCs. */
export function staffAllowance(cfg: Pick<EngineConfig, 'staffChangesPerDay'>, c: Pick<StaffRow, 'staff_change_tick' | 'hires_in_tick' | 'dismissals_in_tick'>, tick: number) {
  const same = c.staff_change_tick === tick;
  return { hire: Math.max(0, cfg.staffChangesPerDay - (same ? c.hires_in_tick : 0)), dismiss: Math.max(0, cfg.staffChangesPerDay - (same ? c.dismissals_in_tick : 0)), same };
}

/**
 * The one place staff numbers change. Hiring costs a day's wage as a recruitment fee, dismissal a day's wage as severance; both are paid to households now and
 * recognised in the next day's labour cost. Throws LedgerError(INSUFFICIENT_FUNDS) if the company cannot pay; limits are the caller's check (see staffAllowance).
 */
export function applyStaffChange(db: Sql, ctx: TickCtx, cfg: Pick<EngineConfig, 'staffChangesPerDay'>, c: StaffRow, target: number, key: string): { hires: number; fires: number; feeMinor: number } {
  const hires = Math.max(0, target - c.employees), fires = Math.max(0, c.employees - target);
  if (hires + fires === 0) return { hires, fires, feeMinor: 0 };
  const fee = (hires + fires) * c.wage_minor;
  if (available(db, c.treasury_account_id) < fee) throw new LedgerError('INSUFFICIENT_FUNDS', `Changing staff costs ${fee / 100} EC (one day's wage each); the company has ${available(db, c.treasury_account_id) / 100} EC.`);
  if (fee > 0) transfer(db, ctx, `${key}:staff`, c.treasury_account_id, HOUSEHOLDS, fee, 'operating_cost', `${hires ? 'recruitment' : 'severance'} fees at ${c.name}`);
  const a = staffAllowance(cfg, c, ctx.tick);
  db.run('UPDATE companies SET employees = ?, hires_in_tick = ?, dismissals_in_tick = ?, staff_change_tick = ?, pending_labour_minor = pending_labour_minor + ? WHERE id = ?',
    target, (a.same ? c.hires_in_tick : 0) + hires, (a.same ? c.dismissals_in_tick : 0) + fires, ctx.tick, fee, c.id);
  return { hires, fires, feeMinor: fee };
}

/** NPC staffing: move towards `target` within the daily limits and what the company can afford (never hires on credit). Returns the new headcount. */
export function npcStaffTo(db: Sql, ctx: TickCtx, cfg: Pick<EngineConfig, 'staffChangesPerDay'>, c: StaffRow, target: number, key: string): number {
  target = Math.max(0, Math.min(c.max_employees, target));
  const a = staffAllowance(cfg, c, ctx.tick);
  let next = target > c.employees ? Math.min(target, c.employees + a.hire) : Math.max(target, c.employees - a.dismiss);
  const cash = available(db, c.treasury_account_id);
  while (next !== c.employees && Math.abs(next - c.employees) * c.wage_minor > cash) next += next > c.employees ? -1 : 1;
  if (next === c.employees) return c.employees;
  applyStaffChange(db, ctx, cfg, c, next, key);
  c.employees = next;
  return next;
}
