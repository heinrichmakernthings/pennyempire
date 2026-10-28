// Real-browser acceptance checks (Chromium via Playwright). Usage: npm run build && npm run qa:browser
// Serves ./dist with `vite preview`, then drives the actual UI. Playwright is resolved from the project or a global install.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
let chromium;
for (const base of [import.meta.url, 'file:///usr/local/lib/node_modules_global/', `file://${process.env.NODE_PATH ?? ''}/`]) {
  try { ({ chromium } = createRequire(base)('playwright')); break; } catch { /* try next */ }
}
if (!chromium) { console.error('Playwright not found. Install it (npm i -D playwright) or provide a global install.'); process.exit(2); }

const PORT = 4173, BASE = `http://127.0.0.1:${PORT}`, OUT = process.env.QA_OUT ?? 'qa-output';
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);
for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* waiting */ } await new Promise((r) => setTimeout(r, 200)); }

const routes = ['/city', '/companies', '/commodities', '/stocks', '/portfolio', '/prestige', '/wallet'];
const viewports = [{ name: 'mobile-390', width: 390, height: 844, mobile: true }, { name: 'tablet-768', width: 768, height: 1024, mobile: false }, { name: 'desktop-1440', width: 1440, height: 900, mobile: false }];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch();
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
      if (route === '/city' || route === '/commodities' || route === '/wallet') await page.screenshot({ path: `${OUT}/${vp.name}${route.replace('/', '-')}.png` });
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
    const insp = page.getByRole('article', { name: 'Mad Slices' });
    await insp.waitFor({ timeout: 4000 }).catch(() => {});
    check(`${vp.name} city: clicking the building opens its company panel`, await insp.isVisible(), 'Mad Slices');
    if (await insp.isVisible()) {
      for (const t of ['Pizza restaurant · Level 2', 'Your company', 'Operating', 'Owner:', 'Revenue / day']) check(`${vp.name} city: panel shows "${t}"`, (await insp.getByText(t, { exact: false }).count()) > 0);
      await page.screenshot({ path: `${OUT}/${vp.name}-city-selected.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    // management link
    if (!vp.mobile) {
      await page.mouse.click(cx, cy); await page.getByRole('link', { name: 'Manage company' }).first().click();
      await page.waitForURL(/\/companies\?company=co-mad-slices/);
      check(`${vp.name} city: "Manage company" opens the company-management view`, await page.getByRole('tab', { name: 'Operations' }).waitFor({ timeout: 4000 }).then(() => true, () => false));
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
    // accessible list alternative
    if (vp.width >= 1200) check(`${vp.name} city: accessible business list is present`, await page.getByRole('list', { name: 'Businesses in Bristol' }).isVisible());
    else {
      await page.getByRole('button', { name: /Businesses \(6\)/ }).click();
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
      await page.waitForURL(/\/stocks/); check(`${vp.name} nav: sidebar/rail navigates`, await page.getByRole('heading', { name: 'Stock Exchange', level: 1 }).waitFor({ timeout: 4000 }).then(() => true, () => false));
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
  await page.goto(BASE + '/companies?fixture=error', { waitUntil: 'networkidle' });
  check('error state renders with retry', await page.getByRole('button', { name: 'Try again' }).isVisible());
  await page.goto(BASE + '/companies?fixture=empty', { waitUntil: 'networkidle' });
  check('empty state renders with next action', await page.getByText("You don't own a company yet").isVisible());
  await page.goto(BASE + '/wallet?fixture=slow');
  check('loading skeleton shows while data is pending', await page.getByRole('status', { name: /Loading Wallet/ }).first().waitFor({ timeout: 2000 }).then(() => true, () => false));
  await ctx.close();
} finally { await browser.close(); stop(); }

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length ? 1 : 0);
