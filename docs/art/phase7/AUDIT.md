# Phase 7 repository audit

Base: Phase 6 `a9a0440bc33d34b953fb87a57eea64a73f1fff42`, tree `a46b1e249e0b4732a5b4ea169b995987aee8db2b`. Work branch `art/phase7-npc-living-city`. Art branches remain review submissions, not automatic final source-grid certification.

Read README, AGENTS, design-system/tokens, Phase 1–6 manifests and animation/outstanding specifications. Compared Bristol district rendering, Phase 2 actors, prior state/transport art, Phase 5 prestige and Phase 6 city/news references. Latest available implementation audited: `feature/commodities-exchange` at `26a8a20fdd74edecb48ad0764dd04fd485e623f0`, including seed companies, demand allocation, exchange contracts/docs and current exchange screenshot. No separate NPC-economy feature branch was exposed in the initial fetch. Read-only inspection; no implementation files changed.

## Existing assets and actual engine boundaries

- World actors already use 24×40 frames and pivot [12,40]; four diagonal directions. Phase 2 supplies owner, office-worker, customer and construction-worker idle views. Phase 1 supplies pedestrian/factory/courier idle art.
- Phase 2 courier walk study is explicitly rejected for inconsistent facing. Do not reuse it as a valid animation.
- Character walk target is four phases, 120ms each, 24×40. Retain this rather than invent a new world resolution.
- Vans/lorries/cars already have directional exports; prestige cars and trophy decorations exist. Reuse. New vehicle bodies are lower priority than missing character motion.
- Phase 6 supplies empty rack, boarded panel and maintenance crate, but fully shuttered shopfronts remain incomplete.
- Phase 3 state pulses and Phase 6 Penny Post/event templates already exist; add character identity and local-competition data, not duplicate entire icon systems.
- Engine has actual NPC company owners, reputation basis points, funded demand, retail allocations and finite stock/cash. `allocateDemand().share` is attractiveness weight, NOT necessarily realised sales share. UI market share must define a period/market/metric and divide comparable realised totals.
- Retail goods (pizza/café drinks) differ from commodity exchange volume. Do not combine household retail sales, intercompany trades and contracts into an unexplained ranking.
- Existing owner IDs identify firms/owner records, not these new fictional human personas. Persona-to-company bindings are proposed cosmetic metadata; preserve engine owner IDs and player/state distinctions.
- Local contracts settle goods/money/fees atomically. Delivery artwork can replay a confirmed transfer; it cannot reserve inventory, introduce transit delay or settle a trade. No live customer path/queue telemetry or acquisition simulation is assumed.

## New asset classes

Portraits are a new UI class: 96×96 portraits and 48×48 avatars (exact 2:1 export relation). These sizes do not alter the approved 24×40 world scale. Neutral/positive/negative are presentation reactions; personality copy never changes economic rules by itself. Names and company branding remain dynamic text.

Final pre-delivery fetch: `feature/commodities-exchange` remains at `26a8a20fdd74edecb48ad0764dd04fd485e623f0`. No active Claude implementation branch was modified.
