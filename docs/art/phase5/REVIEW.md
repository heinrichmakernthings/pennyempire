# Phase 5 independent finish review

## 1. Disposition

**Fix before frontend acceptance; suitable for a draft art/integration PR. No rebuild required.** The supplied static-art and reference-interface scope is credible. Two focused interface issues remain below. This review does not certify production art, live exchange behavior, or the complete original inventory.

## 2. Evidence validity

Manually inspected all 18 required desktop/mobile captures: stocks, state, prestige, portfolio, news, share-order-review, stale-quote, prestige-preview and owned-customisation. Also inspected contact-sheet-1x, small-assets-2x and city-composition-1x, plus manifest, browser report, implementation, tokens, approved design system and handoff documents. The screenshots match the current composition and controls in source. No separate approved new comp exists; the incumbent Pixel Tycoon × Market Terminal world is the comparison authority.

The browser report records no page overflow for the captured routes and additional 360/768/1199 widths, no reported browser errors, and exercised preview guards. Those are recorded results, not independently rerun here. Review used supplied images and source; no browser or detector was available to this reviewer. Full-page mobile captures place the fixed bottom bar partway through the stitched page; this alone is not a layout defect. They do not prove that all content is visible in a single viewport, or establish keyboard/assistive-technology compliance.

The art evidence demonstrates individual sprites, an actual-size composition, distinguishable vehicle/property silhouettes and continuity with reused state buildings. It does not prove a uniform hand-authored source-pixel grid. Keeping `productionCertified: false` is correct.

## 3. Material findings

### P5-R01 — Medium — Mobile financial values require avoidable horizontal scrolling

Evidence: mobile-stocks and mobile-portfolio hide the right-hand amount column even for simple two-column financial-report and dividend tables. The inherited mobile table minimum width causes this; `table()` wraps every table identically. No explicit scroll instruction appears. No page overflow is therefore insufficient evidence of readable mobile financial data.

Action: give simple two-column tables a scoped compact layout with zero minimum width and wrapping labels so values remain visible at 360/390px. Keep horizontal scrolling for genuinely wide tables, but add a visible scroll hint and an explicitly focusable, labelled scroll region. Verify both ends of the wide tables with keyboard and touch. Do not reduce financial text size to make columns fit.

### P5-R02 — Medium — Issuer news ignores the selected issuer

Evidence: `stocks()` always renders `news[0].title` under “Issuer news”, regardless of `selected`. Switching from Brunel Milling to Harbour Bean, Avon Timber or the unlisted state utility therefore retains the Brunel listing story. This undermines the otherwise data-driven issuer view.

Action: associate fixture news with stable issuer IDs, filter the issuer section by the selected company, and show a truthful empty state when no matching story exists. Preserve the selected issuer in issuer-specific news navigation. Verify at least one alternate issuer and the unlisted utility. No server changes are needed.

## 4. Scope and quality verdict

Desktop directory/profile/ticket hierarchy is clear, with restrained terminal surfaces, inherited typography, tabular amounts and semantic positive/error colors. Charts are SVG/data-driven, missing observations remain visible gaps, and exact values are available through tables. Mobile stacking and the ticket jump retain the primary action. Captured review and purchase dialogs keep amounts and confirmation actions readable.

Prestige uses real sprites, restrained catalogue framing and textual rarity/ownership. Buildings and small-asset presentation follow the declared native/2× approach in the gallery. State buildings retain the incumbent pixel-world identity. The code-led extension does not require a replacement visual concept.

Skyscraper and superyacht placeholders are expressly unavailable and correctly do not masquerade as delivered assets. Parked southwest orientations, absent body recolour masks, absent projected advertising UVs, missing additional upgrades and missing live engine capabilities are documented limitations, not reasons to demand out-of-scope engine modifications. The current deliverable remains a static art pack and interactive reference, not a completed live financial system.

## 5. Handoff

Carry P5-R01 and P5-R02 as explicit open frontend acceptance items. Keep the PR draft while art and integration are reviewed. After the focused fixes, verify only the affected mobile tables and alternate-issuer news; retain the existing evidence and avoid another general polish loop. Do not describe the whole requested Phase 5 inventory as complete, remove the production-certification caveat, or infer backend readiness from successful fixture interactions.

## Focused resolution pass

This pass supersedes the two open finding statuses and the fix-before-acceptance disposition above. It is limited to P5-R01/P5-R02; it is not another general polish review.

| Finding | Resolution score | Evidence |
|---|---|---|
| P5-R01 | **Resolved — 2/2** | Updated mobile-stocks and mobile-portfolio show complete financial-report and dividend amounts without horizontal scrolling. Source scopes zero minimum width to two-column tables. Wide tables retain their columns and now expose a visible mobile scroll hint, a labelled region, keyboard focus and focus styling. `review-fix-checks.json` records compact tables fitting, keyboard scroll movement of 40px and touch scroll movement of 62px. |
| P5-R02 | **Resolved — 2/2** | Desktop/mobile-issuer-news-timber show “Acquisition announced”; mobile-issuer-news-energy shows “State service update”. Source filters news by stable company ID, includes a no-announcements branch, and generates issuer-specific `#stocks/<issuer>` links. Directory navigation and hash parsing preserve issuer selection. The targeted report records correct unlisted-issuer news. |

Scoring: 0 unresolved, 1 partial, 2 resolved. Captures and current source were independently inspected; interaction metrics are the supplied browser results, not tests rerun by this reviewer.

**Updated disposition: ship the scoped reference/art work to draft PR review.** No material findings from this review remain open. Keep the existing art-approval, `productionCertified: false`, outstanding-inventory and live-engine limitations intact. This verdict closes the two interface defects; it does not certify the entire originally requested Phase 5 inventory or production integration.
