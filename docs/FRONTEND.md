# Frontend foundation (Prompt 1)

React 19 + TypeScript (strict) + Vite, `react-router-dom`, `zustand`. Static SPA deployable to Cloudflare (`wrangler.jsonc`, SPA fallback). **No economic backend exists yet**: every number on screen comes from a labelled illustrative fixture.

## Run
```bash
npm install
npm run dev            # http://localhost:5173
npm run typecheck && npm test && npm run build
npm run qa:browser     # after build: real-Chromium acceptance checks (needs Playwright + Chromium)
```
Fixture test hooks: `?fixture=slow` (loading state), `?fixture=error` (error + retry), `?fixture=empty` (empty states).

## Layout
| Path | Role |
|---|---|
| `src/contracts/game-state.ts` | Wire contract from the design handoff (unchanged). |
| `src/domain/` | Pure, tested logic: integer money, fee/quote maths, wallet rules, history gaps, wire-integrity guard, draft validation. **No UI imports.** |
| `src/data/` | `GameDataSource` interface, query cache (`store.tsx`), `useCommand`. `fixtures/` is the only implementation today. |
| `src/city/` | Isometric engine: `geometry` (2:1 projection, footprints), `connectivity` (road/quay masks), `scene` (DTO → drawables), `draw` (Canvas 2D + hit-testing), `camera`, `CityViewport`, inspector and overview. |
| `src/assets/artAssets.ts` | Typed manifest + atlas loader. Frames are cropped from the **unmodified** source PNGs using `assets/art/runtime/manifest.json`; there are no hard-coded offsets. |
| `src/app/` | Shell, HUD, navigation (sidebar / rail / bottom bar + More), notifications, ad slot. |
| `src/screens/`, `src/ui/` | The six management screens and shared components. |

## Fixture vs authoritative state
* All data enters through `GameDataSource`. The fixture source returns `authority: 'illustrative-fixture'`; the shell, HUD and every screen show an **Illustrative data** badge for it. A future server source returns `'server'` and the badges disappear without touching components.
* Every payload passes `assertWireIntegrity` (safe-integer money, integer quantities, bps ranges, known currencies). It already caught a float artefact in the fixtures during development.
* `submitCommand` in the fixture source **always refuses** (`UNAVAILABLE`). Forms validate and keep drafts, the notification region says *nothing was sent*, and no balance, inventory or share count is ever changed locally.
* Quote maths (`domain/quote.ts`) is used by the fixture source only; the UI renders quotes it is given.
* Simulated GBP_TEST appears only on the Wallet screen (permanent **SIMULATED** banner); everything else is Empire Coins. A test asserts GBP_TEST is absent from every other payload, and `addMoney` throws on mixed currencies.

## City rendering contract
2:1 grid, `project(c,r) = ((c-r)*64, (c+r)*32)`; zoom snaps 1×/2×/3×; world uses logical pixels, DPR only changes the backing store; `imageSmoothingEnabled=false` everywhere; the ground is pre-rendered once and cropped per frame; camera/hover live in refs (no React re-render while panning). Hit-testing = footprint polygon (plot geometry) **or** opaque sprite pixel, front-to-back, so a tall roof in front wins and non-selectable scenery blocks selection behind it. Sprites sit with their base `SPRITE_BASE_INSET = 8px` above the footprint's south vertex (bases are ≈87–90% of the footprint, from the manifest sizes).

## Contract proposals (for the server milestone)
1. `ScreenState.city` should return a company **directory** (id, name, plotId, industry, owner, level, status) — the map needs names for every plot, but the contract only returns `selectedCompany`. Implemented client-side as `CityScreenState.directory`.
2. City bounds and cosmetic decor are not in the contract (`MapMeta`, client-side for now). The map size should come from city metadata.
3. No `portfolio` root exists in `ScreenState`; the Portfolio screen composes `holdings + listings + player` (`PortfolioState`).
4. `Industry` has no `utility`/`warehouse`; those buildings are non-selectable scenery in this milestone (the utility is shown as a *state* plot but has no Company DTO).
5. Idempotency keys are generated per user intent and regenerated when the draft changes; `expectedRevision` is taken from the DTO. The server must still own deduplication.

## Known art gaps (unchanged from PRODUCTION-READINESS.md)
Static art only: no walk cycles, upgrade variants, production FX or prestige art for car/HQ/yacht (those items show *Artwork pending* and are unbuyable). Railing prop is not used. Pixel density across AI-generated sources is not perfectly uniform; footprints are integration values. The atlas sources are loaded as the original ~1–3 MB PNGs (≈11 MB total) — an optimised packed atlas is the first performance follow-up.
