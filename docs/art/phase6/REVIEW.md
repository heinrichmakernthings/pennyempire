# Phase 6 independent finish review

## Disposition

**fix** — one material art-composition correction before prototype handoff. This is a review of the isolated living-world reference and starter artwork, not live-engine readiness or user art approval.

## Evidence and coverage

Reviewed all 32 required desktop/mobile PNG captures in `docs/art/phase6/qa`: world, empire, freight, post, groups, states, bankrupt-state, event-consequences, country, city, neighbourhood, expansion-destination, expansion-review, customs-hold, post-feature and shareholder-vote. Opened all via labelled montages and inspected native-detail views/crops for mobile city, expansion review, customs hold, business states and the long Penny Post layouts. Captures depict the named surfaces without blank or unloaded regions. Long mobile pages retain fixed navigation in the first viewport; native artwork and wide reports intentionally scroll within their containers.

Reviewed all six required art sheets in `assets/art/phase6/qa`: contact-sheet-1x, city-starters-1x, logistics-composition-1x, business-states-1x, small-assets-2x, event-shipment-icons. Read AUDIT, INTEGRATION, SCREEN-SPECIFICATIONS, OUTSTANDING, ASSET-INVENTORY and CITY-CATALOGUE. Compared `docs/design/DESIGN-SYSTEM.md`, `src/design/tokens.css`, Phase 4 company-overview and Phase 5 stocks screenshots. Read relevant rendering/CSS source and the supplied browser report. No independent browser session was run. The detector was attempted upstream but unavailable; this is not a clean detector result.

## Material findings

| ID | Finding | Evidence | Impact |
|---|---|---|---|
| F1 | Forklift overlaps the lorry cab in the logistics composition. | `assets/art/phase6/qa/logistics-composition-1x.png`, lower centre; `tools/living-world/compose.mjs:3` places the lorry at `[620,500]` and forklift at `[570,510]`. | The two vehicles read as one intersecting object and undermine the sheet's role as a credible placement example for integration. |

The management UI preserves the incumbent charcoal/amber terminal, native pixel assets and clear financial table grammar. Expansion costs, policy preview, proposals and vote boundaries remain explicitly illustrative. The city modules distinguish materials and rooflines while fitting the existing Bristol visual family. Business-state actors and props communicate the intended differences, subject to the documented incomplete closed-facade treatment. No additional material UI correction was identified in the supplied evidence.

## Recommended fixes

Move the forklift onto clear paved ground, separated from the lorry silhouette and transport access. Regenerate `logistics-composition-1x.png` from `compose.mjs`, preserve native scale and the sprite's inherited pivot, and provide that updated sheet for the verdict pass. Do not change backend behavior or regenerate the underlying sprite for this placement issue.

## Scope and risks

This is a reviewable starter pack: 27 native sprite exports (14 new, 13 reused), 13 SVG icons and an isolated UI fixture. `productionCertified:false` remains appropriate. Human source-grid, footprint and attachment-profile approval is outstanding; illuminated closed/bankrupt windows remain an explicit partial treatment. Cargo ships, aircraft, full airport/port layouts, hills, complete cities and all-facade profiles are not delivered and must remain in OUTSTANDING. Loading/stale/network-error integration, authoritative economic events, shipments, international expansion and ownership settlement remain engineering work. No approval of those capabilities is implied by this review.

## Verdict pass — F1

**Disposition: ship**, at prototype-handoff scope. Reopened the regenerated `assets/art/phase6/qa/logistics-composition-1x.png` at native detail. **F1 resolved:** the forklift at `[750,570]` is visibly separated from the lorry cab, sits on the paved ground and reads as an independent vehicle. Native sprite scale and the surrounding composition are retained. No UI changed; this pass scores F1 only and does not constitute a new whole-surface review or production-art certification.

The upstream branch freshness update and `Snapshot.loadStatus` correction are acknowledged as context; no additional implementation review is claimed here. The previously documented art and live-integration limits continue to apply.
