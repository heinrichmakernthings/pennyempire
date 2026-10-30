# Scenario C — Growing City (100 companies)

120 in-game days · deterministic · reconciles: **true** · accounting anomalies: **0**

## Setup
- 120 synthetic vacant lots added (stress test only — the real map has about 14), NPC cap raised to 120, entry every 3 days, 90 NPC firms seeded on day 0 from recorded household grants (mix: 24 pizza, 18 cafe, 12 dairy, 12 mill, 12 farm, 12 timber — roughly one input supplier per two consumer-facing restaurants), and the state provisioner's raw-material intake raised 8× to match (a city this size needs more milk and wheat; the fixed intake was what starved the first attempt), and the city's population grown from 50,000 to 450,000 (citizen income and consumer budgets both scale with population; a city cannot hold 100 firms on a village's demand).

## Headline
- Circulating supply 551,950.00 EC → 428,931.02 EC (-22.29%)
- Live companies 97 → 17 · NPC entries 1 · voluntary closures 8 · bankruptcies 80
- Days with any unmet consumer units: 120/120 · company-cash Gini 23% · daily consumer spend 3,786.25 EC (day 1) → 7,654.35 EC (last day)
- NPC strategy reviews logged: 988 · live NPC strategies: budget 6, premium 3, growth 3, conservative 3, opportunistic 2
- Player: 1 company, net worth 1,500.00 EC → 0.00 EC (-1,500.00 EC), 0.0% of all units sold in the final fortnight
- Largest explicit coin destruction over the run: infrastructure upkeep (explicit burn) — 114,593.27 EC (every destruction is a recorded sink; transfers are never counted as sinks).
- Uniform seeding is a stress test, not a forecast: 90 firms opened on day 0 into a city whose households can only fund so many. The shake-out above is the engine behaving as designed — failing firms are liquidated through the ledger, nothing is rescued, and nothing is created or lost off the books.

## Industries (final fortnight)
| industry | live | NPC | player | player share | HHI | avg price |
|---|---|---|---|---|---|---|
| cafe | 12 | 12 | 0 | 0% | 909 | 2.87 EC |
| dairy | 0 | 0 | 0 | 0% | 0 | 0.00 EC |
| farm | 0 | 0 | 0 | 0% | 0 | 0.00 EC |
| mill | 0 | 0 | 0 | 0% | 0 | 0.00 EC |
| pizza | 2 | 2 | 0 | 0% | 5000 | 10.28 EC |
| timber | 3 | 3 | 0 | 0% | 3549 | 3.24 EC |

## Prices (VWAP of executed trades)
| commodity | reference | first | last | min | max |
|---|---|---|---|---|---|
| cheese | 3.20 EC | 4.38 EC | 4.48 EC | 3.30 EC | 4.48 EC |
| coffee | 1.00 EC | 1.40 EC | 1.40 EC | 1.40 EC | 1.40 EC |
| flour | 2.20 EC | 3.01 EC | 3.08 EC | 2.28 EC | 3.08 EC |
| milk | 0.70 EC | 0.93 EC | 0.98 EC | 0.93 EC | 0.98 EC |
| packaging | 0.40 EC | 0.56 EC | 0.56 EC | 0.56 EC | 0.56 EC |
| wheat | 0.50 EC | 0.66 EC | 0.59 EC | 0.52 EC | 0.66 EC |

## Timeline
| day | circulating | live companies | consumer spend | units produced |
|---|---|---|---|---|
| 10 | 529,084.73 EC | 96 | 9,890.06 EC | 2760 |
| 20 | 513,175.34 EC | 87 | 10,099.47 EC | 2730 |
| 30 | 499,208.22 EC | 40 | 8,795.27 EC | 2885 |
| 40 | 487,712.33 EC | 25 | 7,854.19 EC | 2060 |
| 50 | 478,049.94 EC | 25 | 7,723.39 EC | 2355 |
| 60 | 469,597.92 EC | 23 | 7,583.96 EC | 2340 |
| 70 | 462,509.45 EC | 22 | 8,051.52 EC | 2590 |
| 80 | 455,069.66 EC | 21 | 7,403.73 EC | 2495 |
| 90 | 448,218.90 EC | 19 | 7,362.64 EC | 2175 |
| 100 | 441,201.33 EC | 19 | 7,049.72 EC | 2175 |
| 110 | 434,639.03 EC | 18 | 7,240.53 EC | 2070 |
| 120 | 428,931.02 EC | 17 | 7,654.35 EC | 2155 |
