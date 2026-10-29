# Persistent economic engine (Prompt 2)

A real, server-authoritative economic simulation that runs without the browser. Pre-alpha, single human player, fictional Empire Coins (EC) only. **No payments, no real-money features.** The browser shows this state; it never computes it.

## Audit and conflicts resolved
* Nothing from earlier milestones is merged: art PRs #4–#6 and the frontend PR #7 are open. This work branches from the frontend branch (`feature/economic-engine`) so the working UI is preserved and the art branches are untouched.
* `docs/ECONOMY.md` is authoritative for recipes (mill 2 wheat → 1 flour; pizza 1 flour + 1 cheese → 1 pizza). The frontend's illustrative fixtures used different ratios (10→8); the engine follows the doc and the UI now shows engine values. Fixtures remain only as the labelled offline fallback.
* `docs/ARCHITECTURE.md` says "select the database after reviewing requirements" — see the decision below. Its "immutable double-entry, integer minor units, idempotency keys, reconciliation, no negative balances" ledger requirements are implemented as written.
* The frontend contract has no "utility/warehouse" industries, so the state enterprises (energy, estates, media, provisions) exist in the engine and ledger but are not exposed as selectable company DTOs.
* ECONOMY.md "transfers to state companies are NOT sinks": implemented — rent, energy, advertising and taxes are `operating_cost`/`state_payment` transfers; only `sink`/`sink_fee` transactions credit the burn account.

## Database and infrastructure decision
| Option | Verdict |
|---|---|
| **SQLite semantics behind one synchronous `Sql` interface — Durable Object SQLite (deploy) / `node:sqlite` (local, tests, CLI)** | **Chosen.** Strict serialisable transactions, CHECK constraints and triggers enforced *by the database*, no network hop inside a tick, Cloudflare-native. A Durable Object processes one request at a time and `transactionSync` is atomic, so ticks, commands and matching are serialised without lock code. The same SQL runs locally, so every test exercises production semantics. |
| D1 | Rejected for the core: no interactive transactions (only `batch`), which makes read-check-write ledger and settlement logic unsafe. Fine later for analytics/read replicas. |
| Postgres via Hyperdrive | Viable for multi-region scale, adds latency and an external dependency; revisit if one world outgrows a single DO. |

* `server/db/` — `Sql` interface, `node:sqlite` and Durable Object adapters, migration runner (`schema_migrations`, append-only), `migrations/0001_init.ts`.
* `server/worker.ts` + `wrangler.jsonc` — DO + assets deployment. **Verified locally under workerd** with `wrangler dev --local`: the Durable Object SQLite adapter migrates, seeds, serves the API, runs 60 ticks and produces *identical* supply figures to the Node implementation (issued 10,017,331 / destroyed 86,004 / circulating 9,931,327 minor units), reconciles, accepts commands, and keeps `/api/dev/*` at 404 by default. Not verified: alarm-driven ticking, production deployment, behaviour across DO eviction/restart.
* `server/node.ts` — local API + background ticker on a SQLite file (`data/pennyempire.db`).
* `server/cli.ts` — `migrate`, `seed`, `reset`, `tick N`, `reconcile`, `sim DAYS`.

## Data model (migration 0001)
Players, cities, districts, plots, industries, commodities, recipes (+inputs), **accounts / ledger_transactions / ledger_postings**, companies (treasury account, owner, staffing, prices, reputation, arrears), production lines, ownership, **inventory + immutable inventory_movements**, **orders / trades**, demand rules, **ticks**, company_tick_stats, demand_tick_stats, supply_snapshots, economic_events, failed_transactions, command_log, quotes. Seeding (`seedBristol`) is idempotent: it creates the fictional Bristol economy once and records every opening coin as a labelled issuance.

Integrity enforced in the database: `balance >= 0` for every account except the mint, `reserved <= balance`, `qty >= 0`, `reserved <= qty`, `qty_remaining <= qty_original`, price bounds, and triggers that make the ledger and inventory log **immutable** (UPDATE/DELETE abort).

## Ledger
Double-entry, integer minor units (100 = 1 EC). `post()` is the only function that moves coins: atomic savepoint, balanced postings, idempotency key (same key + same postings = no-op; same key + different postings = error), and rules — only `issuance` may debit the mint, nothing may credit it; only `sink`/`sink_fee` may credit the burn account, nothing may debit it; no spend below reserved funds. `reconcile()` re-derives every balance, reservation and stock level from the immutable logs and compares. Supply identity: `circulating = issued − destroyed = Σ all non-mint/burn balances`.

## Time
1 tick = 1 in-game day (`realMsPerTick`, default 60 s). `runTick(n)` is a pure function of (database state, config, n): no wall-clock, no randomness, strictly ordered, atomic, and a no-op if already processed. `advanceToNow` catches up after downtime but **replays at most `maxCatchupTicks` (48)**; the rest of the gap is skipped (clock re-anchored, `offline_gap` event) — the world pauses rather than simulating weeks at once. Outcomes depend only on tick number, so downtime delays results without changing them (tested). A failed tick rolls back completely and is recorded.

## Daily order of events
1. **Income** — NPC citizens' income grant (the only post-genesis issuance; scaled by a transparent supply controller) and civil payroll (treasury → households).
2. **State provisioner** creates a bounded fallback stock (≤120 units per base commodity per tick, cap 400) and lists it at 140% of reference.
3. **NPC rules** — full-cost-plus pricing, demand-following production, hire/fire to planned output (players are never touched).
4. **Listings**, **procurement** (IOC limit buys, budget-limited, cheapest asks first), **production** (staffing, storage, inputs; cost basis = inputs + energy).
5. **Consumers** — each demand rule names the account that funds it; budget is a fixed daily amount capped by that account's balance; allocation by a reproducible integer score of price², quality, reputation and marketing; stock caps sales; unmet demand is recorded.
6. **Expenses** (accrual): wages → households; energy, rent, advertising → state enterprises (transfers); unpaid amounts become arrears.
7. **Recycling** — corporation tax (15% of profit) and an idle-cash levy above operating reserves → treasury; NPC dividends → households; state enterprises sweep surplus to the treasury; the treasury burns 1%/day of balance above a reserve (the explicit upkeep **sink**).
8. **Insolvency** after 3 consecutive unpaid days; reputation updates; history rows and a supply snapshot.

## Business economics
Revenue, cost of goods (inputs + capitalised energy, moving-average cost basis), labour, rent (district-indexed), marketing, exchange fees, tax → gross and net profit; cash is the treasury account balance; `net = revenue − cogs − labour − rent − marketing − fees − tax` holds on every stored row (tested). Insolvent companies stop operating; arrears are settled to the state "administrator" on `company.reopen`.

## Marketplace foundations (implemented, used by the engine)
Limit orders with reserved buyer coins / seller stock, price-time priority (execution at the resting order's price), partial fills, no self-trade, idempotent placement, cancellation that releases exactly the remainder, atomic settlement (goods + coins together), seller-paid 1% fee **transferred to the Penny Exchange** (since Prompt 5; see `docs/COMMODITIES-EXCHANGE.md` — only the exchange's separate per-tick burn destroys coins). Players can quote, place and cancel real orders through the API.

## API
`GET /api/health`, `/api/screens/{city,companies,commodities,portfolio}`, `/api/companies/:id[/financials]`, `POST /api/quote`, `POST /api/command` (`company.configure`, `commodity.order`, `order.cancel`, plus `company.fund|withdraw|reopen`). Every write needs an idempotency key and (for configure) an `expectedRevision`; anything the engine does not model (shares, prestige, test wallet, company creation) returns `501 UNAVAILABLE`. `/api/dev/*` exists only when enabled (`ENABLE_DEV_ENDPOINTS`, default on locally, `DEV_ENDPOINTS=false` in `wrangler.jsonc`).

## Running it
```bash
npm run dev:all           # engine server (8787) + web (5173, proxies /api)  — PENNY_TICK_MS=60000 default
npm run server            # engine only            npm run db:reset   # delete the local world
npm run sim -- 360        # 12-month simulation + audit (exit 1 on any accounting anomaly)
# internal dashboard: http://localhost:5173/dev/economy
```
If `/api/health` is unreachable the UI falls back to labelled fixtures and says so. `?source=fixture` forces fixtures.

## Tests (npm test — 200+ tests; `npm run qa:browser` — 112 real-Chromium checks)
Ledger unit + seeded property tests (random op streams incl. duplicates/overdrafts), idempotency, immutability, tamper detection; tick idempotency/order/determinism/rollback; per-tick conservation (Δsupply == issued − destroyed); sources/sinks are labelled; transfers-to-state-are-not-sinks; inventory vs movement log; recipes vs ECONOMY.md; demand allocation; NPC demand with no player actions; expense/price effects on profit; insolvency boundaries (exactly N days, exact-cash boundary, stops operating, reopen); order book integrity; command idempotency/stale revision/ownership; clock catch-up cap; file persistence across reopen; **multi-process races** (6 OS processes: one tick applied, one transfer, no oversold stock, no duplicated goods); API contract + dev-endpoint gating; 12/24-month simulations; supplier-failure scenario.

## Simulation results (see `docs/engine/sim-*.txt`)
12 months: circulating supply 97,000 → 104,419 EC (+7.65%): 107,800 issued (97,000 genesis + 10,800 NPC income grants), 3,382 destroyed; 24 months: +8.55%. Zero insolvencies, zero failed transactions, ledger reconciles, Δsupply == issued − destroyed on every one of 730 ticks. Average tick ≈ 31 ms. **No wealth appears from nowhere** — every coin above genesis is a recorded NPC income grant, bounded by the controller.

Honest observations: consumer spend settles from ~2,590 to ~1,800 EC/day within ~5 months and then stays flat — consumption is limited by NPC household income (wages + dividends + civil payroll), which is the intended "no unlimited demand" behaviour. An unmanaged player pizza shop earns ≈ 0 because the NPC competitor reprices cost-plus and takes share; the passive player's retained profit accumulates (≈ +80 EC/day for the café) and is partly recycled by the idle-cash levy.

## Known exploits, limitations and risks
* **No authentication.** Commands act as the single demo player. Never expose the server or `/api/dev/*` publicly; add invite-only auth, rate limits, CSRF before multiplayer.
* **Worker/Durable Object**: verified under `wrangler dev --local` (see above) but not deployed; alarm scheduling and restart behaviour still need a deployed smoke test. To repeat: `npm i -D wrangler && npm run build && npx wrangler dev --local --var DEV_ENDPOINTS:true`, then `POST /api/dev/tick {"count":60}` and compare `GET /api/dev/economy` with `npm run sim -- 60`.
* **Intermediation is possible and intended**: a player can buy from NPC asks and relist to NPC buyers up to their 150% limit; this transfers NPC margin to the player but cannot create coins. Thin supply makes it more profitable; revisit with player-count growth.
* Wash trading between a player's own companies only costs the 1% fee (a transfer to the exchange; half of it is later burned). Hoarding is slowed (not prevented) by the idle-cash levy; a passive player still slowly drains NPC household liquidity.
* State-provisioner stock is created from nothing (goods, not coins), bounded and sold only for coins; it is the one deliberate goods faucet.
* Insolvent companies keep cash and stock locked (no liquidation/auction yet). Companies cannot be created or sold; no shares, dividends to players, upgrades, events or inflation shocks.
* NPC rules (cost-plus pricing, demand-following production, hire/fire) are what keep the economy stable; they were calibrated by simulation, not derived — expect retuning when more human players exist. Fixed daily consumer budgets and the stipend controller are simple, not a full macro model.
* Quotes are per-tick and only for commodities; the 24 h offline cap means a very long absence skips time (documented, logged).
* `portfolioValue` is 0 in server mode (no tradable shares); net worth = wallet + book value of owned companies.

## Next steps (Prompt 3)
Auth + multi-player accounts and per-player isolation; company creation, plot purchase and upgrades; resting-order UI and depth view; shares, dividends and valuation; player-driven supply contracts; workerd/DO smoke test and load/soak test with many concurrent players; observability (tick latency, anomaly alerts) beyond the dev dashboard; liquidation/auction for insolvent assets; economic events and seasonality; retune NPC rules with more players.
