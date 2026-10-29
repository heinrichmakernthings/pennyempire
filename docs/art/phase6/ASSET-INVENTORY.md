# Phase 6 asset inventory

All runtime sprites use RGBA transparency, integer nearest-neighbour scaling and the inherited 128×64 grid. Pivot is bottom-centre. Frames reserve existing approved canvas sizes; `contentRect` records the occupied alpha bounds so padding is explicit. Footprint is a placement reservation, not a tested collision mesh. No source is claimed hand-grid certified.

| ID / runtime filename | Pixels | Pivot | Footprint | Intended use | Origin |
|---|---|---|---|---|---|
| `london-commercial.png` | 224×265 | [112, 265] | [2, 2] | city-london | new static |
| `london-office.png` | 224×285 | [112, 285] | [2, 2] | city-london | new static |
| `lisbon-tiled-shop.png` | 224×265 | [112, 265] | [2, 2] | city-lisbon | new static |
| `lisbon-waterfront-store.png` | 288×283 | [144, 283] | [3, 2] | city-lisbon | new static |
| `lisbon-retaining-wall.png` | 64×49 | [32, 49] | [1, 1] | city-lisbon | new static |
| `mexico-city-shop.png` | 224×265 | [112, 265] | [2, 2] | city-mexico-city | new static |
| `mexico-city-market-stall.png` | 64×81 | [32, 81] | [1, 1] | city-mexico-city | new static |
| `mexico-city-workshop.png` | 288×283 | [144, 283] | [3, 2] | city-mexico-city | new static |
| `freight-container.png` | 128×91 | [64, 91] | [2, 1] | logistics | new static |
| `customs-office.png` | 224×194 | [112, 194] | [2, 2] | logistics | new static |
| `air-freight-terminal.png` | 288×283 | [144, 283] | [3, 2] | logistics | new static |
| `boarded-window-panel.png` | 64×49 | [32, 49] | [1, 1] | business-state | new static |
| `empty-stock-rack.png` | 64×81 | [32, 81] | [1, 1] | business-state | new static |
| `maintenance-crate.png` | 32×39 | [16, 39] | [1, 1] | business-state | new static |
| `warehouse-module.png` | 288×283 | [144, 283] | [3, 2] | reused-logistics | existing export |
| `terrace-module.png` | 224×234 | [112, 234] | [2, 2] | reused-environment | existing export |
| `shop-module.png` | 224×265 | [112, 265] | [2, 2] | reused-environment | existing export |
| `lorry-sw.png` | 128×91 | [64, 91] | [1, 1] | reused-logistics | existing export |
| `lorry-se.png` | 128×91 | [64, 91] | [1, 1] | reused-logistics | existing export |
| `lorry-ne.png` | 128×91 | [64, 91] | [1, 1] | reused-logistics | existing export |
| `lorry-nw.png` | 128×91 | [64, 91] | [1, 1] | reused-logistics | existing export |
| `forklift-sw.png` | 68×62 | [34, 62] | [1, 1] | reused-logistics | existing export |
| `penny-logistics.png` | 288×283 | [144, 283] | [3, 2] | reused-logistics | existing export |
| `customer-sw.png` | 24×40 | [12, 40] | [1, 1] | reused-environment | existing export |
| `construction-worker-sw.png` | 24×40 | [12, 40] | [1, 1] | reused-environment | existing export |
| `crane.png` | 96×146 | [48, 146] | [1, 1] | reused-logistics | existing export |
| `crates.png` | 32×39 | [16, 39] | [1, 1] | reused-logistics | existing export |

Runtime paths are `assets/art/phase6/runtime/<filename>`. `sourceArtwork`, `sourceCrop` and `reusedFrom` identify source and reuse. Do not load high-resolution source originals into the game.

## UI and metadata

Thirteen SVG icons are 24×24 viewBox, currentColor with consistent stroke. `penny-post.svg` is the publication mark; other icons use token-derived color in UI. `event-icons.json` maps twelve event IDs and six shipment lifecycle states to existing or new icons. `animations.json` records every static sprite and reused badge frame order/timing. `business-states.json` records nine reusable compositions.

`files.csv` lists all Phase 6 art files with PNG dimensions, byte size and SHA256; manifest.json is the runtime authority. Screenshot dimensions live in browser-report.json and PNG headers. Contact sheets are review artifacts, never flattened game backgrounds.

See OUTSTANDING.md for partial and absent items.
