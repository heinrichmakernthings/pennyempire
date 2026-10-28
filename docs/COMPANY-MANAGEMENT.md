# Company creation, management and profitability

Prompt 3 turns the economic engine into a playable business game. Everything here is server-authoritative and goes through the immutable ledger.

## The loop
Opportunities → Start a company → Buy supplies → Manage → Produce → Sell → Profit or loss → Upgrade, or fail.

* **Opportunity finder** (`/opportunities`, `GET /api/opportunities`). For each of the six industries: demand, rivals' sales, unserved demand, saturation, startup cost, ingredients, and a profit **FORECAST** (always labelled). It is computed from the last 7 simulated days (on day 0 from rivals' production plans and demand funding). Reasons and warnings explain why, e.g. why a flour mill can beat another pizza restaurant: fewer rivals, and customers who must buy to keep producing.
* **Creation wizard** (`/start`, `GET /api/startup-quote`, command `company.create`). Industry → plot → premises tier and name → itemised bill → confirm. The server re-quotes inside the transaction and refuses if the total changed. Licence fee is destroyed (a sink); fit-out goes to Bristol Estates and equipment to Bristol Works (transfers, not sinks); working capital goes into the new company.
* **Dashboard** (`/companies`): overview (plain-English diagnosis, local ranking, history), operations (production log, suppliers and "buy supplies now", staff, equipment, advertising), controls (price/ask price, staff, quality, target, auto-purchasing, cash in/out), upgrades, financials.
* **Failure**: unpaid bills → insolvent → bankrupt after `bankruptcyAfterTicks`. The administrator sells stock at 50% of cost, pays arrears first, writes off the rest (limited liability), returns any cash, frees the plot. No bailouts.

## Rules that make decisions matter
* Capacity = workplace capacity × staffing × equipment condition. Extra staff cost wages but add no output.
* Hiring or dismissing costs one day's wage per person, max 3 of each per day.
* Quality changes ingredient use (basic 90%, standard 100%, premium 125%) and reputation.
* Advertising awareness saturates and decays 5% a day; it is paid to the state ad company.
* Equipment wears 0.2% per producing day; servicing is paid to Bristol Works.
* Production pauses at 5 days of unsold stock (no blind overproduction).
* Wholesale businesses sell to the cheapest ask first, so price wars are real.

## Industries
All six share one data-driven catalogue (`industry_specs`, `industry_tiers`, `upgrade_catalog`; seeded from `server/seed/industries.ts`): Wheat Farm, Flour Mill, Dairy, Pizza Restaurant, Café, Timber Yard. Premises tiers 1–3 map to the Phase 2 building art (`pizza`, `pizza-t2`, `pizza-t3`, …).

## Schema (migration `0002_company_management`, additive)
New tables: `industry_specs`, `industry_tiers`, `upgrade_catalog`, `company_upgrades`, `production_log`. New `companies` columns for premises tier, productivity, energy saving, condition, awareness, equipment cost, pending labour/maintenance, staffing counters, auto-procure, insolvent/bankrupt ticks, write-offs. Existing worlds upgrade in place.

## Starting profiles
`new` (default for the server): 20,000 EC, no company, the two former demo shops are vacant plots. `demo` keeps the two demo shops for tests.

## API additions
`GET /api/opportunities`, `/api/lots`, `/api/rankings`, `/api/startup-quote`, `/api/companies/:id/management`; commands `company.create`, `company.upgrade`, `company.service`, `company.procure`, `company.reopen`, and extended `company.configure` (ask price, auto-procure).

## Verification
`npm test` (240 tests incl. creation atomicity/idempotency, upgrades, bankruptcy, calibration for all six industries, strategy test), `npm run qa:browser` (118 checks), `node scripts/qa/company-journey.mjs` (21-check end-to-end journey). Screenshots: `docs/screenshots/company-management/`.

## Known limits
Phase 4 art does not exist yet; icons use Phase 3 UI icons. Farm and mill margins are thin by design. Staffing/upgrade effects are tuned by simulation, not by long-run balance testing.
