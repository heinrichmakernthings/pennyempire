# Combined playable alpha — 29 October 2026

This release candidate combines `release/private-alpha-v01` at `21a2ffb1812773b26514a14c4c407b23e622119a` with `art/phase10-playable-alpha-polish` at `5af35e3df3bce26440475a25d606f782415236b8`. Both histories are preserved as merge parents. It includes the backend stack already in the alpha and the existing Phase 1–8 art, Phase 10 presentation, city actors and destination previews. No competing economy, ledger or payment model was introduced.

## Integration and repairs

- Resolved the prestige conflict in favour of server-authoritative purchases, collection, resale, boosts and rankings. Moved the approved executive-office preview into the illustrative prestige screen; it is not a purchasable entitlement.
- Retained all 15 navigation sections, including Beyond Bristol's explicitly unfinished expansion previews. Updated navigation regression coverage.
- First-time city visitors see their actual capital and one clear opportunity action. After founding, the real server checklist and manage-company shortcut appear. The checklist refreshes on navigation rather than showing stale instructions for 15 seconds. Hide-onboarding preferences apply to the introductory guide too.
- Retained Phase 10 real-data company briefing, approved worker portraits, supplier shortcuts, contextual help, share search, accessible meters, city controls and frame-correct icons.
- Health failures show recovery rather than automatically entering fixtures. An illustrative preview requires an explicit choice. Session errors and malformed responses keep the private game closed and offer retry; only an explicit server response can enable local account-free mode.
- Account requests have bounded network waits and useful connection errors. Failed logout no longer claims the server session was revoked; the account screen offers an actionable error. No automatic retry of financial writes was added.
- Notifications no longer request a private feed in account-free local mode. This fixed the only console error in the initial expanded responsive pass.

## Final verification

| Check | Result | Evidence |
|---|---|---|
| Unit/integration | 525/525, 48 files | [tests](results/tests.txt) |
| Production build/typecheck | Pass; entry bundle about 739 kB / 145 kB gzip | [build](results/build.txt) |
| Art validation | Pass | [art](results/art.txt) |
| 360 simulated days | Ledger reconciles; supply changes match issuance minus destruction every tick | [simulation](results/sim.txt) |
| Responsive/navigation/state checks | 169/169; 390, 768, 1440 px; all 15 routes | [browser](results/browser.txt) |
| Invited multiplayer + outage recovery | 23/23 | [alpha](results/alpha.txt) |
| First-company UI journey | 27/27 | [company](results/company.txt) |
| Commodity settlement | 21/21 | [exchange](results/exchange.txt) |
| Stocks/dividends/portfolio | 20/20 | [stocks](results/stock.txt) |
| Living city/news | 15/15 | [living](results/living.txt) |
| State companies/policy | 15/15 | [state](results/state.txt) |
| Prestige/rewards/simulated wallet | 18/18 | [wallet](results/wallet.txt) |
| Cloudflare Worker packaging | Dry-run passes; no upload | [Worker build](results/worker-build.txt) |
| Local Cloudflare workerd + DO SQLite | 14/14: auth, two accounts, company settlement, ownership, CSRF, disabled dev writes, logout | [Worker smoke](results/worker-smoke.txt) |

Browser totals: **308/308**. The initial pass exposed the notification request and stale onboarding; final runs above include the fixes. The explicit-preview test initially checked visibility before navigation completed; it now waits for the labelled preview to load. Screenshots were inspected in an initial and a final confirmation pass. No production database or billing settings were touched.

The 360-day check establishes accounting consistency, not economic balance or long-term fun: several companies become insolvent in that scenario. Desktop remains primary. Browser testing used Chromium; Safari, Firefox and real-device performance are not certified. Vite still warns about the large initial JS chunk.

## Screenshots

- [Sign in](screenshots/alpha-1-signin.png), [city after founding](screenshots/alpha-2b-first-company.png), [company management](screenshots/journey-3-dashboard.png)
- [Suppliers](screenshots/exchange-2-procure.png), [portfolio](screenshots/stock-5-portfolio.png), [state economy](screenshots/state-5-economy.png)
- [Owned prestige](screenshots/wallet-2-collection.png), [simulated wallet](screenshots/wallet-7-wallet.png)
- [Mobile city](screenshots/mobile-390-city.png), [mobile shares](screenshots/mobile-390-stocks.png), [mobile prestige](screenshots/mobile-390-prestige.png), [mobile account](screenshots/alpha-7-account-mobile.png)
- [Connection recovery](screenshots/combined-outage.png)

## Reproduce

Run `npm ci`, `npm run build`, `npm test`, `npm run art:validate`, and `npm run sim -- 360`. In this sandbox the tsx CLI's IPC socket is restricted; the equivalent `node --import tsx server/cli.ts sim 360` passed.

With Playwright and Chromium installed, run `npm run qa:browser` and the scripts in `scripts/qa/{alpha,company,exchange,stock,living,state,wallet}-journey.mjs`. They create disposable local databases and clean up their servers. Set `QA_CHROMIUM_PATH` only when a custom Chromium binary is needed. Captures go to `QA_OUT` (default `qa-output`).

For the Worker smoke, create a disposable local `.dev.vars` containing an `ADMIN_TOKEN` of at least 12 characters, start `wrangler dev --local --ip 127.0.0.1 --port 8798 --persist-to <temporary-directory>`, then run `node scripts/qa/worker-smoke.mjs`. Use a fresh database for each run. The harness refuses non-loopback URLs; do not use production credentials. Local workerd testing used Wrangler 4.155.0.

## Remaining release dependencies

1. Production Cloudflare health was failing with 1101 in the preceding audit; prior runtime evidence identified a free-tier row-write limit. Confirm capacity and recovery before deployment. This merge does not fix an exhausted cloud quota.
2. The build trigger watches the old deployment branch. Configure the approved combined commit, secure admin bootstrap and a separate staging world before a production rollout. See [deployment gates](../DEPLOYMENT.md).
3. Bristol still has only ten rentable plots. Existing stress evidence shows this blocks most of a 100-player cohort. Map/capacity expansion requires engine coordination.
4. Default pacing remains one game day per real minute, with at most 48 catch-up days. Assess business survival and idle progression in a staged playtest before broad invites; the financial rules were preserved here.
5. Advanced staff progression, international expansion and executive interiors remain previews/dependencies, not fabricated working gameplay.

This is a tested combined candidate ready for review. It is not a claim that the currently deployed Cloudflare game is healthy or that all long-term gameplay balance is finished.
