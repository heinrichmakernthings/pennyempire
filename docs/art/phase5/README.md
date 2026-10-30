# Penny Empire — Phase 5 markets and prestige

Reviewable art pack and runnable interface reference for Stock Exchange, State Companies, Prestige, Portfolio and Financial News. This extends the approved Pixel Tycoon × Market Terminal direction without changing the application or economic engine.

## Delivered

- **26 individual transparent runtime sprites:** 16 new + 10 unchanged-art exports from Phase 2.
- **16 new assets:** four luxury vehicles, four luxury properties, one motor launch, three collectibles, one branch bank and three advertising props.
- **10 reused assets:** all six state-company headquarters plus billboard, street advertisement, digital sign and bus shelter.
- Five interactive screen references, desktop/mobile layouts, share-order and prestige-purchase review/failure states, collection nameplate controls, nine financial-news templates.
- Manifest, CSV file inventory, exact generation prompts, source images, native-size contact sheet, 2× edge review, city composition, proposed TypeScript view contracts and integration instructions.

## Open the reference

From repository root, run `python -m http.server 8000`, then open `http://localhost:8000/tools/markets-prestige/`. All data is illustrative. No account, backend, live trade or payment connection is used. Preview purchases reset on refresh.

Read [INTEGRATION.md](INTEGRATION.md) before wiring to Claude’s React application. Preserve its existing components and canonical contracts; the standalone reference is not a replacement application.

## Review order

1. [Repository audit](AUDIT.md) and [outstanding work](OUTSTANDING.md).
2. [Asset inventory](ASSET-INVENTORY.md), `assets/art/phase5/qa/contact-sheet-1x.png` and city composition.
3. [Screen specifications](SCREEN-SPECIFICATIONS.md) and interactive reference.
4. [Integration contract and acceptance criteria](INTEGRATION.md).
5. [Independent review](REVIEW.md), its resolution verdict and `qa/browser-report.json`.

## Verification

`export-assets.mjs` and `city-composition.mjs` use `@napi-rs/canvas` for deterministic exports/composition. `validate-assets.py` uses Pillow for read-only size/alpha/pivot checks and inventory generation. `qa.mjs` and `qa-review-fixes.mjs` use Playwright and a local Chromium; set `CHROMIUM_PATH` when the executable is not Playwright-managed. These tools are isolated references and add no production dependencies.

Recorded checks: 26 RGBA sprites with correct dimensions/frames/pivots and nonempty alpha; desktop 1440 and mobile 390 capture sets; overflow checks at 360/768/1199; preview quote, reserved-share, purchase, placement and insufficient-funds flows; selected-issuer news and touch/keyboard table access. See JSON reports for exact scope. Image generation does not prove a hand-authored pixel grid; manifest certification remains false pending art approval.

## Delivery status

Suitable for technical and visual review and integration of supplied static assets. **Not full completion of the requested inventory:** skyscraper and superyacht remain outstanding until larger footprints are approved. Moving orientations, material recolour masks, projected-ad UV mappings and additional state upgrades are separately listed. No live stock-market or prestige backend is delivered. Keep the PR draft and do not merge unreviewed art.
