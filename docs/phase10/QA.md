# Phase 10 validation

29 October 2026. Tested against the real local economic engine on fresh disposable SQLite databases. Public Cloudflare gameplay remains blocked by its write quota. No production transactions or database resets were performed.

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript | Pass | [log](results/typecheck.txt) |
| Full unit/integration suite | 393/393, 37 files | [log](results/unit-tests.txt) |
| Phase 10 focused checks | 7/7 | [log](results/phase10-tests.txt) |
| 360-day simulation | Pass; no accounting anomalies, ledger reconciles | [log](results/simulation-360.txt) |
| Production build | Pass; existing large-chunk warning remains | [log](results/build.txt) |
| Base art validation | Pass: 41 unique frame bounds and all referenced sources | [log](results/art-validation.txt) |
| Phase 10 asset references | All 27 strip sources and 6 worker sources exist | [manifest](../../assets/art/phase10/integration.json) |
| Responsive browser acceptance | 139/139 | [log](results/browser-check.txt) |
| First-company journey | 27/27 | [log](results/company-journey.txt) |
| Commodity trading/contracts | 21/21 | [log](results/exchange-journey.txt) |
| Fictional shares, IPO, dividends, portfolio | 20/20 | [log](results/stock-journey.txt) |
| Living economy, NPCs, recorded news | 15/15 | [log](results/living-journey.txt) |

The browser suite covers 1440×900 desktop, 768×1024 tablet and 390×844 mobile, ten routes, touch targets, no page-level horizontal overflow, canvas art, selection, camera controls, accessible lists, navigation, data states and persisted management. Tables may scroll within their own regions. The expanded stock checks test empty search results and clearing the query. Company QA exercises opening a café, the exact server startup debit, procurement, saved price changes, automatic sales/costs and an upgrade. All currency figures in these runs originate in the test engine.

Baseline: 116/118 browser checks. Both failures expected the obsolete heading “Stock Exchange” rather than the actual server screen “Penny Exchange.” During implementation the expanded checks caught a mobile forecast overflow; visual review also caught the absent share gutter and SVG-strip rendering. Those were repaired and the final suite passed. The living journey previously assumed at least eight companies; it now verifies every actual non-state directory company has an activity entry, matching the API contract. Search assertions wait for the rendered list, rather than sampling React state immediately after clearing.

## Reproduction

Run `npm ci`, `npm run typecheck`, `npm test`, `npm run art:validate`, `npm run sim -- 360`, `npm run build`. With Playwright/Chromium available:

```sh
npm run qa:browser
node scripts/qa/company-journey.mjs
node scripts/qa/exchange-journey.mjs
node scripts/qa/stock-journey.mjs
node scripts/qa/living-journey.mjs
```

The `tsx` CLI IPC socket was unavailable in this workspace, so the equivalent `node --import tsx server/cli.ts sim 360` ran successfully.

The scripts start their own servers and isolated databases. Run journeys sequentially for reliable screenshots. `QA_OUT` selects the screenshot directory. Browser/company/living scripts accept optional `QA_CHROMIUM_PATH` for a preinstalled headless binary; the default remains normal Playwright Chromium. In this workspace, the regular browser download failed, so a registry-provided headless Chromium was used, with software rendering. Commodity/share runs used temporary copies with that executable override only; those copies are not committed.

Final screenshots were visually inspected for city/onboarding, company briefing, worker scaling, corrected stock spacing/icons and mobile layout. No console warnings/errors or failed requests appeared in the final responsive run. This is not a certification of physical-device performance, screen-reader usability, multiplayer concurrency, or pending PR #19/#23 behavior. The entry bundle is 725.06 kB (140.64 kB gzip); cache/cold-load and memory profiling on representative devices remains outstanding.
