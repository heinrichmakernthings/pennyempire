# Claude Code handoff — company management and marketplace

## What to integrate

Start with the runnable visual reference at `tools/company-marketplace/index.html` and screenshots in `docs/art/phase4/qa`. This is a frontend-only design/interaction harness, not a replacement game or a live API client. It imports the existing design tokens, draws approved building frames at their logical dimensions, reuses Phase 3 commodity PNGs, and renders charts, depth, tables, labels and supply-chain nodes from code. Four new SVG icons and twelve aliases are indexed in `assets/art/phase4/manifest.json`.

Inspect `SCREEN-SPECIFICATIONS.md` and `COMPONENTS-AND-STATES.md` for exact journey/state requirements. `view-models.d.ts` contains frontend proposal shapes, clearly separate from the existing wire contract. Extend existing React components in Claude’s frontend rather than copying the prototype’s global shell styles wholesale. The fixture stylesheet includes shell/body rules; transplant only component rules into appropriately scoped app styles.

## Repository boundaries and evidence

Phase 4 is based on remote `art/phase3-economic-gameplay`, commit d20c54a2b4a289a7fa48ecfe8e663b535eac1c8f. Read-only engine inspection: `feature/economic-engine`, commit e62eecebb2ab295f39dbb4a7d5fb6bbb2550c615. Sources inspected: `docs/ECONOMIC-ENGINE.md`, `server/api/router.ts`, `server/api/dto.ts`, `server/engine/commands.ts`, `server/seed/bristol.ts`, `src/contracts/game-state.ts`, existing CompaniesScreen and committed engine screenshots.

No files under `src/`, `server/`, migrations, engine config, root package files or Claude’s branch are changed by Phase 4. The PR is stacked on the art branch. Do not replace Claude’s application tree with the art branch’s older app snapshot; bring in the reviewed additive art/tools/docs commits or paths after resolving the art stack.

## Current engine versus proposed capability

| System | Evidence / supported now | Integration requirement |
|---|---|---|
| Company settings | `company.configure`; price, employees, quality, plannedUnitsPerTick, marketingMinorPerTick; revision validation | Keep a local draft; save once with expectedRevision/idempotencyKey; refresh relevant screen/company |
| Company money | Company treasury separate from player coins; server supports fund/withdraw/reopen | Display available treasury, not global player balance. Engine operations must validate owner and permissions |
| Company startup | Contract has `company.create`, but router returns501 UNAVAILABLE; non-commodity quotes unavailable | New quote/eligibility/cost/defaults/atomic-create endpoint needed. Keep actions capability-gated until implemented |
| Upgrades | Contract has upgrade metadata/command; execution currently501 | Quote, requirements, downtime, resultant asset and atomic upgrade needed |
| Limit orders | Current quotes, `commodity.order`, `order.cancel`, price-time matching, partial fills and reservations | Reuse server flow. Quote expiry currently aligns with next simulation tick. `quote.total` describes currently executable value, not necessarily full reserved value |
| Fee | Seller-paid1% fee in inspected engine; buyer fee0; fee is a sink | Render returned quote fee. Do not hard-code the fixture calculator as game economics. Fee policy needs explicit server metadata if configurable |
| Full reservation | Buyer reserves quantity×limit; seller reserves whole requested stock | Display the full commitment separately from executable quote subtotal. Server remains authority for available funds/reservations |
| Protected market order | Internal NPC IOC exists; player API only exposes limit-price order terms | Add explicit kind/time-in-force and protection semantics. Never label a resting limit order as Market |
| Order depth | Order DTOs exist and can aggregate by price/side | Confirm pagination completeness. If incomplete, label visible depth; ask server for aggregated full book. Do not fabricate a full-depth chart |
| Supplier profile | Owner identity exists; richer supplier/delivery metadata absent | Populate verified fields only; unknown metrics remain unavailable |
| Recurring contracts | Not implemented | Bilateral offer/accept, price caps, cadence, funding policy, failure/termination/renewal semantics and atomic recurring settlement required |
| Transit | Current settlement transfers goods atomically | Hide shipment timing until real logistics exist; no animation delays on usable inventory |
| Ownership | Owner/share metadata in DTO, no player share trading | Read-only table until permissioned investment capabilities exist |

The current engine is a single demo-player foundation without production authentication. Do not enable player-to-player actions in public deployment from this UI pack alone; Claude’s engine work must supply authenticated per-player isolation and permissions.

## Recommended Prompts 3–5 integration order

This is a suggested work partition, not a claim about unseen prompt text.

1. **Prompt 3: creation and management.** Keep existing shell and responsive breakpoints. Add StartupWizard, OpportunityList, PremisesPicker and StartupQuoteReview. Bind authoritative per-industry defaults and plot compatibility. Extend CompaniesScreen tabs using CompanyOverview, OperationsDraftForm, InventorySummary, UpgradeReview and OwnershipTable. Reuse existing FinancialChart/OperatingStatement. Test creation quote expiry, plot contention, duplicate submit, insufficient funds and name errors.
2. **Prompt 4: player exchange.** Extend CommodityScreen/TradeTicket, add BookDepthTable, SupplierProfile and OrderStatusRow. Implement limit quote→review→commit, partial fills and cancel-remainder. Preserve drafts while live data refreshes. Quote signature binds company, commodity, side, quantity and price. Add protected market orders only after backend support.
3. **Prompt 5: supply chain and advanced management.** Render SupplyChainNode/Connection from recipes/inventory and actual supplier links; show cheese as pizza’s second dependency. Add contracts, upgrades and logistics only behind explicit enabled capabilities. Advanced forms expand on demand; they never block casual first production.

## Field mapping

- Creation: current `City.demand`, `Plot`, `Industry`, `Recipe`; proposed eligibility/startup quote/result in `view-models.d.ts`. City demand’s latest completed period must be labelled. The current seeded map has only limited ready plots; do not expose fixture addresses as real purchasable inventory.
- Overview: `Company.dailyRevenue`, `dailyProfit`, `cash`, status, profit/revenue/expense histories. Expanded costs: `/api/companies/:id/financials` operating statement. Cash may include reserved money; add or resolve authoritative available treasury rather than assuming total cash is spendable.
- Operations: `employees/maxEmployees`, `price/minPrice/maxPrice`, `quality`, `capacityPerTick`, `plannedUnitsPerTick`, `marketingPerTick`; `Recipe.inputs` and energy. `durationSeconds` describes game time, not necessarily wall-clock tick frequency.
- Inventory: `availableUnits`, `reservedUnits`, `estimatedHoursRemaining`; `capacityUnits` repeats shared company cap in the current DTO. Sum occupied units, not capacities. Unknown coverage is not zero.
- Trading: `Commodity`, `Order`, `Trade`, `Quote`; server response for placement includes actual filled/remaining data beyond the older base CommandResult shape. Refresh own orders/history after command instead of inventing fills from local depth. Existing commodity `cafe-drink` maps to Phase 3 icon `commodity-coffee-drinks`.
- Ownership: `Company.ownership`, `owner`, `permissions`; percentage = ownershipBps/100. No inferred manage permission from share percentage alone.

## Production acceptance criteria

- Users can complete the first-company journey using keyboard or touch without opening advanced panels. Test the under-five-minute target with new players; automation alone cannot verify it.
- Price/quantity/funds labels distinguish player versus company, available versus reserved, in-game day versus real time, and execution estimate versus reservation.
- All money arithmetic is integer minor units. UI validates basic input; server validates every rule and settles atomically. Actual values cannot be copied from design fixtures.
- Save, create, upgrade, trade and cancel require stable idempotency keys; retries reuse keys until definitive outcome. Timeout recovery reconciles state instead of submitting a fresh transaction.
- Partial fill/cancel races, stale revision, quote expiry, unavailable capability, forbidden company and empty/unknown histories have the specified recovery states.
- No page-level horizontal scrolling at360/390/768/1199/1440. Essential data remains14px or larger; controls44px; dialog focus/escape/return works; charts have tables and no interpolated missing data.
- Building frames, source art and token files remain unchanged. Reused icons are references, not duplicate generated illustrations. No new economic text is baked into raster art.

## Run the reference and checks

```sh
python -m http.server 8876
# Open http://localhost:8876/tools/company-marketplace/
node tools/company-marketplace/components.test.mjs
node tools/company-marketplace/qa.mjs
```

QA requires Playwright plus an installed Chromium. Set `CHROMIUM_PATH` if using a custom executable and `NODE_PATH` for shared dependencies. The QA script starts its own ephemeral localhost server; it does not contact the engine or a deployed service. Browser dependencies used for review were installed outside the repository and are not new application dependencies.
