# State enterprises, monetary policy, inflation and economic events (Prompt 8)

Everything here runs in the real engine (`server/engine/*`), is written to the immutable double-entry ledger, and is covered by tests (`server/engine/stateEconomy.test.ts`, 37 tests) and deterministic scenarios (`docs/engine/eco-scenarios/`). The simulated GBP wallet is untouched: every figure on this page is in Empire Coins.

## 1. State-company architecture

Six state-owned companies are ordinary rows in `companies` (`owner_kind = 'state'`) with their own treasury account, staff, wages, tick statistics, cap table (`securities`) and ticker on the Stock Exchange from day 7:

| Company | Id | Sells | Ticker |
|---|---|---|---|
| Penny Energy | `co-bristol-energy` | electricity (grid capacity, tariff) | BENR |
| Penny Ads | `co-bristol-media` | advertising campaigns | PADS |
| Penny Logistics | `co-penny-logistics` | delivery of traded goods | PLOG |
| Central Property | `co-bristol-estates` | leases, rent, premises purchase | BEST |
| National Bank | `co-national-bank` | loans and savings | NBNK |
| Penny Exchange | `co-penny-exchange` | commodity, share and listing venue | PEXC |

**One shared service interface** (`stateServices.ts`): `chargeService()` is the only way a business pays a state company. It writes one ledger *transfer* (`operating_cost`, payer → provider treasury), one immutable `service_charges` row, honours an idempotency key (a repeated charge is a no-op) and can never overdraw the payer. Tick-level expenses (energy, rent, advertising) use the same table via `recordPaidService`. Provider reports (`providerReport`) read revenue, customers, wages and profit from these books.

**State companies do not have unlimited balances.** They are funded by recorded opening issuance, earn from customers, pay wages to households, and a state company short of cash on payday receives treasury *liquidity support* (a transfer from the state treasury, logged). Dividends use the Prompt 7 engine: only real treasury surplus is paid; the National Bank additionally never pays out its founding lending capital or depositors' money.

**Explicit sinks.** A small share of each provider's service revenue (`stateServiceBurnBps`, default 2%) is destroyed as "infrastructure wear" and a share of the Penny Exchange's newly earned fees (`exchangeBurnBps`, default 25%) is burned. Both are separate `sink` / `sink_fee` ledger transactions with explicit memos. Everything else a business pays the state is a transfer that stays in circulation.

## 2. Services

* **Penny Energy** (`energy.ts`). Production draws electricity from a finite daily grid (sum of `energy_sources`; a player-owned producer is just another row). When the grid runs short, lines are limited by `energy` (or `disruption` when an event caused it), recorded in `production_log` and `energy_daily`. The tariff follows yesterday's load: no surcharge below 80% load, up to +60% at 100%, times any event modifier. Electricity is billed through the shared interface.
* **Penny Ads** (`ads.ts`). Five campaign types (local, billboard, digital, industry-wide, contract ≥14 days at a 15% discount), tiers 1–3, billed daily, at most 3 active per company. Effective spend = spend × efficiency × reach modifier × (1 − competitive dilution, up to 50%, from rivals' spend in the same industry). Standing marketing and all campaigns feed **one** saturating awareness curve (half of the ceiling at `awarenessHalfSpendMinor`) with a hard cap (`awarenessMaxBps`) and 5%/day decay, and awareness weights consumer choice. A campaign is paid in full or skipped for the day; two unpaid days cancel it. History and an effectiveness report are in `adReport`.
* **Penny Logistics** (`logistics.ts`). Every trade and contract delivery becomes one shipment (`(ref, commodity)` is unique). The seller pays a delivery fee (base + per unit, scaled by distance, capped at 20% of the sale). Settlement is never touched. Goods are held in transit (removed from the buyer, returned on arrival, never duplicated) only when daily capacity is exceeded or an event adds delay. Fees apply only to trades made after the service started (no retroactive charges).
* **Central Property** (`property.ts`). Each non-state company has a lease (rent, service charge, history). Companies that pre-date leases were migrated with their rent unchanged, **no service charge and no retroactive fees**; new or upgraded premises open a new lease with the service charge. Rent is index-linked to the rent modifier. A company can buy its premises (one transfer to Central Property); owners pay rates only.
* **National Bank** (`bank.ts`). Lends only coins it holds (cash minus the reserve requirement on deposits): a loan is a *transfer* from the bank's treasury, not an issuance. Equal principal instalments plus daily interest on the outstanding balance; principal and interest are separate in `loan_payments`. Floating rate = base rate + the loan's credit spread (+ event spread). A "Penny year" is 100 days. Creditworthiness (A–D) comes from the company's age, 14-day profit, arrears, missed payments and previous defaults; the limit is a multiple of average daily profit, and new loans must pass a debt-service test. Missed instalments add a late fee, 5 consecutive misses default the loan, and at liquidation the bank is a senior creditor (repaid from the company's cash before the state's arrears and shareholders); the rest is a recorded loss to the bank. Savings earn the deposit rate paid from the bank's own cash. NPC firms borrow and repay by the same rules.
* **Penny Exchange** (`exchange.ts`). Fees (commodity trades, contract deliveries, share trades, listing fees) arrive in its treasury as transfers and are its revenue; `totalExchangeFees` is read from the trade tables, each fee is recognised once (cursor in `meta`), and `exchangeBurnBps` of newly recognised fees is burned in one labelled transaction. There is no second fee: trades pay exactly the existing marketplace fee.

## 3. Monetary policy (`centralBank.ts`)

Penny Central Bank is a rule, not a switch. Every `cbReviewEveryTicks` (14) days it compares 30-day basket inflation with its target (1%) ± band (1%) and moves the base rate one step (0.25 points): up when inflation is above target + band, down when below target − band, held otherwise; bounded to [0, `cbRateMaxBps`]. Each decision, with its reason and the inflation reading, is in `policy_log` and the Penny Post.

Causal channels (nothing is assumed):
1. **Loans**: effective rate = base rate + spread, so a rate rise raises every existing borrower's interest the next day (tested) and tightens the debt-service test for new loans.
2. **Savings**: deposit rate = base − spread.
3. **Valuation**: earnings value of every listed company is scaled by ±2% per point the base rate is above/below neutral (cap ±30%), so investors' fair-value estimates, and therefore their orders, respond.
4. **Liquidity**: only if the National Bank's cash falls below its reserve requirement (and inflation is not above target + band) may the central bank issue one `liquidity_step` per week (an `issuance` ledger transaction recorded in `monetary_ops`); when inflation is high and the bank holds **surplus above its founding capital** it drains a step (an explicit burn). Loans themselves never mint money.
5. **Stimulus**: the `government_stimulus` event pays households from the treasury (a transfer, never new coins).

Administrators can set the base rate or pause the rule only through the logged admin API (§6).

## 4. Inflation and currency monitoring (`inflation.ts`)

Inflation is measured from **prices**. The Penny Basket is fixed-weight: pizza 30%, café drinks 20%, electricity 15%, commercial rent 15% (fixed reference × rent modifier, so adding shops never looks like inflation), wholesale food 20% (trade-weighted price of wheat, milk, flour, cheese). Each component is a 7-day average relative to its first observation (= 100). Money-supply growth is reported next to the index (`monetary_stats`: circulating, issued, destroyed, transferred, consumer spending, savings, trading value, credit issued, loans outstanding, treasury, base rate) but never feeds it. A falling share price is never treated as destruction: only `sink`/`sink_fee` ledger transactions into the burn account destroy coins.

## 5. Economic events (`events.ts`)

Twelve types: consumer boom, recession, inflation shock, energy shortage, agricultural disruption, construction boom, supply-chain disruption, tourism surge, advertising boom, credit crunch, corporate scandal, government stimulus. Each event has an id (`evt-<tick>-<n>`), type, location (`city-bristol`), affected industries, severity 1–3, duration, trigger (`random`/`admin`), probability roll, stored effects, start and end ticks and an audit trail (`eco_event_log`).

* **Generation is deterministic.** From day 30, every 3 days, an integer hash of `(tick, seed)` decides whether an event starts (18% per check), which eligible type (weighted, with preconditions: e.g. no recession during a boom, no inflation shock when inflation is already high, a scandal needs an eligible NPC company) and its severity (60/30/10%). At most 2 are active; a type cannot repeat within 25 days. The same world replays the same events.
* **Effects change fundamentals only.** Energy capacity/price, delivery delay/capacity/fees, rents, credit spreads and limits, advertising price/reach, household spending, commodity demand and industry output. Modifiers are *derived each day from the active events*, never accumulated, so applying an event twice or re-running a tick cannot stack them. No event sets a price, edits a balance or inventory, or targets a player.
* **One-shots** happen exactly once: the stimulus payment (treasury → households) and the scandal (a public reputation hit to the highest-revenue NPC-controlled shop; a player company is never eligible).
* Events are reported by the Penny Post (`economy`, `policy`, `credit`, `scandal` articles), one article per recorded event.

## 6. Administration and developer dashboard

`/api/admin/*` requires the `x-admin-token` header to equal the server's `PENNY_ADMIN_TOKEN` / `ADMIN_TOKEN` (≥12 chars; unset = administration disabled). Only whitelisted economic parameters (bounded) can be changed, plus base rate, central-bank rule on/off and event start/cancel; a reason is required; every attempt, allowed or refused, is written to `admin_log`; config changes are versioned. There is deliberately no way to edit a balance, an inventory or a ledger entry. The developer dashboard (`/dev/economy`, dev endpoints only) shows currency creation / transfer / destruction, inflation, base rate, state treasuries and revenue, loans and defaults, energy, advertising, logistics, property revenue, active events and bankruptcies, all read from the books.

## 7. API additions

`GET /api/state/overview`, `/api/state/company/:id`, `/api/state/loan-quote`, `/api/state/events`; commands `ad.start`, `ad.cancel`, `loan.take`, `loan.repay`, `bank.deposit`, `bank.withdraw`, `property.buy` (idempotent, via `runCommand`); `GET /api/admin/state`, `POST /api/admin/{param,base-rate,event,event-cancel,cb-rule}`; `GET /api/dev/state`. UI: **State Services** (`/state`), Penny Post economy stories, dev dashboard section.

## 8. Simulation results

Run `npm run eco-scenarios` (`tsx server/cli.ts eco-scenarios all 150`). Full reports with timelines: `docs/engine/eco-scenarios/eco-*.md`. All nine ended with the **ledger reconciling and the share register consistent**. Headline figures (EC):

| Scenario | Days | Final CPI | 30d inflation peak / trough | Peak energy shortage | Min mean profit/day | Bankruptcies | Defaults | Peak loans | Coins start → end | Share index low / end |
|---|---|---|---|---|---|---|---|---|---|---|
| A Normal (demo, 12 months) | 360 | 114.0 | +15.6% / −6.5% | 0 | −50.27 | 8 | 0 | 1,749 | 137,442 → 144,992 | 98.7 / 180.0 |
| B Rapid growth | 150 | 100.3 | +7.3% / −7.4% | 0 | 55.42 | 1 | 0 | 0 | 173,018 → 170,242 | 95.2 / 151.4 |
| C Inflation (6× issuance, no controller) | 150 | 93.8 | +4.9% / −11.9% | 0 | 17.36 | 0 | 0 | 1,195 | 173,018 → **217,409** | 95.2 / 130.4 |
| D Recession | 150 | 96.6 | +4.0% / −11.8% | 0 | 36.98 | 1 | 0 | 297 | 173,018 → 170,807 | 95.2 / 120.5 |
| E Energy crisis | 150 | 89.3 | +27.7% / −27.0% | 53 units | 21.58 | 2 | 0 | 359 | 173,018 → 170,499 | 95.2 / 127.6 |
| F Credit crunch (rate 12%) | 150 | 92.5 | +9.5% / −14.2% | 0 | 47.05 | 2 | 0 | 7,802 | 173,018 → 170,570 | 90.3 / 113.9 |
| G Market crash | 150 | 89.0 | +6.3% / −10.3% | 0 | 47.01 | 1 | 0 | 542 | 173,018 → 170,783 | 95.2 / 124.3 |
| H Solo player | 150 | 87.3 | +6.2% / −13.7% | 0 | 45.20 | 2 | 0 | 948 | 173,018 → 170,538 | 95.3 / 127.2 |

**The essential story (scenario P)** runs the whole chain: Quay Pizza buys a billboard (Penny Ads), pays electricity (Penny Energy) and rent (Central Property), borrows 900 EC (National Bank) and lists 2,000 shares. A severe energy shortage cuts grid capacity to 45% and lifts the tariff: its daily electricity bill rises from 16.20 EC to 37.62 EC and daily profit falls from about 94 EC to 82 EC. The central bank raises the base rate 4 points and the loan's daily interest rises from 0.27 EC to 0.37 EC. Investors trade the shares (price and share index move through real orders), and the Penny Post prints the event, the rate decision and the listing. The ledger reconciles at the end. See `docs/engine/eco-scenarios/eco-P.md`.

### What the scenarios taught us (not tuned away)

1. **Printing coins does not create inflation here (scenario C).** Coins in circulation rose 26% yet the basket fell 6%. Consumer budgets are capped per head and NPC prices follow cost-plus, so extra coins pile up in household and state balances instead of bidding prices up; inflation in this economy is cost-pushed (energy, rent, delivery, wages). That is consistent with measuring inflation from prices, but it means the money supply is a weak lever, and the central bank's rate has most effect through borrowing and valuations. A demand-pull channel would need household spending to scale with wealth.
2. **The price index is noisy.** Café-drink and wholesale-food prices swing with NPC entry/exit and stock levels (café drinks fell more than 40% in one 120-day run), so 30-day inflation ranges of ±25% appear even without shocks. The 7-day smoothing helps; a longer window or median would calm the rule further.
3. **The credit crunch bit prices but not solvency (F).** With a 12% rate and a severe crunch, borrowers still serviced their loans in 150 days (zero defaults): the debt-service test keeps lending conservative. Defaults are reachable (tested by draining a borrower's cash) but the bank's rules make them rare.
4. **Some state companies lose money** (Penny Exchange, Penny Logistics, National Bank pay wages from thin revenue) and rely on treasury liquidity support. That is visible and disclosed, not hidden; it is a balance question for Prompt 9.
5. **Supply chains remain the fragile point.** In the 360-day demo run eight firms fail, mostly farm/mill/dairy after cash-rich NPCs pay out dividends; one fewer firm survives a year than before this change (`tick.test.ts` now expects ≥4 operating non-state firms).

## 9. Exploit tests

Covered in `stateEconomy.test.ts`: duplicate service charges, charge overdraw, repeated/replayed commands (ads, loans, repayments, premises purchase), loan caps and credit limits, repayment above the balance, negative balances, defaults and liquidation priority, repeated ticks (no repeated rent, interest, events or shipments), event determinism and non-stacking, stimulus as a pure transfer, scandals never targeting players, unlimited electricity (supplied ≤ capacity), logistics duplication and goods conservation in transit, rent double-charging, advertising ceiling, administrative permission bypass (no/bad/disabled token, non-whitelisted parameters, out-of-range values, no balance endpoint), state dividends and issuance, and ledger reconciliation after every scenario.

## 10. Limitations and next steps

* City art: state buildings use the approved Phase 5 sprites on the State Services screen; billboard overlays on the city map, logistics/bank buildings on the map, construction and warning overlays are **not** implemented (no approved sprites for logistics; the renderer was not changed).
* No player-owned energy producers yet (the data model supports them: `energy_sources`).
* Logistics is local only; the shipment model is ready for intercity trade.
* CPI noise and the weak money-supply lever (see above); defaults are rare under current credit rules.
* The `state_wear` and exchange burns are small; sink calibration for long games is untested beyond 360 days.
* Deploying to Cloudflare needs the admin token as a Worker secret (`wrangler secret put ADMIN_TOKEN`); dev endpoints stay off.
