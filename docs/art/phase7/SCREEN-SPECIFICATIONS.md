# Living Bristol screens

Extends the approved tokens and shared controls; no new global theme. Background #141C20, surface #1D282D, raised #26343B, divider #38464C, text #F0E8D7, muted #A9B5B9; amber #FFC45E, mint #62DBAF, coral #F08076. Body 16/24, secondary 14/20, h1 24/32, h2 20/28. System typography; tabular financial numerals. Existing 4px control / 8px panel corners and 44px minimum actions.

## Layout and component tree

`LivingBristolShell → CityActivityScene | CompetitionReport | PeopleCatalogue | PennyPostNPC | MotionLibrary`.

- Desktop ≥1200: existing 184px navigation rail, 64px HUD, City inspector 336px beside native 820×500 scene. Other pages use available report width. Owner catalogue 3 columns, news 2 columns, motion 4 columns.
- Tablet 768–1199: compact 72px navigation rail; inspector stacks where the shared split breakpoint requires it; owner catalogue 2 columns.
- Mobile <768: 88px HUD and 56px bottom navigation; single-column forms/profiles/news. City remains native resolution in a labelled focusable pan region. Owner catalogue one column; motion two columns. Tables scroll within a labelled focusable region, never the entire document. No shrinking of sprites to fractional scale.

## Bristol activity

Business state selector demonstrates busy, quiet, low stock, closed, bankrupt and stale. The same shop is reused; queues reflect bounded representative throughput, workers reflect confirmed activity, shutters reflect lifecycle. Company label and accent are dynamic. Prestige award preview has an explicit entitlement fixture label. Transfer replay communicates settled goods and never submits an order. State changes clear pending effects.

## Local competition

Filter market first, then ownership. Rank and denominator use the full comparable market before ownership filtering. Bars and text share one data source; table includes rank, company, owner kind, realised units/share, fictional EC revenue, reported reputation, sales-volume change and profile action. Distinguish player/NPC/state through both symbols and text. New entrant has no fabricated prior growth; unavailable report is not zero. Empty ownership result explains how to recover. Dynamic bars are not raster chart assets.

## Profiles and population

Twelve catalogue entries open a focused profile detail using native dialog keyboard behaviour. Show portrait, role, flavour personality and proposed company bindings. Reaction selector is review-only. Human persona ID is separate from engine ownership. At mobile widths image and text wrap without shrinking the 96px portrait. Consumer examples reuse appearances; demographic labels never assign income, demand or financial behaviour.

## Penny Post

Keep existing masthead. Nine data-driven templates: opening, leader, expansion, rivalry, shortage, hiring, bankruptcy, acquisition, milestone. Cards show avatar/category/headline/tick/city; article detail shows larger portrait and event provenance. Company and person metadata remain distinct. Fixtures are clearly labelled and must be replaced by confirmed event payloads. Negative expression can accompany bankruptcy but never substitutes for the actual event category.

## States and accessibility

Initial artwork loading has a visible status. Module/decode failure displays retry guidance rather than blank content. Missing market report uses Unavailable/N/A; empty filtered report offers a different filter. Native selects/buttons expose focus; native modal supports Escape and trapped focus. Every icon ownership state includes text. Motion honours reduced-motion and pause. Stale company snapshots remove crowd/work cues. Prototype financial records are illustrative, in fictional EC; no simulated GBP balance appears here.
