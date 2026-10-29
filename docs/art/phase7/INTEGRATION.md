# Claude Code handoff

Integrate only after reviewing the stacked Phase 1–6 dependencies. Keep this pack's files in their existing paths. New files are confined to `assets/art/phase7/`, `tools/living-npcs/` and `docs/art/phase7/`. Nothing changes engine balances, recipes, ownership or contract settlement.

## Order

1. Read `manifest.json`, `characters.json`, `animations.json`, `branding.json`, `population.json`; use the atlas metadata, exact source frames and foot pivots. Load runtime PNGs, never generated source sheets or QA contact sheets. All new art is explicitly un-certified for strict source-grid purity.
2. Add a presentation-only registry mapping existing company/owner IDs to optional personas. Proposed fixture pairings are not engine data migrations. Unknown persona gets an existing generic avatar, not another company's face.
3. Build the shared ownership mark, portrait, configurable company label and profile detail. Require entitlement for prestige cosmetics. Do not tint whole actors to change uniforms.
4. Adapt actual comparable reports into `contracts.d.ts`. Compute realised sales share from sold units in one city/product/channel/period. Never use `allocateDemand().share` as realised share. Apply display ownership filters after rank and denominator computation; return null for every share and rank when any comparable report is unavailable. Known units/revenue may still be displayed; sorting known units is not a definitive market rank. Use integer minor EC for amounts; display formatting is not financial arithmetic. Keep test GBP wallet separate.
5. Bind `activityPlan` to fresh company reports. The fixture uses one tick staleness and one representative sprite per 20 sold units, max six. This is a configurable visual sampling rule, not a population model. Prefer real queue telemetry if introduced. Zero sales means no large queue; closed/bankrupt means no workers/customers. Stale reports suppress active cues.
6. Bind replay to settled event IDs only. Local contract settlement is atomic; the replay is a retrospective visual cue, not reservation/transit. Use persistent event cursors and bounded visible actors. Fees are transfers to Penny Exchange followed by configured burn/sweep, not automatically all destruction.
7. Attach Penny Post to actual event templates. Do not schedule random bankruptcy/acquisition stories. Derive persona from approved metadata and keep financial outcome fields in the event. Unsupported event types stay hidden.
8. Run the reference and compare native/2× contacts; implement desktop/mobile layouts without altering approved dimensions. Address OUTSTANDING before advertising the full animation set.

## Screen data

| Surface | Required | Optional / currently missing |
|---|---|---|
| City | companyId, lifecycle, current tick, asOfTick, realised units, productionActive | actual queue, approved paths, doorway occlusion anchors |
| Competition | market period/channel/product/unit, company identities, sold units, revenueMinor, reputationBps | previous units, distinct customers, previous rank |
| Profile | persona registry, company name, engine ownerId/kind | cosmetics, flavour biography |
| News | confirmed event ID/type/tick/city/company IDs, dynamic headline/body | approved persona, commodity link |
| Logistics | unique settled transfer ID, endpoints, commodity, quantity | render route/vehicle selection |

`contracts.d.ts` is an adapter proposal, not a declaration that endpoints exist. Existing seed IDs and audit revision are documented in AUDIT.md. Missing metrics display unavailable; no invention from reputation or appearance. Where data.js uses invented companies or news it is labelled a fixture.

## Renderer and performance

Share one decoded atlas per class and one animation clock. Cull by screen bounds before submitting draw calls; cap local visible consumers at six per business and define a global device budget (start 40 desktop / 16 mobile, profile on target hardware). Batch by depth while preserving occlusion. Load city art lazily; the review tool deliberately loads prior manifests for comparison and is not the production asset loader. Paused/hidden scenes should stop requesting animation frames; the reference skips hidden drawing. Use static poses for reduced motion. Do not issue network requests per character or per frame. No GPU/browser performance budget has been certified by this pack.

## Acceptance

- Atlas cells parse without manual cropping; world foot pivots remain fixed at 1×/2×/3×.
- Same shop can show busy, quiet, low stock, closed and bankrupt using layers; closed states remove staff and crowds.
- Rankings use comparable realised outcomes; filtering owners does not change share; new entrants and missing data remain honest.
- One settled event produces at most one replay in the retained event window and no financial write.
- News uses confirmed events, branding stays dynamic, owned cosmetic checks are enforced.
- Keyboard controls, native dialogs, 360/390px mobile workflows and 768/1199/1440px reports remain usable.
- Missing walk/direction frames have explicit static fallback; rejected studies cannot be loaded as finished animation.

Validation commands: `python tools/living-npcs/validate-assets.py`, `node tools/living-npcs/activity.test.mjs`; browser QA uses Playwright with `CHROMIUM_PATH` and screenshots under `docs/art/phase7/qa/`. Export/compose requires `@napi-rs/canvas`. Type declarations were reviewed but not compiled with the game's TypeScript build; no backend/game integration test is claimed.
