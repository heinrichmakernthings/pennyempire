# Phase 5 design conformance

## Scope and disposition

**Ship the scoped art pack and interactive reference to draft PR review.** The final resolution pass in `REVIEW.md` closes P5-R01 and P5-R02 (2/2 each). This document records conformance evidence, not a replacement design system or production certification. Direction: **Operate**, extending the approved Phase 1–4 world.

Delivered inventory is **26 runtime sprites: 16 new and 10 reused**. The skyline tower/skyscraper and superyacht remain unavailable artwork. No economic engine is implemented. Keep `productionCertified: false`, art approval and the remaining inventory limitations explicit.

## Authority and evidence

Product context was found in `docs/PRODUCT-BRIEF.md`; visual authority is `docs/design/DESIGN-SYSTEM.md`, `src/design/tokens.css`, and `docs/art/phase4/COMPONENTS-AND-STATES.md`. No new PRODUCT.md, DESIGN.md or token sidecar was invented. The Impeccable document reference was applied as an extraction/conformance method within this report's write boundary.

Inspected final `index.html`, `styles.css`, `app.js`, `contracts.ts`, asset inventory, integration handoff, review resolution and QA reports. Visually inspected `qa/desktop-stocks.png`, `qa/mobile-stocks.png` and `qa/desktop-prestige.png`. Browser metrics below are supplied results; this documentation pass did not rerun browser tests or sample computed styles. The working-tree diff for the incumbent tokens and design-system document was empty.

## Conformance comparison

| Area | Final evidence | Assessment |
|---|---|---|
| Palette and materials | `index.html` imports incumbent tokens and Phase 4 styles before its local extension. Phase 5 CSS uses `--pe-bg`, surface, raised, divider, text, muted, accent and negative. Positive outcomes inherit Phase 4 mint. Screens retain charcoal surfaces, amber action/selection and warm pixel art. | Coherent continuation; no replacement palette, gradients or glowing panels. Allocation/nameplate literals in `app.js` equal incumbent amber, mint, muted and cream values; they are local duplicates, not new normative tokens. |
| Typography | Inherited body is system font at 16/24 with tabular numerals; normal headings are 24/32 and 20/28. Tables remain 14/20; helpers and labels are at least 14px in CSS. | Core financial hierarchy conforms. Local exceptions are a 28/36 quote and lead-story title, 32/40 news masthead (28px mobile), 18px mobile stat value and 500-weight table headers. These are observed surface-specific extensions, not additions to the canonical type scale. |
| Spacing and shape | Most separation uses 8/12/16/24/32px. Controls inherit 4px corners and 44px minimum height; ticket/dialog use 8px corners and 1px dividers. | Same control language. Local 6px field margins and 20px gaps/padding exist, with 20px panel padding already present in Phase 4. Do not reinterpret these as global spacing tokens. |
| Layout | Reference exchange uses 210px directory / flexible detail / 304px ticket; below 1200px the ticket moves under detail; below 768px it stacks. Catalogue moves 3 → 2 → 1 columns. Mobile navigation is 56px plus safe area. | Responsive reference retains hierarchy. It intentionally has a compact top navigation/HUD instead of the application's 184px sidebar/64px HUD and 336px inspector. Its shell dimensions must not replace the production shell contract. |
| Financial readability | Final mobile stock capture shows both report columns, including complete amounts. `.compact-table` removes inherited 420px minimum width only for two-column tables; wide tables have visible scroll instructions, labelled focusable regions and amber focus styling. | P5-R01 resolved without shrinking financial type. Supplied `review-fix-checks.json` reports compact fit plus 40px keyboard and 62px touch scrolling. |
| Charts and motion | Price/history path is generated from data, null observations break the path, cropped scale is labelled, exact values follow in a table. Phase 4 reduced-motion rules are inherited. | Data remains editable DOM/SVG, with no decorative ticker or animated balance. Mobile SVG labels use a larger 24-unit source size to compensate for viewBox scaling; CSS sizes alone do not certify rendered chart-text dimensions. |
| Pixel assets and scale | Native property sizes match inventory; vehicle CSS is 136×124 for 68×62 sources; launch is 256×182 for 128×91; trophy 64×78 for 32×39; sculpture 128×162 for 64×81; monument 160×178 for 80×89. Pixelated rendering is explicit. | Native property and exact 2× small-asset gallery treatment retain silhouette readability. These catalogue display sizes are not world geometry. City integration retains the 128×64 projection, manifest pivots and integer zoom. Source-grid certification remains withheld. |
| State and feedback | Inherited focus, disabled, primary, negative, native dialog and reduced-motion styles; reference labels all money interactions as previews. Unavailable large artwork has requirements rather than a purchase action. | Consistent with the incumbent restrained terminal. Screenshot inspection does not establish full keyboard or assistive-technology compliance. |

## Final review closure

P5-R02 is resolved in source: issuer news filters by stable `companyId`, missing news has an honest empty state, and issuer-specific news links/hash parsing preserve the selected listing. The focused report records correct unlisted-issuer news. The final review independently inspected the alternate-issuer captures and supersedes its earlier open-finding text. No additional global polish or design-drift repair is required by this report.

## Integration compatibility

The available `origin/feature/company-management` ref resolves to `48494cb90bafce17e001dfaa5959c7a74b22f532`, matching `INTEGRATION.md`. Its tree already contains StocksScreen, PrestigeScreen, PortfolioScreen, MoneyValue and art registration/loading modules. Its `src/data/types.ts` composes portfolio state from holdings/listings and distinguishes illustrative fixtures from server authority. Extend those existing application components and data-source boundaries; the standalone reference is not a replacement frontend.

The active branch's `src/contracts/game-state.ts` defines `Money { currency: 'EC' | 'GBP_TEST'; minor }` and a `Listing` with separate `id`/`companyId`, `companyName`, `price: Money` and `outstandingShares`. Preserve those identifiers and adapt reference fields: `name` → `companyName`, `price`/`sharePriceMinor` → `price.minor`, `shares`/`sharesOutstanding` → `outstandingShares`. Keep EC portfolio totals separate from GBP_TEST. Phase 5 `contracts.ts` explicitly proposes view contracts; it does not declare existing backend endpoints or supersede application contracts.

The handoff correctly treats company creation/upgrades as already implemented on the newer branch while retaining the older engine commit solely as the payment-semantics audit anchor. Recheck capabilities at implementation time. Share order lifecycle, dividends, prestige purchases, placement and temporary perks still require authoritative server support. Fixture fees, prices, preview ownership and successful acknowledgements do not establish economic rules or fills.

This pass changes only this conformance report. Existing design/token files, Phase 4 controls, active Claude frontend files and backend files remain untouched.
