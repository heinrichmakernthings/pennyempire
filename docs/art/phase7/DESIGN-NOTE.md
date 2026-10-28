# Phase 7 design conformance note

## Outcome and authority

**Preserves the incumbent Pixel Tycoon × Market Terminal system at draft-review / finished-subset scope.** This is an ordinary extension of the approved UI, not a replacement visual world or a global system change. The finish review's **SHIP** disposition has that same limited scope; it does not approve the full animation brief or certify production integration.

Authority remains [DESIGN-SYSTEM.md](../../design/DESIGN-SYSTEM.md), [tokens.css](../../../src/design/tokens.css) and the existing Phase 4/6 shared styles. Product context is [PRODUCT-BRIEF.md](../../PRODUCT-BRIEF.md). There is no root PRODUCT.md or DESIGN.md to replace. Under the Impeccable new-work ordinary-extension handoff, this comparison preserves those sources; a new token-bearing global DESIGN.md and `.impeccable/design.json` would duplicate authority and imply an unapproved system change. Neither is needed or created.

## Evidence checked

Read DIRECTION, SCREEN-SPECIFICATIONS, README, INTEGRATION, OUTSTANDING and FINISH-REVIEW, the product/design equivalents above, shared tokens, `tools/company-marketplace/styles.css`, `tools/living-world/styles.css`, and the Phase 7 HTML, local CSS and relevant application/scene rendering. Checked the prior Phase 6 conformance note for inherited exceptions. Opened the final desktop-city and mobile-competition screenshots directly; reviewed the supplied browser report and independent finish-review account. This is a source and supplied-evidence documentation check, not a fresh live browser run, exhaustive accessibility measurement or detector pass.

| Area | Preservation evidence |
|---|---|
| Palette | The HTML loads shared tokens before Phase 4 controls, Phase 6 shell and local styles. Local surfaces, dividers, bars, labels and focus use existing `--pe-*` colors. Canvas background/text and editable brand choices repeat incumbent palette values; they introduce no global palette. |
| Typography | Shared system font stack, 16/24 body, 14/20 report text, 24/32 and 20/28 headings, and body-wide tabular numerals remain. The inherited Penny Post masthead uses 32/40 on desktop and 24/32 on mobile. Native canvas labels use system-ui at 14px. |
| Controls and shape | Native controls inherit 44px minimum height, 4px corners, amber focus, hover/disabled treatment and existing select/input styling. Panels and the scene use 8px corners and 1px dividers. Dialogs retain the shared native-dialog and mobile sheet presentation. The inherited 20px checkbox glyph rule is not evidence of a measured 44px effective hit area. |
| Depth and composition | Flat charcoal tonal layers and separators, with the inherited dialog backdrop. Reports use rows, bars and tables; people/news use divided content rather than a new ornamental card system. The native Bristol art remains the visual subject. |
| Layout | Shared desktop shell retains 184px rail, 64px HUD and 336px inspector. At 768–1199px the 72px rail and stacked inspector follow Phase 6. Mobile retains 88px HUD and native scene panning; Phase 7 explicitly sets its five-item navigation to 56px plus safe area and bottom content padding to 92px. People columns are 3/2/1; motion columns are 4/2/2. |
| Pixel scale | Scene canvas remains 820×500 with smoothing disabled; CSS keeps pixelated rendering and local overflow. Portraits remain 96px, avatars 48px, world actors 24×40; the work library shows native frames at exact 2×. The desktop city capture and mobile report capture agree with these layout and visual rules. |

## Existing exceptions and drift left intact

The Phase 6 inspector stacks on tablet rather than implementing the Phase 1 dismissible 360px overlay. Phase 7 inherits that scoped reference-shell exception. Phase 6's 64px mobile navigation is locally overridden to the global 56px size for this five-item reference; the earlier shared stylesheet is unchanged. The larger newspaper masthead is also inherited. Shared styles use literal spacing/radius dimensions alongside tokens, including 20px/28px values outside the declared spacing scale; visual adherence is not complete token indirection. None of these established differences was repaired or promoted to a global rule.

The Phase 7 direction's design-system reference was corrected to the actual repository path, `docs/design/DESIGN-SYSTEM.md`. No implementation or global design files changed in this documentation pass.

## Delivery limits remain binding

- Generated raster sources are **not certified for strict source-grid/palette purity**. Nearest-neighbour export, fixed dimensions and integer zoom do not prove authored pixel-grid quality; `productionCertified:false` remains meaningful.
- New owners/workers and the pickup are **SW only**. Worker loops contain two work poses; owner reactions are held poses. Rejected walk studies remain excluded. Four-direction alternating-foot walks, carrying, door entry/exit and full reaction clips are outstanding.
- Consumer scenarios reuse appearances; representative crowd counts are visual sampling, not live individual consumer simulation. Shutters fit the reviewed shop module only.
- Reporting, lifecycle/freshness, approved ownership/persona mapping, cosmetic entitlements, settled-transfer streams and news require live adapters. Fixture data and proposed contracts do not establish backend capabilities. Unsupported event templates must stay hidden in production until confirmed events exist.
- The resolved finish-review ranking issue preserves known units but withholds every rank/share when any comparable report is unavailable. This data correction does not confer wider economic integration approval.

See [OUTSTANDING.md](OUTSTANDING.md), [INTEGRATION.md](INTEGRATION.md) and [FINISH-REVIEW.md](FINISH-REVIEW.md) for the remaining release gates. No unresolved design-authority contradiction was found at the draft-subset scope.
