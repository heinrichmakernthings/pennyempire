// Run against wrangler dev --local with a disposable database and ADMIN_TOKEN in .dev.vars.
// Never point this test at a deployed world: it creates test accounts and companies.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const base = process.env.QA_WORKER_URL ?? 'http://127.0.0.1:8798';
assert.equal(new URL(base).hostname, '127.0.0.1', 'This smoke test is local-only');
const token = /^ADMIN_TOKEN=(.+)$/m.exec(readFileSync('.dev.vars', 'utf8'))?.[1]?.trim();
assert.ok(token, 'Use a disposable local ADMIN_TOKEN in .dev.vars');
let checks = 0;
const check = (name, ok) => { assert.ok(ok, name); console.log(`PASS  ${name}`); checks++; };
const client = () => {
  let cookie = '';
  return async (path, body, extra = {}) => {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let data; try { data = await r.json(); } catch { data = {}; }
    return { status: r.status, data };
  };
};
const anon = client(), a = client(), b = client();
const suffix = Date.now().toString(36);
check('Worker health answers from the local Durable Object', (await anon('/api/health')).data.authority === 'server');
check('anonymous game access is refused', (await anon('/api/screens/city')).status === 401);
check('SPA deep link serves the built game', (await (await fetch(base + '/city')).text()).includes('id="root"'));
async function join(api, name) {
  const invited = await anon('/api/admin/invites', { role: 'player', note: 'local smoke' }, { 'x-admin-token': token });
  assert.equal(invited.status, 200);
  const registered = await api('/api/auth/register', { invite: invited.data.invite.code, username: name + suffix, displayName: name, password: name + suffix + '-test-password' });
  check(`${name} registers with a single-use invite`, registered.status === 200);
  check(`${name} has an authenticated session`, (await api('/api/auth/me')).data.authenticated === true);
}
await join(a, 'worker_a'); await join(b, 'worker_b');
const quote = await a('/api/startup-quote?industry=farm&plotId=lot-3&tier=1');
const created = await a('/api/command', { type: 'company.create', idempotencyKey: 'worker-create-' + suffix, expectedRevision: 0, industry: 'farm', plotId: 'lot-3', tier: 1, name: 'Worker QA Farm', expectedTotalMinor: quote.data.quote.totalMinor });
check('company creation settles in Durable Object SQLite', created.data.ok === true);
const id = created.data.data?.companyId;
assert.ok(id);
check('the second player cannot withdraw from the first company', (await b('/api/command', { type: 'company.withdraw', companyId: id, amountMinor: 100, idempotencyKey: 'worker-denied-' + suffix, expectedRevision: 0 })).data.error?.code === 'FORBIDDEN');
check('cross-origin writes are refused', (await a('/api/auth/profile', { displayName: 'Denied' }, { origin: 'https://untrusted.invalid' })).status === 403);
check('developer tick endpoint stays disabled', (await a('/api/dev/tick', { count: 1 })).status !== 200);
const health = await anon('/api/admin/health', undefined, { 'x-admin-token': token });
check('administrator health is available', health.status === 200);
const logout = await a('/api/auth/logout', {});
check('logout is accepted by the Worker', logout.status === 200);
check('the old account cannot access the game after logout', (await a('/api/screens/city')).status === 401);
console.log(`\n${checks}/${checks} local Worker checks passed`);
