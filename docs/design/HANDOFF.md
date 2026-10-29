# Claude Code handoff

Approved: `assets/art/reference/approved-bristol.png` as visual target; warm amber terminal plus colourful Bristol pixel art. User requested subtle dashboard graphs.

Implemented in this branch: source-art pack, shared CSS tokens, granular asset inventory and art/export contract. No frontend scaffold, gameplay logic, animations or financial charts are implemented yet.

Start with ART-DIRECTION.md and ASSET-INVENTORY.md. Preserve source PNGs; derive runtime exports separately. The generated sheet gutters may contain alpha contamination: use the verification report and visually inspect against both light and dark backgrounds. Do not treat the presence of an alpha channel as proof of a clean cutout.

Frontend component structure: GameShell, FinancialHUD, CityViewport, CityBuilding, CompanyInspector, CompanyFinancials, CommodityMarket, StockExchange, Portfolio, PrestigeShop, SimulatedWallet. City selection and financial state must not be baked into artwork. CompanyInspector exposes Overview / Operations / Financials; Overview shows price, staffing, stock warning and one compact trend. Secondary management stays behind those tabs.

Initial chart data must be explicitly illustrative. Test wallet remains separate from Empire Coins and labelled SIMULATED. Do not imply this artwork implements the economic backend.

Validation before asset approval: transparency, footprint alignment, consistent pixel scale, neighboring tile seams, object occlusion, touch selection, memory budget and readable silhouettes. Animation and upgrade work follows that validation.

Production source artwork generated with the built-in image generation tool. Prompt constraints: approved screenshot as style reference; orthographic 2:1 axes; upper-left light; terracotta/slate/ochre/teal palette; transparent background; no baked text/UI; separated objects. Follow-up extraction prompts removed coloured background haze while preserving object layout. Exact per-file dimensions and alpha measurements are in assets/art/source/validation.json.

## Known generation defect

The three multi-object sheets still contain coloured semi-transparent haze after a targeted background-removal retry. They are retained as visual source only and must NOT be imported as finished transparent atlases. Regenerate individual objects or perform supervised masking before extraction. The three standalone building sources have transparent backgrounds, but still need scale/pivot checks. Do not mark the whole pack production-ready.

## Follow-up audit

Read ASSET-AUDIT.md for updated alpha findings and new inventory/actor/UI assets. Its evidence supersedes the earlier categorical haze diagnosis. The connection study failed orientation review and must not be used as a runtime road atlas.
