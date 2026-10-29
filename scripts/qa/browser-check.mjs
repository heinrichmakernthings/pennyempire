// Real-browser acceptance checks (Chromium via Playwright). Usage: npm run build && npm run qa:browser
// Starts the real economic engine server (temp SQLite DB, fast ticks) and `vite preview` (proxying /api), then drives the actual UI. Playwright is resolved from the project or a global install.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
for (const base of [import.meta.url, 'file:///usr/local/lib/node_modules_global/', `file://${process.env.NODE_PATH ?? ''}/`]) {
  try { ({ chromium } = createRequire(base)('playwright')); break; } catch { /* try next */ }
}
if (!chromium) { console.error('Playwright not found. Install it (npm i -D playwright) or provide a global install.'); process.exit(2); }

const PORT = 4173, BASE = `http://127.0.0.1:${PORT}`, OUT = process.env.QA_OUT ?? 'qa-output';
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'pe-qa-'));
// Children are spawned directly (not via npx) so kill() really stops them, and the run refuses to start if a stale server owns the ports.
for (const url of [`${BASE}/`, 'http://127.0.0.1:8787/api/health']) { const up = await fetch(url).then(() => true, () => false); if (up) { console.error(`Port already in use (${url}). Stop the stale server before running QA.`); process.exit(2); } }
const engine = spawn(process.execPath, ['--import', 'tsx', '--no-warnings', 'server/node.ts'], { stdio: 'ignore', env: { ...process.env, PENNY_DB: join(tmp, 'qa.db'), PENNY_PROFILE: 'demo', PENNY_TICK_MS: '2500', PORT: '8787' } });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore' });
const stop = () => { server.kill(); engine.kill(); try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } };
process.on('exit', stop);
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE)).ok && (await fetch(`${BASE}/api/health`)).ok) break; } catch { /* waiting */ } await new Promise((r) => setTimeout(r, 200)); }

const routes = ['/city', '/opportunities', '/companies', '/commodities', '/stocks', '/portfolio', '/prestige', '/wallet', '/bristol', '/world'];
const viewports = [{ name: 'mobile-390', width: 390, height: 844, mobile: true }, { name: 'tablet-768', width: 768, height: 1024, mobile: false }, { name: 'desktop-1440', width: 1440, height: 900, mobile: false }];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'] } : {});
try {
  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.mobile, isMobile: vp.mobile, deviceScaleFactor: vp.mobile ? 2 : 1 });
    const page = await ctx.newPage();
    const problems = [];
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));

    for (const route of routes) {
      await page.goto(BASE + route, { waitUntil: 'networkidle' });
      await page.waitForSelector('main h1, [data-testid="city-screen"]');
      await page.waitForTimeout(500);
      const m = await page.evaluate(() => ({ docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, mainOverflow: (() => { const e = document.querySelector('main'); return e.scrollWidth - e.clientWidth; })() }));
      check(`${vp.name} ${route}: no horizontal overflow`, m.docOverflow <= 0 && m.mainOverflow <= 0, JSON.stringify(m));
      await page.screenshot({ path: `${OUT}/${vp.name}${route.replace('/', '-')}.png` });
      if (route === '/stocks') {
        const search = page.getByRole('searchbox', { name: 'Find a listed company' });
        await search.fill('no-company-with-this-name');
        check(`${vp.name} shares: search has an honest empty state`, await page.getByText('No matching companies. Try another name or clear your search.').isVisible());
        await search.fill('');
        await page.getByTestId('listings').locator('tbody tr').nth(1).waitFor();
        check(`${vp.name} shares: clearing search restores listings`, await page.getByTestId('listings').locator('tbody tr').count() > 1);
      }
      // touch targets: every visible interactive element in the shell and screen is ≥44px in both axes (inline text links excepted)
      const small = await page.evaluate(() => [...document.querySelectorAll('button, [role=tab], select, input, .pe-btn, nav a, .pe-more-link')].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && (r.height < 43.5 || r.width < 43.5) && e.type !== 'hidden'; }).map((e) => `${e.tagName}.${e.className}|${e.textContent?.trim().slice(0, 20) || e.getAttribute('aria-label')}|${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
      check(`${vp.name} ${route}: touch targets ≥44px`, small.length === 0, small.slice(0, 4).join('; '));
    }

    // ── City canvas behaviour ──
    await page.goto(BASE + '/city', { waitUntil: 'networkidle' });
    const wrap = page.locator('.pe-city-canvas-wrap');
    await wrap.waitFor();
    await page.waitForTimeout(700);
    const box = await wrap.boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const sig = () => page.evaluate(() => { const c = document.querySelector('[data-testid=city-canvas]'); const copy = document.createElement('canvas'); copy.width = c.width; copy.height = c.height; const ctx = copy.getContext('2d', { willReadFrequently: true }); ctx.drawImage(c, 0, 0); const w = c.width, h = c.height; const seen = new Set(); for (let i = 0; i < 400; i++) { const d = ctx.getImageData(Math.floor((i * 7919) % w), Math.floor((i * 104729) % h), 1, 1).data; seen.add(d.join(',')); } return { colours: seen.size, hash: c.toDataURL().length + ':' + c.toDataURL().slice(-40) }; });
    const s0 = await sig();
    check(`${vp.name} city: canvas draws real artwork`, s0.colours > 40, `${s0.colours} distinct sampled colours`);
    check(`${vp.name} city: crisp pixel rendering`, await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid=city-canvas]')).imageRendering === 'pixelated'));

    // select via pointer
    if (vp.mobile) await page.touchscreen.tap(cx, cy); else await page.mouse.click(cx, cy);
    const insp = page.getByRole('article').first();
    await insp.waitFor({ timeout: 4000 }).catch(() => {});
    const selectedName = (await insp.locator('h2').first().textContent().catch(() => '')) ?? '';
    check(`${vp.name} city: clicking the building opens its company panel`, await insp.isVisible() && ['Mad Slices', 'Harbour Bean'].includes(selectedName), selectedName);
    if (await insp.isVisible()) {
      for (const t of ['Your company', 'Operating', 'Owner:', 'Revenue / day']) check(`${vp.name} city: panel shows "${t}"`, (await insp.getByText(t, { exact: false }).count()) > 0);
      await page.screenshot({ path: `${OUT}/${vp.name}-city-selected.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    // management link
    if (!vp.mobile) {
      await page.mouse.click(cx, cy); await page.getByRole('link', { name: 'Manage company' }).first().click();
      await page.waitForURL(/\/companies\?company=co-/);
      check(`${vp.name} city: "Manage company" opens the company-management view`, await page.getByRole('tab', { name: 'Controls' }).waitFor({ timeout: 4000 }).then(() => true, () => false));
      await page.goto(BASE + '/city', { waitUntil: 'networkidle' }); await wrap.waitFor(); await page.waitForTimeout(500);
    }
    // zoom
    const zoomOut = page.locator('.pe-zoom-level');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    check(`${vp.name} city: zoom in snaps to 2×`, (await zoomOut.textContent()).trim() === '2×');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    check(`${vp.name} city: zoom in snaps to 3× (max)`, (await zoomOut.textContent()).trim() === '3×' && await page.getByRole('button', { name: 'Zoom in' }).isDisabled());
    await page.getByRole('button', { name: 'Zoom out' }).click(); await page.getByRole('button', { name: 'Zoom out' }).click();
    check(`${vp.name} city: zoom out returns to 1×`, (await zoomOut.textContent()).trim() === '1×');
    if (!vp.mobile) { await page.mouse.move(cx, cy); await page.mouse.wheel(0, -200); await page.waitForTimeout(300); check(`${vp.name} city: mouse wheel zooms`, (await zoomOut.textContent()).trim() === '2×'); await page.getByRole('button', { name: 'Zoom out' }).click(); }
    // pan by drag
    const before = await sig();
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 160, cy + 60, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(250);
    const afterDrag = await sig();
    check(`${vp.name} city: dragging pans the map`, before.hash !== afterDrag.hash);
    check(`${vp.name} city: a drag does not select a building`, await page.getByRole('article').count() === 0);
    // keyboard pan
    await wrap.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(250);
    const afterKey = await sig();
    check(`${vp.name} city: keyboard arrows pan the map`, afterKey.hash !== afterDrag.hash);
    await page.getByRole('button', { name: 'Recentre city' }).click();
    check(`${vp.name} city: recentre resets zoom`, (await zoomOut.textContent()).trim() === '1×');
    // accessible list alternative
    if (vp.width >= 1200) check(`${vp.name} city: accessible business list is present`, await page.getByRole('list', { name: 'Businesses in Bristol' }).isVisible());
    else {
      await page.getByRole('button', { name: /Businesses \(8\)/ }).click();
      const dlg = page.getByRole('dialog', { name: 'Businesses in Bristol' });
      check(`${vp.name} city: business list dialog opens`, await dlg.isVisible());
      await dlg.getByRole('button', { name: /Brunel Milling/ }).click();
      await page.waitForTimeout(500);
      check(`${vp.name} city: choosing from the list selects and focuses the company`, await page.getByRole('article', { name: 'Brunel Milling' }).isVisible());
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      check(`${vp.name} city: Escape closes the sheet`, await page.getByRole('dialog').count() === 0);
    }
    // navigation
    if (vp.mobile) {
      await page.getByRole('button', { name: 'More' }).click();
      await page.getByRole('link', { name: /Wallet/ }).click();
      await page.waitForURL(/\/wallet/);
      check(`${vp.name} nav: More sheet reaches Wallet`, await page.getByText('SIMULATED').first().waitFor({ timeout: 4000 }).then(() => true, () => false));
    } else {
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Stock Exchange/ }).click();
      await page.waitForURL(/\/stocks/); check(`${vp.name} nav: sidebar/rail navigates`, await page.getByRole('heading', { name: 'Penny Exchange', level: 1 }).waitFor({ timeout: 4000 }).then(() => true, () => false));
    }
    // ad slot placement
    const ad = await page.getByRole('complementary', { name: /Sponsored space/ }).isVisible();
    check(`${vp.name}: ad slot ${vp.width >= 1200 ? 'visible' : 'hidden'} per breakpoint`, ad === (vp.width >= 1200));
    check(`${vp.name}: no console errors/warnings or failed requests`, problems.length === 0, problems.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // loading / error / empty states via fixture mode
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/companies?source=fixture&fixture=error', { waitUntil: 'networkidle' });
  check('error state renders with retry', await page.getByRole('button', { name: 'Try again' }).isVisible());
  await page.goto(BASE + '/companies?source=fixture&fixture=empty', { waitUntil: 'networkidle' });
  check('empty state renders with next action', await page.getByText("You don't own a company yet").isVisible());
  await page.goto(BASE + '/wallet?source=fixture&fixture=slow');
  check('loading skeleton shows while data is pending', await page.getByRole('status', { name: /Loading Wallet/ }).first().waitFor({ timeout: 2000 }).then(() => true, () => false));
  await ctx.close();

  // ── Live economic engine behaviour ──
  const live = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const lp = await live.newPage(); const lproblems = [];
  lp.on('console', (m) => { if (['error', 'warning'].includes(m.type())) lproblems.push(m.text()); }); lp.on('pageerror', (e) => lproblems.push(e.message));
  await lp.goto(BASE + '/city', { waitUntil: 'networkidle' });
  const badge = lp.locator('.pe-live').first(); await badge.waitFor();
  const day = async () => Number(/Day (\d+)/.exec((await badge.textContent()) ?? '')?.[1] ?? -1);
  const d0 = await day();
  check('HUD labels data as a live simulation (not illustrative) and shows real balances', d0 >= 0 && (await lp.getByText('Demo data').count()) === 0 && (await lp.locator('.pe-hud-stats dd').first().textContent()).includes('15,000 EC'), `Day ${d0}`);
  let d1 = d0; for (let i = 0; i < 40 && d1 === d0; i++) { await lp.waitForTimeout(500); d1 = await day(); }
  check('the economy advances by itself: HUD day increases with nobody clicking', d1 > d0, `Day ${d0} → ${d1}`);
  await lp.goto(BASE + '/companies?company=co-mad-slices', { waitUntil: 'networkidle' });
  await lp.getByRole('tab', { name: 'Controls' }).click();
  const price = lp.getByLabel(/Price per unit/); await price.fill('10.50'); await lp.getByRole('button', { name: 'Save changes' }).click();
  check('saving company settings is accepted by the server and persists', await lp.getByText('Settings saved').waitFor({ timeout: 5000 }).then(() => true, () => false));
  const after = await (await fetch(`${BASE}/api/companies/co-mad-slices`)).json();
  check('server state reflects the change (price and revision)', after.envelope.data.price.minor === 1050 && after.envelope.data.revision >= 2);
  await lp.getByRole('tab', { name: 'Financials' }).click();
  check('financials show the stored daily operating statement', await lp.getByRole('region', { name: 'Daily operating statement' }).locator('tbody tr').first().waitFor({ timeout: 5000 }).then(() => true, () => false));
  await lp.goto(BASE + '/wallet', { waitUntil: 'networkidle' });
  check('screens without server data (wallet) stay explicitly illustrative', (await lp.getByText('Illustrative data').count()) > 0 && (await lp.getByText('SIMULATED').count()) > 0);
  await lp.goto(BASE + '/dev/economy', { waitUntil: 'networkidle' });
  check('developer economy dashboard shows live ledger statistics', await lp.getByText('Ledger reconciles').waitFor({ timeout: 6000 }).then(() => true, () => false) && (await lp.getByText('Circulating supply').count()) > 0);
  await lp.screenshot({ path: `${OUT}/dev-economy.png`, fullPage: false });
  check('live pages produced no console errors or warnings', lproblems.length === 0, lproblems.slice(0, 3).join(' | '));
  await live.close();
} finally { await browser.close(); stop(); }

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length ? 1 : 0);
