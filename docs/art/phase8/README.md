# Living-world asset completion pass

This pass supersedes the overlapping Phase 6/7 outstanding lists. It adds real exports and app bindings; it does not declare the entire game finished.

## Delivered

- Cargo vessel (384×224), cargo aircraft (256×192), executive-office cutaway (384×320), four pickup directions.
- Four directional idles for all 12 owners and eight workers, plus the shared courier. Separate illustrated facings, not horizontal flips. Worker front-right errors were regenerated before export.
- 21 shared cutout rigs × 4 directions × 8 actions = 672 clips, each with four frames. Actions: idle, walk, carry, enter, exit, celebrate, upset, load. 32×48 frames, bottom-centre pivot [16,46], 160ms per frame. These are deterministic articulated cutouts, not hand-drawn animation sheets. Entry/exit locomotion needs scene door clipping; the clips alone do not implement door interaction.
- 32 conservative central-garment accent masks. They exclude heads, hands, equipment and boots; they are not full-uniform recolour masks. Source illustrations remain untouched.
- London, Lisbon and Mexico City district compositions, freight-port berth composition, air-freight apron/runway composition. JSON placements, elevations and PNG previews are supplied. They are modular visual layouts, not full playable cities or surveyed geography.
- Five code-native 2:1 elevation/ramp SVG tiles, 32px height step.
- Runtime city worker loops driven by recorded production, bounded pedestrian motion based on sales volume, one delivery replay per contiguous new server day, stale-data suppression after 20 seconds, reduced-motion and offscreen-tab handling. No historical catch-up replays.
- NPC representative portraits on competitor profiles, with player/state ownership excluded. These are presentation identities; they do not change strategies or ownership.
- Closed buildings are dimmed/desaturated. The existing status badges and dynamic company labels remain in use.
- `/dev/art` read-only review route with character selectors, explicit play/pause, transport/interior previews and world compositions.
- PNGs remain separate build assets instead of inflating JavaScript with inline image data.

## Still outside this completed subset

- Per-building doors, shutters, window/light masks and sign slots beyond the previously reviewed shop-module profile. Dimming is not a fully abandoned facade replacement.
- Door entry/exit integration in the live city, unique pedestrian identities, full-garment recolouring and player cosmetic entitlement integration.
- Fully populated playable international cities; port/airport route simulation; moving vessels/aircraft and settled shipment-event bindings. Layouts and sprites are available, but no international economic action is enabled.
- Distinct-customer counts and historical customer-growth comparisons. The engine exposes sales volume, which is not labelled as distinct customers.
- Native-pixel artistic certification. Generated sources have detailed raster shading; `productionCertified:false` remains accurate.

## Validation

`npm run build` passes. `node --test tools/living-finish/validate.test.mjs` passes: stale/closed suppression, bounds and malformed activity, replay deduplication/backlogs, alternating rig phases/reduced motion, 91 transparent sprite exports, all 672 clip bounds and five layout references.

The desktop/mobile Playwright script is included but did not run: no Chromium executable is installed and its download failed. Full Vitest stalled without producing test results and was stopped; it is not reported as passing. PNG contact/layout previews were inspected directly, including correction of clipped layout edges and berth alignment.

## Rebuild

On the application/deployment branch, run `node tools/living-finish/export.mjs`, `node tools/living-finish/bake-rig.mjs`, `node tools/living-finish/uniform-masks.mjs`, and `node tools/living-finish/world-layouts.mjs` in order. Sharp and @napi-rs/canvas resolve from the project or `CODEX_PRIMARY_RUNTIME_NODE_MODULES`. The pure rig source is `src/city/actorRig.ts`. Browser QA additionally needs Playwright/Chromium and local app/API servers on 4173/8787.

All project assets live under `assets/art/phase8/`. Built-in image generation produced the raster sources; crop, nearest-neighbour sizing, atlas packing and rig baking are deterministic scripts. Terrain is code-native SVG geometry. Rejected opaque-background and repeated-stride studies are excluded from the manifest.
