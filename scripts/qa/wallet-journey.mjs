// Prompt 9 end-to-end journey in a real browser: pizza restaurant -> luxury car -> boost -> rewarded ad -> 50p test deposit -> £5 prize -> £5 withdrawal -> mock settlement, then reconciliation.
// Usage: npm run build && node scripts/qa/wallet-journey.mjs (spawns its own engine on a fresh temp DB and `vite preview`)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let chromium;
for (const base of [import.meta.url, 'file:///usr/local/lib/node_modules_global/', `file://${process.env.NODE_PATH ?? ''}/`]) { try { ({ chromium } = createRequire(base)('playwright')); break; } catch { /* next */ } }
if (!chromium) { console.error('Playwright not found.'); process.exit(2); }
const PORT = 4180, API = 8794, BASE = `http://127.0.0.1:${PORT}`, OUT = process.env.QA_OUT ?? 'qa-output';
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'pe-wallet-'));
for (const url of [`${BASE}/`, `http://127.0.0.1:${API}/api/health`]) { if (await fetch(url).then(() => true, () => false)) { console.error(`Port in use (${url}).`); process.exit(2); } }
const engine = spawn(process.execPath, ['--import', 'tsx', '--no-warnings', 'server/node.ts'], { stdio: 'ignore', env: { ...process.env, PENNY_DB: join(tmp, 's.db'), PENNY_TICK_MS: '3600000', PORT: String(API) } });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore', env: { ...process.env, PENNY_API_PORT: String(API) } });
const stop = () => { server.kill(); engine.kill(); try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } };
process.on('exit', stop);
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE)).ok && (await fetch(`${BASE}/api/health`)).ok) break; } catch { /* waiting */ } await new Promise((r) => setTimeout(r, 200)); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const api = (p, init) => fetch(`${BASE}${p}`, init).then((r) => r.json());
let n = 0;
const cmd = (body) => api('/api/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: `qa-${Date.now()}-${n++}`, expectedRevision: 0, ...body }) });
const tick = (count) => api('/api/dev/tick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ count }) });
const coins = async () => (await api('/api/screens/city')).envelope.data.player.coins.minor;

const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'] } : {});
try {
  const free = (await api('/api/lots')).lots.find((l) => l.status === 'vacant' && l.fits.includes('pizza'));
  const q = (await api(`/api/startup-quote?industry=pizza&plotId=${free.id}&tier=1&name=Quay%20Pizza`)).quote;
  const made = await cmd({ type: 'company.create', industry: 'pizza', plotId: free.id, tier: 1, name: 'Quay Pizza', expectedTotalMinor: q.totalMinor }); if (!made.ok) throw new Error(made.error?.message);
  await tick(20);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } }); const page = await ctx.newPage(); const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); }); page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`)); page.on('dialog', (d) => d.accept());
  check('the restaurant earned Empire Coins from real sales', ((await api('/api/companies/' + made.data.companyId + '/financials?limit=20')).rows ?? []).some((r) => (r.revenue?.minor ?? r.revenueMinor ?? 1) > 0));

  // luxury car
  const c0 = await coins();
  await page.goto(`${BASE}/prestige`, { waitUntil: 'networkidle' }); await page.getByTestId('prestige-store').waitFor();
  check('ad placements are labelled simulated and inert', (await page.locator('aside[data-placement]').count()) >= 2 && (await page.locator('aside[data-placement] a, aside[data-placement] button').count()) === 0);
  await page.screenshot({ path: `${OUT}/wallet-1-prestige-store.png`, fullPage: true });
  await page.getByTestId('item-veh-sports').getByRole('button', { name: /^Buy for/ }).click(); await page.waitForTimeout(900);
  check('the car was bought with Empire Coins (price deducted)', (await coins()) <= c0 - 900_000, `${(c0 - await coins()) / 100} EC`);
  await tick(8);
  await page.getByRole('tab', { name: 'My collection' }).click(); await page.getByTestId('owned-veh-sports#1').waitFor();
  check('the car is in the prestige collection', true);
  await page.screenshot({ path: `${OUT}/wallet-2-collection.png`, fullPage: true });
  const act = (await api('/api/city/activity')).items.find((i) => i.companyId === made.data.companyId);
  check('the car appears beside the company on the city map', act?.luxury?.includes('sports-car-sw'), JSON.stringify(act?.luxury));
  await page.goto(`${BASE}/city`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500); await page.screenshot({ path: `${OUT}/wallet-3-city-car.png` });

  // boost
  await page.goto(`${BASE}/prestige`, { waitUntil: 'networkidle' }); await page.getByRole('tab', { name: 'Boosts' }).click();
  await page.getByRole('button', { name: /Activate for/ }).first().click(); await page.waitForTimeout(900);
  const pr = await api('/api/prestige'); check('the disclosed production boost is active', pr.boosts.active.some((b) => b.kind === 'production' && b.bps === 300));
  await page.screenshot({ path: `${OUT}/wallet-4-boosts.png`, fullPage: true });
  await tick(3);

  // rewarded ad
  await page.goto(`${BASE}/rewards`, { waitUntil: 'networkidle' });
  const c1 = await coins();
  await page.getByTestId('adreward-ad-coins').getByRole('button', { name: /Watch/ }).click(); await page.getByTestId('ad-player').waitFor();
  await page.screenshot({ path: `${OUT}/wallet-5-rewarded-ad.png`, fullPage: true });
  await page.getByTestId('ad-message').waitFor({ timeout: 40_000 });
  check('the rewarded video paid the fictional coins once, issued by the server', (await coins()) - c1 === 5_000, `${((await coins()) - c1) / 100} EC`);
  await page.screenshot({ path: `${OUT}/wallet-6-after-ad.png`, fullPage: true });

  // wallet deposit
  await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' }); await page.getByTestId('server-wallet').waitFor();
  await page.screenshot({ path: `${OUT}/wallet-7-wallet.png`, fullPage: true });
  const cDep = await coins(); await page.getByRole('button', { name: '£0.50' }).click(); await page.waitForTimeout(900);
  check('a 50p simulated deposit reached the GBP wallet and left coins untouched', (await api('/api/wallet')).availablePence === 50 && (await coins()) === cDep);

  // treasury: fund a programme and award a simulated £5 prize
  await page.goto(`${BASE}/dev/treasury`, { waitUntil: 'networkidle' }); await page.getByTestId('treasury').waitFor();
  await page.getByRole('button', { name: 'Fund treasury £100' }).click(); await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Create £5 test programme' }).click(); await page.waitForTimeout(600);
  await page.getByRole('button', { name: /^Fund Test prize/ }).click(); await page.waitForTimeout(600);
  await page.getByRole('button', { name: /^Award Test prize/ }).click(); await page.waitForTimeout(800);
  check('the £5 prize came from the funded programme', (await api('/api/wallet')).availablePence === 550 && (await api('/api/wallet')).rewards.length === 1);
  await page.screenshot({ path: `${OUT}/wallet-8-treasury.png`, fullPage: true });

  // withdrawal
  await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' }); await page.getByTestId('wd-amount').fill('4.99');
  check('the £5 minimum is enforced in the form', await page.getByTestId('wd-submit').isDisabled());
  await page.getByTestId('wd-amount').fill('5.00'); await page.getByTestId('wd-submit').click(); await page.waitForTimeout(900);
  const w1 = await api('/api/wallet'); check('£5 is reserved as pending; the rest stays available', w1.pendingPence === 500 && w1.availablePence === 50);
  await page.goto(`${BASE}/dev/treasury`, { waitUntil: 'networkidle' }); await page.getByRole('button', { name: 'Approve' }).click(); await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Settle + duplicate webhook' }).click(); await page.waitForTimeout(900);
  const w2 = await api('/api/wallet'); check('the mock payout settled once (duplicate webhook ignored)', w2.withdrawals[0].status === 'paid' && w2.pendingPence === 0 && w2.availablePence === 50);
  await page.screenshot({ path: `${OUT}/wallet-9-settled.png`, fullPage: true });
  await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' }); await page.getByRole('tab', { name: 'Transaction history' }).click(); await page.getByTestId('gbp-history').waitFor();
  await page.screenshot({ path: `${OUT}/wallet-10-history.png`, fullPage: true });

  // membership + lottery
  await page.goto(`${BASE}/membership`, { waitUntil: 'networkidle' }); await page.getByRole('button', { name: 'Subscribe (simulated)' }).click(); await page.waitForTimeout(900);
  check('the simulated premium subscription is active', (await page.getByTestId('membership-status').textContent()).includes('active'));
  await page.screenshot({ path: `${OUT}/wallet-11-membership.png`, fullPage: true });
  await page.goto(`${BASE}/rewards`, { waitUntil: 'networkidle' }); await page.getByRole('tab', { name: 'Coin lottery' }).click(); await page.getByTestId('odds').waitFor();
  await page.getByRole('button', { name: /Buy a ticket/ }).click(); await page.waitForTimeout(800);
  check('the lottery shows published odds and the ticket was bought with coins', (await page.getByTestId('odds').textContent()).includes('Published odds') && (await api('/api/rewards')).lotteries.find((l) => l.status === 'open').myTickets.length === 1);
  await page.screenshot({ path: `${OUT}/wallet-12-lottery.png`, fullPage: true });

  // reconciliation
  const t = (await api('/api/dev/treasury')).treasury;
  check('the GBP ledger reconciles and deposits/prizes are not revenue', t.reconciles === true && t.problems.length === 0 && t.revenue.advertising === 0 && t.playerFunds.walletLiabilitiesPence === 50, `liabilities ${t.playerFunds.walletLiabilitiesPence}p, rewards ${t.rewards.issuedPence}p`);
  check('the Empire Coin ledger reconciles', (await api('/api/dev/economy')).ledger?.reconciles !== false);

  // mobile
  const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
  m.on('pageerror', (e) => problems.push(`mobile pageerror: ${e.message}`));
  for (const [path, name] of [['/wallet', 'wallet'], ['/prestige', 'prestige'], ['/rewards', 'rewards']]) { await m.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }); await m.screenshot({ path: `${OUT}/wallet-m-${name}.png`, fullPage: false }); }
  check('the mobile layout does not scroll sideways', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  check('no console errors', problems.length === 0, problems.slice(0, 3).join(' | '));
} catch (e) { check('journey completed', false, e instanceof Error ? e.message : String(e)); }
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
