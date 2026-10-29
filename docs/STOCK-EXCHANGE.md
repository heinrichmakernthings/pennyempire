# Penny Exchange: shares, ownership, dividends and investment gameplay

Fictional securities in **Empire Coins only**. Shares cannot be redeemed for money, and nothing here touches the simulated GBP wallet. Everything below is implemented in `server/engine/` and verified by the tests named in each section.

## 1. Architecture at a glance
| Layer | File | Role |
|---|---|---|
| Cap table & control | `capital.ts` | investors, holdings, immutable share journal, stake classes, majority control, circular-ownership guard, integrity check |
| Order book | `shareMarket.ts` | limit / protected market orders, price-time priority, partial fills, reservations, fee, atomic settlement, daily price band |
| Listing | `listing.ts` | IPO / follow-on rules, quote, offering as a primary sale, withdrawal, treasury-share retirement |
| Dividends | `dividends.ts` | declaration with a record-date snapshot, earmarked treasury funds, payment, cancellation |
| Valuation | `valuation.ts` | fundamental estimate from the company's own books (never a price) |
| Participants | `securitiesTick.ts` | opening listings, NPC investors, founding-holder float, dividend policy, daily statistics, index, suspensions, news facts |
| Commands/API | `shareCommands.ts`, `server/api/shareApi.ts`, `marketDashboard.ts` | idempotent player commands, quotes, portfolio, developer dashboard |

**Reused, not duplicated:** the double-entry ledger (`transfer`, `reserveFunds`/`releaseFunds`, `reconcile`), the idempotent `runCommand` log, the exchange fee account (fees are transfers to the Penny Exchange which the existing sweep burns/forwards explicitly), and the Prompt 6 news/standings pipeline. The share matcher follows the commodity matcher's structure (price-time priority, resting price executes, reserve-then-match in one transaction) but is a separate module because shares are held by *investors*, not company inventories.

## 2. Ownership model (migration `0005_stock_exchange`)
* Every company is born with **10,000 shares** held by its founder (`share_holdings`), with the founder's real startup cost recorded as issued capital (`securities.paid_in_minor`) and as the holder's cost basis.
* `share_journal` is append-only: `founder`, `issue`, `transfer`, `cancel`, `liquidation`. `checkShareIntegrity()` proves: shares held = shares issued = founder + issues − cancellations, reservations never exceed holdings, shares reserved = shares offered.
* **Investors**: the player, NPC shareholders (households), the state, NPC market participants, and *companies* (a company's treasury can own shares of another company, and holds its own unsold shares as **treasury shares**).
* **Outstanding** = issued − treasury shares. Percentages and dividends use outstanding shares.
* Stake classes (published): minority < 10% · significant ≥ 10% · substantial ≥ 30% · **majority > 50%**.
* The old `ownership` table was copied into the cap table and retired.

## 3. Listing and IPO
`listingQuote()` is the single source of truth for both the wizard and the action: owner control, operating status, 14 days trading, ≥ 1,000 EC revenue in 7 days, ≥ 1,000 EC book equity, no arrears, offering cooldown (30 days), ≤ 100% new shares, the controlling owner keeps ≥ 51% *if every share sells*, offer price between 50% and 200% of the fundamental estimate, and the company can pay the listing fee (50 EC + 1% of the offering value).

**Primary vs secondary accounting** (tests: `shareExploits.test.ts` "IPO accounting"):
* **New issue**: shares are created into the company's *own treasury holding* (journal `issue`) and offered at a fixed price by a primary sell order. Buyers' coins go to the **company treasury**; `paid_in_minor` rises; unsold shares stay treasury shares (no dividend, no dilution until sold). The listing fee is a ledger **transfer** to the Penny Exchange.
* **Founder sale** of existing shares: an ordinary secondary trade; proceeds (less the 0.5% seller fee) go to the **seller's** account, never to the company.
* The founder cannot buy their own IPO and a player's companies cannot trade each other's shares (same ultimate owner).

## 4. Trading rules
Limit and slippage-protected market orders; price-time priority with partial fills; buyers' coins reserved at the limit price, sellers' shares reserved; the resting order's price executes; seller pays 0.5%; whole shares; orders expire. Settlement is one transaction: coins, fee, shares, realised P&L, order state, offering state, statistics.

Safeguards: **daily price band ±20%** around the previous close (when the last close is older than 10 days the band re-centres on the fundamental estimate: an illiquid price never anchors the market forever); idempotency keys; no self-trading, no trading between accounts or ultimate owners that coincide (wash trading is impossible, so it can never inflate volume); selling away majority control needs an explicit confirmation; circular ownership refused; suspended/delisted securities refuse orders (resting orders can still be cancelled).

## 5. Valuation: estimate, never price
`fair value per share = max(liquidation floor, book equity + 60 days × recent average daily profit × (1 + growth/2) × (1 − risk)) ÷ issued shares`. Book equity = treasury cash + stock at cost + equipment at worn value − arrears − declared-unpaid dividends. Growth is the 7-day vs prior-7-day profit change (±20% cap); risk is profit volatility, arrears and thin cash runway (≤ 30%). Traded prices come only from orders; the UI shows the estimate beside the price and the premium/discount between them. *Because the whole game economy pays back a start-up in about two months, a fairly priced share yields far more per day than a real one; that is a property of the game's time scale, not a promise.*

## 6. Dividends
`declareDividend`: the controlling owner (or the NPC/state policy) chooses a per-share amount; allowed only if the company is operating, has no arrears, keeps `10 days of fixed costs` in reserve, no other dividend is open and ≥ 3 days passed. The **record-date snapshot** (`dividend_entitlements`) is taken at declaration: later buyers get nothing, later sellers still get paid, treasury shares are excluded. The total is **earmarked** on the treasury (so it can't be spent twice) and paid next day as one ledger transfer per holder. A company that fails or is suspended into insolvency has its declared dividend cancelled and released. Listed NPC and state companies no longer use the automatic cash sweeps: they declare a weekly dividend (80% of surplus) through this engine, so public shareholders really receive their share. Tests: `shareExploits.test.ts` (record date, treasury only, idempotent), `stockMarket.test.ts` (180-day totals).

## 7. NPC/state participation
Opening listings on **day 7**, when each company has a week of earnings: Bristol Energy, Bristol Estates, Bristol Provisions (state, real revenue) and Clifton Slice, Bean There, Severn Valley Farm, Brunel Milling, Clifton Creamery, Avon Timber (NPC). Founding NPC/state holders keep a ladder of asks for ~30% float (never selling below 55% of their company; 51% when the price is far above the estimate). **Six NPC investors** (value ×2, income, momentum, contrarian, balanced) start with 1,500 EC each (a one-off, recorded issuance), review on a staggered schedule, read only recorded prices and *yesterday's* estimate, size orders to ≤ 15% of their cash, and spend 8% of cash above their seed back to households daily so money keeps circulating. Every decision is stored in `investor_decisions` with its inputs.
*Not listed:* National Bank, Penny Logistics, Penny Ads and Penny Exchange. The brief requires listed companies to have real operations; the engine has none for these yet, so listing them would be decorative. The approved Phase 5 sprites for Penny Energy, Central Property (Bristol Estates), Penny Ads and Penny Exchange are used in the UI.

## 8. Corporate control
Control follows a **majority (> 50% of outstanding)**: crossing it moves `companies.owner_*` to the new holder and writes `control_log`. Below a majority nothing changes. Control moves management rights only: the company's treasury and assets never move. A company holder resolves to whoever owns that company; **circular ownership** (a company buying shares of something that already owns it, or its own shares) is refused. NPC owners that gain control keep a strategy profile; player-controlled companies stop being run by the NPC engine. Hostile-takeover bids and shareholder voting are not built; the register, control log and thresholds are ready for them.

## 9. Failure
An insolvent listed company is **suspended** (orders refused, dividend cancelled). When the state administrator liquidates it: open orders are cancelled and reservations released; stock is sold, arrears paid first; **the residual cash is paid to shareholders pro rata**; every share is cancelled (`liquidation` journal rows) and the security is **delisted**; each holder's loss is recorded in `share_pnl`. A falling share price alone destroys no coins: it only lowers the marked value.

## 10. Penny Post, dashboard, UI
News is generated only from recorded events: IPO, dividend declared/paid, record profit, major loss, large shareholder, control change, suspension/resumption, delisting, market crash (index −10% in 5 days). The developer dashboard (`/dev/economy`) shows listings, shares outstanding/issued/cancelled, volume, market value, depth and spreads, dividends, ownership concentration (top holder, HHI), volatility, NPC participation, failed settlements, suspicious-trading heuristics and the full issuance/transfer/dividend audit trail. Player screens: `/stocks` (listings, company pane with chart, order book, financials, ownership & control, dividends, news, ticket), `/stocks/list/:id` (IPO wizard), `/portfolio` (positions, estimated vs realised vs dividends, history).

## 11. Simulation results (90 days, deterministic) — `docs/engine/stock-scenarios/`
| | Scenario | Result |
|---|---|---|
| A | Growing startup | 3,000 shares sold, 5,817 EC of dividends paid from the treasury, founder keeps 63% |
| B | Struggling business | estimate 0.95 → 0.68 EC; price 0.32 EC; trading dries up |
| C | Speculative bubble | price peaks at 3.97 EC (+251% over the estimate), then falls to 0.90 EC; speculators lose 4,290 EC; the ±20% band limits the climb to roughly 4 days |
| D | NPC market | one human vs six NPC investors; NPCs supply 65% of volume; dividend income 5,551 EC |
| E | Acquisition | investor crosses 50% on day 12 (60% stake); café cash stays in the café |
| F | Bankruptcy | supply collapse → suspended day 64 → delisted; shareholders realise losses |
All six: ledger reconciles, share register consistent, zero anomalies.

## 12. Known limits
* Opening NPC liquidity is thin: prices go stale for days at a time (flagged in the UI; the band re-centres after 10 days).
* Genesis-style gains: because fair value uses a 60-day earnings horizon, early buyers of undervalued NPC shares earn very high returns (see scenario D).
* One human player only; no hostile bids, voting, short selling, margin or derivatives.
* Player count limit (`maxCompaniesPerPlayer`) also counts companies acquired through control.
* Removing the old `ownership` table is irreversible for existing worlds (its rows are copied first).
