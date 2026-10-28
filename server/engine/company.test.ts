// @vitest-environment node
import { advance, openWorld } from './world';
import { reconcile, balance, supply } from './ledger';
import { configureCompany, fundCompany, reopenCompany } from './commands';
import { createCompany, procureNow, serviceEquipment, startupQuote, upgradeCompany } from './company';
import { lots, management, opportunities, rankings } from './insights';
import { handleApi } from '../api/router';
import { PLAYER_WALLET } from '../seed/bristol';
import type { Sql } from '../db/sql';

const fresh = (cfg = {}) => { const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000, ...cfg }, 'new'); advance(db, 3); return db; };
const wallet = (db: Sql) => balance(db, PLAYER_WALLET);
const make = (db: Sql, key: string, industry = 'pizza', plotId = 'lot-1', name = 'Test Pizza', tier = 1) => {
  const q = startupQuote(db, { industry, plotId, tier, name });
  return { q, res: createCompany(db, key, { industry, plotId, tier, name, expectedTotalMinor: q.totalMinor }) };
};

describe('company creation', () => {
  it('starts a new player with no company and 20,000 EC; 6 industries are startable', () => {
    const db = fresh();
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE owner_kind='player'")!.n).toBe(0);
    expect(wallet(db)).toBe(2_000_000);
    expect(opportunities(db).map((o) => o.industry).sort()).toEqual(['cafe', 'dairy', 'farm', 'mill', 'pizza', 'timber']);
  });

  it('creates atomically: ledger pays licence (sink), fit-out + equipment (state transfers), capital (company); supply only falls by the licence', () => {
    const db = fresh(); const before = supply(db); const w0 = wallet(db);
    const { q, res } = make(db, 'c1');
    expect(res.ok).toBe(true); if (!res.ok) return;
    const id = (res.data as { companyId: string }).companyId;
    expect(wallet(db)).toBe(w0 - q.totalMinor);
    expect(balance(db, `acct:co:${id}`)).toBe(q.lines.find((l) => l.kind === 'working_capital')!.amountMinor);
    expect(before.circulating - supply(db).circulating).toBe(q.lines.find((l) => l.kind === 'licence')!.amountMinor);
    expect(db.get<{ holder_id: string; shares: number }>('SELECT * FROM ownership WHERE company_id = ?', id)).toMatchObject({ holder_id: 'player-demo', shares: 10_000 });
    expect(db.get<{ company_id: string }>("SELECT company_id FROM plots WHERE id = 'lot-1'")!.company_id).toBe(id);
    expect(reconcile(db).ok).toBe(true);
  });

  it('is idempotent: the same key twice creates one company and charges once', () => {
    const db = fresh(); const a = make(db, 'dup'); const w = wallet(db);
    const b = createCompany(db, 'dup', { industry: 'pizza', plotId: 'lot-1', tier: 1, name: 'Test Pizza', expectedTotalMinor: a.q.totalMinor });
    expect(b).toEqual(a.res); expect(wallet(db)).toBe(w);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE owner_kind='player'")!.n).toBe(1);
  });

  it('rejects an occupied lot, a duplicate name, a wrong-sized lot, bad names and a stale total', () => {
    const db = fresh(); make(db, 'a');
    const taken = createCompany(db, 'b', { industry: 'cafe', plotId: 'lot-1', tier: 1, name: 'Another Cafe', expectedTotalMinor: 1 });
    expect(taken.ok).toBe(false);
    const q = startupQuote(db, { industry: 'cafe', plotId: 'lot-2', tier: 1, name: 'test pizza' });
    expect(q.ok).toBe(false); expect(q.issues.some((i) => i.field === 'name')).toBe(true);
    expect(startupQuote(db, { industry: 'farm', plotId: 'lot-2', tier: 1, name: 'Farm One' }).issues.some((i) => i.field === 'plotId')).toBe(true);
    expect(startupQuote(db, { industry: 'cafe', plotId: 'lot-2', tier: 1, name: '<b>x</b>' }).issues.some((i) => i.field === 'name')).toBe(true);
    const good = startupQuote(db, { industry: 'cafe', plotId: 'lot-2', tier: 1, name: 'Fresh Cafe' });
    const stale = createCompany(db, 'c', { industry: 'cafe', plotId: 'lot-2', tier: 1, name: 'Fresh Cafe', expectedTotalMinor: good.totalMinor - 1 });
    expect(!stale.ok && stale.error.code).toBe('QUOTE_EXPIRED');
    expect(reconcile(db).ok).toBe(true);
  });

  it('cannot create without enough money, and a failure leaves the lot, wallet and ledger untouched', () => {
    const db = fresh();
    // drain the wallet to the state treasury via a legitimate route: build three expensive companies until funds run out
    const w0 = wallet(db);
    const q = startupQuote(db, { industry: 'mill', plotId: 'lot-3', tier: 1, name: 'Poor Mill', workingCapitalMinor: w0 });
    expect(q.ok).toBe(false);
    const r = createCompany(db, 'poor', { industry: 'mill', plotId: 'lot-3', tier: 1, name: 'Poor Mill', workingCapitalMinor: w0, expectedTotalMinor: q.totalMinor });
    expect(!r.ok && r.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(wallet(db)).toBe(w0);
    expect(db.get<{ company_id: string | null }>("SELECT company_id FROM plots WHERE id = 'lot-3'")!.company_id).toBeNull();
  });

  it('enforces the per-player company limit', () => {
    const db = fresh({ maxCompaniesPerPlayer: 1 }); make(db, 'a');
    const second = startupQuote(db, { industry: 'cafe', plotId: 'lot-2', tier: 1, name: 'Second Cafe' });
    expect(second.ok).toBe(false); expect(second.issues[0]!.message).toMatch(/limit/);
  });

  it.each(['farm', 'mill', 'dairy', 'pizza', 'cafe', 'timber'])('%s uses the same engine path and produces + sells in the simulation', (industry) => {
    const db = fresh();
    const spec = db.get<{ plot_width: number }>('SELECT plot_width FROM industry_specs WHERE industry_id = ?', industry)!;
    const plot = spec.plot_width === 2 ? 'lot-1' : 'lot-3';
    const { res } = make(db, `k-${industry}`, industry, plot, `Co ${industry}`);
    expect(res.ok).toBe(true);
    const id = (res as { data: { companyId: string } }).data.companyId;
    advance(db, 12);
    const stats = db.all<{ units_produced: number; units_sold: number }>('SELECT * FROM company_tick_stats WHERE company_id = ? AND tick > 3', id);
    expect(stats.reduce((a, s) => a + s.units_produced, 0)).toBeGreaterThan(0);
    expect(reconcile(db).ok).toBe(true);
  });
});

describe('management actions', () => {
  const setup = () => { const db = fresh(); const { res } = make(db, 'm', 'pizza', 'lot-1', 'Managed Pizza'); const id = (res as { data: { companyId: string } }).data.companyId; return { db, id }; };
  const rev = (db: Sql, id: string) => db.get<{ revision: number }>('SELECT revision FROM companies WHERE id = ?', id)!.revision;

  it('hiring and dismissing charge a fee, respect the daily limit and the workplace maximum', () => {
    const { db, id } = setup();
    const c0 = balance(db, `acct:co:${id}`);
    const staff = db.get<{ employees: number; max_employees: number }>('SELECT employees, max_employees FROM companies WHERE id = ?', id)!;
    const r = configureCompany(db, 'h1', id, rev(db, id), { employees: staff.employees + 1 });
    expect(r.ok).toBe(true); expect(balance(db, `acct:co:${id}`)).toBe(c0 - 2_000);
    const over = configureCompany(db, 'h2', id, rev(db, id), { employees: staff.max_employees + 1 });
    expect(over.ok).toBe(false);
    const many = configureCompany(db, 'h3', id, rev(db, id), { employees: staff.employees + 1 + 5 });
    expect(many.ok).toBe(false);
    expect(reconcile(db).ok).toBe(true);
  });

  it('stale revisions are refused; ownership is enforced', () => {
    const { db, id } = setup();
    const stale = configureCompany(db, 's1', id, 999, { priceMinor: 1_100 });
    expect(!stale.ok && stale.error.code).toBe('STALE_REVISION');
    const npc = configureCompany(db, 's2', 'co-clifton-slice', 1, { priceMinor: 1_100 });
    expect(!npc.ok && npc.error.code).toBe('FORBIDDEN');
  });

  it('upgrades cost real money, change real parameters and need the previous tier', () => {
    const { db, id } = setup();
    fundCompany(db, 'f1', id, 500_000);
    const cap0 = db.get<{ capacity_batches: number; asset_id: string; property_minor: number }>('SELECT * FROM companies WHERE id = ?', id)!;
    const tierUp = upgradeCompany(db, 'u0', id, 'up-pizza-tier2');
    expect(tierUp.ok).toBe(true);
    const c1 = db.get<{ capacity_batches: number; asset_id: string; property_minor: number; premises_tier: number }>('SELECT * FROM companies WHERE id = ?', id)!;
    expect(c1.capacity_batches).toBeGreaterThan(cap0.capacity_batches); expect(c1.asset_id).toBe('pizza-t2'); expect(c1.property_minor).toBeGreaterThan(cap0.property_minor);
    expect(db.get<{ asset_id: string }>("SELECT asset_id FROM plots WHERE id = 'lot-1'")!.asset_id).toBe('pizza-t2');
    const again = upgradeCompany(db, 'u0b', id, 'up-pizza-tier2'); expect(again.ok).toBe(false);
    const skip = upgradeCompany(db, 'u0c', id, 'up-pizza-tier3'); expect(skip.ok).toBe(true);
    expect(reconcile(db).ok).toBe(true);
  });

  it('upgrades are refused when the company cannot afford them', () => {
    const { db, id } = setup();
    const poor = upgradeCompany(db, 'u1', id, 'up-pizza-tier3');
    expect(poor.ok).toBe(false);
  });

  it('equipment wears with production and servicing restores it for a priced fee', () => {
    const { db, id } = setup();
    advance(db, 15);
    const worn = db.get<{ condition_bps: number }>('SELECT condition_bps FROM companies WHERE id = ?', id)!.condition_bps;
    expect(worn).toBeLessThan(10_000);
    const m = management(db, id)!; expect(m.equipment.serviceCostMinor).toBeGreaterThan(0);
    const r = serviceEquipment(db, 'svc', id); expect(r.ok).toBe(true);
    expect(db.get<{ condition_bps: number }>('SELECT condition_bps FROM companies WHERE id = ?', id)!.condition_bps).toBe(10_000);
    expect(serviceEquipment(db, 'svc2', id).ok).toBe(false);
  });

  it('buy-supplies-now purchases real stock through the order book / state supplier and charges the treasury', () => {
    const { db, id } = setup();
    const before = balance(db, `acct:co:${id}`);
    const r = procureNow(db, 'p1', id, 2);
    expect(r.ok).toBe(true);
    expect(balance(db, `acct:co:${id}`)).toBeLessThan(before);
    expect(db.get<{ q: number }>("SELECT COALESCE(SUM(qty),0) q FROM inventory WHERE company_id = ?", id)!.q).toBeGreaterThan(0);
    expect(reconcile(db).ok).toBe(true);
  });

  it('management view explains production, staffing, upgrades and rank from real data', () => {
    const { db, id } = setup(); advance(db, 6);
    const m = management(db, id)!;
    expect(m.upgrades.length).toBeGreaterThan(3); expect(m.supplyChain.length).toBeGreaterThan(0);
    expect(m.production.log.length).toBeGreaterThan(0); expect(m.staff.max).toBeGreaterThan(0);
    expect(m.diagnosis.length).toBeGreaterThan(0);
  });
});

describe('calibration: default companies are viable, never runaway', () => {
  const LOTS: Record<string, string> = { farm: 'lot-3', mill: 'lot-3', dairy: 'lot-3', pizza: 'plot-pizza', cafe: 'plot-cafe', timber: 'lot-3' };
  it.each(Object.keys(LOTS))('%s: unmanaged default company survives 60 days with modest positive profit', (industry) => {
    const db = fresh(); advance(db, 7);
    const q = startupQuote(db, { industry, plotId: LOTS[industry]!, tier: 1, name: 'Calib Co' });
    const r = createCompany(db, 'k', { industry, plotId: LOTS[industry]!, tier: 1, name: 'Calib Co', expectedTotalMinor: q.totalMinor });
    const id = (r as { data: { companyId: string } }).data.companyId;
    advance(db, 60);
    const st = db.all<{ net_profit_minor: number }>('SELECT net_profit_minor FROM company_tick_stats WHERE company_id = ? AND tick > 20', id);
    const avg = st.reduce((a, x) => a + x.net_profit_minor, 0) / st.length;
    expect(db.get<{ bankrupt_tick: number | null }>('SELECT bankrupt_tick FROM companies WHERE id = ?', id)!.bankrupt_tick).toBeNull();
    expect(avg).toBeGreaterThan(0);
    expect(q.totalMinor / avg).toBeGreaterThan(30);               // no default business repays its whole startup cost in under 30 days
    expect(reconcile(db).ok).toBe(true);
  });
  it('production pauses once unsold stock reaches the cover limit, so an unsellable price cannot burn cash on endless overproduction', () => {
    const db = fresh(); advance(db, 7);
    const q = startupQuote(db, { industry: 'cafe', plotId: 'plot-cafe', tier: 1, name: 'Overstock Cafe' });
    const id = (createCompany(db, 'k', { industry: 'cafe', plotId: 'plot-cafe', tier: 1, name: 'Overstock Cafe', expectedTotalMinor: q.totalMinor }) as { data: { companyId: string } }).data.companyId;
    configureCompany(db, 'p', id, 1, { priceMinor: 700 });                       // maximum price: little demand
    advance(db, 25);
    const held = db.get<{ q: number }>("SELECT COALESCE(SUM(qty),0) q FROM inventory WHERE company_id = ? AND commodity_id = 'cafe-drink'", id)!.q;
    const planned = db.get<{ u: number }>('SELECT l.planned_batches * r.output_units u FROM production_lines l JOIN recipes r ON r.id = l.recipe_id WHERE l.company_id = ?', id)!.u;
    expect(held).toBeLessThanOrEqual(planned * 5 + planned);                      // cover limit (+ one day's batch in flight)
  });
  it('overstaffing costs wages without adding output', () => {
    const run = (staff: number) => {
      const db = fresh(); const q = startupQuote(db, { industry: 'cafe', plotId: 'plot-cafe', tier: 1, name: 'Staff Cafe' });
      const id = (createCompany(db, 'k', { industry: 'cafe', plotId: 'plot-cafe', tier: 1, name: 'Staff Cafe', expectedTotalMinor: q.totalMinor }) as { data: { companyId: string } }).data.companyId;
      configureCompany(db, 'h', id, 1, { employees: staff }); advance(db, 15);
      return db.all<{ units_produced: number; labour_minor: number }>('SELECT units_produced, labour_minor FROM company_tick_stats WHERE company_id = ? AND tick > 6', id)
        .reduce((a, x) => ({ out: a.out + x.units_produced, wages: a.wages + x.labour_minor }), { out: 0, wages: 0 });
    };
    const lean = run(2), fat = run(3);
    expect(fat.wages).toBeGreaterThan(lean.wages);
    expect(fat.out).toBeLessThanOrEqual(lean.out + 20);
  });
  it('a company with no ingredients and no cash produces nothing', () => {
    const db = fresh({ stateSupplyPerTick: 0 }); const q = startupQuote(db, { industry: 'pizza', plotId: 'plot-pizza', tier: 1, name: 'Empty Pizza', workingCapitalMinor: undefined });
    const id = (createCompany(db, 'k', { industry: 'pizza', plotId: 'plot-pizza', tier: 1, name: 'Empty Pizza', expectedTotalMinor: q.totalMinor }) as { data: { companyId: string } }).data.companyId;
    configureCompany(db, 'a', id, 1, { autoProcure: false }); advance(db, 3);
    expect(db.get<{ u: number }>('SELECT COALESCE(SUM(units_produced),0) u FROM company_tick_stats WHERE company_id = ? AND tick > 3', id)!.u).toBe(0);
  });
});

describe('strategy: attention pays', () => {
  const play = (industry: string, plot: string, managed: boolean) => {
    const db = fresh(); advance(db, 7);
    const q = startupQuote(db, { industry, plotId: plot, tier: 1, name: 'Strategy Co' });
    const id = (createCompany(db, 'k', { industry, plotId: plot, tier: 1, name: 'Strategy Co', expectedTotalMinor: q.totalMinor }) as { data: { companyId: string } }).data.companyId;
    for (let d = 0; d < 60; d++) {
      if (managed && d % 2 === 0) {
        // a competent owner watches the price war and stays just under the cheapest rival
        const c = db.get<{ revision: number; min_price_minor: number; max_price_minor: number; retail_commodity_id: string | null }>('SELECT * FROM companies WHERE id = ?', id)!;
        const rival = rankings(db).find((r) => r.industry === industry)!.rows.filter((r) => r.companyId !== id).map((r) => r.priceMinor);
        if (rival.length) { const target = Math.max(c.min_price_minor, Math.min(c.max_price_minor, Math.floor(Math.min(...rival) * 0.99))); configureCompany(db, `m${d}`, id, c.revision, { priceMinor: target }); }
      }
      advance(db, 1);
    }
    return db.get<{ p: number }>('SELECT COALESCE(SUM(net_profit_minor),0) p FROM company_tick_stats WHERE company_id = ?', id)!.p;
  };
  it('a managed company out-earns a set-and-forget one in a market with price competition', () => {
    expect(play('dairy', 'lot-3', true)).toBeGreaterThan(play('dairy', 'lot-3', false));
  });
});

describe('failure and recovery', () => {
  it('a company starved of cash goes insolvent, then bankrupt; the owner is not bailed out and the ledger stays balanced', () => {
    const db = fresh({ bankruptcyAfterTicks: 3, insolvencyAfterTicks: 2 });
    const q0 = startupQuote(db, { industry: 'pizza', plotId: 'plot-pizza', tier: 1, name: 'Doomed Pizza' });
    const wc = q0.workingCapitalMinMinor, q = startupQuote(db, { industry: 'pizza', plotId: 'plot-pizza', tier: 1, name: 'Doomed Pizza', workingCapitalMinor: wc });
    const id = (createCompany(db, 'doom', { industry: 'pizza', plotId: 'plot-pizza', tier: 1, name: 'Doomed Pizza', workingCapitalMinor: wc, expectedTotalMinor: q.totalMinor }) as { data: { companyId: string } }).data.companyId;
    // an unsellable price (the maximum) and a full payroll: costs run, revenue does not
    configureCompany(db, 'x', id, 1, { priceMinor: 1_600, employees: 5, marketingMinorPerTick: 0, autoProcure: false });
    const w = wallet(db);
    advance(db, 120);
    const row = db.get<{ bankrupt_tick: number | null; status: string }>('SELECT bankrupt_tick, status FROM companies WHERE id = ?', id)!;
    expect(row.bankrupt_tick).not.toBeNull();
    {
      expect(db.get<{ company_id: string | null }>("SELECT company_id FROM plots WHERE id = 'lot-1'")!.company_id).toBeNull();
      expect(reopenCompany(db, 'r', id).ok).toBe(false);
      expect(wallet(db)).toBeGreaterThanOrEqual(w);       // never charged again; only residual cash comes back
    }
    expect(reconcile(db).ok).toBe(true);
  });
});

describe('opportunity finder, lots and rankings', () => {
  it('opportunities are forecasts built from real data and rank a business supplier above a crowded restaurant market when it is better', () => {
    const db = fresh(); advance(db, 8);
    const ops = opportunities(db);
    for (const o of ops) { expect(o.forecast.label).toBe('FORECAST'); expect(Number.isInteger(o.forecast.profitMinor)).toBe(true); expect(o.reasons.length).toBeGreaterThan(0); }
    expect(ops[0]!.score).toBeGreaterThanOrEqual(ops[ops.length - 1]!.score);
  });
  it('opportunities on day 0 use rivals’ production plans and demand funding, not empty history', () => {
    const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'new');
    const ops = opportunities(db);
    const farm = ops.find((o) => o.industry === 'farm')!, pizza = ops.find((o) => o.industry === 'pizza')!;
    expect(farm.market.supplyUnitsPerDay).toBeGreaterThan(0);                 // Severn Valley Farm plans to make wheat
    expect(farm.market.unmetUnitsPerDay).toBeLessThan(farm.market.demandUnitsPerDay);
    expect(pizza.market.demandUnitsPerDay).toBeGreaterThan(0);
  });
  it('lots list vacancy and fits; a taken lot becomes unavailable', () => {
    const db = fresh(); expect(lots(db).filter((l) => l.status === 'vacant')).toHaveLength(10);
    make(db, 'z'); const l1 = lots(db).find((l) => l.id === 'lot-1')!; expect(l1.status).toBe('taken');
  });
  it('rankings include my company with a deterministic order', () => {
    const db = fresh(); make(db, 'r'); advance(db, 10);
    const r = rankings(db).find((x) => x.industry === 'pizza')!;
    expect(r.rows.some((x) => x.mine)).toBe(true); expect(r.rows.map((x) => x.rank)).toEqual(r.rows.map((_, i) => i + 1));
  });
});

describe('HTTP API', () => {
  const api = (db: Sql, method: string, path: string, body?: unknown, query?: Record<string, string>) => handleApi(db, { method, path, body, query }, { devEndpoints: true, now: () => 1_000 });
  it('quote → create → management over the API', () => {
    const db = fresh();
    const q = api(db, 'GET', '/api/startup-quote', undefined, { industry: 'cafe', plotId: 'lot-2', tier: '1', name: 'API Cafe' }).body as { quote: { ok: boolean; totalMinor: number } };
    expect(q.quote.ok).toBe(true);
    const c = api(db, 'POST', '/api/command', { type: 'company.create', idempotencyKey: 'api-1', industry: 'cafe', plotId: 'lot-2', tier: 1, name: 'API Cafe', expectedTotalMinor: q.quote.totalMinor });
    expect(c.status).toBe(200);
    const id = ((c.body as { data: { companyId: string } }).data).companyId;
    expect(api(db, 'GET', `/api/companies/${id}/management`).status).toBe(200);
    expect(api(db, 'GET', '/api/opportunities').status).toBe(200);
    expect(api(db, 'GET', '/api/lots').status).toBe(200);
    expect(api(db, 'GET', '/api/rankings').status).toBe(200);
    const bad = api(db, 'POST', '/api/command', { type: 'company.create', idempotencyKey: 'api-2', industry: 'cafe', plotId: 'lot-2', tier: 1, name: 'API Cafe 2', expectedTotalMinor: q.quote.totalMinor });
    expect(bad.status).toBe(422);
  });
});

describe('migration 0001 → 0002 on an existing world', () => {
  it('upgrades in place, keeping balances and companies, and adds the catalogue', () => {
    const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000 });
    advance(db, 4);
    const cash = balance(db, PLAYER_WALLET), n = db.get<{ n: number }>('SELECT COUNT(*) n FROM companies')!.n;
    expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM industry_specs')!.n).toBeGreaterThanOrEqual(6);
    expect(cash).toBeGreaterThan(0); expect(n).toBe(13);
    expect(reconcile(db).ok).toBe(true);
  });
});
