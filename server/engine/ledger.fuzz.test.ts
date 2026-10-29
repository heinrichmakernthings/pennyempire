// @vitest-environment node
import { openNodeSqlite } from '../db/nodeSqlite';
import { migrate } from '../db/migrate';
import { BURN, ISSUANCE, LedgerError, createAccount, destroy, issue, reconcile, supply, transfer } from './ledger';

/** mulberry32 — seeded so a failing run is reproducible. */
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

describe('ledger property tests (random operation streams)', () => {
  for (const seed of [1, 7, 42, 1234, 99999]) {
    it(`conserves coins under ${600} random operations incl. duplicates and overdrafts (seed ${seed})`, () => {
      const db = openNodeSqlite(':memory:'); migrate(db); const r = rng(seed);
      createAccount(db, ISSUANCE, 'issuance', 'm'); createAccount(db, BURN, 'destroyed', 'b');
      const accts = ['a', 'b', 'c', 'd', 'e'].map((x) => { createAccount(db, x, x === 'e' ? 'state_treasury' : 'player', x); return x; });
      const ctx = { tick: 1, gameDate: 'x', actor: 'fuzz' };
      let issued = 0, destroyed = 0; const keys: string[] = [];
      for (let i = 0; i < 600; i++) {
        const op = r(); const amt = 1 + Math.floor(r() * 5_000); const from = accts[Math.floor(r() * 5)]!, to = accts[Math.floor(r() * 5)]!;
        const reuse = keys.length && r() < 0.15; const key = reuse ? keys[Math.floor(r() * keys.length)]! : `k${i}`;
        try {
          if (op < 0.25) { const res = issue(db, ctx, key, to, amt, 'g'); if (!res.duplicate) issued += amt; }
          else if (op < 0.4) { const before = supply(db).destroyed; destroy(db, ctx, key, from, amt, 'b'); destroyed += supply(db).destroyed - before; }
          else if (from !== to) transfer(db, ctx, key, from, to, amt, 'transfer', 't');
          keys.push(key);
        } catch (e) { expect(e).toBeInstanceOf(LedgerError); }                       // overdrafts / mismatched replays are refused, never half-applied
        for (const a of db.all<{ balance_minor: number; reserved_minor: number }>("SELECT balance_minor, reserved_minor FROM accounts WHERE kind NOT IN ('issuance')")) expect(a.balance_minor).toBeGreaterThanOrEqual(0);
      }
      const s = supply(db);
      expect(s.issued).toBe(issued); expect(s.destroyed).toBe(destroyed); expect(s.circulating).toBe(issued - destroyed);
      expect(reconcile(db)).toMatchObject({ ok: true, problems: [] });
    });
  }
});
