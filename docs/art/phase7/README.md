# Phase 7 — NPCs and Living Bristol

Review pack on `art/phase7-npc-living-city`, stacked on Phase 6. No backend changes. This is an integration-ready subset with explicit animation and source-grid limitations, not a claim that every Phase 7 animation is complete.

## Delivered

- Twelve fictional entrepreneurs; each has three 96×96 portraits, three 48×48 avatars and three southwest 24×40 world reaction poses. Names/personality/path mapping: `assets/art/phase7/characters.json`.
- Eight worker strips, covering six launch industries plus delivery and warehouse staff. Each 72×40 strip has idle / work A / work B; two-pose work loop, 240ms per pose.
- A 64×81 shutter overlay and 128×91 agricultural pickup, with transparent backgrounds. Shutter placement is verified for the existing `shop-module` only.
- Seven 24×24 SVG UI icons; dynamic ownership marks, competitor profiles, realised-sales rankings, nine Penny Post article templates and configurable company labels.
- Four atlases, 134 frame records, 32 references to existing actors, vehicles and prestige props. Eight population scenarios reuse appearances, rather than introducing duplicate sheets.
- Runnable desktop/mobile visual reference at `/tools/living-npcs/`, with state-dependent city activity and settled-transfer replay. No connection to real game accounts.

The 110 runtime PNG files include convenience exports and atlases; they do not represent 110 independent new designs. Source artwork, rejected studies, QA contacts and runtime files are separated.

## Review and integrate

Serve repository root with `python -m http.server 8000`; open `http://localhost:8000/tools/living-npcs/`. The fixture imports earlier packs, so retain the stacked Phase 1–6 dependencies. Do not open the HTML through `file://`.

Read [integration](INTEGRATION.md), [screen specifications](SCREEN-SPECIFICATIONS.md), [animations](ANIMATIONS.md), [outstanding work](OUTSTANDING.md), [audit](AUDIT.md) and [QA](QA.md). Machine-readable dimensions, anchors, crops and reuse references are in `assets/art/phase7/manifest.json`; `files.csv` lists files, sizes and SHA-256 hashes. `generation-prompts.json` records source provenance.

Contact sheets: `assets/art/phase7/qa/owners-contact-1x.png`, `workers-contact-1x-2x.png`, `city-states-1x.png`, `logistics-overlay-1x.png`. The GIF shows eight two-pose work loops at 2×; the browser Motion view also displays them.
