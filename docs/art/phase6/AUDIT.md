# Phase 6 repository audit

Art base: `origin/art/phase5-markets-prestige` at `f4310e3627bcba5fd3a10f25e6cff7fd9f7ba6f2`. Phase 5 remains a draft review branch; prior delivery is not automatically final art certification. Dedicated branch: `art/phase6-living-world`.

Latest active implementation inspected read-only: `feature/company-management` at `48494cb90bafce17e001dfaa5959c7a74b22f532`; economic-engine at `e62eecebb2ab295f39dbb4a7d5fb6bbb2550c615`. Read current README through GitHub connector, AGENTS, company-management docs, frontend data-source types, design system/tokens, prior screen specifications, manifests, missing-asset reports and event composition mappings. Viewed approved Bristol visual, Phase 2 environment/state art, Phase 3 state/icon sheets, Phase 4 company reference, Phase 5 contact sheet and Claude's current company dashboard screenshot.

The engine supports Bristol company creation, production, upgrades, insolvency and bankruptcy. Cross-city shipment settlement, tariffs, international expansion, corporate ownership transfers/voting and economic-event effects are not demonstrated implemented capabilities. Keep Phase 6 reference data explicitly illustrative and server capability gated. Current commodity settlement is atomic, not a timed shipment.

## Reuse decisions

- Reuse lorry SW/SE/NE/NW, forklift, warehouses, state distribution centre, cranes, customer/construction-worker idle sprites and crates. Do not create duplicates to inflate delivery counts.
- Reuse Phase 3 production, missing-input, loss, high-demand, construction, closed, bankruptcy, new-ownership, major-success and shipment indicators. Existing strips already define four 24×24 frames and timing.
- Reuse Phase 4/5 table, dialog, money and notification conventions; extend Claude's React components at integration time.
- Add city-specific architectural/prop modules, customs/freight/container modules, and three physical decline props. London terraces/industrial buildings can also reuse Bristol modules.
- Add only missing event/route/vote icon geometry; map existing financial icons to applicable events.
- Cargo ships and full airports require larger approved frames/footprints. No miniature vessel or ordinary warehouse is mislabelled as a completed cargo ship/airport.

Grid remains 128×64, orthographic 2:1, integer zoom, nearest sampling, warm upper-left light. Existing logical frames and bottom-centre pivots are reused. No active implementation file is modified.

## Final freshness check

A final fetch found Claude's newer `feature/commodities-exchange` branch at `26a8a20fdd74edecb48ad0764dd04fd485e623f0`. Read `docs/COMMODITIES-EXCHANGE.md` and supplier-contract implementation, inspected exchange desktop screenshot. It now supports local order-book depth, protected market/direct orders, partial fills, expiry, contextual procurement and recurring local supplier contracts. Contract deliveries settle atomically on schedule. Orders/stats are city-keyed but Bristol-only; documentation explicitly says no cross-city transfer. Phase 6 international lifecycle remains proposed.

Fee routing has advanced: seller fees transfer to Penny Exchange; a configured portion is subsequently burned and the rest swept to treasury. Do not describe the full exchange fee as an immediate sink. Coffee beans and packaging are now registry commodities supplied by a bounded state provisioner. Reuse the registry and local contract system instead of replacing them. No files on that branch were edited.
