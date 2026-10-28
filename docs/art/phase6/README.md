# Phase 6 — Living world art pack

Branch: `art/phase6-living-world`, stacked on `art/phase5-markets-prestige`. Visual direction remains Pixel Tycoon × Market Terminal. No backend or active company-management files are changed.

Start with [audit](AUDIT.md), [screen specifications](SCREEN-SPECIFICATIONS.md), [asset inventory](ASSET-INVENTORY.md), [city catalogue](CITY-CATALOGUE.md), [integration handoff](INTEGRATION.md) and [outstanding work](OUTSTANDING.md). Manifest: `assets/art/phase6/manifest.json`; event/animation/state metadata lives alongside it. Source provenance and prompts are retained.

Serve the repository root using `python -m http.server 8000`, then open `http://localhost:8000/tools/living-world/`. This is a standalone review fixture with illustrative EC amounts, not the game engine or a replacement frontend. There are no live economic writes.

## Reproduce exports and checks

- `node tools/living-world/export-assets.mjs`: exact-size runtime PNGs and contacts; requires @napi-rs/canvas.
- `python tools/living-world/build-icons.py`: authored SVG icon set and mappings.
- `node tools/living-world/compose.mjs`: city/logistics/state compositions and metadata; requires @napi-rs/canvas.
- `python tools/living-world/validate-assets.py`: read-only dimensions/alpha/anchor checks and checksummed file catalogue; requires Pillow.
- `node tools/living-world/qa.mjs`: ephemeral local server and browser workflow/capture checks; requires Playwright and Chromium. Set CHROMIUM_PATH if Chromium is outside Playwright's managed browser directory.

Use NODE_PATH for a system installation of Node dependencies. No package-lock/backend dependency changes are required by this art pack. Review screenshots in `docs/art/phase6/qa`; contact sheets in `assets/art/phase6/qa`. Production-ready static exports are provided, while source-grid and visual approval remain explicitly pending. See QA and outstanding reports before integration.
