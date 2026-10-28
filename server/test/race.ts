/** Child process for concurrency.test.ts: opens the SAME database file and races one operation against its siblings. */
import { openNodeSqlite } from '../db/nodeSqlite';
import { runTickSafely } from '../engine/clock';
import { fundCompany } from '../engine/commands';
import { placeOrder } from '../engine/market';

const [mode, path, arg] = process.argv.slice(2) as [string, string, string];
const db = openNodeSqlite(path);
const ctx = { tick: 0, gameDate: 'x', actor: 'race' };
let out: unknown;
try {
  if (mode === 'tick') out = runTickSafely(db, Number(arg));
  else if (mode === 'fund') out = fundCompany(db, 'one-intent', 'co-mad-slices', 100_000);
  else if (mode === 'sell') { const r = placeOrder(db, ctx, 100, { company: 'co-severn-farm', commodity: 'wheat', side: 'sell', price: 60, qty: 150, key: `race:${arg}` }); out = { ok: true, id: r.order.id }; }
  else if (mode === 'buy') { const r = placeOrder(db, ctx, 100, { company: 'co-brunel-mill', commodity: 'wheat', side: 'buy', price: 60, qty: 100, key: `race:${arg}`, ioc: true }); out = { ok: true, filled: r.fills.reduce((a, f) => a + f.qty, 0) }; }
} catch (e) { out = { ok: false, error: (e as Error).message }; }
console.log(JSON.stringify(out));
db.close();
