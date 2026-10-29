# Asset audit — 28 October 2026

## Decision

Enough building designs exist for the first Bristol district. Do not expand building count before proving a composed scene. The immediate gaps were inventory icons, static people, navigation/control icons and road connectivity.

## Added

- `commodities-sheet.png`: wheat, flour, cheese, milk, pizza, timber, energy and delivery carton. Eight source icons, not extracted runtime files.
- `actors-idle-sheet.png`: resident, worker and courier, four idle views each. Twelve sources. Back-facing views are visually similar and require direction/pivot review. Not walk animations.
- `connections-study.png`: road/quay exploration. **Rejected for runtime use**: top-row markings repeat a screen-space T rather than rotating consistently along isometric road axes; quay pieces do not establish all required edge combinations. Keep as a study only.
- `assets/art/ui/`: 16 currentColor navigation/control SVGs plus two 128×64 footprint outlines. Icons have 24×24 viewBoxes and 1.6px strokes. For inline SVG, use currentColor; for external img, set the desired colour in a build step. Add accessible names to the containing button, hide decorative SVGs from assistive technology, and use 44px hit targets.
- `scripts/art/audit_sources.py`: repeatable read-only PNG dimensions and alpha inspection. Requires Pillow.

## Correction to the previous transparency diagnosis

The displayed previews alone do not prove that coloured haze is composited into visible background. Original sheets contain substantial alpha-zero regions, and sampled outside edges were zero except isolated alpha=1 pixels. Many solid object pixels use alpha=254; counting only alpha=255 incorrectly suggests no opaque content. The new report counts alpha>=250 separately. A final checkerboard composite and contour inspection is still required. Do not mark all sheets broken solely because their previews show coloured RGB outside the objects, and do not mark them production-ready solely because they have alpha.

## Blocking integration work

1. Extract source items, normalize logical pixel scale and record pivots/footprints.
2. Compose pizza, cafe, mill and warehouse on one test block. Verify roof/actor occlusion.
3. Build exact road connection geometry in code over the asphalt base: N/E/S/W refer to tile neighbours, projected through the 2:1 transform. Use a four-bit connection mask. Generate lines from tile centre to connected edge midpoints; never rotate a flattened isometric PNG as if it were a top-down square.
4. Build quay edge/corner geometry from the same adjacency map. Keep water animation separate.
5. Verify 48px commodity icons, 24×40 logical actors and 24px UI icons in the actual browser.

## Assets still needed after static validation

- 48 walk frames (three actors × four directions × four frames), consistent foot pivots.
- Remaining vehicle/boat facings for routes actually used.
- Six building upgrade variants, preserving footprint or explicitly purchasing more land.
- Smoke/water animation only after motion/performance tests.
- Prestige car/yacht/HQ later, not blockers for the first scene.

Subtle graphs are code-rendered UI, not missing raster artwork. Profit trend, revenue/expense history and portfolio history need labelled periods, units, empty states and a data-table alternative. No additional chart image pack is needed.

## Generation record

Built-in image generation; approved Bristol screenshot used as style reference. Commodity prompt requested eight isolated pixel icons on alpha, 4×2 layout. Actor prompt requested three archetypes × four directional idle views, 4×3 layout. Connections prompt requested four rotated T-junctions, four endcaps and four quay pieces; visual review rejected its orientation fidelity. Sources preserved without destructive edits.
