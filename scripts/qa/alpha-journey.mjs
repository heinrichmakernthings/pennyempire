// Private-alpha journey in real browsers: two invited players (desktop + phone) and an administrator share one server-authoritative Bristol.
// Accounts are REQUIRED (PENNY_REQUIRE_AUTH=true), exactly as on Cloudflare. Usage: npm run build && node scripts/qa/alpha-journey.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let chromium;
for (const base of [import.meta.url, 'file:///usr/local/lib/node_modules_global/', `file://${process.env.NODE_PATH ?? ''}/`]) { try { ({ chromium } = createRequire(base)('playwright')); break; } catch { /* next */ } }
if (!chromium) { console.error('Playwright not found.'); process.exit(2); }

const PORT = 4181, API = 8795, BASE = `http://127.0.0.1:${PORT}`, OUT = process.env.QA_OUT ?? 'qa-output', TOKEN = 'alpha-journey-admin-token';
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'pe-alpha-'));
for (const url of [`${BASE}/`, `http://127.0.0.1:${API}/api/health`]) { if (await fetch(url).then(() => true, () => false)) { console.error(`Port in use (${url}).`); process.exit(2); } }
const engine = spawn(process.execPath, ['--import', 'tsx', '--no-warnings', 'server/node.ts'], { stdio: 'ignore', env: { ...process.env, PENNY_DB: join(tmp, 'a.db'), PENNY_TICK_MS: '3600000', PORT: String(API), PENNY_ADMIN_TOKEN: TOKEN, PENNY_REQUIRE_AUTH: 'true' } });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore', env: { ...process.env, PENNY_API_PORT: String(API) } });
const stop = () => { server.kill(); engine.kill(); try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } };
process.on('exit', stop);
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE)).ok && (await fetch(`${BASE}/api/health`)).ok) break; } catch { /* waiting */ } await new Promise((r) => setTimeout(r, 200)); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const invite = async (role = 'player') => (await (await fetch(`${BASE}/api/admin/invites`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN }, body: JSON.stringify({ role, note: 'qa' }) })).json()).invite.code;
let n = 0;
const as = (page) => ({
  get: async (p) => (await page.request.get(`${BASE}${p}`)).json(),
  post: async (p, body) => (await page.request.post(`${BASE}${p}`, { data: body })).json(),
  cmd: async (body) => (await page.request.post(`${BASE}/api/command`, { data: { idempotencyKey: `qa-${Date.now()}-${n++}`, expectedRevision: 0, ...body } })).json(),
});
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function joinGame(page, code, username, displayName) {
  await page.goto(`${BASE}/?invite=${code}`, { waitUntil: 'networkidle' });
  await page.getByLabel('Username').fill(username); await page.getByLabel('Display name').fill(displayName); await page.getByLabel('New password').fill(`${username}-alpha-password`);
  await page.getByRole('button', { name: 'Create account' }).click();
  try { await page.getByRole('navigation', { name: 'Main' }).waitFor({ timeout: 15_000 }); } catch (e) { await page.screenshot({ path: `${OUT}/alpha-join-failed-${username}.png` }); throw new Error(`join ${username} failed: ${await page.locator('[role=alert]').allTextContents()}`); }
}
async function order(api, companyId, commodityId, side, quantity, limitPriceMinor, extra = {}) {
  const q = await api.post('/api/quote', { kind: 'commodity', companyId, entityId: commodityId, side, quantity, limitPriceMinor, ...extra });
  return api.cmd({ type: 'commodity.order', companyId, commodityId, side, quantity, limitPriceMinor, quoteId: q.quote.id, ...extra });
}

const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'] } : {});
const problems = [];
const watch = (page, who) => { page.on('pageerror', (e) => problems.push(`${who} pageerror: ${e.message}`)); page.on('console', (m) => { if (m.type() === 'error' && !/401|403|Failed to load resource/.test(m.text())) problems.push(`${who}: ${m.text()}`); }); };
try {
  // 0. the game is closed to anyone without an account
  const anon = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); watch(anon, 'anon');
  await anon.route('**/api/health', route => route.fulfill({ status: 503, contentType: 'text/html', body: 'Unavailable' }));
  await anon.goto(`${BASE}/city`, { waitUntil: 'networkidle' });
  check('health outage shows recovery, never a substitute game', await anon.getByRole('heading', { name: 'Bristol is temporarily unavailable' }).isVisible() && await anon.getByRole('navigation', { name: 'Main' }).count() === 0);
  await anon.screenshot({ path: `${OUT}/combined-outage.png` });
  await anon.getByRole('link', { name: 'Explore an illustrative preview' }).click();
  check('offline preview is an explicit choice and clearly labelled', await anon.getByLabel('Preview mode').waitFor({ timeout: 10_000 }).then(() => true, () => false));
  await anon.unroute('**/api/health');
  await anon.route('**/api/auth/me', route => route.fulfill({ status: 503, contentType: 'text/html', body: 'Unavailable' }));
  await anon.goto(`${BASE}/city`, { waitUntil: 'networkidle' });
  check('session outage keeps the private game closed', await anon.getByRole('heading', { name: 'Bristol is temporarily unavailable' }).isVisible() && await anon.getByRole('navigation', { name: 'Main' }).count() === 0);
  await anon.unroute('**/api/auth/me');
  await anon.getByRole('button', { name: 'Try again' }).click();
  await anon.getByRole('button', { name: 'Sign in' }).waitFor();
  check('session retry recovers to sign-in', await anon.getByRole('button', { name: 'Sign in' }).isVisible());
  await anon.goto(`${BASE}/city`, { waitUntil: 'networkidle' });
  check('signed-out visitors see the sign-in screen, not the game', await anon.getByRole('button', { name: 'Sign in' }).isVisible() && !(await anon.getByRole('navigation', { name: 'Main' }).count()));
  check('the game API refuses anonymous requests', (await anon.request.get(`${BASE}/api/screens/city`)).status() === 401);
  await anon.screenshot({ path: `${OUT}/alpha-1-signin.png` });

  // 1. Player A joins on a desktop with an invite and is playing within seconds
  const t0 = Date.now();
  const A = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage(); watch(A, 'A');
  await joinGame(A, await invite(), 'alice', 'Alice');
  check('A lands in Bristol with one first-business guide', await A.getByRole('heading', { name: 'Your first business starts here.' }).waitFor({ timeout: 10_000 }).then(() => true, () => false) && await A.getByRole('complementary', { name: 'Getting started' }).count() === 0);
  await A.screenshot({ path: `${OUT}/alpha-2-onboarding.png` });
  const a = as(A);
  const fq = (await a.get('/api/startup-quote?industry=farm&plotId=lot-3&tier=1')).quote;
  const farm = (await a.cmd({ type: 'company.create', industry: 'farm', plotId: 'lot-3', tier: 1, name: 'Alice Acres', expectedTotalMinor: fq.totalMinor })).data.companyId;
  await A.goto(`${BASE}/city`, { waitUntil: 'networkidle' });
  await A.locator('.pe-onboard .pe-pill', { hasText: '1/5' }).waitFor({ timeout: 20_000 }).catch(() => {});
  const firstStepDone = await A.locator('.pe-onboard-list li.is-done').count();
  await A.screenshot({ path: `${OUT}/alpha-2b-first-company.png` });
  check('founding a company completes the first onboarding step in under 60 seconds', firstStepDone >= 1 && Date.now() - t0 < 60_000, `${Math.round((Date.now() - t0) / 1000)}s`);
  await a.post('/api/dev/tick', { count: 3 });

  // 2. Player B joins on a phone and buys A's wheat for a mill
  const B = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage(); watch(B, 'B');
  await joinGame(B, await invite(), 'bob', 'Bob');
  check('mobile: no horizontal scrolling on the city screen', await noHScroll(B));
  const b = as(B);
  const mq = (await b.get('/api/startup-quote?industry=mill&plotId=lot-4&tier=1')).quote;
  const mill = (await b.cmd({ type: 'company.create', industry: 'mill', plotId: 'lot-4', tier: 1, name: 'Bob Mills', expectedTotalMinor: mq.totalMinor })).data.companyId;
  const sell = await order(a, farm, 'wheat', 'sell', 40, 55);
  const buy = await order(b, mill, 'wheat', 'buy', 40, 55, { orderKind: 'direct', fromCompanyId: farm });
  check('B buys 40 wheat directly from A (player-to-player trade)', sell.ok && buy.data?.filled === 40, JSON.stringify(buy.data ?? buy.error));
  check('B cannot control A\'s farm', (await b.cmd({ type: 'company.withdraw', companyId: farm, amountMinor: 100 })).error?.code === 'FORBIDDEN');

  // 3. A sees a real notification about the sale
  await A.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' });
  check('A is notified that the farm sold wheat', (await A.getByText(/Alice Acres sold \d+ wheat/).count()) > 0);   // the direct sale is reported together with that day's automatic sales
  await A.screenshot({ path: `${OUT}/alpha-3-notifications.png`, fullPage: true });
  await B.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' });
  check('B is notified of the purchase', (await B.getByText(/Bob Mills bought 40 wheat/).count()) > 0);
  check('mobile: notifications fit the screen', await noHScroll(B));
  await B.screenshot({ path: `${OUT}/alpha-4-notifications-mobile.png`, fullPage: true });

  // 4. the administrator signs in and inspects players, both ledgers and the audit log
  const adminInvite = await invite('admin');
  const ADM = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage(); watch(ADM, 'admin');
  await joinGame(ADM, adminInvite, 'organiser', 'Organiser');
  await ADM.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  check('admin console shows reconciled Empire Coin and GBP_TEST ledgers', (await ADM.getByText('Reconciles').count()) === 2);
  await ADM.screenshot({ path: `${OUT}/alpha-5-admin-health.png`, fullPage: true });
  await ADM.getByRole('tab', { name: 'Players & invites' }).click();
  await ADM.getByText('@alice').first().waitFor({ timeout: 10_000 }).catch(() => {});
  { const html = await ADM.content(); check('admin sees all three players', ['@alice', '@bob', '@organiser'].every((u) => html.includes(u))); }
  check('admin views never show password material', !(await ADM.content()).match(/password_hash|password_salt|pbkdf2/i));
  await ADM.screenshot({ path: `${OUT}/alpha-6-admin-players.png`, fullPage: true });
  await A.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  check('a player opening /admin is refused', (await A.getByText('Administrator permission required.').count()) === 1 && (await A.request.get(`${BASE}/api/admin/health`)).status() === 403);

  // 5. A signs out from the account page and back in; everything is still there
  await A.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
  await A.getByRole('button', { name: 'Sign out', exact: true }).click();
  await A.getByRole('button', { name: 'Sign in' }).waitFor();
  check('after sign-out the session cookie no longer works', (await A.request.get(`${BASE}/api/screens/city`)).status() === 401);
  await A.getByLabel('Username').fill('alice'); await A.getByLabel('Password').fill('alice-alpha-password'); await A.getByRole('button', { name: 'Sign in' }).last().click();
  await A.getByRole('navigation', { name: 'Main' }).waitFor({ timeout: 15_000 });
  await A.goto(`${BASE}/companies`, { waitUntil: 'networkidle' });
  check('after signing back in A still owns Alice Acres', (await A.getByText('Alice Acres').count()) > 0);
  await B.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
  check('mobile: account page fits the screen', await noHScroll(B));
  await B.screenshot({ path: `${OUT}/alpha-7-account-mobile.png`, fullPage: true });
  const s = await (await fetch(`${BASE}/api/admin/health`, { headers: { 'x-admin-token': TOKEN } })).json();
  check('the shared world still reconciles after the journey', s.health.coinLedger.ok && s.health.gbpLedger.ok);
  check('no page errors in any browser', problems.length === 0, problems.slice(0, 5).join(' | '));
} finally { await browser.close(); }
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
