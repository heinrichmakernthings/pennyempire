# Phase 5 implementation handoff

This is an isolated art and interactive interface reference, extending Phase 4. It does not implement the economic engine. Serve the repository root and open `/tools/markets-prestige/`. Every value in `data.js` is illustrative. Refresh resets preview purchases. Do not import that fixture file into production.

## Files and components

- `assets/art/phase5/runtime/*.png`: individual transparent sprites; `manifest.json` supplies logical dimensions, source frame, bottom-centre pivot, footprint, usage and provenance.
- `tools/markets-prestige/app.js`: framework-independent reference for ExchangeDirectory, IssuerProfile, PriceHistory, ShareOrderTicket, QuoteReview, OwnershipTable, DividendHistory, StateServicePanel, PrestigeCatalogue, PrestigePreview, PlacementSelector, CollectionControls, PortfolioAllocation, FinancialNewsStory.
- `styles.css`: responsive extension of the existing tokens and Phase 4 controls; no competing design system.
- `data.js`: realistic fixtures covering six state institutions, four issuer profiles, fourteen catalogue records (two unavailable) and nine news types.
- `export-assets.mjs`: deterministic Canvas export, individual crops and contact sheets. `city-composition.mjs` uses the existing renderer. No backend file is changed.

## Integration order

1. Merge/rebase the preceding art branches after review. This PR is stacked on Phase 4 to preserve the exact approved art baseline.
2. Register Phase 5 manifest IDs. Cache decoded PNGs; use the existing renderer and manifest pivots. No CSS stretch, perspective transform or smoothing on city sprites.
3. Implement read-only state-service, prestige catalogue and financial news components. Map existing engine state IDs exactly; hide unsupported actions.
4. Bind issuer/portfolio views to typed server snapshots. Treat absence, loading, stale, halted and unavailable values explicitly. Never replace absent values with zero.
5. Add order and purchase interactions only after server capabilities exist. Quotes, eligibility, ownership, execution, fees, reservations and dividends remain authoritative server operations.
6. Verify mobile/keyboard, quote invalidation and double-count protection before enabling live interactions.

## Data contract (proposed view model, not existing endpoints)

Money uses safe integer minor EC units, 100 minor = 1 EC. Share quantities are whole integers for this phase. `currency: "EC"` is mandatory. GBP_TEST is a separate wallet domain and must never enter these totals. All snapshots include `asOfTick`, `version`, `status` and city ID. Prices, fees and availability are server values; fixtures do not establish rules.

| Screen/component | Required authoritative fields |
|---|---|
| Directory/profile | companyId, cityId, displayName, ticker nullable, industryId, assetId, listingStatus (unlisted/open/halted/delisted), sharePriceMinor nullable, sharesOutstanding, changeBps, quoteAsOfTick |
| Price history | period, points[{tick,priceMinor nullable}], currency, adjustmentBasis; null breaks a path, never interpolates missing data |
| Financial report | companyId, reportId, periodStartTick, periodEndTick, revenueMinor, expensesMinor, operatingProfitMinor, netProfitMinor nullable, debtMinor nullable, cashMinor, reportStatus; calculate market cap only from same-snapshot price × outstanding shares |
| Order book | companyId, sequence, asOfTick, bids/asks[{priceMinor,remainingShares}], marketStatus; aggregate by price and calculate cumulative depth independently on each side |
| Share ticket | ownerId, availableCashMinor, heldShares, reservedShares, capabilities, permittedOrderTypes, min/maxQuantity; draft side/type/quantity/limitPriceMinor |
| Quote review | quoteId, companyId, side, type, quantity, limitPriceMinor or maximumSpendMinor, notionalMinor, feeMinor, totalReservationMinor/netProceedsMinor, expiresAt, quoteVersion, warningCodes; no inferred fee percentage |
| Execution/order lifecycle | idempotencyKey, orderId, status (pending/open/partial/filled/cancelled/rejected), originalShares, filledShares, remainingShares, fills[{priceMinor,shares,feeMinor,tick}], reservationMinor, rejectionCode; acknowledgement is not a fill |
| Ownership | sharesOutstanding, positions[{ownerId,displayName,shares}], freeFloatShares; disclose partial visibility; never fabricate named investors |
| Dividends | corporateActionId, companyId, amountPerShareMinor, declarationTick, recordTick, paymentTick, status, eligibleShares, cashPaidMinor; declared amount is not available cash |
| State services | serviceId, companyId nullable, assetId, serviceType, capabilityStatus, tariffVersion nullable, effectiveTick, billingBasis, helpText; mappings below |
| Prestige catalogue | itemId, displayName, assetId nullable, category, rarity, priceMinor nullable, prestigePoints, purchaseAvailability, allowedPlacementTypes, colourOptions[], perks[] |
| Prestige ownership | instanceId, ownerId, itemId, purchasedAtTick, acquisitionCostMinor, placement{cityId,plotId,anchor,orientation}, nameplateText, nameplateColour, activePerks[{id,expiresAtTick,effectDescription}] |
| Purchase quote | quoteId, itemId, placementId, availabilityVersion, priceMinor, feesMinor, totalMinor, expiresAt; submit idempotencyKey; revalidate occupancy, funds and eligibility atomically |
| Portfolio | cashAvailableMinor, cashReservedMinor, privateStakes[{companyId,ownershipBps,attributableValuationMinor,valuationBasis,asOfTick}], publicPositions[{companyId,shares,marketValueMinor}], realised/unrealisedPnlMinor, historicalSnapshots[], dividendCashPaidMinor, prestigeInstanceIds |
| News | eventId, type, title, bodyTokens, companyId nullable, cityId, occurredAtTick, effectiveAtTick nullable, severity, action{label,targetId,route}, readAt nullable; escape all dynamic strings |

Portfolio counts cash once (available + reserved for economic worth), each private stake once, and public positions once. The reference has no cash reservation; its private company is not also listed. Prestige uses acquisition cost for collection history only, not assumed resale value. Historical portfolio values are independent snapshots and do not rewrite after a preview purchase. No payout, perk, price appreciation or liquidation recovery is promised.

## Engine boundaries

Audited engine commit: `e62eecebb2ab295f39dbb4a7d5fb6bbb2550c615`. Energy maps to `co-bristol-energy`, Central Property to `co-bristol-estates`, Penny Ads to `co-bristol-media`. Payments to these accounts are transfers. Current commodity trading fees are destroyed; do not book them as Penny Exchange revenue. Current commodity delivery is atomic; do not infer in-transit ownership from a decorative vehicle.

Dedicated logistics, banking products, player stock trading, IPOs, player dividends, prestige purchases, perks and placement ownership need engine work. State-company art does not make a state institution publicly tradable. No endpoints are invented in this handoff.

## Rendering and ownership

Keep projection `(column-row)*64, (column+row)*32`; tile is 128×64. Draw at `screenAnchor - pivot` with integer nearest-neighbour zoom. Bottom-centre is the southern ground contact anchor. Footprints reserve placement cells; no sprite alpha is used as collision geometry. Painter-sort by southern footprint extent, not image top. Vehicles are parked SW props only, not movement animations. No horizontal mirroring: it reverses lighting.

Reuse existing selection/ownership footprint geometry; selection is an amber outline and ownership a separate mint symbol/nameplate so colour is not the only cue. For 2×2/3×2 properties, derive the outline from occupied tile corners, not a stretched one-tile diamond. Use the same title/nameplate renderer for state and private assets. State institutions are not buyable through prestige.

Advertising surfaces are blank. At gameplay size use an optional 1–2 character monogram and a separate readable HTML nameplate, never tiny illegible company text. The reference demonstrates the nameplate, not baked branding. Approved body recolour masks and mapped facade UV quads are not supplied; do not recolour the whole sprite or claim those features complete.

## Acceptance criteria

- All referenced runtime files load with alpha and exact manifest dimensions; source art never ships as a scene texture.
- State institutions reuse approved pixels; branch bank is clearly smaller; vehicles/launch use existing scale.
- Financial values, charts, ownership, prices and news are DOM/SVG data-driven elements; chart table remains available to assistive technology.
- Buy/sell validates safe integers, unreserved shares, available cash including fees, listing status and fresh quotes. Disable duplicate submissions and use idempotency in production. Refresh snapshots after any rejection/conflict.
- Partial fill is distinct from acknowledgement; cancel only remaining quantity. Reserve/release cash or shares solely from server responses.
- Prestige purchase requires valid unoccupied placement and funds; failure preserves ownership/cash. Unavailable artwork has no purchase action.
- Mobile retains all actions, dialog focus/escape works, controls are at least 44px and essential text at least 14px. Reduced motion never hides state information.
- No backend, active Claude branch or existing approved asset is modified.

## Active Claude frontend compatibility

Final recheck found `feature/company-management` at `48494cb90bafce17e001dfaa5959c7a74b22f532`. It already contains `StocksScreen`, `PrestigeScreen`, `PortfolioScreen`, `DataTable`, `FinancialChart`, `MoneyValue`, `TradeTicket`, `ResponsiveSheet`, `ScreenData` and `src/assets/artAssets`/`useArtAtlas`. Extend those in Claude’s subsequent work; do not copy this standalone DOM app over them. Existing `Money { currency, minor }` remains the application convention. Adapt this reference’s `price`/`priceMinor` into `Listing.price.minor`, `name` into `companyName`, `shares` into `outstandingShares`, and preserve canonical listing IDs separately from company IDs. The proposal in `contracts.ts` describes additional view needs, not replacement production types.

Company creation/upgrades are implemented on the new company-management branch. The earlier economic-engine commit is retained as the audit anchor for its payment semantics, not as a claim that company management is still absent. Recheck branch capabilities when wiring financial actions. This art PR changes none of those active files.
