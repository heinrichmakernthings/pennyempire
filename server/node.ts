/** Local development server: the real economic engine on a SQLite file, serving the JSON API the browser uses. `npm run server` */
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { handleApi } from './api/router';
import { advanceToNow } from './engine/clock';
import { openWorld } from './engine/world';

const dbPath = process.env.PENNY_DB ?? 'data/pennyempire.db';
const port = Number(process.env.PORT ?? 8787);
const devEndpoints = process.env.ENABLE_DEV_ENDPOINTS !== 'false';
const tickMs = process.env.PENNY_TICK_MS ? Number(process.env.PENNY_TICK_MS) : undefined;
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
const db = openWorld(dbPath, tickMs ? { realMsPerTick: tickMs } : {});

const first = advanceToNow(db, Date.now());
console.log(`[engine] db=${dbPath} tick=${first.lastTick} (replayed ${first.ran}, skipped ${first.skipped})`);
setInterval(() => { try { advanceToNow(db, Date.now()); } catch (e) { console.error('[engine] tick error', e); } }, 1_000).unref();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    let body: unknown; const raw = Buffer.concat(chunks).toString();
    if (raw) { try { body = JSON.parse(raw); } catch { res.writeHead(400, { 'content-type': 'application/json' }).end('{"ok":false,"error":{"code":"VALIDATION","message":"Invalid JSON"}}'); return; } }
    const out = handleApi(db, { method: req.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), body }, { devEndpoints });
    res.writeHead(out.status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(out.body));
  });
});
server.listen(port, '127.0.0.1', () => console.log(`[api] http://127.0.0.1:${port}/api/health  (dev endpoints ${devEndpoints ? 'ON' : 'off'})`));
