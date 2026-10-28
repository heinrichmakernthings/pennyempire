# Phase 5 asset inventory

All files below are RGBA PNGs under `assets/art/phase5/runtime/`. Runtime frame begins at 0,0 and equals logical size. Anchor is bottom centre. Static assets have one frame and no timing. Existing pixels are extracted unchanged where marked reused.

| Filename | Dimensions | Pivot | Footprint | Usage | Origin |
|---|---|---|---|---|---|
| executive-car-sw.png | 68×62 | [34, 62] | [1, 1] | vehicle | New Phase 5 |
| sports-car-sw.png | 68×62 | [34, 62] | [1, 1] | vehicle | New Phase 5 |
| supercar-sw.png | 68×62 | [34, 62] | [1, 1] | vehicle | New Phase 5 |
| luxury-suv-sw.png | 68×62 | [34, 62] | [1, 1] | vehicle | New Phase 5 |
| penthouse.png | 224×285 | [112, 285] | [2, 2] | property | New Phase 5 |
| luxury-townhouse.png | 224×234 | [112, 234] | [2, 2] | property | New Phase 5 |
| mansion.png | 288×283 | [144, 283] | [3, 2] | property | New Phase 5 |
| corporate-hq.png | 288×283 | [144, 283] | [3, 2] | property | New Phase 5 |
| luxury-boat-sw.png | 128×91 | [64, 91] | [2, 1] | waterfront | New Phase 5 |
| trophy-display.png | 32×39 | [16, 39] | [1, 1] | collectible | New Phase 5 |
| exclusive-sculpture.png | 64×81 | [32, 81] | [1, 1] | collectible | New Phase 5 |
| prestige-monument.png | 80×89 | [40, 89] | [1, 1] | collectible | New Phase 5 |
| national-bank-branch.png | 224×194 | [112, 194] | [2, 2] | state | New Phase 5 |
| shopfront-display.png | 32×39 | [16, 39] | [1, 1] | advertising | New Phase 5 |
| wall-advert.png | 64×49 | [32, 49] | [1, 1] | advertising | New Phase 5 |
| promotion-kiosk.png | 64×81 | [32, 81] | [1, 1] | advertising | New Phase 5 |
| penny-energy.png | 224×194 | [112, 194] | [2, 2] | state | Reused Phase 2 |
| penny-ads.png | 288×283 | [144, 283] | [3, 2] | state | Reused Phase 2 |
| penny-logistics.png | 288×283 | [144, 283] | [3, 2] | state | Reused Phase 2 |
| central-property.png | 224×285 | [112, 285] | [2, 2] | state | Reused Phase 2 |
| national-bank.png | 224×285 | [112, 285] | [2, 2] | state | Reused Phase 2 |
| penny-exchange.png | 288×283 | [144, 283] | [3, 2] | state | Reused Phase 2 |
| roof-billboard.png | 64×49 | [32, 49] | [1, 1] | advertising | Reused Phase 2 |
| street-ad.png | 22×83 | [11, 83] | [1, 1] | advertising | Reused Phase 2 |
| digital-sign.png | 22×83 | [11, 83] | [1, 1] | advertising | Reused Phase 2 |
| bus-shelter.png | 64×81 | [32, 81] | [1, 1] | advertising | Reused Phase 2 |

## Inspection artifacts

- `assets/art/phase5/qa/contact-sheet-1x.png`: every sprite at native gameplay dimensions.
- `assets/art/phase5/qa/small-assets-2x.png`: small sprites at exact 2× on alternating light and dark backgrounds.
- `assets/art/phase5/qa/city-composition-1x.png`: existing renderer, native tile dimensions, mixed state/prestige composition.
- `assets/art/phase5/qa/asset-validation.json`: machine checks.
- `assets/art/phase5/files.csv`: complete artwork/metadata file inventory, dimensions, usage, byte sizes and SHA-256.
- `docs/art/phase5/qa/`: desktop/mobile screen and dialog captures plus browser report.

No generated source image is a runtime asset. Source art and exact prompts are retained for provenance and revisions. No pixel-perfect source-grid certification is claimed. Review remains required before merge.
