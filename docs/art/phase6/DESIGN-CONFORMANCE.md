# Phase 6 design conformance

## Result and authority

**Conforms to the approved PixelTycoon × MarketTerminal direction at prototype-handoff scope, with documented surface exceptions and production limits.** This is an ordinary extension of the existing pixel-city / charcoal-market-terminal system. It introduces no replacement visual world and confers no new art or live-economy approval.

Visual authority remains [DESIGN-SYSTEM.md](../../design/DESIGN-SYSTEM.md), [tokens.css](../../../src/design/tokens.css), and the incumbent Phase 4 controls inherited by `tools/living-world/index.html`. The Phase 6 [screen specification](SCREEN-SPECIFICATIONS.md) describes this reference's local layout choices. No root `PRODUCT.md` or `DESIGN.md` was found in the repository; neither was invented. Global design documents, tokens and previous-phase artwork are preserved.

This document records source conformance and existing QA/reviewer evidence. It does not claim a new browser run, independent screenshot review, detector pass, or production certification by the documenter.

## Token and component adherence

| Area | Implemented evidence and assessment |
|---|---|
| Palette | The HTML loads the shared token stylesheet. Living-world surfaces, separators, text, selection and status styles consume `--pe-*` colors: charcoal background/surface/raised, warm text, slate muted text, amber actions, mint positive and coral negative. Primary buttons inherit dark text on amber. |
| Typography | Inherited system font stack; body 16/24, secondary and financial tables 14/20, headings 24/32 and 20/28. Body-wide tabular numerals support financial alignment. The Penny Post masthead expands to 32/40 on desktop and returns to 24/32 on mobile; the lead story uses a larger hierarchy within the existing family. |
| Spacing and shape | Common 8/12/16/24/32px spacing, 4px controls, 8px panels and 1px dividers preserve the incumbent grammar. Several dimensional values are literal CSS values matching the system, rather than references to spacing/radius custom properties. This is visual adherence, not complete token indirection. |
| Depth | Flat tonal layers and separators, with the inherited native-dialog backdrop. No new gradients or glowing panels. |
| Controls | Inherited native buttons, selects and inputs, 44px minimum action-control height, amber focus-visible outline, labelled errors, selected navigation and pressed states. The 20px native checkbox/radio glyph rule is inherited; these source checks do not certify every effective hit area. |
| Tables and reports | 14/20 text, tabular amounts, aligned end columns and divider rows. Wide mobile reports have named, focusable scroll regions; fixed-layout quote-review tables wrap and fit the sheet. |
| Accessibility and motion | Skip link, semantic controls, native dialog, status announcer, labelled icons and text destination alternatives are present. Reduced-motion rules are inherited, the ticker advances manually, and the state preview freezes existing badges. Full accessibility certification is outside the evidence. |

The schematic map adds literal terrain colors `#34484C` and `#526267` locally; these are map illustration colors, not new global UI tokens. Its mobile SVG labels use 30px in SVG coordinates for legibility. Neither these local choices nor the newspaper hierarchy changes the shared financial type scale.

## Responsive contract

| Viewport | Actual living-world layout |
|---|---|
| Desktop ≥1200px | 184px fixed navigation, 64px sticky HUD, 32px horizontal content gutters, fluid main column plus 336px inspector and 24px gap. Main content has a 1700px maximum width. |
| Tablet 768–1199px | 72px icon rail, 24px content padding; main/inspector and business-state layouts stack. The newspaper retains a main column plus a 280px secondary column. |
| Mobile <768px | 88px HUD, 16px horizontal gutters, one-column content and a six-item 64px bottom navigation plus safe-area inset; 100px content bottom padding. Native art scrolls within its viewport. Reports may scroll at a 620px minimum width; core cost review tables fit. Dialogs inherit bottom-sheet placement with an 80dvh maximum height. |

Two differences from the original Phase 1 global contract are explicit in the Phase 6 screen specification: the tablet inspector follows content instead of becoming a dismissible 360px overlay, and this reference's six-item mobile navigation is 64px instead of the global 56px. These are scoped reference-shell exceptions, not revisions to global tokens. Integration must preserve the real game's navigation rather than add six permanent tabs. No drift repair was performed.

## Pixel art and composition

The inherited logical grid is **128×64**, orthographic 2:1, projected as `((c-r)*64, (c+r)*32)`. Integration uses source frames at `anchor - pivot`, nearest-neighbour integer zoom, no mirrored orientations, warm upper-left light and southern-footprint depth ordering. Footprint reservation and alpha silhouette remain separate concepts. CSS keeps city sprites and state canvas pixelated; mobile overflow preserves native art rather than shrinking a whole city into a thumbnail.

The delivered pack contains **27 individual RGBA runtime sprites: 14 new static assets and 13 deterministic exports of existing art**, plus **13 new SVG UI icons**. Existing badge strips provide animation vocabulary; the new raster art is single-frame. The event and shipment mappings cover twelve event categories and six shipment states. City starters comprise two London, three Lisbon and three Mexico City modules, with existing Bristol materials and street assets reused.

Nine business-state compositions reuse a shop and layer props, actors, badges and editable text. The boarded-panel attachment is demonstrated only for `shop-module`. No universal facade attachment, new walking cycle, live production simulation or complete city is implied. Closed/bankrupt states still retain illuminated windows in the inherited building texture; this is a disclosed partial treatment, not a repaired facade.

## Evidence and finish disposition

[QA.md](QA.md) records 32 full-page captures: 16 at desktop 1440×1000 and 16 at mobile 390×844, covering the six routes, map hierarchy, expansion steps, consequences, customs hold, feature article and shareholder vote. Browser workflow assertions and extra overflow checks at 360, 768 and 1199px are recorded; runtime-error arrays were empty. Asset checks cover dimensions, frame rectangles, pivots and alpha. These checks do not establish source pixel-grid certification.

The independent [review](REVIEW.md) inspected all 32 captures and six art sheets, including native-detail views. It found one material issue: the forklift intersected the lorry cab on the logistics composition. The corrected placement at `[750,570]` was reopened at native detail and accepted as visibly separate on paved ground, retaining scale. The final verdict is **ship at prototype-handoff scope**. That final pass resolved F1 only; it was not a repeat whole-surface audit. No additional material UI correction was identified in the original review.

The Impeccable detector was attempted upstream but its launcher was unavailable. No clean automated detector result is claimed. Human source-density, footprint-fit and per-building attachment approval remain outstanding; `productionCertified:false` is retained.

## Fixture and live-integration boundary

This is a code-led, interactive art reference under `tools/living-world`, with illustrative economic records and no economic API writes. Expansion commitment changes are in-memory previews. Shipment policy, acquisition and vote acknowledgements do not establish inventory, money or ownership settlement. Schematic map connections supply no geographic distances or tariff calculations. News effects require structured authoritative events, not interpretation of headlines or icons.

The final [audit](AUDIT.md) includes Claude's commodities-exchange branch at `26a8a20fdd74edecb48ad0764dd04fd485e623f0`. Local supplier contracts, direct purchase/quote flow, order-book trading, commodity IDs and city-keyed statistics already exist. Scheduled local deliveries still settle atomically; the audited implementation is Bristol-only and does not support cross-city transfers. International contracts and shipment lifecycle must remain gated. Exchange seller fees first transfer to the state exchange account before configured burn/treasury sweep; the full fee is not an immediate sink.

`contracts.ts` contains proposed view interfaces, not evidence of implemented server capabilities. `Snapshot.loadStatus` is separate from destination/shipment status. Fixture `data.js` needs an adapter to those richer interfaces; preserve authority, version, as-of tick, null values, event lifecycle and typed effects. Loading/stale/network-error behavior is specified for future binding, not exercised against a backend.

The [integration handoff](INTEGRATION.md) and [outstanding list](OUTSTANDING.md) remain authoritative for delivery limits: international expansion/quotes, transit inventory, tariffs, ownership closing/votes and event-effect simulation need engine support. Cargo ships, aircraft, full ports/airports, geographic map data, terrain elevation, complete new cities, new character animation and all-facade masks are not delivered. The existing reference and approved visual identity can proceed to prototype integration review without representing those missing capabilities as complete.
