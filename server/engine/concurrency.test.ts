// @vitest-environment node
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorld, lastTick } from './world';
import { balance, reconcile, supply } from './ledger';
import { EXCHANGE_ACCOUNT } from '../seed/bristol';
import { stock } from './inventory';

const race = (mode: string, path: string, args: string[]) => Promise.all(args.map((arg) => new Promise<unknown>((resolve) => {
  const p = spawn(process.execPath, ['--import', 'tsx', '--no-warnings', 'server/test/race.ts', mode, path, arg], { cwd: process.cwd() });
  let out = ''; p.stdout.on('data', (d) => (out += d)); p.on('close', () => resolve(JSON.parse(out.trim().split('\n').pop() ?? 'null')));
})));
const fresh = () => { const dir = mkdtempSync(join(tmpdir(), 'pe-race-')); const path = join(dir, 'w.db'); const db = openWorld(path); return { dir, path, db }; };

describe('concurrent actions from separate processes on one database file', () => {
  it('six workers racing to run the same tick apply it exactly once', async () => {
    const { dir, path, db } = fresh();
    try {
      const res = (await race('tick', path, Array(6).fill('1'))) as { status: string }[];
      expect(res.filter((r) => r.status === 'complete')).toHaveLength(1);
      expect(res.filter((r) => r.status === 'skipped')).toHaveLength(5);
      expect(lastTick(db)).toBe(1);
      expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM ledger_transactions WHERE tick = 1 AND kind = 'issuance'")!.n).toBe(1);   // one stipend, not six
      expect(reconcile(db).ok).toBe(true);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  it('six identical submissions of one player intent move coins exactly once', async () => {
    const { dir, path, db } = fresh();
    try {
      const before = db.get<{ b: number }>("SELECT balance_minor b FROM accounts WHERE id = 'acct:player:demo'")!.b; const s = supply(db);
      const res = (await race('fund', path, ['a', 'b', 'c', 'd', 'e', 'f'])) as { ok: boolean }[];
      expect(res.every((r) => r.ok)).toBe(true);
      expect(db.get<{ b: number }>("SELECT balance_minor b FROM accounts WHERE id = 'acct:player:demo'")!.b).toBe(before - 100_000);
      expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM ledger_transactions WHERE idempotency_key = 'cmd:one-intent'")!.n).toBe(1);
      expect(supply(db)).toEqual(s); expect(reconcile(db).ok).toBe(true);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  it('racing sell orders can never reserve more stock than exists', async () => {
    const { dir, path, db } = fresh();
    try {
      const res = (await race('sell', path, ['1', '2', '3', '4', '5', '6'])) as { ok: boolean }[];
      expect(res.filter((r) => r.ok)).toHaveLength(1);                               // 200 wheat in stock, 150 per order → only one fits
      expect(stock(db, 'co-severn-farm', 'wheat')).toMatchObject({ qty: 200, reserved: 150 });
      expect(reconcile(db).ok).toBe(true);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  it('racing buyers cannot take the same units twice (no duplicated inventory, no created coins)', async () => {
    const { dir, path, db } = fresh();
    try {
      const { placeOrder } = await import('./market');
      placeOrder(db, { tick: 0, gameDate: 'x', actor: 't' }, 100, { company: 'co-severn-farm', commodity: 'wheat', side: 'sell', price: 60, qty: 150 });
      const s0 = supply(db); const wheatBefore = db.get<{ s: number }>("SELECT SUM(qty) s FROM inventory WHERE commodity_id = 'wheat'")!.s;
      const res = (await race('buy', path, ['1', '2', '3', '4', '5', '6'])) as { filled: number }[];
      expect(res.reduce((a, r) => a + r.filled, 0)).toBe(150);                       // 6 × wants 100 of 150 → total exactly 150
      expect(db.get<{ s: number }>("SELECT SUM(qty) s FROM inventory WHERE commodity_id = 'wheat'")!.s).toBe(wheatBefore);   // units moved, none created
      expect(supply(db).circulating).toBe(s0.circulating);                                                                   // nothing left the economy: the fee moved to the Penny Exchange
      expect(balance(db, EXCHANGE_ACCOUNT)).toBe(Math.floor((150 * 60) / 100));
      expect(reconcile(db)).toMatchObject({ ok: true });
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
