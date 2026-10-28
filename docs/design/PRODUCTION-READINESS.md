# Phase 1 readiness decision — 28 October 2026

## Decision

**GO for Claude Code Prompt 1: frontend foundation and static asset integration. NO-GO for declaring Phase 1 fully production-ready.** The remaining art and browser checks are explicit below. Do not confuse implementation readiness with a finished game or completed Phase 1.

## Delivered and usable

- Final design system: DESIGN-SYSTEM.md, tokens.css and approved visual target.
- Final specifications for all six requested screens: SCREEN-SPECIFICATIONS.md, including responsive states, commands, errors and subtle graphs.
- Shared typed field/command contract: src/contracts/game-state.ts. Includes ownership, stock reservations, economic values, history, quotes, permissions and a separate simulated wallet. Runtime validation and backend are not implemented.
- Machine-readable runtime manifest: 41 measured atlas frames with source filenames/dimensions, frame bounds, logical dimensions, pivots, plot reservations, usage and status; full image/SVG file inventory and missing/excluded assets. Atlas cropping is performed by the renderer without modifying source art.
- Nine static buildings (all six starting industries plus warehouse, utility and terraces), eight inventory icons, twelve static actor views, eleven usable props; railing is blocked below. Eighteen SVG UI assets.
- Usable reference renderer and standalone art-review page. Procedural terrain, all sixteen exact road connection masks and quay edge masks replace unusable generated road geometry.
- Reproducible measurement, metadata validation and native Canvas render scripts; checked-in visual QA images.
- Concise implementation handoff: CLAUDE-PROMPT-1.md.

## What inspection found and fixed

At intended sizes, naïve equal-cell atlas frames leaked neighbouring props/icons and cut the crane top. Main connected-region measurement fixed those rectangles. Inventory assets now fit 48×48; actors share 40px logical height. A 1× and 2× static district was rendered and visually inspected, with all six industries present. People were moved to unobstructed street positions in the fixture; that does not validate general actor/building occlusion.

Checkerboard composites show transparent backgrounds; the previous categorical haze diagnosis was wrong. Partial alpha exists at edges, but there is no broad opaque coloured backdrop in the rendered accepted frames. The railing frame still contains a tiny neighbouring crane fragment beneath it: do not ship that frame without a silhouette mask or replacement.

## Remaining blockers to full production certification

1. **Uniform pixel density:** normalized display dimensions do not turn varied AI source pixel clusters into one authored pixel grid. At 2× the source styles are broadly coherent but not pixel-perfect. A final art cleanup pass is required if strict uniform pixel scale is a release criterion.
2. **World footprints and pivots:** current southern-edge pivots and 2×2/3×2 plot reservations are integration values, not certified collision geometry. The dense static scene proves compositing, not arbitrary adjacency or roof/actor occlusion. Verify actual footprints before enabling free placement.
3. **Railing:** one blocked prop frame; omit it initially. Quay geometry itself works without it.
4. **Browser QA:** Chromium was unavailable; install attempts failed with a truncated/invalid download. Native Canvas rendering and metadata checks passed; actual browser behaviour, 390/768/1440 layouts, focus, touch, device-pixel ratio and performance remain unverified.
5. **Presentation polish:** procedural ground is geometrically correct but simpler than the approved city. Decorative ground texture, denser scenery and delivery activity remain visual polish work.
6. **Type checking:** contract parsed with Node's TypeScript stripping; a TypeScript compiler was unavailable. Full typecheck belongs in the app scaffold gate.

## Outstanding asset work

48 walk frames; six level-2/3 building variants; unused vehicle/boat directions; smoke/water/delivery FX; prestige car/yacht/HQ/penthouse art; repaired railing. These do not block the first static frontend build. Prestige with missing art must be unavailable, not presented as completed purchasing gameplay.

## Validation actually performed

- All 41 IDs unique; source files present; atlas rectangles inside measured image bounds; logical dimensions positive integers.
- Six initial industries present; eight inventory icons fit 48×48; twelve actors exactly 40px high.
- Projection checked; all sixteen road and quay masks draw the expected number of connections/edges.
- Renderer syntax checked; contract syntax parsed (not typechecked).
- Native Canvas decoded seven source atlases, rendered three checkerboard galleries and the district at 1× and 2×. Inspect docs/design/qa/ for evidence.
- No browser interaction tests or economic tests passed or were claimed. No backend was added.

## Run

From repository root: `python -m http.server 8765`, then `/tools/art-review/` in a browser. `node tools/art-review/validate.mjs` runs dependency-free metadata/geometry checks. Native render check: install `@napi-rs/canvas`, then `node tools/art-review/render-check.mjs /tmp/pe-art-review`. Frame remeasurement requires Pillow, numpy and scipy. Keep sources unchanged.

## Handoff condition

Claude can start Prompt 1 now using this branch. Its first milestone must resolve footprint/occlusion and browser verification, not silently certify all assets. An unconditional handoff describing the art as fully production-ready would be inaccurate.
