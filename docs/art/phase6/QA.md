# Phase 6 QA evidence

## Performed

- Read the Phase 1–5 art conventions and active company-management implementation; recorded exact branch commits in AUDIT.md.
- Exported 27 individual RGBA sprites and checked dimensions, frame rectangles, bottom-centre pivots, nonempty alpha and transparency. Results: `assets/art/phase6/qa/asset-validation.json`.
- Inspected individual sprites in native-scale contact cells, small assets at exact 2× on light/dark grounds, and London/Lisbon/Mexico City alongside the same Bristol warehouse/lorry.
- Inspected nine business-state compositions using the same building. Existing badge sheets supply state signals; new raster assets are static.
- Inspected dock/customs/distribution/air-freight composition; no cargo ship or aircraft is represented as finished.
- Captured 32 full-page browser states: 16 desktop (1440×1000 viewport) and 16 mobile (390×844), covering six routes, four map levels, expansion steps, consequences, customs hold, article feature and shareholder vote.
- Browser workflow assertions cover expansion acknowledgement/confirmation, locked destination, shipment policy preview, news filtering/article, vote selection/acknowledgement, dynamic branding and page overflow. Extra overflow checks cover all six routes at 360, 768 and 1199px. Browser runtime error arrays are empty.
- Own UI review used two bounded capture passes; fixed newspaper column imbalance, mobile schematic-label size, required expansion name and explicit absence of quantified acquisition effects.
- Checked source provenance, machine-readable dimensions, state recipes and animation timings. Existing lorry orientations are individually exported, not mirrored.

## Limits

The Impeccable automated detector was attempted once and could not run: launcher `.codex/skills/impeccable/scripts/impeccable` is absent. No automated design-detector pass is claimed. Independent visual review is recorded separately in REVIEW.md.

Browser screenshots are fixture validation, not production engine tests, full accessibility certification or evidence of live international trading. Loading/stale/error behavior for actual network data is specified but not exercised against a backend. Source-grid certification and visual approval remain pending. Full-map geography, facade-specific attachment profiles, cargo ships and new character animations remain outstanding. See OUTSTANDING.md.

Production integration must test asset loading inside the actual renderer, y-sorting and per-building attachment profiles; authoritative quote expiry/idempotency, shipment inventory conservation and ownership settlement belong to Claude's implementation tests. This branch changes no engine files.

The independent review requested one logistics composition correction (forklift/lorry overlap). Corrected the placement without changing individual sprite art; the reviewer scored F1 resolved and issued `ship` at prototype-handoff scope. This was a verdict on that fix, not a new production-art certification. The final fetch also inspected Claude's newer commodities-exchange branch and updated integration guidance; no active branch files were changed.
