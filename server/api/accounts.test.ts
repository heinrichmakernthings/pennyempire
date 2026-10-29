// @vitest-environment node
import { openWorld } from '../engine/world';
import { reconcile, balance } from '../engine/ledger';
import { createInvite } from '../engine/accounts';
import { ADMIN_TOKEN, client, player } from '../test/http';

const fresh = () => openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'new');

describe('private-alpha accounts', () => {
  it('registration is invite-only, single-use, and creates a real player with recorded starting capital and a separate SIMULATED GBP wallet', async () => {
    const db = fresh(); const anon = client(db, 'anon');
    expect((await anon.call('POST', '/api/auth/register', { invite: 'inv-made-up', username: 'mallory', password: 'long-enough-pass' })).status).toBe(403);
    const invite = createInvite(db, Date.now(), 'test', 'player').code;
    const r = await anon.call('POST', '/api/auth/register', { invite, username: 'alice', password: 'alice-long-password', displayName: 'Alice' });
    expect(r.status).toBe(200); expect(r.body.user).toMatchObject({ username: 'alice', displayName: 'Alice', role: 'player' });
    expect(r.headers?.['set-cookie']).toMatch(/HttpOnly; SameSite=Lax/);
    const again = client(db, 'eve'); expect((await again.call('POST', '/api/auth/register', { invite, username: 'eve', password: 'eve-long-password' })).status).toBe(403);
    const p = db.get<{ wallet_account_id: string }>('SELECT wallet_account_id FROM players WHERE id = ?', r.body.user.playerId)!;
    expect(balance(db, p.wallet_account_id)).toBe(2_000_000);
    expect(db.get<{ memo: string }>("SELECT memo FROM ledger_transactions WHERE idempotency_key = ?", `register:${r.body.user.playerId}`)!.memo).toBe('new player starting capital');
    expect(db.get('SELECT 1 FROM gbp_accounts WHERE owner_id = ?', r.body.user.playerId)).toBeTruthy();
    expect(reconcile(db).ok).toBe(true);
  });

  it('never stores or returns secrets: passwords are PBKDF2 hashes, tokens and codes are digests, and no API response contains them', async () => {
    const db = fresh(); const a = await player(db, 'alice'); const admin = await player(db, 'root', 'admin');
    const row = db.get<{ password_hash: string; password_iters: number }>("SELECT password_hash, password_iters FROM users WHERE username = 'alice'")!;
    expect(row.password_hash).toMatch(/^[0-9a-f]{64}$/); expect(row.password_hash).not.toContain('alice-long-password'); expect(row.password_iters).toBe(100_000);
    expect(db.get('SELECT 1 FROM sessions WHERE token_hash = ?', a.cookie)).toBeFalsy();
    const users = JSON.stringify(await admin.get('/api/admin/users'));
    for (const secret of ['password', 'salt', 'hash', a.cookie]) expect(users).not.toContain(secret);
    expect(JSON.stringify(await a.get('/api/auth/me'))).not.toMatch(/hash|salt|password/);
  });

  it('login, logout and sessions: wrong passwords fail, logout revokes the cookie server-side, unknown users cost the same work', async () => {
    const db = fresh(); await player(db, 'alice');
    const c = client(db, 'alice2');
    expect((await c.call('POST', '/api/auth/login', { username: 'alice', password: 'wrong-password!!' })).status).toBe(401);
    expect((await c.call('POST', '/api/auth/login', { username: 'nobody', password: 'whatever-password' })).status).toBe(401);
    expect((await c.call('POST', '/api/auth/login', { username: 'ALICE', password: 'alice-long-password' })).status).toBe(200);
    expect((await c.get('/api/auth/me')).user.username).toBe('alice');
    const stolen = c.cookie;
    await c.call('POST', '/api/auth/logout'); expect(c.cookie).toBe('');
    const replay = client(db, 'thief'); replay.cookie = stolen;
    expect((await replay.get('/api/auth/me')).authenticated).toBe(false);
    expect((await replay.call('GET', '/api/screens/portfolio')).status).toBe(401);
  });

  it('rate limits password guessing per username and per address', async () => {
    const db = fresh(); await player(db, 'alice'); const c = client(db, 'x');
    for (let i = 0; i < 5; i++) expect((await c.call('POST', '/api/auth/login', { username: 'alice', password: `guess-${i}-xxxxx` })).status).toBe(401);
    expect((await c.call('POST', '/api/auth/login', { username: 'alice', password: 'alice-long-password' })).status).toBe(429);   // locked even with the right password
    const later = client(db, 'y', { now: () => Date.now() + 16 * 60_000 });
    expect((await later.call('POST', '/api/auth/login', { username: 'alice', password: 'alice-long-password' })).status).toBe(200);
  });

  it('requires a session for every game route in private-alpha mode, but health stays public', async () => {
    const db = fresh(); const anon = client(db, 'anon');
    expect((await anon.call('GET', '/api/health')).status).toBe(200);
    for (const p of ['/api/screens/city', '/api/wallet', '/api/exchange/commodities', '/api/prestige']) expect((await anon.call('GET', p)).status).toBe(401);
    expect((await anon.cmd({ type: 'company.fund', companyId: 'x', amountMinor: 1 })).status).toBe(401);
  });

  it('a player can only act as themselves: no access to another player\'s company, orders, contracts or command results', async () => {
    const db = fresh(); const a = await player(db, 'alice'); const b = await player(db, 'bob');
    const q = (await a.get('/api/startup-quote?industry=farm&plotId=lot-3&tier=1')).quote;
    const made = await a.cmd({ type: 'company.create', industry: 'farm', plotId: 'lot-3', tier: 1, name: 'Alice Farm', expectedTotalMinor: q.totalMinor }, 'same-key');
    expect(made.status).toBe(200); const farm = made.body.data.companyId;
    for (const body of [{ type: 'company.configure', companyId: farm, expectedRevision: 1, priceMinor: 60 }, { type: 'company.withdraw', companyId: farm, amountMinor: 100 }, { type: 'company.fund', companyId: farm, amountMinor: 100 }, { type: 'loan.take', companyId: farm, amountMinor: 10_000, termDays: 30 }, { type: 'commodity.order', companyId: farm, commodityId: 'wheat', side: 'sell', quantity: 1, limitPriceMinor: 50 }, { type: 'share.list', companyId: farm, newShares: 100, offerPriceMinor: 100 }, { type: 'dividend.declare', companyId: farm, perShareMinor: 1 }])
      { const r = (await b.cmd(body)).body; expect(r.ok).toBe(false); expect(r.error.code === 'FORBIDDEN' || /You control this company/.test(r.error.message)).toBe(true); }   // listing reports control as an unmet criterion
    // Bob re-using Alice's idempotency key gets his own fresh command, never Alice's stored result
    const bq = (await b.get('/api/startup-quote?industry=farm&plotId=lot-4&tier=1')).quote;
    const bobs = await b.cmd({ type: 'company.create', industry: 'farm', plotId: 'lot-4', tier: 1, name: 'Bob Farm', expectedTotalMinor: bq.totalMinor }, 'same-key');
    expect(bobs.status).toBe(200); expect(bobs.body.data.companyId).not.toBe(farm);
    const own = (await b.get('/api/screens/companies')).envelope.data;
    expect(JSON.stringify(own)).not.toContain('Alice Farm');
    for (const path of [`/api/companies/${farm}/management`, `/api/companies/${farm}/financials`, `/api/state/company/${farm}`, `/api/state/loan-quote?companyId=${farm}&amountMinor=1000&termDays=30`]) expect((await b.call('GET', path)).status).toBe(403);
    expect((await a.call('GET', `/api/companies/${farm}/management`)).status).toBe(200);
    expect(reconcile(db).ok).toBe(true);
  });

  it('refuses cross-site writes (CSRF) even with a valid cookie', async () => {
    const db = fresh(); const a = await player(db, 'alice');
    expect((await a.call('POST', '/api/auth/profile', { displayName: 'Hacked' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await a.call('POST', '/api/auth/profile', { displayName: 'Alice Two' }, { origin: 'https://alpha.test' })).status).toBe(200);
  });

  it('profiles and settings: display name is sanitised, settings are whitelisted', async () => {
    const db = fresh(); const a = await player(db, 'alice');
    const r = await a.call('POST', '/api/auth/profile', { displayName: '  <b>Al</b>  ', settings: { reducedMotion: true, isAdmin: true } });
    expect(r.body.user.displayName).toBe('bAl/b'); expect(r.body.user.settings).toEqual({ reducedMotion: true }); expect(r.body.user.role).toBe('player');
  });

  it('roles: players cannot reach admin routes; admins can, via session or the operator token, and every action is logged', async () => {
    const db = fresh(); const a = await player(db, 'alice'); const admin = await player(db, 'root', 'admin');
    expect((await a.call('GET', '/api/admin/users')).status).toBe(403);
    expect((await a.call('GET', '/api/admin/state')).status).toBe(403);
    expect((await a.call('POST', '/api/admin/invites', { role: 'admin' })).status).toBe(403);
    expect((await admin.call('GET', '/api/admin/state')).status).toBe(200);
    const inv = await admin.call('POST', '/api/admin/invites', { role: 'player', note: 'friend' }); expect(inv.body.invite.code).toMatch(/^inv-/);
    const op = client(db, 'ops'); expect((await op.call('GET', '/api/admin/users', undefined, { 'x-admin-token': ADMIN_TOKEN })).status).toBe(200);
    expect((await op.call('GET', '/api/admin/users', undefined, { 'x-admin-token': 'wrong-token-value' })).status).toBe(403);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM admin_log WHERE actor = 'admin:root' AND action = 'invite.create'")!.n).toBe(1);
    expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM admin_log WHERE ok = 0')!.n).toBeGreaterThanOrEqual(3);
  });

  it('password recovery: an admin-issued code works once, signs out old sessions, and expires', async () => {
    const db = fresh(); const a = await player(db, 'alice'); const admin = await player(db, 'root', 'admin');
    const uid = db.get<{ id: string }>("SELECT id FROM users WHERE username = 'alice'")!.id;
    const code = (await admin.call('POST', `/api/admin/users/${uid}/reset-code`)).body.reset.code;
    const anon = client(db, 'anon');
    expect((await anon.call('POST', '/api/auth/reset', { username: 'alice', code: 'rst-wrong', newPassword: 'new-alice-password' })).status).toBe(403);
    expect((await anon.call('POST', '/api/auth/reset', { username: 'alice', code, newPassword: 'new-alice-password' })).status).toBe(200);
    expect((await anon.call('POST', '/api/auth/reset', { username: 'alice', code, newPassword: 'another-password' })).status).toBe(403);
    expect((await a.get('/api/auth/me')).authenticated).toBe(false);
    expect((await anon.call('POST', '/api/auth/login', { username: 'alice', password: 'new-alice-password' })).status).toBe(200);
  });

  it('changing a password needs the current one and signs out other devices', async () => {
    const db = fresh(); const a = await player(db, 'alice'); const other = client(db, 'phone');
    await other.call('POST', '/api/auth/login', { username: 'alice', password: 'alice-long-password' });
    expect((await a.call('POST', '/api/auth/password', { currentPassword: 'nope-nope-nope', newPassword: 'next-alice-password' })).status).toBe(403);
    expect((await a.call('POST', '/api/auth/password', { currentPassword: 'alice-long-password', newPassword: 'next-alice-password' })).status).toBe(200);
    expect((await a.get('/api/auth/me')).authenticated).toBe(true);
    expect((await other.get('/api/auth/me')).authenticated).toBe(false);
  });

  it('disabled accounts lose access immediately', async () => {
    const db = fresh(); const a = await player(db, 'alice'); const admin = await player(db, 'root', 'admin');
    const uid = db.get<{ id: string }>("SELECT id FROM users WHERE username = 'alice'")!.id;
    expect((await admin.call('POST', `/api/admin/users/${uid}/disable`, { disabled: true })).status).toBe(200);
    expect((await a.call('GET', '/api/wallet')).status).toBe(401);
    expect((await client(db, 'x').call('POST', '/api/auth/login', { username: 'alice', password: 'alice-long-password' })).status).toBe(401);
  });

  it('bursts of commands are rate limited per player', async () => {
    const db = fresh(); const a = await player(db, 'alice'); const b = await player(db, 'bob');
    const codes: number[] = []; for (let i = 0; i < 45; i++) codes.push((await a.cmd({ type: 'order.cancel', orderId: 999999 })).status);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    expect((await b.cmd({ type: 'order.cancel', orderId: 999999 })).status).not.toBe(429);
  });
});
