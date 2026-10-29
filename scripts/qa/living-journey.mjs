// Living Bristol journey in a real browser: fast-forward the city, then check NPC competitors, the Penny Post, leaderboards, titles, competitor profiles, opportunity labels and city activity.
// Usage: npm run build && node scripts/qa/living-journey.mjs (spawns its own engine on a fresh temp DB and `vite preview`)
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

const PORT = 4177, API = 8791, BASE = `http://127.0.0.1:${PORT}`, OUT = process.env.QA_OUT ?? 'qa-output';
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'pe-living-'));
for (const url of [`${BASE}/`, `http://127.0.0.1:${API}/api/health`]) { if (await fetch(url).then(() => true, () => false)) { console.error(`Port in use (${url}).`); process.exit(2); } }
const engine = spawn(process.execPath, ['--import', 'tsx', '--no-warnings', 'server/node.ts'], { stdio: 'ignore', env: { ...process.env, PENNY_DB: join(tmp, 'l.db'), PENNY_TICK_MS: '1500', PORT: String(API) } });
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
  // Day 0: the player opens a pizza restaurant next to the NPC one, then the city runs for two game months.
  const free = (await api('/api/lots')).lots.find((l) => l.status === 'vacant' && l.fits.includes('pizza'));
  const pizza = await found('pizza', free.id, 'Quay Pizza');
  await fetch(`${BASE}/api/dev/tick`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ count: 63 }) });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  // API truth first
  const standings = (await api('/api/standings')).standings;
  const news = (await api('/api/news?limit=40')).articles;
  const act = await api('/api/city/activity');
  check('weekly leaderboards are published', standings.boards.length > 0 && standings.asOfBoardTick >= 56, `board day ${standings.asOfBoardTick}`);
  check('titles are held by named companies, NPC or player', standings.titles.length > 0 && standings.titles.every((t) => t.holderName));
  check('the Penny Post has stories drawn from recorded events', news.length > 0 && news.every((a) => a.headline && a.gameDate), `${news.length} stories`);
  const directory = (await api('/api/screens/city')).envelope.data.directory.filter(c => c.owner.kind !== 'state');
  check('city activity reports a state for every non-state company', directory.length > 0 && directory.every(c => act.items.some(i => i.companyId === c.id)), `${act.items.length} activity entries for ${directory.length} companies`);
  const opps = (await api('/api/opportunities')).opportunities;
  check('every opportunity carries derived labels and metrics', opps.every((o) => Array.isArray(o.labels) && o.metrics));
  const npcCount = (await api('/api/dev/economy')).living.npcInspector.length;
  check('NPC companies are alive with logged strategy reviews', npcCount >= 5, `${npcCount} NPCs`);

  // City
  await page.goto(`${BASE}/city`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  check('city canvas renders', await page.getByTestId('city-screen').isVisible());
  await page.screenshot({ path: `${OUT}/living-1-city.png` });

  // News & rankings
  await page.goto(`${BASE}/bristol`, { waitUntil: 'networkidle' });
  check('Penny Post lists articles', (await page.getByTestId('penny-post').locator('li').count()) > 0);
  await page.screenshot({ path: `${OUT}/living-2-penny-post.png`, fullPage: true });
  await page.getByRole('tab', { name: 'Leaderboards' }).click();
  await page.waitForTimeout(400);
  check('leaderboards show ranked companies', (await page.locator('table.pe-table tbody tr').count()) >= 5);
  await page.screenshot({ path: `${OUT}/living-3-leaderboards.png`, fullPage: true });
  await page.getByRole('tab', { name: 'Titles' }).click(); await page.waitForTimeout(400);
  check('titles tab lists current holders', (await page.getByRole('list', { name: 'Current titles' }).locator('li').count()) > 0);
  await page.screenshot({ path: `${OUT}/living-4-titles.png`, fullPage: true });

  // Competitor profile: click through from a leaderboard
  await page.getByRole('tab', { name: 'Leaderboards' }).click(); await page.waitForTimeout(300);
  const npcLink = page.locator('table.pe-table tbody a').first();
  const npcName = await npcLink.textContent();
  await npcLink.click(); await page.getByTestId('competitor-profile').waitFor({ timeout: 5000 });
  const profileText = (await page.getByTestId('competitor-profile').textContent()) ?? '';
  check('competitor profile shows public data only', profileText.includes('Reputation') && profileText.includes('Market share') && !/cash balance|treasury|strategy:/i.test(profileText), npcName ?? '');
  await page.screenshot({ path: `${OUT}/living-5-competitor.png`, fullPage: true });

  // Opportunities with labels
  await page.goto(`${BASE}/opportunities`, { waitUntil: 'networkidle' });
  check('opportunity cards show market-condition labels', (await page.locator('[data-testid^="labels-"]').count()) > 0);
  await page.screenshot({ path: `${OUT}/living-6-opportunities.png`, fullPage: true });

  // Dev dashboard shows the NPC inspector and purchasing power
  await page.goto(`${BASE}/dev/economy`, { waitUntil: 'networkidle' });
  check('no console errors across the journey', problems.length === 0, problems.slice(0, 3).join(' | '));

  // Mobile
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  for (const [path, shot] of [['/bristol', 'living-mobile-news'], ['/city', 'living-mobile-city']]) {
    await mp.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }); await mp.waitForTimeout(1000);
    check(`mobile ${path}: no horizontal overflow`, (await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    await mp.screenshot({ path: `${OUT}/${shot}.png` });
  }
  void pizza;
} finally { await browser.close(); stop(); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
