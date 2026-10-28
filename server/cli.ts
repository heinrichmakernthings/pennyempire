import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './db/migrate';
import { openNodeSqlite } from './db/nodeSqlite';
import { reconcile } from './engine/ledger';
import { advance, openWorld } from './engine/world';
import { seedBristol } from './seed/bristol';
import { formatReport, runSimulation } from './sim';

const [cmd = 'help', arg] = process.argv.slice(2);
const dbPath = process.env.PENNY_DB ?? 'data/pennyempire.db';
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

switch (cmd) {
  case 'migrate': { const db = openNodeSqlite(dbPath); console.log('applied:', migrate(db)); break; }
  case 'seed': { const db = openNodeSqlite(dbPath); migrate(db); console.log(seedBristol(db)); break; }
  case 'reset': for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(f)) rmSync(f); console.log('removed', dbPath); break;
  case 'tick': { const db = openWorld(dbPath); const r = advance(db, Number(arg ?? 1)); console.log(`ran ${r.length} tick(s)`); break; }
  case 'reconcile': { const db = openWorld(dbPath); console.log(reconcile(db)); break; }
  case 'sim': { const days = Number(arg ?? 360); const report = runSimulation(days); console.log(formatReport(report)); process.exit(report.anomalies.length ? 1 : 0); break; }
  default: console.log('usage: tsx server/cli.ts <migrate|seed|reset|tick N|reconcile|sim DAYS>   (PENNY_DB=path)');
}
