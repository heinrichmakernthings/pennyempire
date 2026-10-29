// State-economy journey in a real browser: a player pizza restaurant uses the state services, an energy crisis and a rate rise hit, the Penny Post reports them, and the ledger reconciles.
// Usage: npm run build && node scripts/qa/state-journey.mjs (spawns its own engine on a fresh temp DB and `vite preview`)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let chromium;
for (const base of [import.meta.url, 'file:///usr/local/lib/node_modules_global/', `file://${process.env.NODE_PATH ?? ''}/`]) { try { ({ chromium } = createRequire(base)('playwright')); break; } catch { /* next */ } }
if (!chromium) { console.error('Playwright not found.'); process.exit(2); }

const PORT = 4179, API = 8793, BASE = `http://127.0.0.1:${PORT}`, OUT = process.env.QA_OUT ?? 'qa-output', TOKEN = 'journey-admin-token-123';
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'pe-state-'));
for (const url of [`${BASE}/`, `http://127.0.0.1:${API}/api/health`]) { if (await fetch(url).then(() => true, () => false)) { console.error(`Port in use (${url}).`); process.exit(2); } }
const engine = spawn(process.execPath, ['--import', 'tsx', '--no-warnings', 'server/node.ts'], { stdio: 'ignore', env: { ...process.env, PENNY_DB: join(tmp, 's.db'), PENNY_TICK_MS: '3600000', PORT: String(API), PENNY_ADMIN_TOKEN: TOKEN } });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore', env: { ...process.env, PENNY_API_PORT: String(API) } });
const stop = () => { server.kill(); engine.kill(); try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } };
process.on('exit', stop);
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE)).ok && (await fetch(`${BASE}/api/health`)).ok) break; } catch { /* waiting */ } await new Promise((r) => setTimeout(r, 200)); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const api = (p, init) => fetch(`${BASE}${p}`, init).then((r) => r.json());
let n = 0;
const cmd = async (body) => api('/api/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: `qa-${Date.now()}-${n++}`, expectedRevision: 0, ...body }) });
const admin = (path, body) => api(`/api/admin/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN }, body: JSON.stringify(body) });
const tick = (count) => api('/api/dev/tick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ count }) });

const browser = await chromium.launch();
try {
  const free = (await api('/api/lots')).lots.find((l) => l.status === 'vacant' && l.fits.includes('pizza'));
  const q = (await api(`/api/startup-quote?industry=pizza&plotId=${free.id}&tier=1&name=Quay%20Pizza`)).quote;
  const made = await cmd({ type: 'company.create', industry: 'pizza', plotId: free.id, tier: 1, name: 'Quay Pizza', expectedTotalMinor: q.totalMinor });
  if (!made.ok) throw new Error(made.error?.message);
  await tick(25);
  const ov = await api('/api/state/overview'); const co = ov.myCompanies[0].id;
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1100 } })).newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  await page.goto(`${BASE}/state`, { waitUntil: 'networkidle' });
  check('six state companies are shown with real treasuries', (await page.locator('[data-testid^="provider-"]').count()) === 6);
  await page.screenshot({ path: `${OUT}/state-1-overview.png`, fullPage: true });

  await page.getByRole('tab', { name: 'Advertising' }).click(); await page.getByTestId('ads-tab').waitFor();
  await page.getByRole('button', { name: 'Start campaign' }).click(); await page.waitForTimeout(800);
  const camps = (await api(`/api/state/company/${co}`)).services.advertising.campaigns;
  check('a campaign bought in the browser exists on the server', camps.length === 1 && camps[0].status === 'active');
  await page.screenshot({ path: `${OUT}/state-2-advertising.png`, fullPage: true });
  await tick(3);

  await page.getByRole('tab', { name: 'Premises' }).click(); await page.getByTestId('premises-tab').waitFor();
  check('premises show a real daily cost from Central Property', (await page.getByTestId('premises-tab').textContent()).includes('Daily cost'));
  await page.screenshot({ path: `${OUT}/state-3-premises.png`, fullPage: true });

  await page.getByRole('tab', { name: 'Bank' }).click(); await page.getByTestId('bank-tab').waitFor();
  const prof = (await api(`/api/state/company/${co}`)).services.credit.profile;
  check('the bank reads the company’s real record and states its grade and reasons', ['A', 'B', 'C', 'D'].includes(prof.grade) && prof.reasons.length > 0, `grade ${prof.grade}: ${prof.reasons[0]}`);
  await page.screenshot({ path: `${OUT}/state-4-bank.png`, fullPage: true });

  // crisis: energy shortage (admin-controlled, logged), then a base-rate rise
  const denied = await fetch(`${BASE}/api/admin/event`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'energy_shortage', severity: 3, reason: 'journey' }) });
  check('administration without a token is refused', denied.status === 403);
  const ev = await admin('event', { type: 'energy_shortage', severity: 3, days: 12, reason: 'journey test: energy crisis' });
  check('an administrator can start an event (logged)', ev.ok === true, ev.message ?? ev.error?.message);
  const rate = await admin('base-rate', { rateBps: 800, reason: 'journey test: respond to inflation' });
  check('an administrator can set the base rate (logged)', rate.ok === true);
  await tick(3);
  await page.goto(`${BASE}/state`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Economy' }).click(); await page.getByTestId('economy-tab').waitFor();
  check('the base rate shown is the server’s 8.00%', (await page.getByTestId('base-rate').textContent()).includes('8.00%'));
  check('the active energy event is listed with its effects', (await page.getByTestId('economy-tab').textContent()).toLowerCase().includes('energy crisis'));
  await page.screenshot({ path: `${OUT}/state-5-economy.png`, fullPage: true });
  await page.getByRole('tab', { name: 'Energy' }).click(); await page.getByTestId('energy-tab').waitFor();
  const en = (await api('/api/state/overview')).energy;
  check('grid capacity is reduced by the event', en.capacityUnits < en.baseCapacityUnits, `${en.capacityUnits} of ${en.baseCapacityUnits}`);
  await page.screenshot({ path: `${OUT}/state-6-energy.png`, fullPage: true });

  await page.goto(`${BASE}/bristol`, { waitUntil: 'networkidle' });
  const post = await page.getByTestId('penny-post').textContent();
  check('the Penny Post reports the energy crisis and the rate decision', /energy/i.test(post) && /base rate/i.test(post));
  await page.screenshot({ path: `${OUT}/state-7-penny-post.png`, fullPage: true });

  await page.goto(`${BASE}/dev/economy`, { waitUntil: 'networkidle' });
  await page.getByTestId('dev-state-economy').waitFor({ timeout: 8000 });
  const dash = (await api('/api/dev/state')).dashboard;
  check('the developer dashboard shows genuine figures and the ledger reconciles', dash.ledger.reconciles === true && dash.currency.circulatingMinor > 0);
  await page.screenshot({ path: `${OUT}/state-8-dev-dashboard.png`, fullPage: true });
  const log = (await api('/api/admin/state', { headers: { 'x-admin-token': TOKEN } })).log;
  check('every administrative action and refusal is in the admin log', log.length >= 3 && log.some((l) => !l.ok));
  check('no console errors', problems.length === 0, problems.slice(0, 3).join(' | '));
} catch (e) { check('journey completed', false, e instanceof Error ? e.message : String(e)); }
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
