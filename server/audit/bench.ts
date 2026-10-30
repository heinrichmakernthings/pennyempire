/**
 * Prompt 11 performance benchmarks: where tick time goes, how many SQL statements a day costs, matching/settlement/ledger throughput,
 * catch-up after downtime, and memory. Numbers are for this machine and the node:sqlite adapter; the Durable Object runs the same SQL.
 */
import type { Sql } from '../db/sql';
import { advance, lastTick, openWorld } from '../engine/world';
import { runTick } from '../engine/tick';
import { advanceToNow } from '../engine/clock';
import { createAccount, issue, transfer } from '../engine/ledger';
import { placeOrder } from '../engine/market';
import { addStock } from '../engine/inventory';
import { loadConfig } from '../engine/config';
import { createInvite, registerUser } from '../engine/accounts';
import { runFuzz } from './fuzz';

export interface BenchReport { machine: string; tick: { days: number; avgMs: number; p95Ms: number; maxMs: number; byPhaseMs: Record<string, number>; sqlPerTick: number }; throughput: { ledgerTransfersPerSec: number; orderMatchesPerSec: number; ordersPlacedPerSec: number }; catchUp: { ticks: number; ms: number }; scaling: { players: number; tickAvgMs: number; msPerCommand: number }[]; memoryMb: { heapUsed: number; rss: number } }

function counting(db: Sql) {
  let n = 0;
  const wrap = <K extends 'run' | 'all' | 'get'>(k: K) => { const f = db[k].bind(db) as (...a: unknown[]) => unknown; (db as unknown as Record<string, unknown>)[k] = (...a: unknown[]) => { n++; return f(...a); }; };
  wrap('run'); wrap('all'); wrap('get');
  return { reset: () => { n = 0; }, get: () => n };
}

export function runBench(): BenchReport {
  const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'new');
  advance(db, 30);
  // 1. tick cost by phase (365 days of a living city)
  const phases: Record<string, number> = {}; const tickMs: number[] = []; const q = counting(db); let sql = 0;
  for (let d = 0; d < 365; d++) {
    let mark = performance.now(), cur = 'start'; q.reset();
    const t0 = performance.now();
    runTick(db, lastTick(db) + 1, { phase: (p) => { const now = performance.now(); phases[cur] = (phases[cur] ?? 0) + now - mark; mark = now; cur = p; } });
    phases[cur] = (phases[cur] ?? 0) + performance.now() - mark;
    tickMs.push(performance.now() - t0); sql += q.get();
  }
  const sorted = [...tickMs].sort((a, b) => a - b);
  const byPhaseMs = Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, Math.round((v / 365) * 10) / 10]).sort((a, b) => (b[1] as number) - (a[1] as number)));
  // 2. ledger write throughput
  const ctx = { tick: lastTick(db), gameDate: 'bench', actor: 'bench' };
  createAccount(db, 'acct:bench:a', 'households', 'bench a'); createAccount(db, 'acct:bench:b', 'households', 'bench b'); issue(db, ctx, 'bench:seed', 'acct:bench:a', 1_000_000_000, 'test grant');
  let t0 = performance.now(); const N = 5_000;
  for (let i = 0; i < N; i++) transfer(db, ctx, `bench:t:${i}`, 'acct:bench:a', 'acct:bench:b', 1, 'transfer', 'bench');
  const ledgerTransfersPerSec = Math.round((N * 1_000) / (performance.now() - t0));
  // 3. order placement and matching throughput (two NPC companies crossing each other)
  const [s, b] = ['co-severn-farm', 'co-clifton-dairy'];
  addStock(db, ctx, s, 'wheat', 100_000, 100_000 * 50, 'seed', 'bench');
  issue(db, ctx, 'bench:buyer', db.get<{ a: string }>('SELECT treasury_account_id a FROM companies WHERE id = ?', b)!.a, 500_000_000, 'test grant');
  const fee = loadConfig(db).exchangeFeeBps; let fills = 0; const M = 2_000;
  t0 = performance.now();
  for (let i = 0; i < M; i++) { placeOrder(db, ctx, fee, { company: s, commodity: 'wheat', side: 'sell', price: 50, qty: 5, key: `bench:s:${i}` }); fills += placeOrder(db, ctx, fee, { company: b, commodity: 'wheat', side: 'buy', price: 50, qty: 5, key: `bench:b:${i}` }).fills.length; }
  const el = performance.now() - t0;
  // 4. catch-up after an outage: the clock jumps 48 days ahead
  const db2 = openWorld(':memory:', { realMsPerTick: 1_000 }, 'new'); advanceToNow(db2, 1_000_000); const before = performance.now(); const r = advanceToNow(db2, 1_000_000 + 48 * 1_000); const catchUp = { ticks: r.ran, ms: Math.round(performance.now() - before) };
  // 5. scaling with player count (fuzzed commands through the API, 20 days each)
  const scaling = [1, 10, 100].map((players) => { const f = runFuzz({ seed: 7, players, ticks: 20, actionsPerTick: Math.min(200, players * 4), auditEvery: 20 }); return { players, tickAvgMs: f.msPerTick, msPerCommand: f.msPerCommand }; });
  void createInvite; void registerUser;
  const m = process.memoryUsage();
  return { machine: `${process.platform} ${process.arch}, node ${process.version}`, tick: { days: 365, avgMs: Math.round(tickMs.reduce((a, x) => a + x, 0) / 365), p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)]!), maxMs: Math.round(sorted.at(-1)!), byPhaseMs, sqlPerTick: Math.round(sql / 365) }, throughput: { ledgerTransfersPerSec, orderMatchesPerSec: Math.round((fills * 1_000) / el), ordersPlacedPerSec: Math.round((M * 2 * 1_000) / el) }, catchUp, scaling, memoryMb: { heapUsed: Math.round(m.heapUsed / 1e6), rss: Math.round(m.rss / 1e6) } };
}
