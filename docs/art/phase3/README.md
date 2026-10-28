# Phase 3 — Economic gameplay art

Review pack on `art/phase3-economic-gameplay`, stacked on `art/phase2-living-bristol`. No backend, economy rules, approved buildings, or Phase 1/2 source files changed. Read [integration](INTEGRATION.md), [animation specification](ANIMATIONS.md), and [outstanding work](MISSING-ASSETS.md) before integration.

## Delivered

- **15 commodity icons**, individual transparent 48×48 PNGs and one 260×156 atlas. Seven new illustrations; eight deterministic exports of approved art. Original commodity IDs remain supported by the explicit manifest mapping. New IDs are proposals until the engine adopts them.
- **Six production motion sheets**, one per launch industry, using the established 24×24 overlay convention. These are animated activity glyphs, not moving facade machinery.
- **Eleven additional state/event sheets**, plus references to ten approved Phase 2 sheets. Each new sheet has editable SVG and a 96×24 PNG export. Eight business states × six industries and seven lifecycle states are mapped.
- **27 terminal SVG icons** and reusable CSS/HTML patterns for queues, storage, suppliers, orders, rankings, P&L, supply chains, prices and notifications. No charts are flattened.
- **Eight event compositions** reuse approved actors, vehicles, advertising, crates and construction props. They are composable placement data, not duplicate flattened artwork.
- Five [contact sheets](qa/), dimensions/file inventory, a read-only presentation adapter and a runnable [integration fixture](../../../tools/economic-art/index.html).

## Art conventions retained

City tiles remain 128×64; projection remains x=(column−row)×64, y=(column+row)×32. Buildings, actors and vehicles retain their original logical sizes, frame rectangles and bottom-centre pivots. Commodity slots are 48×48, matching the maximum Phase 1 icon extent; content is aspect-preserved and bottom-centred. Atlas cells are 52×52, including a two-pixel transparent gutter on each side. Commodity sprites are UI illustrations, not world-scale cargo.

Terminal icons retain the approved 24×24 viewBox, 1.6px stroke and currentColor. SVG antialiasing belongs to the existing terminal style; it must not be applied to city sprites. State colours use existing amber #FFC45E, positive #62DBAF and negative #F08076. All city and commodity scaling uses nearest neighbour. No new building scale, perspective or lighting scheme is introduced.

Generated sources retain their original alpha. Runtime export uses an alpha≥128 content bounding box plus two source pixels and nearest-neighbour sampling; source artwork is not repainted. This removes irrelevant source padding while preserving the visible silhouette. Source faint alpha outside the export rectangle is intentionally excluded. Generation used built-in image_gen; exact prompts and style reference are in [generation-prompts.json](generation-prompts.json).

## Verification and status

The five contact sheets were visually inspected at native sprite scale, including each new commodity beside the inherited art, all six unchanged buildings, all state strips and reused event props. The commodity sheet also shows 2× nearest-neighbour views. No opaque background rectangles or clipped main silhouettes were observed. Detailed source pixel density remains inherited and not mathematically uniform; no new claim of pixel-density certification is made.

Native Canvas rendered the files through the existing `drawSprite` function and the new `drawActivity` adapter. Structural validation checks dimensions, transparency, atlas bounds, IDs, animation frames, state references and actual motion-frame changes. Presentation tests cover state precedence, absence of fabricated activity, one-shot expiry, duplicate/stale events, reduced motion and progress clamping. Browser/device QA and engine-driven integration are still outstanding; the HTML fixture is supplied but is not claimed browser-tested.

Ready for Claude to integrate commodity art, badges, terminal icons and event composition references after visual review. **Not a declaration that the full living-city animation scope is complete.** No PR should be merged without visual review.
