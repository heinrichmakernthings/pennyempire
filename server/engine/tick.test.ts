// @vitest-environment node
import { advance, lastTick } from './world';
import { BURN, balance, reconcile, supply, transfer } from './ledger';
import { runTick } from './tick';
import { memWorld, one, stateHash } from '../test/helpers';
import { runTickSafely } from './clock';
import { PLAYER_ID, companyAccount, seedBristol } from '../seed/bristol';

describe('seeding', () => {
  it('creates the Bristol economy with every opening coin recorded as a labelled issuance', () => {
    const db = memWorld();
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM companies').n).toBe(16);
    const s = supply(db);
    expect(s.issued).toBe(s.circulating); expect(s.destroyed).toBe(0);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM ledger_transactions WHERE kind = 'issuance' AND idempotency_key LIKE 'seed:%'").n).toBeGreaterThan(10);
    expect(reconcile(db).ok).toBe(true);
  });
  it('is repeatable: seeding again changes nothing', () => {
    const db = memWorld(); const before = stateHash(db);
    expect(seedBristol(db)).toEqual({ seeded: false, issuedMinor: 0 });
    expect(stateHash(db)).toBe(before);
  });
  it('every demand rule names a real funding account and per-funder pool shares never exceed 100%', () => {
    const db = memWorld();
    for (const r of db.all<{ funder_account_id: string }>('SELECT funder_account_id FROM demand_rules')) expect(db.get('SELECT 1 FROM accounts WHERE id = ?', r.funder_account_id)).toBeTruthy();
    for (const f of db.all<{ f: string; bps: number }>("SELECT funder_account_id f, SUM(amount) bps FROM demand_rules WHERE mode = 'pool_share' GROUP BY funder_account_id")) expect(f.bps).toBeLessThanOrEqual(10_000);
  });
});

describe('ticks', () => {
  it('are idempotent: replaying a processed tick is a no-op', () => {
    const db = memWorld(); advance(db, 3);
    const h = stateHash(db);
    expect(runTick(db, 3)).toMatchObject({ status: 'skipped', reason: 'already_processed' });
    expect(runTick(db, 1)).toMatchObject({ status: 'skipped' });
    expect(stateHash(db)).toBe(h); expect(lastTick(db)).toBe(3);
  });
  it('are strictly ordered: skipping ahead is refused', () => {
    const db = memWorld(); const h = stateHash(db);
    expect(() => runTick(db, 2)).toThrow(/out of order/);
    expect(stateHash(db)).toBe(h);
  });
  it('are deterministic: two worlds with the same seed are bit-identical after 60 days', () => {
    const a = memWorld(), b = memWorld(); advance(a, 60); advance(b, 60);
    expect(stateHash(a)).toBe(stateHash(b));
    const c = memWorld(); advance(c, 59); expect(stateHash(c)).not.toBe(stateHash(a));
  });
  it('a failing tick rolls back completely and can be retried', () => {
    const db = memWorld(); advance(db, 2); const h = stateHash(db);
    expect(() => runTick(db, 3, { phase: (p) => { if (p === 'consumers') throw new Error('boom'); } })).toThrow('boom');
    expect(stateHash(db)).toBe(h); expect(lastTick(db)).toBe(2);
    expect(reconcile(db).ok).toBe(true);
    expect(runTickSafely(db, 3).status).toBe('complete');
  });
  it('conserve coins every day: Δ circulating == issued − destroyed, and the ledger reconciles', () => {
    const db = memWorld(); let prev = supply(db).circulating;
    for (let i = 0; i < 90; i++) {
      const r = runTick(db, lastTick(db) + 1); if (r.status !== 'complete') throw new Error('tick failed');
      expect(r.summary.circulatingMinor - prev).toBe(r.summary.issuedMinor - r.summary.destroyedMinor); prev = r.summary.circulatingMinor;
      expect(r.summary.failures).toBe(0);
    }
    expect(reconcile(db)).toMatchObject({ ok: true });
  });
  it('coins are only created by the NPC income grant (after genesis) and only destroyed by labelled sinks', () => {
    const db = memWorld(); advance(db, 60);
    const issuers = db.all<{ memo: string }>("SELECT DISTINCT memo FROM ledger_transactions WHERE kind = 'issuance' AND tick > 0");
    expect(issuers.map((i) => i.memo)).toEqual(['NPC citizen income grant']);
    const sinks = db.all<{ memo: string }>("SELECT DISTINCT memo FROM ledger_transactions WHERE kind IN ('sink','sink_fee') ORDER BY memo").map((r) => r.memo.replace(/ on trade \d+/, ''));
    expect([...new Set(sinks)].every((m) => m.startsWith('Penny Exchange fee burn') || m.startsWith('infrastructure upkeep') || m.includes('infrastructure wear (explicit burn)') || m.startsWith('incorporation licence'))).toBe(true);
    expect(balance(db, BURN)).toBe(supply(db).destroyed);
  });
  it('transfers to state companies are not sinks: rent, energy and advertising stay in circulation', () => {
    const db = memWorld(); advance(db, 10);
    const toState = one<{ s: number }>(db, "SELECT COALESCE(SUM(p.amount_minor),0) s FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.kind = 'operating_cost' AND p.account_id IN (SELECT treasury_account_id FROM companies WHERE owner_kind = 'state') AND p.amount_minor > 0").s;
    expect(toState).toBeGreaterThan(0);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.kind = 'operating_cost' AND p.account_id = ?", BURN).n).toBe(0);
  });
});

describe('production recipes (docs/ECONOMY.md)', () => {
  it('consume exactly the documented inputs and yield exactly the documented outputs', () => {
    const db = memWorld({ npcDecisionsPerTick: 0 }); advance(db, 30);   // NPC reviews off: they may switch quality grade, which changes ingredient use by design
    const sum = (company: string, commodity: string, reason: string) => one<{ s: number }>(db, 'SELECT COALESCE(SUM(delta),0) s FROM inventory_movements WHERE company_id = ? AND commodity_id = ? AND reason = ?', company, commodity, reason).s;
    for (const pizza of ['co-mad-slices', 'co-clifton-slice']) {                                   // 1 flour + 1 cheese → 1 pizza
      const made = sum(pizza, 'pizza', 'production_output'); expect(made).toBeGreaterThan(0);
      expect(-sum(pizza, 'flour', 'production_input')).toBe(made); expect(-sum(pizza, 'cheese', 'production_input')).toBe(made);
    }
    const flour = sum('co-brunel-mill', 'flour', 'production_output'); expect(flour).toBeGreaterThan(0);
    expect(-sum('co-brunel-mill', 'wheat', 'production_input')).toBe(2 * flour);                  // 2 wheat → 1 flour
    const cheese = sum('co-clifton-dairy', 'cheese', 'production_output'); expect(cheese).toBeGreaterThan(0);
    expect(-sum('co-clifton-dairy', 'milk', 'production_input')).toBe(2 * cheese);                // 2 milk → 1 cheese
    expect(2 * -sum('co-bean-there', 'milk', 'production_input')).toBe(sum('co-bean-there', 'cafe-drink', 'production_output'));   // standard quality: 1 milk → 2 drinks
    expect(20 * -sum('co-harbour-bean', 'milk', 'production_input')).toBe(9 * sum('co-harbour-bean', 'cafe-drink', 'production_output'));   // basic quality uses 10% fewer ingredients: 9 milk → 20 drinks
    for (const primary of [['co-severn-farm', 'wheat'], ['co-severn-farm', 'milk'], ['co-avon-timber', 'timber']] as const) expect(sum(primary[0], primary[1], 'production_output')).toBeGreaterThan(0);   // no inputs required
  });
  it('production is limited by staffing, storage and inputs — never creates stock beyond the cap', () => {
    const db = memWorld(); advance(db, 40);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM inventory i JOIN companies c ON c.id = i.company_id WHERE i.qty > c.storage_cap_units').n).toBe(0);
    for (const r of db.all<{ company_id: string; units: number }>("SELECT company_id, MAX(daily) units FROM (SELECT company_id, tick, SUM(delta) daily FROM inventory_movements WHERE reason = 'production_output' GROUP BY company_id, tick) GROUP BY company_id")) {
      const co = one<{ cap: number }>(db, 'SELECT capacity_batches cap FROM companies WHERE id = ?', r.company_id).cap;
      expect(r.units).toBeLessThanOrEqual(co * 40);                                                // ≤ capacity batches × largest batch size
    }
  });
});

describe('inventory', () => {
  it('stays consistent with its movement log, never goes negative, and only grows through production or the bounded state supply', () => {
    const db = memWorld(); advance(db, 60);
    expect(reconcile(db).problems.filter((p) => p.startsWith('inventory'))).toEqual([]);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM inventory WHERE qty < 0 OR reserved < 0 OR reserved > qty').n).toBe(0);
    const reasons = db.all<{ reason: string }>("SELECT DISTINCT reason FROM inventory_movements WHERE delta > 0 AND tick > 0").map((r) => r.reason).sort();
    expect(reasons).toEqual(['production_output', 'state_supply', 'trade_in']);
    const perTick = db.all<{ q: number }>("SELECT SUM(delta) q FROM inventory_movements WHERE reason = 'state_supply' GROUP BY tick, commodity_id");
    for (const p of perTick) expect(p.q).toBeLessThanOrEqual(120);
  });
  it('every unit traded is conserved: units out of sellers == units into buyers', () => {
    const db = memWorld(); advance(db, 40);
    const o = one<{ s: number }>(db, "SELECT SUM(delta) s FROM inventory_movements WHERE reason = 'trade_out'").s, i = one<{ s: number }>(db, "SELECT SUM(delta) s FROM inventory_movements WHERE reason = 'trade_in'").s;
    const transit = one<{ s: number }>(db, "SELECT COALESCE(SUM(qty),0) s FROM shipments WHERE status = 'delayed'").s;   // goods held by Penny Logistics (taken from the buyer, not yet arrived)
    expect(o + i + transit).toBe(0);
  });
});

describe('consumer demand with one human player and no actions', () => {
  it('NPC households keep buying every day, funded by named accounts, and never spend more than they hold', () => {
    const db = memWorld(); advance(db, 60);
    for (const r of db.all<{ tick: number; rule_id: string; budget_minor: number; spent_minor: number }>('SELECT * FROM demand_tick_stats WHERE tick > 0')) {
      expect(r.spent_minor).toBeLessThanOrEqual(r.budget_minor);
      if (r.rule_id !== 'dem-works') expect(r.spent_minor).toBeGreaterThan(0);
    }
    for (const t of db.all<{ tick: number; h: number }>('SELECT tick, households_minor h FROM supply_snapshots')) expect(t.h).toBeGreaterThanOrEqual(0);
    const spend = one<{ s: number }>(db, "SELECT SUM(spent_minor) s FROM demand_tick_stats WHERE rule_id = 'dem-pizza'").s;
    expect(one<{ s: number }>(db, "SELECT COALESCE(SUM(p.amount_minor),0) s FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.kind = 'consumer_sale' AND p.account_id = 'acct:households:bristol'").s).toBeLessThan(0);
    expect(spend).toBeGreaterThan(0);
  });
  it('the economy stays alive: state enterprises never fail, failures are orderly closures (never zombies), most firms keep trading', () => {
    const db = memWorld(); advance(db, 360);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM companies WHERE owner_kind = 'state' AND status = 'insolvent'").n).toBe(0);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM companies WHERE status = 'insolvent' AND bankrupt_tick IS NULL").n).toBe(0);     // an insolvent firm is liquidated within bankruptcyAfterTicks
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM companies WHERE status = 'operating' AND owner_kind <> 'state'").n).toBeGreaterThanOrEqual(4);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM failed_transactions').n).toBe(0);
  });
});

describe('company financials come from real state', () => {
  it('net profit = revenue − cost of goods − labour − rent − marketing − fees − tax, and cash matches the ledger', () => {
    const db = memWorld(); advance(db, 30);
    for (const r of db.all<Record<string, number>>('SELECT * FROM company_tick_stats WHERE tick > 0')) {
      expect(r.gross_profit_minor).toBe(r.revenue_minor! - r.cogs_minor!);
      expect(r.net_profit_minor).toBe(r.gross_profit_minor! - r.labour_minor! - r.property_minor! - r.marketing_minor! - r.fees_minor! - r.tax_minor!);
    }
    for (const c of db.all<{ id: string; treasury_account_id: string }>('SELECT id, treasury_account_id FROM companies')) {
      expect(one<{ c: number }>(db, 'SELECT cash_end_minor c FROM company_tick_stats WHERE tick = 30 AND company_id = ?', c.id).c).toBe(balance(db, c.treasury_account_id));
    }
  });
  it('operating expenses reduce pre-tax profit one-for-one', () => {
    const a = memWorld(), b = memWorld();
    b.run("UPDATE companies SET property_minor = property_minor + 50000 WHERE id = 'co-mad-slices'"); b.run("UPDATE leases SET base_rent_minor = base_rent_minor + 50000 WHERE company_id = 'co-mad-slices' AND status = 'active'");
    advance(a, 1); advance(b, 1);
    const q = (db: typeof a) => one<{ rev: number; pre: number; prop: number }>(db, "SELECT revenue_minor rev, net_profit_minor + tax_minor pre, property_minor prop FROM company_tick_stats WHERE tick = 1 AND company_id = 'co-mad-slices'");
    const pa = q(a), pb = q(b);
    expect(pa.rev).toBe(pb.rev);                      // same customers, same sales
    expect(pb.prop - pa.prop).toBe(50_000);
    expect(pa.pre - pb.pre).toBe(50_000);             // exactly the extra rent comes off profit
  });
  it('profit responds to price: undercutting wins share, overpricing loses it', () => {
    const share = (price: number) => { const db = memWorld(); db.run("UPDATE demand_rules SET per_thousand_minor = 1400 WHERE id = 'dem-pizza'"); db.run("UPDATE companies SET price_minor = ? WHERE id = 'co-mad-slices'", price); advance(db, 2); return one<{ u: number }>(db, "SELECT units_sold u FROM company_tick_stats WHERE tick = 2 AND company_id = 'co-mad-slices'").u; };
    const cheap = share(700), normal = share(1_000), dear = share(1_500);
    expect(cheap).toBeGreaterThan(normal); expect(normal).toBeGreaterThan(dear);
  });
});

describe('insolvency boundaries', () => {
  const brokeWorld = (cashMinor: number) => {
    const db = memWorld({ npcPayoutBps: 0 });
    db.run("UPDATE companies SET owner_cover = 0 WHERE id = 'co-harbour-bean'");   // wallet cover off: these tests are about a company left short
    const acct = companyAccount('co-harbour-bean');
    // Move all but `cashMinor` out of the café (to the player's wallet) so the starting point is exact and the ledger still balances.
    transfer(db, { tick: 0, gameDate: 'x', actor: 't' }, 'drain', acct, 'acct:player:demo', balance(db, acct) - cashMinor, 'owner_withdrawal', 'test');
    db.run("UPDATE companies SET employees = 2, max_employees = 3 WHERE id = 'co-harbour-bean'");
    db.run("DELETE FROM demand_rules WHERE commodity_id = 'cafe-drink'");   // no sales: pure cost pressure
    db.run("UPDATE production_lines SET planned_batches = 0 WHERE company_id = 'co-harbour-bean'");
    return db;
  };
  it('a company that cannot pay is declared insolvent after exactly N consecutive shortfall ticks, never overdrawn', () => {
    const db = brokeWorld(1_000);
    advance(db, 1); expect(one<{ s: string; t: number }>(db, "SELECT status s, shortfall_ticks t FROM companies WHERE id='co-harbour-bean'")).toEqual({ s: 'operating', t: 1 });
    advance(db, 1); expect(one<{ s: string }>(db, "SELECT status s FROM companies WHERE id='co-harbour-bean'").s).toBe('operating');
    advance(db, 1); expect(one<{ s: string; u: number }>(db, "SELECT status s, unpaid_minor u FROM companies WHERE id='co-harbour-bean'").s).toBe('insolvent');
    expect(balance(db, companyAccount('co-harbour-bean'))).toBeGreaterThanOrEqual(0);
    expect(one<{ u: number }>(db, "SELECT unpaid_minor u FROM companies WHERE id='co-harbour-bean'").u).toBeGreaterThan(0);
    expect(one<{ k: string }>(db, "SELECT kind k FROM economic_events WHERE kind = 'insolvency'").k).toBe('insolvency');
    expect(reconcile(db).ok).toBe(true);
  });
  it('an insolvent company stops operating: no production, no wages, no sales', () => {
    const db = brokeWorld(1_000); advance(db, 3);
    const cash = balance(db, companyAccount('co-harbour-bean'));
    advance(db, 3);
    expect(balance(db, companyAccount('co-harbour-bean'))).toBe(cash);
    expect(one<{ u: number; s: number }>(db, "SELECT SUM(units_produced) u, SUM(units_sold) s FROM company_tick_stats WHERE company_id='co-harbour-bean' AND tick > 3")).toEqual({ u: 0, s: 0 });
  });
  it('boundary: a company with exactly enough cash for one day is not insolvent, and paying in full resets the counter', () => {
    const db = brokeWorld(0);
    const c = one<{ e: number; w: number; p: number; m: number }>(db, "SELECT employees e, wage_minor w, property_minor p, marketing_minor m FROM companies WHERE id='co-harbour-bean'");
    transfer(db, { tick: 0, gameDate: 'x', actor: 't' }, 'fund', 'acct:player:demo', companyAccount('co-harbour-bean'), c.e * c.w + c.p + c.m, 'capital_injection', 'exact');
    advance(db, 1);
    expect(one<{ t: number; u: number }>(db, "SELECT shortfall_ticks t, unpaid_minor u FROM companies WHERE id='co-harbour-bean'")).toEqual({ t: 0, u: 0 });
    expect(balance(db, companyAccount('co-harbour-bean'))).toBeLessThan(10);       // paid to the last coin (tax/levy may take pennies of nothing)
  });
});

describe('player account is untouched by ticks', () => {
  it('the player wallet only changes through player commands', () => {
    const db = memWorld(); const w = balance(db, 'acct:player:demo'); advance(db, 30);
    expect(balance(db, 'acct:player:demo')).toBe(w);
    expect(one<{ id: string }>(db, 'SELECT id FROM players').id).toBe(PLAYER_ID);
  });
});
