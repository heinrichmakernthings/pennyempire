// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { advanceToNow } from './clock';
import { lastTick, openWorld, advance } from './world';
import { memWorld, one, stateHash } from '../test/helpers';
import { reconcile } from './ledger';
import { migrate } from '../db/migrate';

describe('economic clock and offline catch-up', () => {
  it('runs due ticks without anyone clicking, and is idempotent for the same instant', () => {
    const db = memWorld({ realMsPerTick: 1_000 }); const t0 = 1_000_000;
    expect(advanceToNow(db, t0)).toMatchObject({ ran: 0 });                  // first call anchors the clock
    expect(advanceToNow(db, t0 + 3_500)).toMatchObject({ ran: 3, lastTick: 3 });
    const h = stateHash(db);
    expect(advanceToNow(db, t0 + 3_500)).toMatchObject({ ran: 0 });
    expect(advanceToNow(db, t0 + 3_999)).toMatchObject({ ran: 0 });
    expect(stateHash(db)).toBe(h);
    expect(advanceToNow(db, t0 + 4_000)).toMatchObject({ ran: 1, lastTick: 4 });
  });
  it('limits offline catch-up, skips the rest of the gap, and records it', () => {
    const db = memWorld({ realMsPerTick: 1_000, maxCatchupTicks: 10 }); const t0 = 5_000_000;
    advanceToNow(db, t0); advanceToNow(db, t0 + 2_000);
    const r = advanceToNow(db, t0 + 2_000 + 3_600_000);                     // offline for an hour = 3,600 ticks
    expect(r).toMatchObject({ ran: 10, skipped: 3_590, lastTick: 12 });
    const ev = one<{ message: string; data_json: string }>(db, "SELECT message, data_json FROM economic_events WHERE kind = 'offline_gap'");
    expect(JSON.parse(ev.data_json)).toEqual({ replayed: 10, skipped: 3_590 });
    expect(advanceToNow(db, t0 + 2_000 + 3_600_000)).toMatchObject({ ran: 0 });   // re-anchored: no endless backlog
    expect(advanceToNow(db, t0 + 2_000 + 3_601_000)).toMatchObject({ ran: 1 });
    expect(reconcile(db).ok).toBe(true);
  });
  it('downtime never changes outcomes, only delays them: tick N is identical whether reached live or after a long gap', () => {
    const live = memWorld({ realMsPerTick: 1_000, maxCatchupTicks: 1_000 }), gap = memWorld({ realMsPerTick: 1_000, maxCatchupTicks: 1_000 });
    advanceToNow(live, 0); advanceToNow(gap, 0);
    for (let s = 1; s <= 20; s++) advanceToNow(live, s * 1_000);
    advanceToNow(gap, 20_000);
    expect(stateHash(gap)).toBe(stateHash(live));
  });
});

describe('persistence between sessions', () => {
  it('a file database survives close/reopen byte-for-byte and continues exactly as an uninterrupted run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pe-')); const path = join(dir, 'world.db');
    try {
      const a = openWorld(path); advance(a, 12); const h = stateHash(a); a.close();
      const b = openWorld(path);                                          // migrate + seed are no-ops on an existing world
      expect(lastTick(b)).toBe(12); expect(stateHash(b)).toBe(h);
      advance(b, 8); const resumed = stateHash(b); b.close();
      const straight = memWorld(); advance(straight, 20);
      expect(resumed).toBe(stateHash(straight));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('migrations are append-only and re-runnable', () => {
    const db = memWorld();
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM schema_migrations').n).toBe(6);
    expect(migrate(db)).toEqual([]);
  });
});
