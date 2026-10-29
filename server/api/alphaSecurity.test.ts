// @vitest-environment node
import { advance, openWorld } from '../engine/world';
import { reconcile } from '../engine/ledger';
import { reconcileGbp } from '../engine/gbpLedger';
import { createInvite } from '../engine/accounts';
import { client, order, player } from '../test/http';

const fresh = () => openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'new');
async function farmWithWheat(db: ReturnType<typeof fresh>) {
  const A = await player(db, 'alice'); const q = (await A.get('/api/startup-quote?industry=farm&plotId=lot-3&tier=1')).quote;
  const farm = (await A.cmd({ type: 'company.create', industry: 'farm', plotId: 'lot-3', tier: 1, name: 'Alice Acres', expectedTotalMinor: q.totalMinor })).body.data.companyId as string;
  advance(db, 3); return { A, farm };
}
async function mill(db: ReturnType<typeof fresh>, name: string, plot: string) {
  const P = await player(db, name); const q = (await P.get(`/api/startup-quote?industry=mill&plotId=${plot}&tier=1`)).quote;
  const co = (await P.cmd({ type: 'company.create', industry: 'mill', plotId: plot, tier: 1, name: `${name} mill`, expectedTotalMinor: q.totalMinor })).body.data.companyId as string; return { P, co };
}

describe('private-alpha security and concurrency', () => {
  it('two players buying the same 40 units at the same moment: exactly 40 change hands, nothing is duplicated', async () => {
    const db = fresh(); const { A, farm } = await farmWithWheat(db);
    const b = await mill(db, 'bob', 'lot-4'), c = await mill(db, 'carol', 'lot-7');
    expect((await order(A, farm, 'wheat', 'sell', 40, 60)).status).toBe(200);
    // everything the farm has listed, at any price: both buyers try to take ALL of it in the same instant
    const listed = db.get<{ q: number; p: number }>("SELECT SUM(qty_remaining) q, MAX(price_minor) p FROM orders WHERE company_id = ? AND commodity_id = 'wheat' AND side = 'sell' AND status = 'open'", farm)!;
    const stock0 = db.get<{ q: number }>("SELECT SUM(qty) q FROM inventory WHERE commodity_id = 'wheat'")!.q;
    const [rb, rc] = await Promise.all([order(b.P, b.co, 'wheat', 'buy', listed.q, listed.p, { orderKind: 'direct', fromCompanyId: farm }), order(c.P, c.co, 'wheat', 'buy', listed.q, listed.p, { orderKind: 'direct', fromCompanyId: farm })]);
    const filled = [rb, rc].map((r) => r.body.data?.filled ?? 0);
    expect(filled.reduce((a, x) => a + x, 0)).toBe(listed.q);                                  // the units were sold once, not twice
    expect(filled[1]).toBe(0);                                                                   // the second buyer found nothing left
    expect(db.get<{ n: number }>('SELECT COALESCE(SUM(qty),0) n FROM trades WHERE seller_company_id = ? AND buyer_company_id IN (?,?)', farm, b.co, c.co)!.n).toBe(listed.q);
    expect(db.get<{ q: number }>("SELECT COALESCE(SUM(qty_remaining),0) q FROM orders WHERE company_id = ? AND commodity_id = 'wheat' AND side = 'sell' AND status = 'open'", farm)!.q).toBe(0);
    expect(db.get<{ q: number }>("SELECT SUM(qty) q FROM inventory WHERE commodity_id = 'wheat'")!.q).toBe(stock0);   // moved, not created
    expect(reconcile(db).ok).toBe(true);
  });

  it('replayed and double-submitted commands execute once per player', async () => {
    const db = fresh(); const A = await player(db, 'alice');
    const wallet = () => db.get<{ b: number }>('SELECT a.balance_minor b FROM accounts a JOIN players p ON p.wallet_account_id = a.id WHERE p.id = ?', A.playerId)!.b;
    const w0 = wallet();
    const [r1, r2] = await Promise.all([A.cmd({ type: 'prestige.buy', itemId: 'veh-executive' }, 'buy-once'), A.cmd({ type: 'prestige.buy', itemId: 'veh-executive' }, 'buy-once')]);
    expect(r2.body).toEqual(r1.body);
    expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM prestige_owned WHERE owner_id = ?', A.playerId)!.n).toBe(1);
    const replay = await A.cmd({ type: 'prestige.buy', itemId: 'veh-executive' }, 'buy-once'); expect(replay.body).toEqual(r1.body);
    expect(w0 - wallet()).toBeGreaterThan(0); expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM prestige_owned')!.n).toBe(1);
  });

  it('rejects invalid, negative, fractional and oversized input without changing any balance', async () => {
    const db = fresh(); const { A, farm } = await farmWithWheat(db);
    const before = JSON.stringify(db.all('SELECT id, balance_minor FROM accounts ORDER BY id'));
    for (const body of [
      { type: 'company.withdraw', companyId: farm, amountMinor: -500 }, { type: 'company.withdraw', companyId: farm, amountMinor: 1e18 }, { type: 'company.fund', companyId: farm, amountMinor: 0.5 },
      { type: 'company.fund', companyId: farm, amountMinor: 'lots' }, { type: 'wallet.testWithdraw', amountMinor: -500 }, { type: 'wallet.testWithdraw', amountMinor: 1e12 },
      { type: 'loan.take', companyId: farm, amountMinor: Number.MAX_SAFE_INTEGER, termDays: 30 }, { type: 'prestige.buy', itemId: "x' OR 1=1 --" }, { type: 'share.order', companyId: farm, side: 'buy', quantity: -5, limitPriceMinor: 1 },
    ]) { const r = await A.cmd(body); expect(r.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400); }
    expect((await order(A, farm, 'wheat', 'sell', -10, 50)).status).toBeGreaterThanOrEqual(400);
    expect((await order(A, farm, 'wheat', 'sell', 10, -50)).status).toBeGreaterThanOrEqual(400);
    expect((await order(A, farm, 'wheat', 'sell', 1_000_000, 50)).status).toBeGreaterThanOrEqual(400);   // more than it owns
    expect(JSON.stringify(db.all('SELECT id, balance_minor FROM accounts ORDER BY id'))).toBe(before);
    expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM accounts WHERE balance_minor < 0 AND kind NOT IN (\'issuance\')')!.n).toBe(0);
  });

  it('privilege escalation: role cannot be chosen at registration or changed via profile; player ids cannot be spoofed', async () => {
    const db = fresh(); const invite = createInvite(db, Date.now(), 'test', 'player').code;
    const c = client(db, 'mallory');
    const r = await c.call('POST', '/api/auth/register', { invite, username: 'mallory', password: 'mallory-long-pw', role: 'admin', playerId: 'player-demo' });
    expect(r.body.user.role).toBe('player'); expect(r.body.user.playerId).not.toBe('player-demo');
    expect((await c.call('POST', '/api/auth/profile', { role: 'admin', settings: { role: 'admin' } })).body.user.role).toBe('player');
    expect((await c.call('GET', '/api/admin/health')).status).toBe(403);
    // spoofed identity headers and body fields are ignored: the session alone decides who acts
    const demoWallet = db.get<{ b: number }>("SELECT balance_minor b FROM accounts WHERE id = 'acct:player:demo'")!.b;
    await c.call('POST', '/api/command', { idempotencyKey: 'spoof', type: 'prestige.buy', itemId: 'veh-executive', ownerId: 'player-demo', playerId: 'player-demo' }, { 'x-player-id': 'player-demo' });
    expect(db.get<{ b: number }>("SELECT balance_minor b FROM accounts WHERE id = 'acct:player:demo'")!.b).toBe(demoWallet);
    expect(db.get<{ o: string }>('SELECT owner_id o FROM prestige_owned')!.o).toBe(r.body.user.playerId);
  });

  it('forged, truncated and expired session tokens are rejected', async () => {
    const db = fresh(); const A = await player(db, 'alice');
    for (const tok of ['', 'x', A.cookie.slice(0, 63), A.cookie.slice(0, 63) + (A.cookie.endsWith('0') ? '1' : '0'), 'a'.repeat(64)]) { const c = client(db, 'f'); c.cookie = tok; expect((await c.call('GET', '/api/wallet')).status).toBe(401); }
    const later = client(db, 'late', { now: () => Date.now() + 31 * 24 * 3_600_000 }); later.cookie = A.cookie;
    expect((await later.call('GET', '/api/wallet')).status).toBe(401);
  });

  it('no unrestricted balance modification exists, even for an administrator', async () => {
    const db = fresh(); const admin = await player(db, 'root', 'admin');
    for (const p of ['/api/admin/balance', '/api/admin/users/x/balance', '/api/admin/wallet', '/api/admin/mint', '/api/admin/param']) {
      const r = await admin.call('POST', p, { amount: 1_000_000, accountId: 'acct:player:demo', key: 'walletBalance', value: 1 });
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
    expect(reconcile(db).ok).toBe(true); expect(reconcileGbp(db).ok).toBe(true);
  });
});
