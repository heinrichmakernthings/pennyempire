// @vitest-environment node
import { advance, openWorld } from './world';
import { createCompany, startupQuote } from './company';
it('q', () => {
  const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'new'); advance(db, 10);
  const q = startupQuote(db, { industry: 'dairy', plotId: 'lot-3', tier: 1, name: 'Calib Co' });
  const id = (createCompany(db, 'k', { industry: 'dairy', plotId: 'lot-3', tier: 1, name: 'Calib Co', expectedTotalMinor: q.totalMinor }) as any).data.companyId;
  const o: string[] = [];
  for (let i = 0; i < 40; i++) { advance(db, 1); const s = db.get<any>('SELECT tick,revenue_minor r,cogs_minor cg,units_sold us,units_produced up,net_profit_minor np,cash_end_minor cash FROM company_tick_stats WHERE company_id=? ORDER BY tick DESC', id); const riv = db.get<any>("SELECT price_minor p,(SELECT ask_price_minor FROM production_lines WHERE company_id=c.id) a FROM companies c WHERE id='co-clifton-dairy'"); const inv = db.get<any>('SELECT qty FROM inventory WHERE company_id=? AND commodity_id=?', id, 'cheese'); const ask = db.get<any>('SELECT ask_price_minor a FROM production_lines WHERE company_id=?', id); const open = db.all<any>("SELECT price_minor p, qty_remaining q, company_id c FROM orders WHERE commodity_id='cheese' AND side='sell' AND status='open'"); o.push(JSON.stringify({ ...s, riv: riv.a, mine: ask.a, stock: inv?.qty, open: open.map((x: any) => x.c.slice(3, 8) + ':' + x.p + 'x' + x.q).join(',') })); }
  console.log(o.join('\n'));
}, 60000);
