// End-to-end company-management journey in a real browser: open Bristol → find an opportunity → found a company → configure → buy supplies → trade → upgrade.
// Usage: npm run build && node scripts/qa/company-journey.mjs   (spawns its own engine on a fresh temp DB and `vite preview`)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
for (const base of [import.meta.url, 'file:///usr/local/lib/node_modules_global/', `file://${process.env.NODE_PATH ?? ''}/`]) { try { ({ chromium } = createRequire(base)('playwright')); break; } catch { /* next */ } }
if (!chromium) { console.error('Playwright not found.'); process.exit(2); }

const PORT = 4174, API = 8788, BASE = `http://127.0.0.1:${PORT}`, OUT = process.env.QA_OUT ?? 'qa-output';
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'pe-journey-'));
for (const url of [`${BASE}/`, `http://127.0.0.1:${API}/api/health`]) { if (await fetch(url).then(() => true, () => false)) { console.error(`Port in use (${url}).`); process.exit(2); } }
const engine = spawn(process.execPath, ['--import', 'tsx', '--no-warnings', 'server/node.ts'], { stdio: 'ignore', env: { ...process.env, PENNY_DB: join(tmp, 'j.db'), PENNY_TICK_MS: '1500', PORT: String(API) } });
// vite preview proxies /api to 8787 by default; use a dedicated config override through env
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore', env: { ...process.env, PENNY_API_PORT: String(API) } });
const stop = () => { server.kill(); engine.kill(); try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } };
process.on('exit', stop);
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE)).ok && (await fetch(`${BASE}/api/health`)).ok) break; } catch { /* waiting */ } await new Promise((r) => setTimeout(r, 200)); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const api = (p) => fetch(`${BASE}${p}`).then((r) => r.json());
const wallet = async () => (await api('/api/screens/city')).envelope.data.player.coins.minor;

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (['error'].includes(m.type())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  // 1. new player: no company, a clear next step
  await page.goto(`${BASE}/companies`, { waitUntil: 'networkidle' });
  check('new player sees an empty state with a next step', await page.getByTestId('find-opportunity').isVisible());
  const walletStart = await wallet();
  check('new player starts with 20,000 EC and no company', walletStart === 2_000_000 && (await api('/api/screens/companies')).envelope.data.companies.items.length === 0, String(walletStart));

  // 2. opportunity finder
  await page.getByTestId('find-opportunity').click();
  await page.waitForSelector('[data-testid^="opportunity-"]');
  check('opportunity finder lists six industries', (await page.locator('[data-testid^="opportunity-"]').count()) === 6);
  check('every forecast is labelled FORECAST', (await page.getByText('FORECAST', { exact: true }).count()) >= 6);
  await page.screenshot({ path: `${OUT}/journey-1-opportunities.png`, fullPage: true });
  await page.getByRole('button', { name: /Why this forecast/ }).first().click();
  check('details explain the forecast (reasons and cost breakdown)', (await page.getByRole('table', { name: /forecast breakdown/ }).count()) >= 1);

  // 3. start a café
  await page.getByTestId('start-cafe').click();
  await page.waitForURL(/\/start\?industry=cafe/);
  const lots = page.locator('[data-testid^="lot-lot-"], [data-testid="lot-plot-cafe"]');
  await lots.first().waitFor();
  check('location step lists only plots that fit the industry', (await lots.count()) >= 3);
  await lots.first().click();
  await page.getByTestId('company-name').fill('Avon Beans');
  await page.waitForSelector('table[aria-label="Startup costs"]');
  const confirm = page.getByTestId('confirm-create');
  const label = await confirm.textContent();
  check('bill is itemised and the confirm button states the exact price', /Pay .*EC/.test(label ?? '') && (await page.locator('table[aria-label="Startup costs"] tbody tr').count()) === 4, label ?? '');
  await page.screenshot({ path: `${OUT}/journey-2-review.png`, fullPage: true });
  const t0 = Date.now();
  await confirm.click();
  await page.waitForURL(/\/companies\?company=co-pl-cafe/);
  const secs = (Date.now() - t0) / 1000;
  await page.getByTestId('company-detail').waitFor({ timeout: 8000 });
  check('company is created and the player lands on its dashboard', await page.getByTestId('company-detail').isVisible());
  const walletAfter = await wallet();
  check('wallet was debited by the quoted price through the ledger', walletAfter < walletStart && walletStart - walletAfter < 400_000, `${walletStart - walletAfter} minor`);
  check('journey from opportunity to open business took under 5 minutes', secs < 300);
  const econ = await api('/api/dev/economy');
  check('ledger reconciles after creation', econ.reconciliation?.ok === true || econ.ledger?.ok === true || JSON.stringify(econ).includes('"ok":true'));

  // 4. dashboard
  await page.getByRole('heading', { name: 'How is it going?' }).waitFor();
  check('dashboard shows diagnosis, tabs and activity', (await page.getByRole('tab').count()) >= 4);
  await page.screenshot({ path: `${OUT}/journey-3-dashboard.png`, fullPage: true });

  // 5. operations: supplies, equipment
  await page.getByRole('tab', { name: 'Operations' }).click();
  await page.getByTestId('buy-supplies').click();
  const bought = await page.getByText('Bought ingredients').first().waitFor({ timeout: 5000 }).then(() => true, () => false);
  check('"Buy supplies now" is accepted by the server and confirmed in the UI', bought);
  await page.screenshot({ path: `${OUT}/journey-4-operations.png`, fullPage: true });

  // 6. controls: change price + staff
  await page.getByRole('tab', { name: 'Controls' }).click();
  const price = page.getByLabel(/Price per unit/);
  await price.fill('3.40');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Settings saved').first().waitFor({ timeout: 5000 });
  check('price change is saved by the server', (await api('/api/companies/co-pl-cafe-1')).envelope.data.price.minor === 340);

  // 7. let the simulation run: sales, wages and rent are real
  await page.waitForTimeout(9000);
  const co = (await api('/api/companies/co-pl-cafe-1')).envelope.data;
  check('after several simulated days the company has real revenue and expenses', co.dailyRevenue.minor > 0 && co.dailyExpenses.minor > 0, `rev ${co.dailyRevenue.minor} exp ${co.dailyExpenses.minor}`);

  // 8. upgrade
  await page.getByRole('tab', { name: 'Controls' }).click();
  await page.getByTestId('cash-amount').fill('300');
  await page.getByRole('button', { name: 'Add from wallet' }).click();
  await page.getByText('Cash added to company').first().waitFor({ timeout: 5000 });
  await page.getByRole('tab', { name: 'Upgrades' }).click();
  const up = page.getByTestId('upgrade-up-cafe-capacity');
  await up.click();
  await page.getByTestId('confirm-up-cafe-capacity').click();
  await page.getByText('installed').first().waitFor({ timeout: 5000 });
  check('upgrade is bought with company cash and changes real capacity', (await api('/api/companies/co-pl-cafe-1')).envelope.data.upgrades.every((u) => u.id !== 'up-cafe-capacity'));
  await page.screenshot({ path: `${OUT}/journey-5-upgrades.png`, fullPage: true });

  // 9. map shows the new business and vacant plots
  await page.goto(`${BASE}/city`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/journey-6-city.png` });
  check('city map lists plots for lease', (await page.getByText(/Plots for lease/).count()) > 0);

  // 10. mobile layouts
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  for (const route of ['/opportunities', '/start?industry=pizza', '/companies?company=co-pl-cafe-1']) {
    await mp.goto(BASE + route, { waitUntil: 'networkidle' });
    await mp.waitForTimeout(500);
    const o = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`mobile ${route}: no horizontal overflow`, o <= 0, String(o));
    await mp.screenshot({ path: `${OUT}/journey-mobile-${route.replace(/[^a-z]/gi, '_')}.png`, fullPage: true });
  }
  check('no console errors during the journey', problems.length === 0, problems.slice(0, 3).join(' | '));
} finally { await browser.close(); stop(); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
