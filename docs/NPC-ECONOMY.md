# Living Bristol: NPC competitors, consumer economy and market share

Everything below is implemented in `server/engine/` and verified by the tests listed in each section. NPC companies are ordinary companies: they use the same founding, staffing, upgrade, servicing, order-book and ledger code as a player, and every coin they move is a recorded double-entry transfer.

## 1. Consumer economy (`consumers.ts`, migration `0004`)
Spending is **bounded and funded**, never invented.

1. **Potential budget** per demand rule = population ÷ 1,000 × `per_thousand_minor` × season × confidence × recession shock.
2. **Hard cap**: the budget actually spent is limited to the funder's real balance and `consumerSpendCapBps` of it. Households cannot spend coins they do not hold.
3. **Segments** (`consumer_segments`: population, income, price sensitivity, quality preference, loyalty trait, neighbourhood centre) split the budget in a rotating order, weighted by population × income.
4. Each segment chooses among sellers that **really hold stock** and pays through the ledger (`consumer_sale` transactions). Sales are recorded in `segment_sales`; budget → spend is recorded in `consumer_budget_log`.
5. **Confidence** rises when household balances build and falls when they drain (clamped 70–120%). **Seasonality** is a normalised 12-month factor per rule.

Developer report: `GET /api/dev/economy` → `living.purchasingPower` shows every coin that entered the households' account in the last 30 days grouped by origin (citizen income issuance, wages, shareholder payouts …), what each rule funded and spent, and spend per segment.

## 2. Market share: the allocation formula
For a segment, a seller's weight is the product of integer terms (basis points unless stated):

```
weight = (ref / price)^sensitivity            price: cheaper wins, more so for price-sensitive segments
       × quality term                         (grade multiplier − 1) × the segment's quality preference
       × reputation term                      floor + span × rep / (rep + half)   — concave: diminishing returns
       × awareness term                       1 + awareness × marketingWeight     — awareness itself saturates with spend
       × location term                        1 − tiles × penalty, floored         — neighbourhood matters
       × loyalty term                         1 + loyaltyWeight × customer loyalty × segment loyalty trait
       × newcomer term                        1 + noveltyMax × (noveltyDays − age) / noveltyDays
```
`(1 − explore)` of the segment budget follows the weights; `exploreBps` (default 10%) is spent equally across every seller with stock so newcomers always get sampled. Weights are configurable (`config_versions` records every change). A company can never sell more than it holds: allocation stops at each seller's stock.
Tests: `npc.test.ts` (allocation, stock-bound sales, cheaper wins), `demand.test.ts`.

## 3. NPC strategies (`npc.ts`)
`budget`, `premium`, `growth`, `conservative`, `opportunistic`, `struggling`. A profile stores the strategy, a markup range, target quality, marketing spend, reserve days and the review cadence. Reviews are **periodic and staggered** (`npcDecisionEveryTicks`, at most `npcDecisionsPerTick` per tick, deterministic order) and read only the company's own completed-day books plus public market data (rival prices, shortage status). No future information is used. Each review may reprice, hire/fire (limited by the daily staffing limits and affordability), buy an affordable upgrade (only if cash after the purchase still covers the reserve), service equipment, change strategy (4 losing reviews → `struggling`), or close. Every decision, with its inputs and reason, is stored in `npc_decisions`.

## 4. Supply chain
NPC firms procure, list and sell through the same exchange as players (`market.ts`): same fees, same slippage rules, same reservations. A firm with no funds buys nothing; one with no stock lists nothing. State provisioning (`STATE_SUPPLIED` goods) remains the explicit, capped, marked-up fallback.

## 5. Lifecycle: entry, expansion, exit
* **Entry** (`runNpcEntry`): at most one per `npcEntryEveryTicks`, never before day 20, only below the NPC caps (`npcMaxCompanies`, `npcMaxPerIndustry`), only while `npcReservedLots` lots stay free for players, only when the forecast profit clears the bar, unmet demand is at least a fifth, and incumbents are profitable and selling out. Capital is **finite and comes from the NPC households' account** via the normal founding transfers; every skip or entry is logged in `npc_entry_log` with its reason.
* **Expansion**: reserve-checked upgrades (above).
* **Exit**: voluntary closure after sustained losses (`npcExitEveryTicks` rate limit) and insolvency → bankruptcy both go through `liquidateCompany`: orders cancelled, stock sold to the state provisioner at `liquidationBps`, arrears paid from cash, the remainder **written off and recorded**, residual cash returned to the shareholders. Closed companies keep their history; no coin disappears off the books.

## 6. Opportunity finder v2 (`insights.ts`)
Each opportunity now carries `labels` — *High unmet demand*, *Growing market*, *Competitive*, *Oversupplied*, *High risk* — and `metrics` (unmet-demand share, 7-day growth, leader concentration, recent failures, new entrants), each derived from recorded data with explicit thresholds. The screen keeps the **FORECAST** tag and never promises profit.

## 7. Leaderboards, titles, the Penny Post, stability (`standings.ts`)
* Weekly boards (`leaderboard`): profit, revenue, reputation, growth, and market share per industry. Titles (`titles`, `title_changes`): Market Leader per industry, Most Profitable, Most Trusted Brand, Fastest Growing. A challenger must beat the holder by 5%. NPCs and players are ranked identically.
* **Wash trades** between companies of one owner never count towards units sold, revenue boards or rankings.
* **The Penny Post** (`news_articles`): articles are generated only from recorded `economic_events` (unique `event_id`) or recorded market statistics, and state only what the event says.
* **Stability** (`stability_stats`): daily circulating supply, household/NPC/player cash, consumer spend, Gini, company count, cumulative failures. Observation only: **no automatic rescues**.

## 8. Competitor inspection
`GET /api/competitors/:id` returns public information only (price, quality, reputation, rank, share, a volume band, team-size band, age, titles, recent public events). It never exposes cash, margins, stock, orders or strategy. The payload reserves `future: { shareInvestable, acquirable, corporateGroupId }`, all disabled, for share investment, acquisitions and corporate groups.

## 9. City visuals
`GET /api/city/activity` reports a state per building computed from the last completed day: closed (bankrupt/insolvent/paused), construction (< 3 days old), missing inputs (production limited by supply), high demand (sold out), delivery (shipped to another company), customers (consumer sales), production. The canvas draws the matching approved Phase 2/3 state icon and a capped number of residents, workers and vans from the approved sprite sheets; counts are derived from real sales, headcount and shipments.

## 10. Balancing scenarios and exploit tests
`npx tsx server/cli.ts scenarios [A|B|C|D|D-energy|E|F|all] [days]` regenerates `docs/engine/scenarios/scenario-*.md` (`SCENARIO_OUT=docs/engine/scenarios`). See `docs/engine/scenarios/SUMMARY.md` for conclusions. Exploit tests (`server/engine/exploits.test.ts`) cover repeated ticks, circular trading and wash volume, artificial title farming, infinite demand, selling stock one does not hold, unbounded company creation, bankruptcy abuse, NPC free money and below-cost dumping. `pizzaDuel.test.ts` is the final gameplay test: a player pizza restaurant against the NPC one, which the player can win or lose.

## 11. Configuration
All tunables live in `EngineConfig` (`config.ts`) and every change is versioned in `config_versions` (`saveConfig`).
