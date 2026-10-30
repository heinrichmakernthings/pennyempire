# Living Bristol — delivery and integration

Phase 1 Pixel Tycoon × Market Terminal retained. This branch adds actual runtime PNG atlases, fixed-frame SVG state animations, manifests, source provenance and a rendering fixture. **Useful static expansion delivered; Phase 2 is not fully complete.** See MISSING-ASSETS.md before claiming walking characters, all transport directions or fully certified free placement.

## Delivered

- 12 new building upgrades plus 6 inherited tier-one buildings: three visual tiers for each of six industries.
- 6 state-service buildings, recognisable by equipment, architecture and emblems; names remain dynamic.
- 11 environment additions (including alternative shop/warehouse/terrace buildings, park/advertising/transport props).
- 16 vehicle views: four van, four small lorry, four car, two bicycle, one forklift, one service van.
- 16 new idle character views: owner, office worker, customer and construction worker, four directions each. Existing pedestrian, factory-worker and courier sources remain in Phase 1.
- 10 four-frame UI state strips (40 exact 24×24 frames), animation sampler and reduced-motion behaviour.
- Dynamic company name/colour/level overlay helper and live art fixture.

## Files

`assets/art/phase2/runtime/*-atlas.png` are the exported images for integration. `manifest.json` declares source file, exact atlas rectangle, logical dimensions, bottom-centre pivot, reserved plot and usage. `contentRect` identifies visible artwork within the preserved frame. `sourceArtwork` points back to the unmodified generated source. `manifest.csv` is the review-friendly inventory. `animations.json` specifies exact state frames and timing.

Sources are not runtime atlases. Use compiled PNGs or inherited tier-one atlas references, never arbitrary crops from the source sheets. Rejected courier walk imagery is deliberately absent from the runtime manifest. The compiler retains two transparent pixels of atlas separation; sampling is nearest-neighbour with mipmaps disabled.

## Integration

1. Load `assets/art/phase2/manifest.json`; load each unique image source once. It uses the existing Phase 1 `drawSprite(ctx,{manifest,images},id,x,y)` interface without redesign.
2. Resolve company assets as `${industry}-t${level}` for levels 1–3. Frame dimensions, pivots and reserved plots match the Phase 1 industry entries. Do not expand occupied land merely because machinery changes.
3. Depth-sort actors/buildings by world position. Plot reservations are inherited integration contracts, not newly certified collision polygons. Preserve Phase 1 placement restrictions until arbitrary adjacency tests pass.
4. Display names through `tools/living-bristol/overlays.js`; do not bake them into building textures. The colour accent is a label overlay, not a recoloured shopfront. Shopfront recolour masks remain missing.
5. Use vehicle facings from movement direction, interpolate position in world coordinates, and trigger delivery indicators from server-confirmed events. Vehicle sprites are static; no claim of wheel animation.
6. Load state SVGs once and select frames using `animationFrame`. Reduced motion selects frame 2. One-shot events must be removed by the caller after 800ms; persistent statuses loop only while authoritative state requires them. Indicators do not replace accessible text.
7. Bind state names to actual status, not guessed profit or simulated client timers. Business expansion uses the expansion indicator until the upgraded server asset ID is confirmed.

## State services

| ID | Dynamic name | Visible identity | Intended interaction |
|---|---|---|---|
| penny-energy | Penny Energy | Transformers/controlhouse | Energy supply |
| penny-ads | Penny Ads | Warehouse and blank roof billboard | Advertising spend |
| penny-logistics | Penny Logistics | Loading depot | Delivery contracts |
| central-property | Central Property | Key emblem/estate office | Plot leases |
| national-bank | National Bank | Stone facade/coin emblem | Fictional banking |
| penny-exchange | Penny Exchange | Commercial hall/chart emblem | Markets |

## Review and rebuild

Serve repository root with `python -m http.server 8765`; open `/tools/living-bristol/`. The fixture demonstrates tier switching, editable labels, vehicle movement and state pulses with no backend. Browser execution remains unverified in this environment; Native Canvas verified all runtime frames.

Rebuild: Python `tools/living-bristol/measure.py` (Pillow/numpy/scipy), then `node tools/living-bristol/compile.mjs` (@napi-rs/canvas). Generate overlays with `make-overlays.py`. Run `node tools/living-bristol/validate.mjs`; render contacts with `review.mjs`. Rebuild file inventory using `catalogue.py` last.

## Validation performed

All 67 manifest entries rendered through the existing drawSprite API at logical scale on a checkerboard; tier/state/environment/vehicle/actor sheets inspected. Six industry tiers retain exact Phase 1 container sizes/plot reservations. New idle people use 40px height. Atlas bounds/anchors, all IDs, ten animation timing sequences and reduced-motion choices checked by executable assertions. No browser/mobile or general collision/pathfinding verification is claimed.

Uniform authored pixel density remains a Phase 1 limitation. No new camera/palette/light direction was intentionally introduced. Fit-to-frame exports preserve aspect ratio and original logical bounds, but cannot guarantee pixel-perfect geometric identity of AI-drawn architecture.
