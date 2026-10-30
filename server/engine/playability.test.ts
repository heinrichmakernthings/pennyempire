// @vitest-environment node
import { advance, openWorld } from './world';
import { available, balance, reconcile, transfer } from './ledger';
import { configureCompany } from './commands';
import { createCompany, startupQuote } from './company';
import { management } from './insights';
import { advanceToNow, nextTickAtMs, setPace } from './clock';
import { loadConfig, saveConfig } from './config';
import { applySeedPatches, PACE_V1_MS } from '../seed/patches';
import { setParam } from './admin';
import { deepAudit } from '../audit/invariants';
import { HOUSEHOLDS, PLAYER_WALLET } from '../seed/bristol';
import type { Sql } from '../db/sql';

const fresh = () => { const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'new'); advance(db, 3); return db; };
const found = (db: Sql, industry: string, plotId: string, name: string) => {
  const q = startupQuote(db, { industry, plotId, tier: 1, name });
  const r = createCompany(db, `found-${industry}`, { industry, plotId, tier: 1, name, expectedTotalMinor: q.totalMinor });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return (r.data as { companyId: string }).companyId;
};
const co = (db: Sql, id: string) => db.get<{ status: string; revision: number; treasury_account_id: string; unpaid_minor: number; owner_cover: number }>('SELECT status, revision, treasury_account_id, unpaid_minor, owner_cover FROM companies WHERE id = ?', id)!;
let seq = 0;
const T = { tick: 3, gameDate: '', actor: 'test' };
/** Empties the company till into the owner's wallet through the ledger, as if a bad week had spent it. */
const emptyTill = (db: Sql, id: string) => { const a = co(db, id).treasury_account_id; const b = available(db, a); if (b > 0) transfer(db, T, `test-drain-${seq++}`, a, PLAYER_WALLET, b, 'owner_withdrawal', 'test: till emptied'); };

describe('world pace (Prompt 12)', () => {
  it('new worlds run one in-game day per 10 real minutes', () => {
    const db = openWorld(':memory:', {}, 'new');
    expect(loadConfig(db).realMsPerTick).toBe(PACE_V1_MS);
  });

  it('pace-v1 moves a world on the old one-minute pace to ten minutes without skipping or replaying a day', () => {
    const db = fresh(); const t0 = Date.now();
    saveConfig(db, { ...loadConfig(db), realMsPerTick: 60_000 }, 'test: old alpha pace');
    db.run('UPDATE engine_state SET clock_anchor_ms = ? WHERE id = 1', t0 - 3 * 60_000);   // in step with the old clock: day 3 is current
    db.run("DELETE FROM meta WHERE key = 'seed_patch:pace-v1'");
    applySeedPatches(db, { tick: 3, gameDate: '', actor: 'test' });
    expect(loadConfig(db).realMsPerTick).toBe(PACE_V1_MS);
    const now = Date.now();
    expect(advanceToNow(db, now).ran).toBe(0);                                   // no burst
    expect(nextTickAtMs(db) - now).toBeGreaterThan(PACE_V1_MS - 5_000);          // the next day is ~10 minutes away, not stalled for hours
    expect(nextTickAtMs(db) - now).toBeLessThanOrEqual(PACE_V1_MS);
    expect(advanceToNow(db, now + PACE_V1_MS).ran).toBe(1);
  });

  it('keeps a pace an administrator chose', () => {
    const db = fresh();
    saveConfig(db, { ...loadConfig(db), realMsPerTick: 1_800_000 }, 'test: admin pace');
    db.run("DELETE FROM meta WHERE key = 'seed_patch:pace-v1'");
    applySeedPatches(db, { tick: 3, gameDate: '', actor: 'test' });
    expect(loadConfig(db).realMsPerTick).toBe(1_800_000);
  });

  it('administrators can change the pace within bounds, and the clock is re-anchored', () => {
    const db = fresh();
    expect(setParam(db, 'admin', 'realMsPerTick', 30_000, 'too fast for anyone').ok).toBe(false);
    expect(setParam(db, 'admin', 'realMsPerTick', 3_600_000, 'one day per real hour').ok).toBe(true);
    const now = Date.now();
    expect(advanceToNow(db, now).ran).toBe(0);
    expect(nextTickAtMs(db) - now).toBeLessThanOrEqual(3_600_000);
    expect(nextTickAtMs(db) - now).toBeGreaterThan(3_600_000 - 5_000);
  });

  it('setPace works from any day', () => {
    const db = fresh(); setPace(db, 120_000, 1_000_000_000, 'test');
    expect(advanceToNow(db, 1_000_000_000 + 119_999).ran).toBe(0);
    expect(advanceToNow(db, 1_000_000_000 + 120_000).ran).toBe(1);
  });
});

describe('owner cover (Prompt 12)', () => {
  const setup = () => { const db = fresh(); return { db, id: found(db, 'pizza', 'plot-pizza', 'Cover Slices') }; };

  it('is on by default and pays a cash shortfall from the wallet instead of building arrears', () => {
    const { db, id } = setup();
    expect(co(db, id).owner_cover).toBe(1);
    expect(management(db, id)!.ownerCover).toBe(true);
    emptyTill(db, id);
    const w0 = balance(db, PLAYER_WALLET);
    advance(db, 5);
    expect(co(db, id).status).toBe('operating');
    expect(co(db, id).unpaid_minor).toBe(0);
    expect(balance(db, PLAYER_WALLET)).toBeLessThan(w0);
    const ev = db.all<{ message: string }>("SELECT message FROM economic_events WHERE kind = 'owner_cover' AND subject = ?", id);
    expect(ev.length).toBe(1);                                               // one warning a week, not one a day
    expect(ev[0]!.message).toMatch(/your wallet paid/);
    expect(reconcile(db).ok).toBe(true);
    expect(deepAudit(db).findings.filter((f) => f.severity === 'P0' || f.severity === 'P1')).toEqual([]);
  });

  it('can be switched off, and then an empty till leads to insolvency as before', () => {
    const { db, id } = setup();
    expect(configureCompany(db, 'cover-off', id, co(db, id).revision, { ownerCover: false }).ok).toBe(true);
    emptyTill(db, id);
    const w0 = balance(db, PLAYER_WALLET);
    advance(db, loadConfig(db).insolvencyAfterTicks + 1);
    expect(co(db, id).status).toBe('insolvent');
    expect(balance(db, PLAYER_WALLET)).toBe(w0);
  });

  it('never takes more than the wallet holds', () => {
    const { db, id } = setup();
    emptyTill(db, id);
    transfer(db, T, 'test-wallet-out', PLAYER_WALLET, HOUSEHOLDS, available(db, PLAYER_WALLET) - 100, 'transfer', 'test: wallet spent, 1 EC left');
    advance(db, 5);
    expect(balance(db, PLAYER_WALLET)).toBeGreaterThanOrEqual(0);
    expect(['operating', 'insolvent']).toContain(co(db, id).status);
    expect(reconcile(db).ok).toBe(true);
  });

  it('also buys tomorrow\'s ingredients, so an empty till does not stall production and sales for good', () => {
    const { db, id } = setup();
    db.run('UPDATE inventory SET qty = 0, value_minor = 0 WHERE company_id = ? AND reserved = 0', id);   // no stock either
    emptyTill(db, id);
    advance(db, 4);
    const last = db.get<{ p: number; u: number }>('SELECT SUM(units_produced) p, SUM(units_sold) u FROM company_tick_stats WHERE company_id = ? AND tick > ?', id, 4)!;
    expect(last.p).toBeGreaterThan(0); expect(last.u).toBeGreaterThan(0);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM ledger_transactions WHERE memo LIKE 'owner cover:%ingredients%'")!.n).toBeGreaterThan(0);
    expect(reconcile(db).ok).toBe(true);
    expect(deepAudit(db).findings.filter((f) => f.severity === 'P0' || f.severity === 'P1')).toEqual([]);
  });
});

describe('setting guardrails (Prompt 12)', () => {
  it('refuses advertising for a wholesale producer, whose buyers are businesses', () => {
    const db = fresh(); const id = found(db, 'farm', 'lot-3', 'Guard Farm');
    const r = configureCompany(db, 'farm-ads', id, co(db, id).revision, { marketingMinorPerTick: 5_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.fieldErrors?.marketingMinorPerTick).toMatch(/only reaches households/);
  });

  it('warns when premium quality makes ingredients eat the price', () => {
    const db = fresh(); const id = found(db, 'pizza', 'plot-pizza', 'Guard Slices');
    const ok = configureCompany(db, 'premium', id, co(db, id).revision, { quality: 'premium' });
    expect(ok.ok).toBe(true); if (!ok.ok) return;
    expect((ok.data as { warnings: string[] }).warnings.join(' ')).toMatch(/premium quality/);
    expect(management(db, id)!.diagnosis.some((d) => d.kind === 'bad' && /premium/.test(d.text))).toBe(true);
    const back = configureCompany(db, 'standard', id, co(db, id).revision, { quality: 'standard' });
    expect(back.ok && (back.data as { warnings: string[] }).warnings).toEqual([]);
  });

  it('warns when the price is below the ingredient cost of one unit', () => {
    const db = fresh(); const id = found(db, 'pizza', 'plot-pizza', 'Cheap Slices');
    const r = configureCompany(db, 'cheap', id, co(db, id).revision, { priceMinor: 600 });
    expect(r.ok && (r.data as { warnings: string[] }).warnings.join(' ')).toMatch(/lose money on every unit/);
  });
});
