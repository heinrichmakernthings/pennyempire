import type { Sql } from '../db/sql';
import { loadConfig, gameDate } from './config';
import { drawDueLotteries } from './lottery';
import { executeDraw } from './rewards';
import { leaderboard } from './prestige';
import { awardReward } from './rewards';
import { GbpError } from './gbpLedger';
import type { TickCtx } from './ledger';

/**
 * Scheduled services that use real randomness or settle between ticks. They are NOT part of the deterministic economic tick (a tick must replay identically): they run right
 * after ticks are caught up, are idempotent, and only act on things already due.
 */
export function runScheduledServices(db: Sql, nowMs: number): { lotteriesDrawn: string[]; lotteriesCancelled: string[]; prizeDraws: string[]; weeklyAwards: number } {
  const tick = db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
  const ctx: TickCtx = { tick, gameDate: gameDate(loadConfig(db), tick), actor: 'scheduler' };
  const g = { tick, ms: nowMs, actor: 'scheduler' };
  const res = drawDueLotteries(db, ctx);
  const draws: string[] = [];
  for (const d of db.all<{ id: string }>("SELECT id FROM prize_draws WHERE status = 'open' AND closes_tick <= ?", tick)) { executeDraw(db, g, d.id); draws.push(d.id); }
  // weekly leaderboard awards: top human players by prestige, once per programme per week, only from the funded reserve
  let weekly = 0;
  if (tick > 0 && tick % 7 === 0) for (const p of db.all<{ id: string }>("SELECT id FROM reward_programs WHERE source = 'weekly_leaderboard' AND active = 1 ORDER BY id")) {
    const rows = leaderboard(db, '', 'city').rows.filter((r) => db.get('SELECT 1 FROM players WHERE id = ?', r.ownerId));
    rows.forEach((r, i) => { try { awardReward(db, g, { programId: p.id, playerId: r.ownerId, key: `weekly:${p.id}:${tick}:${r.ownerId}`, weeklyRank: i + 1 }); weekly++; } catch (e) { if (!(e instanceof GbpError)) throw e; } });
  }
  return { lotteriesDrawn: res.drawn, lotteriesCancelled: res.cancelled, prizeDraws: draws, weeklyAwards: weekly };
}
