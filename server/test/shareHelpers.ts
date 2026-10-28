import { expect } from 'vitest';
import type { Sql } from '../db/sql';
import { createCompany, startupQuote } from '../engine/company';
import { checkShareIntegrity, ensureInvestor } from '../engine/capital';
import { createAccount, issue, reconcile } from '../engine/ledger';
import { openWorld } from '../engine/world';
import { PLAYER_WALLET } from '../seed/bristol';

/** A fresh Bristol with the player funded for share tests. */
export const world = (cfg = {}, grant = 4_000_000) => { const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000, ...cfg }, 'new'); issue(db, { tick: 0, gameDate: 'x', actor: 'test' }, 'grant', PLAYER_WALLET, grant, 'test grant'); return db; };
export const found = (db: Sql, industry: string, plot: string, name: string, key = `k-${name}`) => {
  const q = startupQuote(db, { industry, plotId: plot, tier: 1, name });
  const r = createCompany(db, key, { industry, plotId: plot, tier: 1, name, expectedTotalMinor: q.totalMinor });
  if (!r.ok) throw new Error(r.error.message);
  return (r.data as { companyId: string }).companyId;
};
export const now = (db: Sql) => ({ tick: db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t, gameDate: 'x', actor: 'test' });
/** Ledger reconciles and the share register is internally consistent. */
export const sane = (db: Sql) => { expect(checkShareIntegrity(db)).toEqual([]); expect(reconcile(db).ok).toBe(true); };
/** A scripted test investor with its own funded account (a recorded test issuance). */
export function testInvestor(db: Sql, id: string, cash: number) {
  const acct = `acct:test:${id}`; createAccount(db, acct, 'households', `test investor ${id}`);
  db.run("INSERT OR IGNORE INTO owners (id, kind, name) VALUES (?, 'npc', ?)", id, id);
  const inv = ensureInvestor(db, { id, kind: 'household', name: id, account: acct });   // 'household' so the scripted investor is not also driven by the NPC investor engine
  if (cash > 0) issue(db, now(db), `testcash:${id}`, acct, cash, `test funding of ${id}`);
  return inv;
}
