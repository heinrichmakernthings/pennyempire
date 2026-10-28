# Scenario C — Growing City (100 companies)

120 in-game days · deterministic · reconciles: **true** · accounting anomalies: **0**

## Setup
- 120 synthetic vacant lots added (stress test only — the real map has about 14), NPC cap raised to 120, entry every 3 days, 90 NPC firms seeded on day 0 from recorded household grants (mix: 24 pizza, 18 cafe, 12 dairy, 12 mill, 12 farm, 12 timber — roughly one input supplier per two consumer-facing restaurants), and the state provisioner's raw-material intake raised 8× to match (a city this size needs more milk and wheat; the fixed intake was what starved the first attempt), and the city's population grown from 50,000 to 450,000 (citizen income and consumer budgets both scale with population; a city cannot hold 100 firms on a village's demand).

## Headline
- Circulating supply 514,950.00 EC → 290,763.17 EC (-43.54%)
- Live companies 97 → 35 · NPC entries 0 · voluntary closures 4 · bankruptcies 62
- Days with any unmet consumer units: 120/120 · company-cash Gini 20% · daily consumer spend 14,011.85 EC (day 1) → 12,141.77 EC (last day)
- NPC strategy reviews logged: 857 · live NPC strategies: conservative 9, budget 9, opportunistic 6, premium 5, growth 5, struggling 1
- Player: 1 company, net worth 1,500.00 EC → 0.00 EC (-1,500.00 EC), 0.0% of all units sold in the final fortnight
- Largest explicit coin destruction over the run: infrastructure upkeep (explicit burn) — 218,489.35 EC (every destruction is a recorded sink; transfers are never counted as sinks).
- Uniform seeding is a stress test, not a forecast: 90 firms opened on day 0 into a city whose households can only fund so many. The shake-out above is the engine behaving as designed — failing firms are liquidated through the ledger, nothing is rescued, and nothing is created or lost off the books.

## Industries (final fortnight)
| industry | live | NPC | player | player share | HHI | avg price |
|---|---|---|---|---|---|---|
| cafe | 13 | 13 | 0 | 0% | 816 | 2.90 EC |
| dairy | 1 | 1 | 0 | 0% | 10000 | 3.20 EC |
| farm | 3 | 3 | 0 | 0% | 4784 | 0.50 EC |
| mill | 1 | 1 | 0 | 0% | 10000 | 2.20 EC |
| pizza | 14 | 14 | 0 | 0% | 767 | 10.94 EC |
| timber | 3 | 3 | 0 | 0% | 3396 | 3.15 EC |

## Prices (VWAP of executed trades)
| commodity | reference | first | last | min | max |
|---|---|---|---|---|---|
| cheese | 3.20 EC | 4.38 EC | 4.17 EC | 4.07 EC | 4.38 EC |
| coffee | 1.00 EC | 1.40 EC | 1.40 EC | 1.40 EC | 1.40 EC |
| flour | 2.20 EC | 3.01 EC | 2.72 EC | 2.56 EC | 3.01 EC |
| milk | 0.70 EC | 0.93 EC | 0.68 EC | 0.41 EC | 0.93 EC |
| packaging | 0.40 EC | 0.56 EC | 0.56 EC | 0.56 EC | 0.56 EC |
| wheat | 0.50 EC | 0.66 EC | 0.54 EC | 0.51 EC | 0.66 EC |

## Timeline
| day | circulating | live companies | consumer spend | units produced |
|---|---|---|---|---|
| 10 | 490,280.19 EC | 97 | 19,166.64 EC | 7100 |
| 20 | 466,056.95 EC | 95 | 18,875.49 EC | 6675 |
| 30 | 442,130.40 EC | 83 | 18,817.17 EC | 6330 |
| 40 | 418,834.50 EC | 57 | 17,097.12 EC | 4880 |
| 50 | 397,350.70 EC | 46 | 15,572.27 EC | 4505 |
| 60 | 377,709.71 EC | 43 | 15,028.24 EC | 4450 |
| 70 | 359,418.43 EC | 39 | 14,237.46 EC | 4600 |
| 80 | 342,277.98 EC | 39 | 12,862.63 EC | 4300 |
| 90 | 326,822.22 EC | 38 | 12,305.40 EC | 4290 |
| 100 | 313,372.65 EC | 35 | 11,904.42 EC | 4230 |
| 110 | 301,439.59 EC | 35 | 11,333.31 EC | 4090 |
| 120 | 290,763.17 EC | 35 | 10,138.77 EC | 4015 |
