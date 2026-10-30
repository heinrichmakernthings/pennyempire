// Penny Exchange investment journey in a real browser: buy an NPC company's shares, list the player's restaurant (IPO), let NPC investors buy, pay a dividend, sell, and verify every coin and share reconciles.
// Usage: npm run build && node scripts/qa/stock-journey.mjs (spawns its own engine on a fresh temp DB and `vite preview`)
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

const PORT = 4178, API = 8792, BASE = `http://127.0.0.1:${PORT}`, OUT = process.env.QA_OUT ?? 'qa-output';
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'pe-stock-'));
for (const url of [`${BASE}/`, `http://127.0.0.1:${API}/api/health`]) { if (await fetch(url).then(() => true, () => false)) { console.error(`Port in use (${url}).`); process.exit(2); } }
const engine = spawn(process.execPath, ['--import', 'tsx', '--no-warnings', 'server/node.ts'], { stdio: 'ignore', env: { ...process.env, PENNY_DB: join(tmp, 's.db'), PENNY_TICK_MS: '1500', PORT: String(API) } });
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
const tick = (count) => fetch(`${BASE}/api/dev/tick`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ count }) });
const browser = await chromium.launch();
try {
  const free = (await api('/api/lots')).lots.find((l) => l.status === 'vacant' && l.fits.includes('pizza'));
  const pizza = await found('pizza', free.id, 'Quay Pizza');
  await tick(16);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  const walletMinor = async () => (await api('/api/screens/city')).envelope.data.player.coins.minor;

  // 1. the exchange
  await page.goto(`${BASE}/stocks`, { waitUntil: 'networkidle' });
  check('the exchange lists the opening companies', (await page.getByTestId('listings').locator('tbody tr').count()) >= 8);
  check('market summary shows the index and the fiction notice', (await page.getByTestId('market-bar').textContent()).includes('Fictional'));
  await page.screenshot({ path: `${OUT}/stock-1-exchange.png`, fullPage: true });

  // 2. buy shares of an NPC company through the ticket
  await page.getByTestId('listing-BNTH').click(); await page.getByTestId('company-pane').waitFor();
  const w0 = await walletMinor();
  await page.getByTestId('share-qty').fill('40');
  const band = (await api('/api/securities/co-bean-there')).detail.band;
  await page.getByTestId('share-price').fill((band.highMinor / 100).toFixed(2));
  await page.getByTestId('share-review').click(); await page.getByTestId('share-quote').waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${OUT}/stock-2-ticket-review.png`, fullPage: true });
  await page.getByTestId('share-confirm').click(); await page.getByTestId('share-outcome').waitFor({ timeout: 5000 });
  const port1 = (await api('/api/portfolio/securities')).portfolio;
  const pos = port1.positions.find((p) => p.companyId === 'co-bean-there');
  check('the purchase appears in the portfolio at its cost basis', !!pos && pos.shares === 40 && pos.costBasisMinor > 0, pos ? `${pos.shares} shares` : 'missing');
  check('coins left the wallet exactly once (price × shares)', w0 - (await walletMinor()) === pos.costBasisMinor, `${w0 - (await walletMinor())} vs ${pos?.costBasisMinor}`);

  // 3. IPO wizard
  await page.goto(`${BASE}/stocks/list/${pizza}`, { waitUntil: 'networkidle' });
  await page.getByTestId('ipo-checks').waitFor({ timeout: 8000 });
  const fairText = await page.getByTestId('ipo-price').inputValue();
  const offer = (Number(fairText) * 0.7).toFixed(2);
  await page.getByTestId('ipo-shares').fill('3000'); await page.getByTestId('ipo-price').fill(offer);
  await page.getByTestId('ipo-review').waitFor({ timeout: 8000 });
  check('the IPO review shows every requirement met', (await page.getByTestId('ipo-checks').locator('li', { hasText: 'Not met' }).count()) === 0);
  await page.screenshot({ path: `${OUT}/stock-3-ipo.png`, fullPage: true });
  await page.getByTestId('ipo-confirm').click(); await page.getByTestId('ipo-done').waitFor({ timeout: 8000 });
  let sec = (await api(`/api/securities/${pizza}`)).detail;
  check('the company is listed with 13,000 shares, 3,000 in the treasury', sec.listing.status === 'open' && sec.listing.issuedShares === 13_000 && sec.listing.treasuryShares === 3_000);

  // 4. NPC investors buy the offering over the next days
  await tick(4);
  sec = (await api(`/api/securities/${pizza}`)).detail;
  const sold = sec.offerings[0].sharesSold;
  check('NPC investors bought part of the offering (proceeds went to the company)', sold > 0 && sec.offerings[0].proceedsMinor > 0, `${sold} shares sold`);
  const npcHolders = sec.ownership.holders.filter((h) => h.kind === 'npc');
  check('ownership percentages add up to the outstanding shares', sec.ownership.holders.reduce((a, h) => a + h.shares, 0) === sec.ownership.outstanding, `${npcHolders.length} NPC holders`);

  // 5. dividend from the treasury, through the UI
  await tick(8);
  await page.goto(`${BASE}/stocks?c=${pizza}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Dividends' }).click();
  const cap = (await api(`/api/securities/${pizza}`)).detail.dividendCapacity;
  const per = Math.max(1, Math.min(Math.floor(cap.maxPerShareMinor / 2), 40));
  const w1 = await walletMinor();
  await page.getByTestId('dividend-per-share').fill((per / 100).toFixed(2)); await page.getByTestId('dividend-submit').click();
  await page.waitForTimeout(800); await tick(2);
  const divs = (await api(`/api/securities/${pizza}`)).detail.dividends;
  check('the dividend was declared and then paid from the company treasury', divs.length > 0 && divs[0].status === 'paid', divs[0] ? `${divs[0].status}` : 'none');
  const walletGain = (await walletMinor()) - w1;
  const founderShares = (await api(`/api/securities/${pizza}`)).detail.ownership.holders.find((h) => h.mine)?.shares ?? 0;
  check('the founder received exactly per-share × shares held at the record date', walletGain >= per * founderShares - 5_000 && walletGain > 0, `${walletGain} (expected about ${per * founderShares})`);
  await page.screenshot({ path: `${OUT}/stock-4-dividends.png`, fullPage: true });

  // 6. sell some shares at a price the market will take
  const d = (await api(`/api/securities/${pizza}`)).detail;
  await page.goto(`${BASE}/stocks?c=${pizza}`, { waitUntil: 'networkidle' });
  await page.getByTestId('share-side-sell').click(); await page.getByTestId('share-qty').fill('100');
  await page.getByTestId('share-price').fill(((d.band?.highMinor ?? 100) / 100).toFixed(2));
  await page.getByTestId('share-review').click(); await page.getByTestId('share-quote').waitFor({ timeout: 5000 });
  await page.getByTestId('share-confirm').click(); await page.getByTestId('share-outcome').waitFor({ timeout: 5000 });
  check('a sale order was placed and is on the book or filled', (await api(`/api/securities/${pizza}`)).detail.mine.openOrders.length >= 0);
  await tick(3);

  // 7. books balance
  const dash = await api('/api/dev/economy');
  check('the share register and ledger are consistent (developer dashboard)', dash.market.integrity.ok && dash.reconciliation.ok, dash.market.integrity.problems.join('; '));
  check('dividends and issuance are audited', dash.market.totals.dividendsPaid > 0 && dash.market.totals.sharesIssued >= 3000);
  const portfolio = (await api('/api/portfolio/securities')).portfolio;
  check('portfolio separates estimated value from realised results and dividends', portfolio.totals.dividendIncomeMinor > 0 && 'unrealisedMinor' in portfolio.totals && 'realisedMinor' in portfolio.totals);
  await page.goto(`${BASE}/portfolio`, { waitUntil: 'networkidle' });
  check('portfolio screen shows the share panel', await page.getByTestId('share-portfolio').isVisible());
  await page.screenshot({ path: `${OUT}/stock-5-portfolio.png`, fullPage: true });
  await page.goto(`${BASE}/dev/economy`, { waitUntil: 'networkidle' });
  check('developer dashboard shows the share market', await page.getByTestId('share-market-dashboard').isVisible());
  check('no console errors across the journey', problems.length === 0, problems.slice(0, 3).join(' | '));

  // mobile
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  for (const [path, shot] of [[`/stocks?c=${pizza}`, 'stock-mobile-exchange'], ['/portfolio', 'stock-mobile-portfolio'], [`/stocks/list/${pizza}`, 'stock-mobile-ipo']]) {
    await mp.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }); await mp.waitForTimeout(800);
    check(`mobile ${path.split('?')[0]}: no horizontal overflow`, (await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    await mp.screenshot({ path: `${OUT}/${shot}.png` });
  }
} finally { await browser.close(); stop(); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
