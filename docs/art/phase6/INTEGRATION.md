# Phase 6 Claude integration handoff

Use the existing React game, not the standalone fixture as a replacement app. The audited company-management and newer commodities-exchange branches already supply DataTable, MoneyValue, StatusLabel, ResponsiveSheet, FinancialChart, ScreenData, art registration/loading and company management. This branch edits only `assets/art/phase6`, `tools/living-world`, `docs/art/phase6`.

## Implement in this order

1. Review the art stack and merge/rebase approved dependencies. Register Phase 6 sprites via manifest; reuse Phase 1–5 IDs, do not create duplicate economic entities for art variants.
2. Bind event icons and THE PENNY POST components to structured server events. All headline, severity, effect, duration and scope fields are data. Do not parse a headline to apply economic effects.
3. Connect `BusinessVisualState` to existing company statuses and confirmed activity. Show quiet/closed/insolvent/bankrupt distinctly; a negative day is not bankruptcy. Suppress actors/production when closed.
4. Add read-only global portfolio and World → Country → City → Neighbourhood navigation. Use available/capability-locked destinations from server. Fixture map is an authored schematic, not navigational geography or distance data.
5. Implement authoritative expansion quotes, shipment lifecycle, tariffs and international contracts before enabling those actions. Persist money flows through existing immutable ledger and idempotent command patterns.
6. Add ownership register, acquisition proposals, eligibility snapshots and votes. Update parent groups/branding only on confirmed closing, never on offer submission or vote acknowledgement.

## Required view contracts

`tools/living-world/contracts.ts` supplies proposed interfaces for events, destinations, expansion quotes, shipments, ownership groups, acquisitions, articles, business visual state, regional reports and capability gates. Preserve the app's existing `Money { currency, minor }` and company/city IDs. All integer currency is fictional EC. GBP_TEST remains separate. No real GBP/EUR/MXN exchange, FX rates or real tariffs are supplied.

Every server-derived view needs authority, version, as-of tick and loading/stale/error status. Null data is unavailable, not zero. Use safe integer minor units, whole commodity quantities and basis-point percentages. Convert only for presentation. Bind article and alert IDs to the same event; deduplicate delivery/milestone events so replay does not replay rewards or create multiple trucks.

### Economic events

An event identifies affected city/industry/company IDs, effective start/end, lifecycle and typed effects. Severity is presentation priority, not a hidden multiplier. Active effects combine only according to engine rules; the client displays them and must not compound percentages independently. Unknown end time displays “end not scheduled”. Policy announcements may have a future effective date. Government stimulus distinguishes a transfer, new coin creation or relief of a sink; its icon cannot decide the ledger entry.

### Expansion

Destination → neighbourhood/name → itemised review → explicit confirmation. Quote has expiry and eligibility version. Production command revalidates destination access, funds, name, occupied plot and quote within one transaction. Retry with the same idempotency key; changed cost requires a fresh review. The reference subtracts a preview commitment only in memory; this is not accounting code. Working capital is an internal transfer and remains part of economic wealth. Do not charge shipping before a contract/shipment exists.

### Logistics

Pending → in transit → delivered; delayed/customs hold/disrupted are explicit exceptional states, not automatic loss. Title/availability follow a contract policy. A received-goods event atomically debits transit inventory and credits destination inventory exactly once. Tariffs, freight and goods price remain separate amounts and ledger destinations. ETA is an estimate; null progress is unknown. No decorative vehicle can settle a trade. Current commodity engine trades are atomic, so timed shipment UI stays gated until supported.

Route lines are graph connections. World paths are schematic and never used to derive distance, tariff or travel time. Mexico City is inland: any future sea route must terminate at an explicit port and transfer to land transport, not sail to the city marker. Airports/ports use logical terminal nodes, with vehicle assets as optional presentation.

### Ownership and groups

Display direct ownership stakes and proposed/owned status. Prevent cycles in the server's corporate graph and distinguish minority investment from controlled subsidiary. Group totals consolidate intercompany transfers and must not add parent valuation to all child valuations. Hostile offers, mergers, votes and approved deals still require confirmed closing before ownership changes. Vote weight uses record-date eligibility; show quorum/deadline/conditions from server. Nameplate edits do not amend legal ownership.

### News

THE PENNY POST supersedes the Phase 5 reference publication title for new integration. Do not modify or regenerate earlier art. Components: compact manual ticker, compact event notification, breaking banner, article card, feature dialog, economic-effect sheet. Use structured actual game events and escaped strings; no fabricated outcomes. Illustrative fixtures are labelled throughout. Ticker advances only on player action in this reference; no compulsory scrolling or flashing. Announcement is not proof an event has already taken effect.

## Sprite and state rendering

Tile 128×64; project `(c-r)*64,(c+r)*32`; warm upper-left illumination; no mirroring. Draw `source/frame` at `anchor-pivot`, nearest-neighbour integer zoom. Footprint reserves map cells; sprite alpha is not collision geometry. Sort by southern footprint extent. Native city frames are inherited dimensions, not new resolutions.

Use `stateRecipes` in `states.js` as executable presentation examples. Ground props/actors are reusable; the boarded panel's attachment offset is demonstrated only for `shop-module`. All other buildings require a reviewed attachment profile. Do not paste it blindly on every facade. Existing badges carry explicit timing in `animations.json`; new raster sprites are static single frames. Static queues are not new walk cycles. Layer terrain → building → attached panel → ground actors/props → state badge → dynamic readable nameplate. No background simulation or random celebration runs in this reference.

## Acceptance and blockers

- Every runtime image is individual RGBA, has exact manifest size/frame/pivot and clear source provenance.
- Compare new city modules with Bristol at 1× and 2×. No downscaled complete-city images in the renderer.
- At 390px, destination selection, costs, shipment state/expenses, articles and vote/expansion confirmations remain usable. Wide tables scroll in named focusable regions; core two-column review amounts fit.
- Escape player/company/news strings; keyboard focus, dialog Escape/return, reduced motion and announced outcomes remain available.
- Do not enable unfinished cargo-ship art, unsupported city elevation, ownership settlement or international APIs by interpreting fixtures as capability declarations.
- Source pixel-grid/footprint certification remains pending human visual review, as in prior phases. No full-city or live global-economy completion claim.

## Latest exchange compatibility

Final audit includes commodities-exchange commit `26a8a20`. Reuse its local supplier contracts, direct purchase/quote flow, commodity IDs and city-keyed market statistics. Scheduled local contract delivery is still atomic, not an in-transit shipment. Extend those contracts with explicit transport/title/tariff policy only after engine support. Exchange fees transfer to the state exchange account before configured burn/treasury sweep; they are not wholly immediate sinks. See AUDIT.md.

The fixture's compact `data.js` records are display samples, not direct assignments to the richer proposed `contracts.ts` types. An adapter must map `eventId` to the card's ID, event lifecycle and typed effects to labels, and `loadStatus` separately from destination/shipment status. Preserve nulls and authority metadata; do not copy fixture assumptions into server domain types.
