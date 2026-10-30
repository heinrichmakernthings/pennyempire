# Phase 4 screen specifications

Visual authority: `docs/design/DESIGN-SYSTEM.md`, `src/design/tokens.css`, approved Phase 1–3 sprites, and the engine branch’s current company/exchange screenshots. This is an extension of the established Pixel Tycoon × Market Terminal UI. The executable visual specification is `tools/company-marketplace/index.html`; all displayed economic values are labelled design fixtures.

## Company creation: a four-decision journey

Target: an unassisted first-time player establishes a company and saves a first production plan in under five minutes. This is a usability target, not a measured playtest result. Estimated budget: opportunity 45s, premises 45s, naming/budget 45s, review 30s, first setup 60s; 75s contingency. Avoid account creation, marketing, share ownership and advanced automation inside this journey.

| Screen / route state | Content and hierarchy | Actions / validation |
|---|---|---|
| `#create`, step 1 | Bristol demand and opportunity finder; six industries; commodity icon, unmet units/day, description, estimated startup outlay; selected approved building and recipe inputs in 336px rail | Select industry, Continue. Retain choice on Back. Demand is observational, never a profit guarantee. Unknown demand shows unavailable rather than zero |
| Step 2 | Eligible premises as a labelled radio list; fictional Bristol address, upfront price, recurring rent and suitability; same plot IDs can highlight City map | Select one server-eligible plot; Continue. If another player acquires it, keep the rest of the draft and request another plot |
| Step 3 | Business name; line-item startup budget; premises, fit-out, opening treasury transfer, total and remaining player funds | Trim name, 2–32 characters in reference; server decides final rules/availability. Validate inline and focus the field. Opening treasury funds are a transfer, not an expense |
| Step 4 | Compact review of name, industry, premises, startup outlay, opening funds, ongoing rent and remaining balance | Explicit acknowledgement, then Create. Live command requires a fresh server quote and idempotency key. Disable during pending; keep draft on error; no optimistic wallet change |
| Confirmation / first setup | New company name, confirmed premises, simple production target and staffing, recipe/input reminder | Buy first supplies deep-links to company+commodity. Save production plan uses permitted company settings. Creation must return actual initial operating state; the UI cannot assume it is producing |

The reference journey is illustrative across all six industries. Its initial staffing, fit-out and production defaults are examples; Claude must replace them with per-industry server defaults and eligible plots. Do not copy the pizza capacity into every industry. A successful live creation response must provide the actual company ID, balances, plot and next action before showing confirmation.

## Company management

Desktop retains a 216px owned-company list inside the content area; selected company detail follows. Mobile replaces the list with a company selector. Header: company name, industry, neighbourhood, owner and operating state. Five tabs: Overview, Operations, Inventory, Growth, Ownership. Do not gate ordinary features behind player wealth or artificial waiting: progressive disclosure is organisational.

- **Overview:** one daily revenue/profit/funds strip; a high-priority input warning; Buy supplies and Adjust production; approved pizza building at native logical scale. One compact seven-day chart with revenue/expenses/profit, named units and zero baseline, plus an accessible data table. A missing day stays a gap. Operating cost breakdown is expandable. Detailed finance remains available without overwhelming the overview.
- **Operations:** production plan, staffing, retail price and quality in a two-column form. Native numeric fields and select controls. Explain units, limits and daily wage cost. Marketing sits under Advanced and is clearly a recurring expense. Save/Discard apply to one local draft. Server validation owns capacity, staffing, cash and quality effects. Report costs from the operating statement; do not double-count capitalised energy.
- **Inventory:** commodity icon, available versus reserved stock, estimated coverage and Buy/Sell action. Storage is a shared company capacity: sum occupied quantities, never the repeated capacity on each inventory line. Suppliers below; recurring agreements expand into their own terms review.
- **Growth:** current-to-next tier artwork, proposed capacity change, quote, requirements and downtime. Disable execution until the server supports upgrades. Business expansion leads back to the opportunity finder. Do not replace the building tier until confirmation.
- **Ownership:** shareholder, share count and basis-point ownership displayed as percent; company treasury and book valuation remain distinct. Investment/issuance controls require server capability and permissions. Do not label book value a tradable market price.

Pizza is the detailed example; content and recipe icons must remain data-driven. The HTML fixture saves only session-local demonstration settings and never calls the engine.

## Commodity exchange

Desktop: 208px commodity selector, flexible selected market, 336px ticket; within the existing 184px shell navigation. The centre shows commodity icon, reference price, daily supply/demand gap, cumulative order-book depth, supplier profiles, then own orders and fill history. Essential numeric data stays ≥14px.

- Commodity rows include price and signed percentage change; no flashing ticker. Current engine `cafe-drink` maps to Phase 3 `commodity-coffee-drinks`.
- Buy and Sell are explicit, persistent ticket states. Select the trading company, whole-unit quantity and price. A company pays from its own available treasury; the global player wallet is not interchangeable.
- **Limit:** display the cap/floor, full reservation and currently executable quantity separately. Unfilled quantity rests until cancelled. Price-time priority and cumulative listed units are readable beside the book.
- **Market (proposed):** show protection price and immediate-or-cancel semantics; never submit a disguised resting limit order. Requires an explicit server capability and protected execution. It is a labelled preview in this reference, unavailable in the inspected engine.
- Review includes company, side, commodity, requested quantity, currently fillable units, protection price, estimated gross, fee, net spend/proceeds, maximum reservation and expiry. Sellers pay the current engine’s 1% exchange fee; buyers have zero exchange fee. Live quotes are authoritative, not values from the demo calculator.
- Partial fills remain visible as filled/requested plus remaining. Cancel confirms the remainder only. Previously filled trades stay in history and fees are not reversed.
- Supplier profiles show known identity, owner kind, district and current listing. Unknown delivery/reliability data reads unavailable; no decorative ratings are invented.
- **Recurring contracts (proposed):** supplier, commodity, units, cadence, duration, price cap, expiry/renewal terms and bilateral acceptance. Proposed lifecycle: draft → offered → accepted/active → completed, paused, cancelled or rejected. Missing delivery pauses and alerts; no silent repricing or supplier substitution. Engine policy and atomic settlement are unresolved capabilities, not implemented by this art pack.

## Supply-chain view

Reusable HTML nodes and CSS/SVG connectors: Wheat Farm → Flour Mill → Pizza Restaurant → Consumers. Each node carries company identity, commodity icon, availability, status and a contextual action. Flour uses the authoritative ratio 2 wheat → 1 flour. Pizza also needs cheese, shown explicitly as a second dependency and bottleneck. The consumer endpoint describes funded demand, not limitless sales.

Connections should come from recipe IDs and supplier/contract IDs. Goods-in-transit UI requires a real shipment state. The inspected engine settles commodity trades atomically, so the shipping example is labelled a proposal; never delay available inventory because an animation is unfinished.
