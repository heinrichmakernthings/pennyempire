# Phase 4 — company management and marketplace

Runnable frontend reference: [company-marketplace/index.html](../../../tools/company-marketplace/index.html). This additive UI pack extends the approved **Pixel Tycoon × Market Terminal** direction in Operate mode. The authoritative [product brief](../../PRODUCT-BRIEF.md), [design system](../../design/DESIGN-SYSTEM.md) and `src/design/tokens.css` remain unchanged.

## Contents

- Company creation: opportunity, premises, budget/name, quote review and first production setup.
- Management: overview, operations draft, inventory, growth/upgrade review and ownership. The worked management fixture is pizza-specific; it does not implement every industry's forms or recipes.
- Marketplace: commodities, order-book depth, buy/sell ticket, quote review, partial-fill cancellation, supplier profile/contract concept, plus a supply-chain view and component-state gallery.
- [Screen specifications](SCREEN-SPECIFICATIONS.md), [components and states](COMPONENTS-AND-STATES.md), [Claude handoff](CLAUDE-HANDOFF.md) and [QA evidence](QA.md).
- `tools/company-marketplace/`: `app.js` screens/interactions, `components.js` reusable renderers, `styles.css`, `data.js` fixtures and `view-models.d.ts` proposed frontend contracts.
- [Manifest](../../../assets/art/phase4/manifest.json): four new 24×24 SVGs (`arrow`, `info`, `premises`, `contract`) and twelve aliases to existing icons. Approved building sprites and commodity art are reused. No new raster art; financial charts, depth, labels and supply-chain connections remain dynamic HTML/SVG.
- [Screenshot directory](qa/): 25 desktop/mobile captures, with machine-readable browser and behaviour reports.

## Run locally

From the repository root:

```sh
python -m http.server 8876
# Open http://localhost:8876/tools/company-marketplace/
```

Checks: `node tools/company-marketplace/components.test.mjs`, `node tools/company-marketplace/qa.mjs`, then `node tools/company-marketplace/browser-checks.mjs`. Browser scripts require Playwright and Chromium; `NODE_PATH` and `CHROMIUM_PATH` can point to external installations. They start local static servers and do not connect to the engine.

## Scope and integration

All save/create/trade/cancel outcomes are fixture-only demonstrations. There are no backend writes, API integration or production settlement guarantees. Creation, upgrades, protected market/IOC orders, recurring contracts, logistics and share trading require explicit backend capabilities; retain the documented gates until their authoritative APIs exist. Values, addresses, suppliers, timing and local fee calculations must not become game rules. See the handoff's capability table and field mappings before integration.

Branch `art/phase4-company-marketplace` is based on remote `art/phase3-economic-gameplay` at `d20c54a2b4a289a7fa48ecfe8e663b535eac1c8f`. Engine inspection was read-only at `e62eecebb2ab295f39dbb4a7d5fb6bbb2550c615`. Bring additive art/tools/docs into the application deliberately; do not overwrite the engine branch with the art branch's app snapshot.
