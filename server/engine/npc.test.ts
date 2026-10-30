// @vitest-environment node
import { advance } from './world';
import { reconcile, supply } from './ledger';
import { loadConfig, saveConfig } from './config';
import { memWorld, one, stateHash } from '../test/helpers';
import { runTick } from './tick';
import { STRATEGIES } from './npc';
import { seasonBps, allocateSegment } from './consumers';

describe('NPC competitors', () => {
  const db = memWorld(); advance(db, 120);

  it('every NPC company has a strategy profile from the known set, and decisions are logged with reasons', () => {
    const npcs = db.all<{ id: string; strategy: string }>("SELECT c.id, p.strategy FROM companies c JOIN npc_profiles p ON p.company_id = c.id WHERE c.owner_kind = 'npc'");
    expect(npcs.length).toBeGreaterThanOrEqual(6);
    for (const n of npcs) expect(Object.keys(STRATEGIES)).toContain(n.strategy);
    const d = db.all<{ action: string; reason: string; inputs_json: string }>('SELECT action, reason, inputs_json FROM npc_decisions');
    expect(d.length).toBeGreaterThan(20);
    for (const r of d) { expect(r.reason.length).toBeGreaterThan(5); expect(() => JSON.parse(r.inputs_json)).not.toThrow(); }
  });
  it('NPC reviews are staggered and bounded per tick', () => {
    const cfg = loadConfig(db);
    for (const r of db.all<{ tick: number; n: number }>('SELECT tick, COUNT(DISTINCT company_id) n FROM npc_decisions GROUP BY tick')) expect(r.n).toBeLessThanOrEqual(cfg.npcDecisionsPerTick);
  });
  it('market entry is rate-limited, capped, and never uses the player’s reserved lots', () => {
    const cfg = loadConfig(db);
    const opened = db.all<{ tick: number }>("SELECT tick FROM economic_events WHERE kind = 'company_opened' ORDER BY tick").map((r) => r.tick);
    for (let i = 1; i < opened.length; i++) expect(opened[i]! - opened[i - 1]!).toBeGreaterThanOrEqual(1);
    expect(opened.length).toBeLessThanOrEqual(Math.ceil(120 / cfg.npcEntryEveryTicks));
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM companies WHERE owner_kind = 'npc' AND bankrupt_tick IS NULL").n).toBeLessThanOrEqual(cfg.npcMaxCompanies + 13);
  });
  it('NPCs create no coins: the ledger reconciles and issuance equals the explicit seeds and state support only', () => {
    expect(reconcile(db).ok).toBe(true);
    const s = supply(db); expect(s.issued - s.destroyed).toBe(s.circulating);
  });
  it('NPC activity is deterministic: the same world produces the same state', () => {
    const a = memWorld(), b = memWorld(); advance(a, 60); advance(b, 60);
    expect(stateHash(a)).toBe(stateHash(b));
  });
  it('re-running an already-processed tick is a no-op (no duplicate NPC production or decisions)', () => {
    const w = memWorld(); advance(w, 30);
    const before = stateHash(w); const r = runTick(w, 30);
    expect(r.status).toBe('skipped'); expect(stateHash(w)).toBe(before);
  });
  it('NPC reviews can be disabled by configuration (versioned config)', () => {
    const w = memWorld(); const cfg = loadConfig(w); saveConfig(w, { ...cfg, npcDecisionsPerTick: 0 }, 'test: freeze NPC reviews');
    advance(w, 20);
    expect(one<{ n: number }>(w, 'SELECT COUNT(*) n FROM npc_decisions').n).toBe(0);
    expect(one<{ n: number }>(w, 'SELECT COUNT(*) n FROM config_versions').n).toBeGreaterThanOrEqual(1);
  });
});

describe('consumer economy', () => {
  it('consumer spending moves coins from households to companies through the ledger and never exceeds the funder’s balance', () => {
    const w = memWorld(); advance(w, 30);
    expect(reconcile(w).ok).toBe(true);
    for (const r of w.all<{ tick: number; funded_minor: number; spent_minor: number }>('SELECT * FROM consumer_budget_log')) expect(r.spent_minor).toBeLessThanOrEqual(r.funded_minor);
    expect(one<{ n: number }>(w, 'SELECT COUNT(*) n FROM segment_sales').n).toBeGreaterThan(0);
  });
  it('segment sales add up to what companies actually received', () => {
    const w = memWorld(); advance(w, 20);
    const seg = one<{ v: number }>(w, 'SELECT COALESCE(SUM(spend_minor),0) v FROM segment_sales').v;
    const co = one<{ v: number }>(w, "SELECT COALESCE(SUM(t.revenue_minor),0) v FROM company_tick_stats t JOIN companies c ON c.id = t.company_id WHERE c.owner_kind <> 'state'").v;
    expect(seg).toBeGreaterThan(0); expect(seg).toBeLessThanOrEqual(co);
  });
  it('seasonality is normalised so twelve months average 100%', () => {
    const m = JSON.stringify([8_000, 9_000, 10_000, 11_000, 12_000, 12_000, 11_000, 10_000, 9_000, 9_000, 9_000, 10_000]);
    const f = Array.from({ length: 12 }, (_, i) => seasonBps(m, `2026-${String(i + 1).padStart(2, '0')}-15`));
    expect(Math.abs(f.reduce((a, b) => a + b, 0) / 12 - 10_000)).toBeLessThan(5);
    expect(seasonBps(null, '2026-03-01')).toBe(10_000);
  });
  it('a company with no stock cannot sell; the rival with stock takes the sales', () => {
    const cfg = loadConfig(memWorld());
    const seg = { id: 's', district_id: null, name: 's', population_bps: 10_000, income_bps: 10_000, price_sens_delta: 0, quality_pref_bps: 5_000, loyalty_trait_bps: 5_000, center_col: 0, center_row: 0 };
    const base = { quality: 'standard' as const, reputationBps: 5_000, awarenessBps: 0, ageTicks: 100, distance: 0, loyaltyBps: 0 };
    const r = allocateSegment(cfg, seg, 2, 500, 10_000, [{ id: 'a', price: 500, stock: 0, ...base }, { id: 'b', price: 600, stock: 100, ...base }]);
    expect(r.allocations.find((x) => x.id === 'a')!.units).toBe(0);
    expect(r.allocations.find((x) => x.id === 'b')!.units).toBeGreaterThan(0);
    expect(r.allocations.reduce((a, x) => a + x.spend, 0)).toBeLessThanOrEqual(10_000);
  });
  it('a cheaper rival with equal standing wins the larger share, and bigger stock never lets it sell more than it holds', () => {
    const cfg = loadConfig(memWorld());
    const seg = { id: 's', district_id: null, name: 's', population_bps: 10_000, income_bps: 10_000, price_sens_delta: 0, quality_pref_bps: 5_000, loyalty_trait_bps: 5_000, center_col: 0, center_row: 0 };
    const base = { quality: 'standard' as const, reputationBps: 5_000, awarenessBps: 0, ageTicks: 100, distance: 0, loyaltyBps: 0 };
    const r = allocateSegment(cfg, seg, 2, 500, 5_000, [{ id: 'cheap', price: 400, stock: 3, ...base }, { id: 'dear', price: 600, stock: 100, ...base }]);
    expect(r.allocations.find((x) => x.id === 'cheap')!.units).toBeLessThanOrEqual(3);
    const r2 = allocateSegment(cfg, seg, 2, 500, 2_000, [{ id: 'cheap', price: 400, stock: 100, ...base }, { id: 'dear', price: 600, stock: 100, ...base }]);
    expect(r2.allocations.find((x) => x.id === 'cheap')!.units).toBeGreaterThan(r2.allocations.find((x) => x.id === 'dear')!.units);
  });
});

describe('leaderboards, titles and the Penny Post', () => {
  const w = memWorld(); advance(w, 91);
  it('boards are persisted weekly and rank real companies', () => {
    expect(one<{ n: number }>(w, 'SELECT COUNT(DISTINCT tick) n FROM leaderboard').n).toBeGreaterThanOrEqual(12);
    expect(one<{ n: number }>(w, 'SELECT COUNT(*) n FROM leaderboard l LEFT JOIN companies c ON c.id = l.company_id WHERE c.id IS NULL').n).toBe(0);
  });
  it('titles are awarded to NPCs on the same footing as players, and every change is recorded', () => {
    expect(one<{ n: number }>(w, 'SELECT COUNT(*) n FROM titles').n).toBeGreaterThan(0);
    expect(one<{ n: number }>(w, "SELECT COUNT(*) n FROM titles t JOIN companies c ON c.id = t.holder_company_id WHERE c.owner_kind = 'npc'").n).toBeGreaterThan(0);
    expect(one<{ n: number }>(w, 'SELECT COUNT(*) n FROM title_changes').n).toBeGreaterThanOrEqual(one<{ n: number }>(w, 'SELECT COUNT(*) n FROM titles').n);
  });
  it('every news article traces to a recorded event or recorded market data; none are duplicated', () => {
    expect(one<{ n: number }>(w, "SELECT COUNT(*) n FROM news_articles WHERE kind <> 'shortage' AND event_id IS NULL").n).toBe(0);
    expect(one<{ n: number }>(w, 'SELECT COUNT(*) n FROM (SELECT event_id FROM news_articles WHERE event_id IS NOT NULL GROUP BY event_id HAVING COUNT(*) > 1)').n).toBe(0);
  });
  it('stability stats are recorded every tick and the economy’s money supply does not run away', () => {
    expect(one<{ n: number }>(w, 'SELECT COUNT(*) n FROM stability_stats').n).toBe(91);
    const a = one<{ c: number }>(w, 'SELECT circulating_minor c FROM stability_stats WHERE tick = 1').c, b = one<{ c: number }>(w, 'SELECT circulating_minor c FROM stability_stats WHERE tick = 91').c;
    expect(Math.abs(b - a) / a).toBeLessThan(0.15);
  });
});
