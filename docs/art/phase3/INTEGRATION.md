# Claude Code integration handoff

## Scope and branch order

Phase 3 is an additive art/presentation pack based on `art/phase2-living-bristol` at da1fee45a33c63f15762457bc4b34f29b4a65938. The frontend was inspected read-only at `origin/claude/keen-allen-axrbsr`, commit 38879cb. No backend files or economic rules were changed. Review/merge the art stack in dependency order, then integrate into Claude's frontend branch; do not overwrite its `src` files with this art branch's older frontend snapshot.

1. Load Phase 1, Phase 2 and Phase 3 manifests into the existing art loader (`src/assets/artAssets.ts` / `src/city/useArtAtlas.ts` on Claude's branch). IDs of new commodity exports are namespaced `commodity-*`; legacy IDs are unchanged.
2. Apply the explicit commodity mapping to `Commodity.iconAssetId`. Do not change commodity IDs or recipes just to match illustration filenames. Keep aliases in one adapter, after engine agreement.
3. Add `CommodityIcon` (48px native, 96px at 2×), `EconomicIcon` (24px currentColor SVG), `CompanyActivityBadge`, and `ProductionProgress`. Extend existing `StatusLabel`, `DataTable`, `TradeTicket`, `FinancialChart` and `NotificationRegion` rather than introducing parallel screen implementations. Existing charts continue to consume live history data.
4. Copy/adapt the pure helpers in `tools/economic-art/presentation.js`. Bind status/profit to existing fields, then add explicit authoritative signals for remaining activity states. Keep those signals in a frontend adapter; this art pack does not define a new backend protocol.
5. Add event cues only after the engine supplies stable event IDs and timestamps. Seed the event gate with historical IDs at initial load. Do not animate initial snapshots as new deliveries. Use synchronized server time and a bounded replay cache; the sample gate only deduplicates within its retained window. Remounts/reconnects must seed the cache again from the event cursor/history.
6. Place reused actors/vehicles through route/door/loading metadata, with normal world depth sorting. `market-activity.json` contains fixture staging offsets, not collision-safe city placements. Retain existing sprite pivots. Screen-space badges do not participate in world collision.
7. Run structural/presentation tests, review all contact sheets, then exercise the art in the real browser at 1×/2× zoom, desktop/mobile and reduced motion before merge.

## Data bindings: existing versus required

| Visual | Existing contract / missing signal | Rule |
|---|---|---|
| Commodity identity | `Commodity.id`, `iconAssetId`; `InventoryLine.commodityId`; `Recipe.inputs/output` | Resolve through explicit manifest mapping; show text fallback for unknown IDs |
| Inventory storage | `availableUnits`, `reservedUnits`, `capacityUnits` | Display available and reserved separately; storage occupancy is their sum if engine semantics confirm both are stored |
| Input requirements | `Company.recipeId` plus `Recipe.inputs`, `energyUnits` | Render engine recipe. Do not invent costs or required units |
| Production queue | Queue/job list and completed/total or authoritative start/end timestamps **missing** | Do not equate plannedUnitsPerTick to completed production; hide unknown progress |
| Producing normally | Actual production-active signal **missing** | `status: operating` alone is insufficient |
| Missing inputs | Blocking input IDs/reasons **missing** | Engine determines requirement/reservation semantics; show affected commodity icon and reason |
| Low inventory | `estimatedHoursRemaining` exists; policy/low-stock signal **missing** | Do not hard-code an economic threshold in art code |
| High demand / overproduction | Supply/demand values exist; authoritative company classification **missing** | Do not infer overproduction solely from market-wide supply |
| Operating at a loss | `Company.dailyProfit.minor < 0` | Label the daily period; distinguish from insolvency |
| Temporarily closed / bankrupt | `Company.status: paused / insolvent` | Map to closed / bankrupt badges respectively |
| Upgrading | Active job/start/end **missing** | `upgrades[].available` means purchasable, not currently upgrading |
| Suppliers / orders | `Order.supplier`, `side`, `status`, `remainingUnits`, `originalUnits`, `pricePerUnit` | Open/partial/filled/cancelled have distinct glyphs and visible labels |
| Market share / P&L / price | `marketShareBps`, `dailyProfit`, `changeBps`, `history` | Format bps/100 as percent; integer money via existing formatting helpers. Price up is direction, not always a positive player outcome |
| Successful transaction | `Trade.id`, `settledAt`, or confirmed command result | Never play success on submit before confirmation |
| Delivery / shipment / queue | Company, route, commodity, quantity, event ID, time, state **missing** | Compose crates, vehicles and actors only from confirmed events or active snapshot states |
| Growth / ownership | Created/expanded/milestone/ownership-change events **missing** | Current owner/level is not evidence of a new transition |

The sample event adapter accepts `{id, type, companyId, at}` as a **presentation proposal**, not an asserted server type. Proposed event names are in `eventAnimations`. Queue and in-transit compositions are persistent snapshot visuals, not one-shot event-gate types. Additional cargo details should come from authoritative `{commodityId, quantity, fromCompanyId, toCompanyId, route}` data when available.

## File usage

- `assets/art/phase3/manifest.json`: commodity mapping, atlas frames, sources, content boxes, pivots and companion-manifest references.
- `runtime/commodities/*.png`: direct `<img>` use; fixed 48×48, image-rendering pixelated, preserve aspect. Inventory table labels are mandatory, especially for related sacks of feed/flour/coffee.
- `runtime/commodity-atlas.png`: Canvas batch rendering, 260×156, 52px cell stride with 2px gutters; frame rectangles already exclude gutters.
- `ui/*.svg`: editable terminal symbols and animation strips. For currentColor icons, inline trusted SVG or use CSS mask-image + background-color:currentColor; an external `<img>` does not inherit the parent's text colour. The fixture's status strips use explicit colours.
- `runtime/animations/*.png`: precooked 96×24 new strips for Canvas. Reused strips continue to reference their Phase 2 SVG files; cache decoded images.
- `business-states.json`: all 48 launch-industry state bindings, lifecycle mapping, priorities and badge placement.
- `market-activity.json`: eight compositions reusing existing approved sprite IDs. Cargo is a badge for enclosed vans, not an inventory icon pasted at world scale.
- `tools/economic-art/terminal.css` and `index.html`: reusable pattern fixture, not replacements for Claude's application screens. Demonstration figures are prominently labelled and must not be shipped as live values.

## Acceptance criteria

- Every one of the 15 commodity IDs resolves; inherited art is visually unchanged. Engine-only IDs fall back to a text label, never the wrong commodity.
- All eight business states render on each of the six industries; insolvency/closure win conflicting states. Unknown production status shows no fabricated production animation. Secondary states remain available as text.
- Sheet frames stay within bounds, anchors remain stable, single-shot events disappear after 800ms including in reduced motion, and duplicate delivery IDs do not replay.
- Existing building dimensions, tile projection and sorting remain unchanged. No badge obscures names or important actions. Render hit targets at least 44px if a badge is interactive.
- All currency and chart values come from current game data. Zero, negative, unknown, stale and unavailable values have explicit text states. No hard-coded fixture values enter production.
- Routes respect roads, doors and loading positions; actors and cargo do not pop through buildings. Until those metadata exist, use badges and inspector updates rather than simulated movement.
- Browser review covers DPR 1/2, integer camera zoom, mobile width 360px, high contrast, screen-reader labels, reduced motion, hidden-tab pause and a representative busy city. These checks are not completed by the native Canvas contact sheets.

## Reproduce exports and checks

From repository root with Python 3 (Pillow for inventory reporting) and Node with `@napi-rs/canvas` available:

```sh
python tools/economic-art/build-ui.py
python tools/economic-art/catalogue.py
node tools/economic-art/compile.mjs
node tools/economic-art/review.mjs
node tools/economic-art/validate.mjs
node tools/economic-art/presentation.test.mjs
python tools/economic-art/inventory.py
python -m http.server 8765
```

Open `/tools/economic-art/` on that local server to review the fixture. Source illustrations and measured crop rectangles are committed; regeneration does not require another image-generation call. If using a shared Node dependency directory, set NODE_PATH to that directory before running the Canvas scripts. Do not install art tooling into the backend workspace.
