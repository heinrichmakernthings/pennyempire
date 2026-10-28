# Balancing scenarios — summary (120 days each, deterministic)

Reproduce with `SCENARIO_OUT=docs/engine/scenarios npx tsx server/cli.ts scenarios all 120`. All seven runs: **ledger reconciles, zero accounting anomalies, issued − destroyed = circulating every day, no state enterprise ever failed.** Full numbers are in `scenario-*.md`.

| | Scenario | Live firms | Bankruptcies / voluntary closures | Notes |
|---|---|---|---|---|
| A | Solo player (1 pizza restaurant, default settings) | 7 → 8 | 0 / 0 | Player net worth 1,500 → 12,197 EC; one NPC café entered on its own. |
| B | Small community (10 firms) | 10 → 8 | 2 / 2 | Seeded NPC entrants without a niche close; incumbents and both player firms profit. |
| C | Growing city (97 firms, population ×9, 8× state raw-material intake, 120 synthetic lots) | 97 → 35 | 62 / 4 | **Stress test, not a forecast.** A city only holds as many firms as its consumer budgets and input chain can feed; the shake-out is orderly (liquidation through the ledger, nothing rescued). The passive player firm failed. |
| D | Supply crisis — every mill shut days 30–50 | 11 → 8 | 4 / 3 | Flour traded up to 140% of reference (the state fallback's mark-up is the ceiling) and the chain recovered after the mills reopened. |
| D′ | Supply crisis — power station shut days 30–50 | 11 → 8 | 3 / 2 | Same pattern with energy. |
| E | Recession (−30% household budgets days 30–70) | 8 → 9 | 0 / 0 | Consumer spend falls while the shock lasts and is restored after; no coin is created to compensate. |
| F | Dominant company (5 firms, 30M minor capital, undercuts by 10%, heavy advertising) | 11 → 8 | 3 / 3 | Held 59% of units sold yet *lost* 7.0k EC of net worth: cheap pizza plus advertising is not automatically profitable. NPC rivals shrank but the market was not frozen. |

## Findings worth acting on
1. **Money supply drifts down in long runs (−1% to −2% in 120 days; −44% in C).** The largest explicit destruction is "infrastructure upkeep (explicit burn)". In C most of the fall is the scenario's own 405,000 EC of seeding grants being burnt. A tuning pass on `stateBurnBps` / household stipend is Prompt 7 material; the stability monitor makes the drift visible and nothing rescues it automatically.
2. **Uniform seeding of NPC firms fails; demand-gated entry works.** In-engine entry is deliberately conservative (1–2 entrants in 120 days). If a livelier city is wanted, relax the incumbent-profitability test, not the rate limit.
3. **Unmet-units metric is noisy**: nearly every day shows some unmet consumer units because elastic demand is estimated at the average price; it is reported as "days with any unmet consumer units" and should not be read as a shortage signal.
4. **Raw-material intake does not scale with population.** `stateSupplyPerTick` is a flat number; scenario C needed it raised 8× or the cheese/milk chain starved every pizza restaurant.
