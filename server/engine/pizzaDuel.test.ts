// @vitest-environment node
import { advance, openWorld } from './world';
import { configureCompany } from './commands';
import { createCompany, startupQuote } from './company';
import { issue, reconcile } from './ledger';
import { PLAYER_WALLET } from '../seed/bristol';
import type { Sql } from '../db/sql';

const NPC = 'co-clifton-slice';
type Play = { price: number; quality: 'basic' | 'standard' | 'premium'; staffFrac: number; marketing: number };

/** The final gameplay test: a player pizza restaurant against the NPC pizza restaurant, both through the real commands and the real tick. */
function duel(play: Play, days = 60) {
  const db: Sql = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'new');
  issue(db, { tick: 0, gameDate: 'x', actor: 'test' }, 'g', PLAYER_WALLET, 3_000_000, 'test grant');
  const q = startupQuote(db, { industry: 'pizza', plotId: 'lot-1', tier: 1, name: 'Player Pizza' });
  const r = createCompany(db, 'duel-found', { industry: 'pizza', plotId: 'lot-1', tier: 1, name: 'Player Pizza', expectedTotalMinor: q.totalMinor });
  if (!r.ok) throw new Error(r.error.message);
  const id = (r.data as { companyId: string }).companyId;
  const c = db.get<{ revision: number; max_employees: number; min_price_minor: number; max_price_minor: number }>('SELECT revision, max_employees, min_price_minor, max_price_minor FROM companies WHERE id = ?', id)!;
  const res = configureCompany(db, 'duel-cfg', id, c.revision, { priceMinor: Math.min(c.max_price_minor, Math.max(c.min_price_minor, play.price)), quality: play.quality, employees: Math.max(1, Math.round(c.max_employees * play.staffFrac)), marketingMinorPerTick: play.marketing });
  if (!res.ok) throw new Error(res.error.message);
  advance(db, days);
  const share = (co: string) => db.get<{ u: number }>('SELECT COALESCE(SUM(units_sold),0) u FROM company_tick_stats WHERE company_id = ? AND tick > ?', co, days - 20)!.u;
  const profit = (co: string) => db.get<{ p: number }>('SELECT COALESCE(SUM(net_profit_minor),0) p FROM company_tick_stats WHERE company_id = ?', co)!.p;
  const mine = share(id), theirs = share(NPC);
  return { db, id, mine, theirs, shareBps: Math.floor((mine * 10_000) / Math.max(1, mine + theirs)), myProfit: profit(id), npcProfit: profit(NPC), npcDecisions: db.get<{ n: number }>('SELECT COUNT(*) n FROM npc_decisions WHERE company_id = ?', NPC)!.n, ok: reconcile(db).ok };
}

describe('player pizza restaurant vs NPC pizza restaurant', () => {
  const sound = duel({ price: 1_000, quality: 'standard', staffFrac: 1, marketing: 800 });
  const lazy = duel({ price: 1_600, quality: 'basic', staffFrac: 0.4, marketing: 0 });
  const reckless = duel({ price: 1_000, quality: 'premium', staffFrac: 1, marketing: 1_500 });

  it('the NPC competitor is a live, decision-making company that follows the same rules', () => {
    expect(sound.npcDecisions).toBeGreaterThan(5); expect(sound.ok && lazy.ok && reckless.ok).toBe(true);
    expect(sound.db.get<{ n: number }>('SELECT COUNT(*) n FROM npc_profiles WHERE company_id = ?', NPC)!.n).toBe(1);
  });
  it('the player can win: a sound restaurant sells most of what it makes, earns a profit and takes a real slice of Bristol’s pizza from the NPC', () => {
    const made = sound.db.get<{ u: number }>('SELECT COALESCE(SUM(units_produced),0) u FROM company_tick_stats WHERE company_id = ? AND tick > 40', sound.id)!.u;
    expect(sound.mine).toBeGreaterThanOrEqual(Math.floor(made * 0.8)); expect(sound.myProfit).toBeGreaterThan(0); expect(sound.shareBps).toBeGreaterThan(2_000);
    const npcBefore = sound.db.get<{ u: number }>('SELECT AVG(units_sold) u FROM company_tick_stats WHERE company_id = ? AND tick BETWEEN 1 AND 3', NPC)!.u;
    expect(npcBefore).toBeGreaterThan(0);
  });
  it('the player can lose: spending more than the restaurant earns (premium goods, heavy advertising, no margin) ends in insolvency and a recorded liquidation', () => {
    const row = reckless.db.get<{ status: string; bankrupt_tick: number | null }>('SELECT status, bankrupt_tick FROM companies WHERE id = ?', reckless.id)!;
    expect(row.status === 'insolvent' || row.bankrupt_tick !== null).toBe(true); expect(reckless.myProfit).toBeLessThan(0);
    expect(reckless.db.get<{ n: number }>("SELECT COUNT(*) n FROM economic_events WHERE kind IN ('insolvency','bankruptcy') AND subject = ?", reckless.id)!.n).toBeGreaterThan(0);
  });
  it('price, staffing and quality decide share: a dear, understaffed restaurant takes a smaller slice than a sound one', () => {
    expect(lazy.shareBps).toBeLessThan(sound.shareBps); expect(lazy.mine).toBeLessThan(sound.mine);
  });
  it('the NPC stays in business through the fight and its reviews are on the record', () => {
    for (const d of [sound, lazy, reckless]) { const npc = d.db.get<{ status: string; bankrupt_tick: number | null }>('SELECT status, bankrupt_tick FROM companies WHERE id = ?', NPC)!; expect(npc.bankrupt_tick).toBeNull(); expect(npc.status).toBe('operating'); }
    expect(sound.db.get<{ n: number }>('SELECT COUNT(*) n FROM npc_decisions WHERE company_id = ? AND reason <> \'\'', NPC)!.n).toBeGreaterThan(5);
  });
});
