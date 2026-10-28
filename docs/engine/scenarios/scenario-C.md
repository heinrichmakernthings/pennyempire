# Scenario C — Growing City (100 companies)

120 in-game days · deterministic · reconciles: **true** · accounting anomalies: **0**

## Setup
- 120 synthetic vacant lots added (stress test only — the real map has about 14), NPC cap raised to 120, entry every 3 days, 90 NPC firms seeded on day 0 from recorded household grants (mix: 24 pizza, 18 cafe, 12 dairy, 12 mill, 12 farm, 12 timber — roughly one input supplier per two consumer-facing restaurants), and the state provisioner's raw-material intake raised 8× to match (a city this size needs more milk and wheat; the fixed intake was what starved the first attempt), and the city's population grown from 50,000 to 450,000 (citizen income and consumer budgets both scale with population; a city cannot hold 100 firms on a village's demand).

## Headline
- Circulating supply 523,950.00 EC → 334,515.85 EC (-36.16%)
- Live companies 97 → 37 · NPC entries 0 · voluntary closures 3 · bankruptcies 60
- Days with any unmet consumer units: 120/120 · company-cash Gini 21% · daily consumer spend 14,011.85 EC (day 1) → 14,046.35 EC (last day)
- NPC strategy reviews logged: 883 · live NPC strategies: conservative 11, budget 9, premium 7, opportunistic 6, growth 4
- Player: 1 company, net worth 1,500.00 EC → 0.00 EC (-1,500.00 EC), 0.0% of all units sold in the final fortnight
- Largest explicit coin destruction over the run: infrastructure upkeep (explicit burn) — 184,323.97 EC (every destruction is a recorded sink; transfers are never counted as sinks).
- Uniform seeding is a stress test, not a forecast: 90 firms opened on day 0 into a city whose households can only fund so many. The shake-out above is the engine behaving as designed — failing firms are liquidated through the ledger, nothing is rescued, and nothing is created or lost off the books.

## Industries (final fortnight)
| industry | live | NPC | player | player share | HHI | avg price |
|---|---|---|---|---|---|---|
| cafe | 13 | 13 | 0 | 0% | 883 | 3.00 EC |
| dairy | 1 | 1 | 0 | 0% | 10000 | 3.20 EC |
| farm | 3 | 3 | 0 | 0% | 4784 | 0.50 EC |
| mill | 1 | 1 | 0 | 0% | 10000 | 2.20 EC |
| pizza | 16 | 16 | 0 | 0% | 661 | 11.61 EC |
| timber | 3 | 3 | 0 | 0% | 3396 | 3.15 EC |

## Prices (VWAP of executed trades)
| commodity | reference | first | last | min | max |
|---|---|---|---|---|---|
| cheese | 3.20 EC | 4.38 EC | 4.03 EC | 3.80 EC | 4.38 EC |
| coffee | 1.00 EC | 1.40 EC | 1.40 EC | 1.40 EC | 1.40 EC |
| flour | 2.20 EC | 3.01 EC | 2.66 EC | 2.40 EC | 3.01 EC |
| milk | 0.70 EC | 0.93 EC | 0.52 EC | 0.42 EC | 0.96 EC |
| packaging | 0.40 EC | 0.56 EC | 0.56 EC | 0.56 EC | 0.56 EC |
| wheat | 0.50 EC | 0.66 EC | 0.52 EC | 0.50 EC | 0.66 EC |

## Timeline
| day | circulating | live companies | consumer spend | units produced |
|---|---|---|---|---|
| 10 | 500,070.46 EC | 97 | 19,166.64 EC | 7100 |
| 20 | 482,112.59 EC | 95 | 15,146.00 EC | 6195 |
| 30 | 463,236.16 EC | 85 | 18,118.12 EC | 6310 |
| 40 | 444,635.59 EC | 59 | 14,774.83 EC | 4530 |
| 50 | 426,722.79 EC | 50 | 14,718.29 EC | 4415 |
| 60 | 409,327.75 EC | 44 | 14,717.87 EC | 4450 |
| 70 | 393,904.13 EC | 41 | 11,567.35 EC | 3935 |
| 80 | 378,961.52 EC | 41 | 12,094.96 EC | 4780 |
| 90 | 366,225.60 EC | 39 | 10,066.21 EC | 3995 |
| 100 | 354,484.37 EC | 37 | 12,891.92 EC | 4450 |
| 110 | 343,999.27 EC | 37 | 9,391.58 EC | 3895 |
| 120 | 334,515.85 EC | 37 | 12,186.34 EC | 3730 |
