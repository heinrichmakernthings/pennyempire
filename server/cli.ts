import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './db/migrate';
import { openNodeSqlite } from './db/nodeSqlite';
import { reconcile } from './engine/ledger';
import { advance, openWorld } from './engine/world';
import { seedBristol } from './seed/bristol';
import { formatReport, runSimulation } from './sim';
import { formatMarketReport, runMarketSim } from './marketSim';
import { formatScenario, runScenario, type ScenarioId } from './scenarios';
import { formatStress, runFinanceStress } from './financeStress';
import { formatAlphaStress, runAlphaStress } from './alphaStress';
import { runFuzz } from './audit/fuzz';
import { POPULATIONS, SCENARIOS, runScenario as runAuditScenario } from './audit/scenarios';
import { formatScenarios } from './audit/report';
import { formatEcoScenario, runEcoScenario, type EcoScenarioId } from './ecoScenarios';
import { formatStockScenario, runStockScenario, type StockScenarioId } from './stockScenarios';

const [cmd = 'help', arg] = process.argv.slice(2);
const dbPath = process.env.PENNY_DB ?? 'data/pennyempire.db';
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

switch (cmd) {
  case 'migrate': { const db = openNodeSqlite(dbPath); console.log('applied:', migrate(db)); break; }
  case 'seed': { const db = openNodeSqlite(dbPath); migrate(db); console.log(seedBristol(db, {}, process.env.PENNY_PROFILE === 'demo' ? 'demo' : 'new')); break; }
  case 'reset': for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(f)) rmSync(f); console.log('removed', dbPath); break;
  case 'tick': { const db = openWorld(dbPath, {}, process.env.PENNY_PROFILE === 'demo' ? 'demo' : 'new'); const r = advance(db, Number(arg ?? 1)); console.log(`ran ${r.length} tick(s)`); break; }
  case 'reconcile': { const db = openWorld(dbPath, {}, process.env.PENNY_PROFILE === 'demo' ? 'demo' : 'new'); console.log(reconcile(db)); break; }
  case 'sim': { const days = Number(arg ?? 360); const report = runSimulation(days); console.log(formatReport(report)); process.exit(report.anomalies.length ? 1 : 0); break; }
  case 'sim-market': { const r = runMarketSim(Number(arg ?? 120)); console.log(formatMarketReport(r)); process.exit(r.anomalies.length || !r.reconciliation ? 1 : 0); break; }
  case 'scenarios': { const ids = (arg && arg !== 'all' ? [arg] : ['A', 'B', 'C', 'D', 'D-energy', 'E', 'F']) as ScenarioId[]; const days = Number(process.argv[4] ?? 120); let bad = 0; for (const id of ids) { const r = runScenario(id, days); const md = formatScenario(r); console.log(md); if (process.env.SCENARIO_OUT) { mkdirSync(process.env.SCENARIO_OUT, { recursive: true }); writeFileSync(`${process.env.SCENARIO_OUT}/scenario-${id}.md`, md); } if (r.anomalies.length || !r.reconciles) bad++; } process.exit(bad ? 1 : 0); break; }
  case 'stock-scenarios': { const ids = (arg && arg !== 'all' ? [arg] : ['A', 'B', 'C', 'D', 'E', 'F']) as StockScenarioId[]; const days = Number(process.argv[4] ?? 90); let bad = 0; for (const id of ids) { const r = runStockScenario(id, days); const md = formatStockScenario(r); console.log(md); if (process.env.SCENARIO_OUT) { mkdirSync(process.env.SCENARIO_OUT, { recursive: true }); writeFileSync(`${process.env.SCENARIO_OUT}/stock-${id}.md`, md); } if (r.anomalies.length || !r.ledgerReconciles || !r.sharesConsistent) bad++; } process.exit(bad ? 1 : 0); break; }
  case 'eco-scenarios': { const ids = (arg && arg !== 'all' ? [arg] : ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'P']) as EcoScenarioId[]; const days = Number(process.argv[4] ?? 150); let bad = 0; for (const id of ids) { const r = runEcoScenario(id, id === 'A' ? Math.max(days, 360) : days); const md = formatEcoScenario(r); console.log(md); if (process.env.SCENARIO_OUT) { mkdirSync(process.env.SCENARIO_OUT, { recursive: true }); writeFileSync(`${process.env.SCENARIO_OUT}/eco-${id}.md`, md); } if (r.anomalies.length || !r.ledgerReconciles || !r.sharesConsistent) bad++; } process.exit(bad ? 1 : 0); break; }
  case 'audit-scenarios': {   // tsx server/cli.ts audit-scenarios [ids…] [--days N]  → docs/audit/*.json + SCENARIOS.md
    const args = process.argv.slice(3); const dIdx = args.indexOf('--days'); const days = dIdx >= 0 ? Number(args[dIdx + 1]) : undefined; const ids = args.filter((a, i) => !a.startsWith('--') && (dIdx < 0 || i !== dIdx + 1));
    const specs = [...SCENARIOS, ...POPULATIONS].filter((s) => !ids.length || ids.includes(s.id) || (s.id === 'POP' && ids.includes(`POP${s.players}`))).map((s) => (days ? { ...s, days: Math.min(s.days, days) } : s));
    const out = process.env.SCENARIO_OUT ?? 'docs/audit'; mkdirSync(out, { recursive: true }); const reports = [];
    for (const s of specs) { const t0 = Date.now(); const r = runAuditScenario(s); reports.push(r); writeFileSync(`${out}/${s.id === 'POP' ? `POP-${s.players}` : s.id}.json`, JSON.stringify(r, null, 1)); console.error(`[audit] ${s.id} ${s.name}: ${Math.round((Date.now() - t0) / 1000)}s, audit ${r.audit.ok ? 'clean' : r.audit.findings.join(' | ')}`); }
    writeFileSync(`${out}/SCENARIOS.md`, formatScenarios(reports)); process.exit(reports.every((r) => r.audit.ok) ? 0 : 1); break;
  }
  case 'fuzz': {   // tsx server/cli.ts fuzz <seed> <players> <ticks> <actionsPerTick>
    const [seed = '1', pl = '10', ticks = '120', apt = '40'] = process.argv.slice(3);
    const rep = runFuzz({ seed: Number(seed), players: Number(pl), ticks: Number(ticks), actionsPerTick: Number(apt), auditEvery: 15 });
    console.log(JSON.stringify(rep, null, 1)); process.exit(rep.findings.some((f) => f.severity !== 'P2') || rep.violations.length ? 1 : 0); break;
  }
  case 'alpha-stress': { void runAlphaStress().then((rs) => { const md = formatAlphaStress(rs); console.log(md); if (process.env.SCENARIO_OUT) { mkdirSync(process.env.SCENARIO_OUT, { recursive: true }); writeFileSync(`${process.env.SCENARIO_OUT}/alpha-stress.md`, md); } process.exit(rs.every((r) => r.ok) ? 0 : 1); }); break; }
  case 'finance-stress': { const rs = runFinanceStress(); const md = formatStress(rs); console.log(md); if (process.env.SCENARIO_OUT) { mkdirSync(process.env.SCENARIO_OUT, { recursive: true }); writeFileSync(`${process.env.SCENARIO_OUT}/finance-stress.md`, md); } process.exit(rs.some((r) => !r.gbpReconciles || !r.coinsReconcile) ? 1 : 0); break; }
  default: console.log('usage: tsx server/cli.ts <migrate|seed|reset|tick N|reconcile|sim DAYS|sim-market DAYS|stock-scenarios [A..F|all] [DAYS]|eco-scenarios [A..H|P|all] [DAYS]|scenarios [A|B|C|D|D-energy|E|F|all] [DAYS]>   (PENNY_DB=path)');
}
