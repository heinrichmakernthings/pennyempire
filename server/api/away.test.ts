// @vitest-environment node
import { advance, openWorld } from '../engine/world';
import { player } from '../test/http';

describe('while you were away (Prompt 12)', () => {
  it('summarises sales, profit and wallet cover since the last acknowledged day, per player', async () => {
    const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'new');
    const A = await player(db, 'alice'); const B = await player(db, 'bob');
    expect((await A.get('/api/away')).summary.days).toBe(0);                 // first visit: nothing to report yet
    const q = (await A.get('/api/startup-quote?industry=pizza&plotId=plot-pizza&tier=1')).quote;
    const id = (await A.cmd({ type: 'company.create', industry: 'pizza', plotId: 'plot-pizza', tier: 1, name: 'Away Slices', expectedTotalMinor: q.totalMinor })).body.data.companyId;
    advance(db, 6);
    const s = (await A.get('/api/away')).summary;
    expect(s.days).toBe(6); expect(s.show).toBe(true);
    expect(s.companies.map((c: { id: string }) => c.id)).toEqual([id]);
    const stats = db.get<{ r: number; u: number }>('SELECT SUM(revenue_minor) r, SUM(units_sold) u FROM company_tick_stats WHERE company_id = ? AND tick > ?', id, s.sinceTick)!;
    expect(s.totals.revenueMinor).toBe(stats.r); expect(s.totals.unitsSold).toBe(stats.u);
    expect((await B.get('/api/away')).summary.companies).toEqual([]);          // bob sees only his own businesses
    expect((await A.call('POST', '/api/away/seen', { upTo: s.nowTick })).status).toBe(200);
    expect((await A.get('/api/away')).summary.days).toBe(0);
    advance(db, 2);
    expect((await A.get('/api/away')).summary.days).toBe(2);
    expect((await A.call('POST', '/api/away/seen', { upTo: 10_000 })).status).toBe(200);  // cannot mark days that have not happened
    advance(db, 1);
    expect((await A.get('/api/away')).summary.days).toBe(1);
  });

  it('is shown only after a real absence, not every time a day ticks over mid-session', async () => {
    const db = openWorld(':memory:', { realMsPerTick: 600_000 }, 'new');   // the live pace: 10 minutes a day
    const A = await player(db, 'alice'); await A.get('/api/away');
    const q = (await A.get('/api/startup-quote?industry=farm&plotId=lot-3&tier=1')).quote;
    await A.cmd({ type: 'company.create', industry: 'farm', plotId: 'lot-3', tier: 1, name: 'Away Acres', expectedTotalMinor: q.totalMinor });
    advance(db, 2);
    expect((await A.get('/api/away')).summary).toMatchObject({ days: 2, show: false });   // 20 minutes
    advance(db, 1);
    expect((await A.get('/api/away')).summary).toMatchObject({ days: 3, show: true });    // 30 minutes
  });
});
