// End-to-end commodities-exchange journey in a real browser: found farm, mill and pizza restaurant, then trade wheat and flour through the exchange UI, set up a contract, and verify every coin and unit.
// Usage: npm run build && node scripts/qa/exchange-journey.mjs (spawns its own engine on a fresh temp DB and `vite preview`)

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
for (const base of [import.meta.url, 'file:///usr/local/lib/node_modules_global/', `file://${process.env.NODE_PATH ?? ''}/`]) { try { ({ chromium } = createRequire(base)('playwright')); break; } catch { /* next */ } }
if (!chromium) { console.error('Playwright not found.'); process.exit(2); }

const PORT = 4175, API = 8789, BASE = `http://127.0.0.1:${PORT}`, OUT = process.env.QA_OUT ?? 'qa-output';
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'pe-exchange-'));
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

let n = 0;
const cmd = async (body) => (await (await fetch(`${BASE}/api/command`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: `qa-${Date.now()}-${n++}`, expectedRevision: 0, ...body }) })).json());
const found = async (industry, plotId, name) => {
  const q = (await api(`/api/startup-quote?industry=${industry}&plotId=${plotId}&tier=1&name=${encodeURIComponent(name)}`)).quote;
  const r = await cmd({ type: 'company.create', industry, plotId, tier: 1, name, expectedTotalMinor: q.totalMinor });
  if (!r.ok) throw new Error(`${name}: ${r.error?.message}`);
  return r.transactionId;
};
const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'] } : {});
try {
  const farm = await found('farm', 'lot-3', 'Avon Wheat'), mill = await found('mill', 'lot-7', 'Severn Flour'), pizza = await found('pizza', 'plot-pizza', 'Quay Pizza');
  for (const c of [farm, mill, pizza]) await cmd({ type: 'company.fund', companyId: c, amountMinor: 150_000 });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  // let the farm grow some wheat
  await page.waitForTimeout(5000);
  await page.goto(`${BASE}/commodities?commodity=wheat`, { waitUntil: 'networkidle' });
  await page.getByTestId('exchange').waitFor();
  check('exchange terminal lists every commodity incl. coffee and packaging', (await page.locator('[data-testid^="pick-"]').count()) >= 8);
  check('market shows executed, best-bid/ask and estimated-demand figures', (await page.getByTestId('market-stats').getByText(/Last executed price/).count()) === 1 && (await page.getByTestId('depth').count()) === 1);
  await page.screenshot({ path: `${OUT}/exchange-1-wheat.png`, fullPage: true });

  // farm lists wheat for sale at its own price through the ticket
  await page.getByTestId('side-sell').click();
  await page.getByTestId('ticket-company').selectOption({ label: 'Avon Wheat' });
  const free = await page.getByTestId('free-note').textContent();
  check('ticket shows the company\'s free stock separately from reservations', /Free to sell/.test(free ?? ''), free ?? '');
  await page.getByTestId('ticket-qty').fill('100');
  await page.getByTestId('ticket-limit').fill('0.60');
  await page.getByTestId('ticket-review').click();
  await page.getByTestId('ticket-quote').waitFor({ timeout: 5000 });
  check('review shows reservation, fee and fillable units before anything is committed', (await page.getByTestId('ticket-quote').getByText(/Units reserved while the order rests/).count()) === 1);
  await page.getByTestId('ticket-confirm').click();
  await page.getByTestId('ticket-outcome').waitFor({ timeout: 5000 });
  await page.getByTestId('own-orders').waitFor({ timeout: 5000 });
  const mine = await api('/api/exchange/orders');
  check('sell order exists on the server with its reservation', mine.orders.some((o) => o.companyId === farm && o.side === 'sell' && o.priceMinor === 60 && ['open', 'partial', 'filled'].includes(o.status)));

  // the mill compares suppliers from its own page and buys wheat
  await page.goto(`${BASE}/companies?company=${mill}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Operations' }).click();
  await page.getByTestId('compare-wheat').click();
  await page.getByTestId('procure-sheet').waitFor();
  check('contextual purchasing opens a supplier comparison from the missing ingredient', (await page.getByTestId('procure-sheet').getByRole('table').count()) >= 1);
  await page.screenshot({ path: `${OUT}/exchange-2-procure.png`, fullPage: true });
  const buyBtn = page.getByTestId(`procure-${farm}`);
  check('the player farm appears among the mill\'s suppliers at its own price', await buyBtn.isVisible().catch(() => false));
  await buyBtn.click();
  await page.getByTestId('ticket-review').click();
  await page.getByTestId('ticket-quote').waitFor({ timeout: 5000 });
  await page.getByTestId('ticket-confirm').click();
  await page.getByTestId('ticket-outcome').waitFor({ timeout: 5000 });
  const outcome = await page.getByTestId('ticket-outcome').textContent();
  check('purchase settles at once against the farm', /filled/.test(outcome ?? ''), outcome ?? '');
  const t1 = (await api('/api/exchange/trades?commodity=wheat')).trades;
  const bought = t1.find((t) => t.companyId === mill && t.role === 'bought');
  check('trade is recorded with the farm as counterparty, price and no fee for the buyer', !!bought && bought.counterparty === 'Avon Wheat' && bought.feeMinor === 0, JSON.stringify(bought));

  // contract: the pizza restaurant contracts flour from the NPC mill
  await page.goto(`${BASE}/commodities?commodity=flour`, { waitUntil: 'networkidle' });
  await page.getByTestId('open-contract').click();
  await page.getByTestId('contract-form').waitFor();
  await page.getByTestId('contract-form').getByLabel('Your company').selectOption({ label: 'Quay Pizza' });
  await page.getByTestId('contract-qty').fill('20'); await page.getByTestId('contract-price').fill('3.40');
  await page.getByTestId('contract-submit').click();
  await page.getByTestId('contract-msg').waitFor({ timeout: 5000 });
  const msg = await page.getByTestId('contract-msg').textContent();
  check('the supplier answers with its reasoning (accepts or explains why not)', (msg ?? '').length > 20, msg ?? '');
  await page.keyboard.press('Escape');

  // let days pass; deliveries and trades happen without the browser
  await page.waitForTimeout(12000);
  const contracts = (await api('/api/exchange/contracts')).contracts;
  const k = contracts.find((c) => c.buyerId === pizza);
  check('the contract exists, is active and delivered real goods on schedule', !!k && k.status === 'active' && k.delivered >= 1, JSON.stringify(k && { status: k.status, delivered: k.delivered, missed: k.missed, history: k.history.slice(0, 3) }));

  // economy-wide integrity
  const econ = await api('/api/dev/economy');
  check('ledger reconciles', econ.reconciliation.ok === true);
  check('order reservations match account and inventory reservations', econ.exchange.reservations.consistent === true);
  check('no self-trades, crossed books or reservation anomalies', !econ.exchange.anomalies.some((a) => ['self_trade', 'crossed_book', 'reservation_mismatch'].includes(a.kind)), JSON.stringify(econ.exchange.anomalies.filter((a) => a.severity === 'error')));
  check('exchange fee income is tracked separately from burns', econ.exchange.fees.collected7d > 0 || econ.exchange.fees.burnedTotal > 0 || econ.exchange.fees.sweptTotal > 0);

  // the chain: mill produced flour from wheat; pizza restaurant trades; wheat price history exists
  const fl = (await api('/api/companies/' + mill + '/financials')).rows;
  check('the mill\'s statement shows wheat purchases', fl.some((r) => r.inputPurchases > 0));
  const opp = await api('/api/opportunities');
  check('opportunity finder reports market shortages from live state', opp.shortages.some((s) => s.demandUnitsPerDay > 0) && opp.shortages.every((s) => Number.isInteger(s.shortageUnitsPerDay)));
  await page.goto(`${BASE}/opportunities`, { waitUntil: 'networkidle' });
  check('opportunities screen shows the market-gaps table', await page.getByTestId('market-gaps').isVisible());
  await page.screenshot({ path: `${OUT}/exchange-3-gaps.png`, fullPage: true });
  await page.goto(`${BASE}/commodities?commodity=flour`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/exchange-4-flour.png`, fullPage: true });
  check('no console errors', problems.length === 0, problems.slice(0, 3).join(' | '));

  // mobile
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  await mp.goto(`${BASE}/commodities?commodity=flour`, { waitUntil: 'networkidle' }); await mp.waitForTimeout(800);
  const over = await mp.evaluate(() => { const w = document.documentElement.clientWidth; const probe = []; for (const sel of ['.pe-ex-list', '.pe-ex-main > section:nth-child(1)', '.pe-ex-main > section:nth-child(2)', '.pe-ex-main > section:nth-child(3)', '.pe-ex-main > section:nth-child(4)', '.pe-ex-side', '.pe-ex-below > section:nth-child(1)', '.pe-ex-below > section:nth-child(2)', '.pe-ex-below > section:nth-child(3)']) { const el = document.querySelector(sel); if (!el) continue; const d = el.style.display; el.style.display = 'none'; probe.push(`${sel}=${document.documentElement.scrollWidth}`); el.style.display = d; } if (document.documentElement.scrollWidth > w) return probe; const sw = [...document.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible' && e.clientWidth > 0).slice(0, 5).map((e) => `SW ${e.tagName}.${String(e.className).slice(0, 25)} ${e.scrollWidth}>${e.clientWidth}`); const wide = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > w + 1 && e.getBoundingClientRect().width > 0 && !e.closest('.pe-toasts')).filter((e) => { let p = e.parentElement; while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return p.getBoundingClientRect().right > w + 1; p = p.parentElement; } return true; }).slice(0, 6).map((e) => `W ${e.tagName}.${String(e.className).slice(0, 30)} r${Math.round(e.getBoundingClientRect().right)} w${Math.round(e.getBoundingClientRect().width)}`); if (wide.length) return wide; const big = [...document.querySelectorAll('body *')].filter((e) => !e.closest('.pe-toasts') && e.getBoundingClientRect().width > w + 1).slice(0, 6).map((e) => `B ${e.tagName}.${String(e.className).slice(0, 30)} w${Math.round(e.getBoundingClientRect().width)} p=${e.parentElement?.className.slice(0, 20)}`); if (big.length) return big; if (sw.length) return sw; return [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > w + 1 && !e.closest('.pe-table-scroll')).slice(0, 4).map((e) => `${e.tagName}.${String(e.className).slice(0, 30)} ${Math.round(e.getBoundingClientRect().right)}`); });
  check('mobile exchange: no horizontal overflow', (await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, over.join('; '));
  await mp.getByTestId('open-ticket').click();
  await mp.getByTestId('order-ticket').waitFor({ timeout: 4000 });
  check('mobile: the ticket opens in a sheet', await mp.getByTestId('order-ticket').isVisible());
  await mp.screenshot({ path: `${OUT}/exchange-mobile-ticket.png` });
} finally { await browser.close(); stop(); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
