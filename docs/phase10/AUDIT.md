# Phase 10 — playable alpha audit and delivery

Audit date: 29 October 2026. Branch: `art/phase10-playable-alpha-polish`.

## Scope and evidence

Read `README.md`, `AGENTS.md`, frontend/architecture/visual-brief, company-management, commodities and stock-exchange documentation; inspected art manifests, Canvas2D renderer, routing, data adapters and current Claude PRs. The root contains no `PRODUCT.md` or `DESIGN.md`.

`main` (`803e0be`) is the art foundation, not the complete playable client. The deployed application is `deploy/cloudflare-test-link` (`5477ac7`, including merged PR #24). This branch starts there and targets that branch for review. It does not merge the backend stack or change deployment settings.

The public [Bristol preview](https://pennyempire.samuel1heinrich.workers.dev/city) loaded, but its API was unavailable. Cloudflare diagnostics identified **Exceeded allowed rows written in Durable Objects free tier**; the browser displayed fallback fixtures and a raw JSON parsing error. This is a P0 operational blocker. No production gameplay success is claimed. Before-live screenshots show this illustrative state. The production database was not reset and billing was not changed.

Local browser tests use fresh disposable SQLite databases and the real server, not fabricated financial results. Test clocks run faster than production. They prove local mechanics and UI behavior, not private multiplayer readiness or human enjoyment. See [QA](QA.md), [screenshots](SCREENSHOTS.md) and [Claude handoff](CLAUDE-HANDOFF.md).

## Classification

| Category | Evidence and disposition |
| --- | --- |
| Working and integrated, locally tested | Company creation and itemised startup bill; saved pricing; ingredient procurement; automatic production/sales; wages, rent and daily results; upgrades; city selection/pan/zoom; NPC rivalry; supplier orders/contracts; fictional-share trades, IPO/dividends and portfolio; recorded economic news. Browser journeys exercise these against the server. |
| Implemented but visually incomplete | Dense multi-tab management, overly technical fallback, thin onboarding, compressed animation-strip UI icons, missing share-column spacing and small-screen forecast overflow. Repaired in this branch. City art remains a mixture of approved historical packs with imperfect scale consistency. |
| Available in GitHub but not integrated everywhere | Six Phase 8 worker sprites are now reused in management. Phase 5 luxury and institution artwork exists, while the deployed prestige fixture still labels several goods “Artwork pending.” PR #23 owns the authoritative luxury catalogue/ownership integration; do not duplicate it. Beyond Bristol and the executive office are cosmetic previews, not playable locations/interiors. |
| Broken | Public API quota failure; stock layout references an undefined spacing token; four-frame SVG strips rendered as entire strips; capacity meter hid overcommitment; forecast table could overflow mobile. The latter four are fixed. API quota is not a frontend fix. |
| Missing | Validated private multiplayer onboarding/authentication in this deployed branch; individual staff experience/achievement records; long-term human playtest evidence; measured low-end-device FPS/memory budgets; playable overseas cities. No client-side substitutes added. |
| Blocked by Claude/integration | State service/event presentation from #19; persistent luxury placement, rewards, deposits/withdrawals and transaction views from #23; forthcoming multiplayer engine/database integration. These branches were inspected, not promoted or advertised as tested here. |

## Prioritised findings and implemented changes

| Priority | Problem and player consequence | Resolution |
| --- | --- | --- |
| P0 | Live API is unavailable; users can explore examples but cannot play their own economy. | Clear preview explanation, honest non-saving warning and reconnect action. Server-connected screens awaiting integration are distinguished from connection failure. Quota recovery remains deployment-owner work. |
| P1 | A new player arrives in Bristol without a clear first action or funding explanation. | Real starting cash, a prominent opportunity link and four short trading-day steps. Existing owners get a direct management shortcut. No hardcoded starting wealth or tutorial modal. |
| P1 | Opportunity discovery begins with a wide market table before the business choices. | Ranked opportunities appear first, preserving FORECAST/risk labels and the detailed market-gap table below. Small-screen forecast breakdown scrolls within its card. |
| P1 | Management facts do not clearly answer “what should I do next?” | A business briefing shows company cash, actual daily profit/revenue/expenses, latest production, ingredient shortages, staffing and next-action links. Recommendations use current API facts and never invent profit or demand. |
| P1 | Production target can exceed capacity while the meter displays a reassuring capped percentage. | Visible percentage preserves overcommitment; accessible meter stays within its declared range. Effective output capacity uses batches × output per batch. |
| P1 | Industry/status symbols look like tiny repeated dashes. | Render the first frame of 27 existing four-frame SVG strips. Source files remain intact; runtime usage is recorded in the Phase 10 manifest. |
| P1 | Shares layout has no column gutter and dense listings lack discovery. | Restore spacing with an existing token, add name/ticker search with an honest empty state, and a short financial guide. |
| P2 | Staff appears as numbers alone. | Reuse approved industry worker sprites beside real staffing facts. Explicitly say individual staff XP is not tracked here. |
| P2 | Marketing and unfamiliar metrics are hard to interpret on touch/keyboard. | Accessible toggle help, Escape dismissal, clearer pricing/quality/marketing guidance and existing server awareness/spend values. |
| P2 | Camera can be lost after panning; hover labels can clip. | Recentre button and Home key; clamp hover-label position. Keep the existing renderer, snapping zoom and selection system. |
| P2 | Shortage → procurement lacks settlement clarity. | Explain company cash, immediate fills into inventory and pending limit orders in the supplier sheet. Existing supplier/trade/contract authority is preserved. |
| P2 | Fixture mode issues unnecessary management/opportunity/activity requests. | Disable those queries until the source is authoritative; hide raw startup-probe errors behind useful connection copy. |

## First five minutes

The local fresh-player journey covers Bristol → real starting cash → opportunity → site and itemised bill → company dashboard → buy supplies → change price → automatic production/sales → daily results → upgrade. The automated first meaningful navigation completes within 60 seconds. This is an automation timing check, not a claim about novice human completion time.

Production and normal sales remain automatic. No repeated collection clicks, artificial payout minigames, fabricated market forecasts or extra financial model were introduced. The briefing explains the separation between personal coins and working capital. Shortage and profitability feedback now sits before the detailed management tables.

## City and art review

The existing isometric renderer already provides roads/pavements, district plots, building depth ordering, selectable companies, ownership panels, keyboard movement, zoom and an accessible company list. Local checks confirm rendering, selection, dragging without accidental selection and mobile list access. Existing workers, pedestrians, deliveries, state markers and harbour ship remain in use. A new renderer would create unnecessary integration risk.

Native pixel scaling and transparent sprites are retained. Six reused worker portraits are decorative representations of each industry, not named employee records. Four-frame UI-strip rendering was a critical integration error, repaired without generating or modifying artwork. `assets/art/phase10/integration.json` records exact sources and usages. No new asset pack was generated. Historical manifests include approval-pending/non-certified entries; this phase does not relabel them as production-certified.

Remaining city issues: some asset proportions and stylistic density vary between packs; business identity mainly relies on selection and the directory, rather than always-visible owner labels; preview locations are not economic districts. These require a selected art target and/or Claude's integration model before broader changes.

## Financial interfaces, news and progression

Commodity procurement, orders, reservations, fees, inventory and contracts use existing authoritative endpoints. No settlement, ledger, pricing or simulation rules changed. The guide explains immediate settlement without promising a visual delivery for every trade.

Shares use fictional companies and EC. The new guide separates spendable cash, valuation, realised/unrealised gains, dividends and unfilled orders. Existing financial charts and ownership/history remain connected to server data; the stock journey tests actual settlements and reconciliation. Simulated GBP is never described as investment proceeds or withdrawable EC.

The deployed GBP wallet and prestige catalogue remain illustrative. The wallet retains SIMULATED labelling and its test £5 withdrawal threshold; a persistent warning now makes the lack of saved transactions explicit. Actual withdrawal/deposit/reward-history behavior on PR #23 was reviewed in source, not tested or enabled here. No actual payment provider or wagering was added.

The Penny Post already reads stored opening, shortage, title and exchange events; local checks verify recorded stories and their presentation. Its tab identity is consistent with the terminal, but a stronger newspaper masthead remains a small follow-up on Claude's active `BristolScreen.tsx`. No synthetic headlines were added. State-company names/services and energy/interest/boom/recession notifications depend on PR #19; no duplicate event system was built.

Luxury assets should appear after purchase through PR #23's ownership/placement data. Until integrated, current city props and office previews do not imply that a purchase was saved. No prestige spending loop is claimed complete.

## Responsive/accessibility and performance

Desktop 1440×900, tablet 768×1024 and mobile 390×844 are covered by browser checks. Tests cover layout overflow, ≥44px controls, sheets, navigation, canvas controls and loading/error/empty states. Contextual help is keyboard/touch accessible and active tabs scroll into view. Forecast tables scroll inside their containers. Colour is accompanied by labels/signs; existing contrast tokens are retained. No screen-reader usability study was performed.

The existing shared atlas cache and requestAnimationFrame renderer are preserved. Added worker images are lazy-loaded, reuse existing URLs and have explicit dimensions. Fixture-only API traffic is reduced. The build still reports an approximately 725 kB uncompressed entry chunk (roughly 141 kB gzip); there is substantial manifest/import weight. No low-end-device FPS or memory claim is made. Route-specific manifest splitting should be profiled after Claude's branch consolidation, rather than rewriting shared art loading now.

## Commercial gameplay assessment

The strongest return motive is revisiting meaningful business outcomes: shortages create supplier opportunities, rivals affect market share, and upgrades change actual capacity. The new briefing makes those consequences easier to see. Ordinary production needs no maintenance clicking. Forecasts, realised results and costs remain distinguishable.

Progression is still difficult to judge without a longer human session. Local tests show that companies can trade and expand, not that the economy is balanced or entertaining for weeks. Staff personality is thin; prestige desirability cannot be validated while ownership/placement remains pending; multiplayer competition needs actual concurrent players. Next playtest should observe whether a new player can explain a loss, source a missing input and identify an attractive next investment without developer guidance. Do not substitute streaks, manufactured scarcity or loss-chasing rewards for this work.

## Delivery boundary

This is a tested frontend polish increment with audit evidence and integration dependencies. It is not a declaration that every Phase 10 success criterion is live: production availability, private multiplayer and the pending backend-backed wallet/prestige/state experience remain blockers. Review and integrate this PR with Claude before publishing it.
