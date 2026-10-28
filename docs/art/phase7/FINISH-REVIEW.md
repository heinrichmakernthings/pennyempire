# Phase 7 independent finish review

## 1. Disposition

**SHIP as a draft review pack / finished subset.** The visual extension does not need a rebuild. The one blocking ranking-data finding is resolved and independently checked. This is not approval of the complete Phase 7 brief, strict source-grid quality, or live-game integration.

## 2. Scope and evidence

Reviewed the original Phase 7 brief, DIRECTION, AUDIT, README, INTEGRATION, OUTSTANDING and QA; incumbent design tokens and the Phase 4/6 styles imported by the reference; application, scene, activity and adapter code. This is an independent file and screenshot review, not a second live browser run.

Inspected all 34 desktop/mobile state captures through the five overview sheets, with full-resolution checks of desktop city and competition and mobile city and unavailable state-company report. Coverage includes all five routes, city lifecycle/freshness states, branding, delivery, three reactions, empty results and article detail. Inspected native owner contacts, 1×/2× worker contacts, city-state contacts, shutter/pickup contacts and both animation preview frames. The GIF exists alongside those frames; the review does not claim playback timing was measured independently.

The recorded browser report contains 49 successful page-overflow checks and empty desktop/mobile error lists. Structural validation is supplied evidence rather than an independently rerun result. The targeted activity test was independently rerun after the F1 correction and passed. The implementation author recaptured all 34 screens after that correction; the final browser report again records 49 passing overflow checks and no errors. Overview sheets were inspected before this helper-only correction; the existing all-known/all-unavailable fixture layouts did not change. The detector launcher was unavailable; no detector pass is claimed. There is no approved Phase 7 comp, so fidelity is assessed against the committed extension direction and incumbent system.

## 3. Material findings

**F1 — incomplete reporting produces a misleading denominator: RESOLVED.** The corrected `rankCompanies` in `tools/living-npcs/activity.js` checks that every report has sales before assigning market shares or ranks. Mixed 30/70/unavailable reports now retain known sales but return null shares and ranks for all rows. A regression assertion covers this case; a separate complete 30/70 report still yields 70% and rank 1. Independently inspected the correction and reran `node tools/living-npcs/activity.test.mjs` successfully. This satisfies the requested fix without changing current all-known/all-unavailable fixture layouts.

**No additional visual blocker for a draft subset.** Identity silhouettes remain distinct at portrait/avatar sizes, worker tools and clothing distinguish roles at native scale, and busy/quiet/shuttered states are legible beside incumbent Bristol art. Mobile intentionally crops the native scene into a pan surface; fixed navigation appearing midway through full-page captures is the expected viewport-fixed capture behavior, not evidence of page overflow. A short horizontal-pan cue would improve discoverability but is not a release blocker for this review tool.

**Release gates remain explicit.** The reviewed two-pose work frames support restrained work loops; they do not establish walking, carrying, entry/exit or full reaction animation. SW-only new actors, rejected walking studies, uncertified generated raster grids, unbound economics/events and limited shutter fitting remain substantive gaps against the original complete-phase request. Keep these in the PR summary and handoff. Native resizing and packing validation do not certify authored pixel-grid purity.

## 4. Quality assessment

The extension preserves the dark financial-terminal palette, system typography, existing control geometry and Bristol scale. No unnecessary hero, ornamental card scaffold, fabricated metrics in artwork or duplicate vehicle system was introduced. Reports use readable bars and tables; ownership has both symbols and labels. Empty/unavailable states explain recovery, and fixture labels are visible on economic/news surfaces. Existing styles supply selection, caret, scrollbars, focus, tabular numerals and touch-sized controls. Screenshot typography and spacing are coherent, with muted text using the established palette; this review does not claim a separate exhaustive measured accessibility audit.

Portrait reactions are deliberately subtle, particularly at avatar scale. They work as secondary flavour alongside event text, not as the sole financial-state signal. The static contacts reveal some detailed raster shading beyond a strict hand-authored pixel grid; the existing production-certification disclaimer accurately describes that limitation. Motion is bounded to the scene/work library rather than scattered decorative entrances.

## 5. Handoff

F1 is resolved; no material finish-review findings remain open at draft-subset scope. Proceed with the draft review pack. The targeted regression test passes and the supplied post-fix browser report remains clean. Retain the stacked Phase 1–6 dependency notice, presentation-only adapter boundary, confirmed-event requirements and outstanding animation/source-grid gates. Claude should integrate only the documented static/two-pose subset and must not treat this review as permission to infer unavailable financial data or activate unsupported news systems.
