import { runScheduledServices } from './services';
import type { Sql } from '../db/sql';
import { loadConfig } from './config';
import { logEvent } from './stats';
import { runTick, type TickResult } from './tick';

export type SafeTickResult = TickResult | { status: 'failed'; tick: number; error: string };

/** Runs one tick; on failure the whole day rolls back and the failure is recorded (never half-applied). */
export function runTickSafely(db: Sql, n: number): SafeTickResult {
  try { return runTick(db, n); } catch (e) {
    const error = (e as Error).message;
    db.transaction(() => {
      db.run("INSERT INTO ticks (tick, status, game_date, started_at, error) VALUES (?, 'failed', ?, 'failed', ?) ON CONFLICT(tick) DO UPDATE SET status = 'failed', error = excluded.error", n, '', error);
      logEvent(db, n, 'tick_failed', 'error', null, `Tick ${n} failed and was rolled back: ${error}`);
    });
    return { status: 'failed', tick: n, error };
  }
}

export interface AdvanceResult { ran: number; skipped: number; failed: boolean; lastTick: number }

/**
 * Brings the economy up to wall-clock time. The economy is a function of tick number, so being offline never changes outcomes — it only
 * delays them. To bound the work (and stop a returning player facing weeks of simulated events at once) at most `maxCatchupTicks`
 * are replayed; the remainder of the gap is skipped, the clock re-anchored, and an `offline_gap` event is recorded.
 */
export function advanceToNow(db: Sql, nowMs: number): AdvanceResult {
  const cfg = loadConfig(db);
  const st = db.get<{ last_tick: number; clock_anchor_ms: number | null }>('SELECT last_tick, clock_anchor_ms FROM engine_state WHERE id = 1')!;
  const anchor = st.clock_anchor_ms ?? nowMs - st.last_tick * cfg.realMsPerTick;
  if (st.clock_anchor_ms === null) db.run('UPDATE engine_state SET clock_anchor_ms = ? WHERE id = 1 AND clock_anchor_ms IS NULL', anchor);
  const target = Math.floor((nowMs - anchor) / cfg.realMsPerTick);
  let due = target - st.last_tick, skipped = 0;
  if (due <= 0) return { ran: 0, skipped: 0, failed: false, lastTick: st.last_tick };
  if (due > cfg.maxCatchupTicks) {
    skipped = due - cfg.maxCatchupTicks; due = cfg.maxCatchupTicks;
    db.transaction(() => {
      db.run('UPDATE engine_state SET clock_anchor_ms = clock_anchor_ms + ? WHERE id = 1', skipped * cfg.realMsPerTick);
      logEvent(db, st.last_tick, 'offline_gap', 'warning', null, `Server was away for ${due + skipped} ticks; replayed ${due}, skipped ${skipped}`, { replayed: due, skipped });
    });
  }
  let ran = 0, last = st.last_tick;
  for (let i = 0; i < due; i++) {
    const r = runTickSafely(db, last + 1);
    if (r.status === 'failed') return { ran, skipped, failed: true, lastTick: last };
    if (r.status === 'complete') { ran++; last = r.tick; }
  }
  if (ran > 0) runScheduledServices(db, nowMs);
  return { ran, skipped, failed: false, lastTick: last };
}

export const nextTickAtMs = (db: Sql): number => {
  const cfg = loadConfig(db); const st = db.get<{ last_tick: number; clock_anchor_ms: number | null }>('SELECT last_tick, clock_anchor_ms FROM engine_state WHERE id = 1')!;
  return (st.clock_anchor_ms ?? Date.now()) + (st.last_tick + 1) * cfg.realMsPerTick;
};
