# Missing assets and integration limits

## Finished files awaiting visual approval

15 commodity PNGs plus atlas; 27 terminal SVG icons; six production glyph animation sheets; eleven additional state/event animation sheets; reused Phase 2 strip references; complete business/lifecycle mappings; eight reusable static event composition recipes; five inspected contact sheets; presentation utilities and terminal pattern fixture. All new animation sheets have SVG and PNG representations. File names, sizes and usage are in `assets/art/phase3/files.json` and `files.csv`.

## Partial scope — do not advertise as complete

- Production motion is delivered as industry-specific **24px activity glyphs**. Wheat field growth, harvest actors, mill facade machinery, dairy pipe animation, oven-window fire, barista gestures and timber-yard machinery attached to building artwork remain outstanding. Reliable per-tier attachment masks are needed before those can be produced without altering approved buildings.
- Market activity reuses approved static sprites with explicit event compositions. The pack does not add working/carrying/entering/walking actor frames or vehicle loading/unloading frames. Enclosed delivery vehicles can use the cargo badge and shipment data; they do not show a newly painted load.
- Ownership/growth signals are modular badges and existing dynamic nameplates. Recolourable facade masks, custom shopfront lettering masks and exact machinery/door coordinates remain outstanding from Phase 2.
- Pixel density of generated detailed artwork and arbitrary footprint collision compatibility remain uncertified, as already recorded in Phase 1/2. No replacement artwork is introduced to conceal this limitation.

## Integration blockers / acceptance gates

- The inspected Claude branch `origin/claude/keen-allen-axrbsr` (38879cb at inspection) exposes fixture-backed frontend data, not the requested Phase 2 economic event protocol. Production active/blocked reasons, active upgrade jobs, shortage thresholds, shipment routes and lifecycle milestone events are not present in the inspected contract. Claude must wire authoritative equivalents; do not infer them from local animations or upgrade availability.
- Only seven commodity IDs exist in that fixture. Eight mappings (including packaging) require engine ID agreement. They are marked proposed in the manifest, not silently inserted into backend enums or recipes.
- Read-only contact-sheet rendering and presentation tests passed. The HTML fixture and real game integration still require browser QA, accessibility checks, DPR/zoom review and performance measurement with the intended visible company count.
- Review the art branch stack before merging. Phase 3 depends on unmerged Phase 1/2 assets. This PR is intentionally based on the Phase 2 art branch, not on main or Claude's working branch.

None of these omissions prevent use of the completed icons and overlays. They prevent claiming that every requested in-world production and logistics animation is finished.
