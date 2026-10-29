# Economic integrity audit (Prompt 11)

Branch `audit/economic-integrity-v01`, built on `release/private-alpha-v01` (PR 25), which already contains every earlier milestone. This report records:

- what was tested;
- what was found and fixed;
- what remains.

**It does not claim the economy is exploit-proof.** It claims that the attacks listed here were attempted, that the ones that worked were repaired with a regression test, and that the invariants below hold across every run.

## 1. Baseline (before any change)

| Check | Result |
|---|---|
| Typecheck, build, unit/integration tests | pass (508 tests); CI green on PR 25 |
| 360-day `sim` | ledger reconciles, no accounting anomalies |
| 3-year `sim` (1,095 days) | **ledger reconciles, but the production chain dies** |
| Cloudflare | Worker builds and runs under local workerd; production deploys from `deploy/cloudflare-test-link`; preview builds fail by design (Durable Objects have no preview URLs); the live URL cannot be reached from this environment |

Coins never leaked in the baseline, so the books were sound. **The economy itself was not.** Over three simulated years:

- **Every primary and manufacturing producer failed.** Severn Valley Farm, Brunel Milling, Clifton Creamery and two NPC dairies were all insolvent by day 390.
- **Households hoarded.** Household savings grew 4× (26k → 104k EC) while daily consumer spending fell by a third.
- **The state supplier took over.** The state provisioner became the main supplier of flour and cheese and the most profitable company in Bristol (+1,012 EC/day).

## 2. Tooling built for the audit

| Tool | What it does | Run with |
|---|---|---|
| `server/audit/invariants.ts` | 31 deep checks, described below | admin console → *Economy audit*; called by every test below |
| `server/audit/fuzz.ts` | seeded adversarial fuzzer, described below | `npm run audit:fuzz`, `tsx server/cli.ts fuzz <seed> <players> <days> <actions/day>` |
| `server/audit/scenarios.ts` | reproducible stress framework: crisis scenarios A–I and 1/10/100/1,000-player populations, run by seeded player agents through the API; aggregate JSON + Markdown reports | `npm run audit:scenarios` → `docs/audit/` |
| `server/audit/bench.ts` | tick cost by phase, SQL statements per tick, ledger/matching throughput, catch-up, scaling, memory | `npm run audit:bench` → `docs/audit/BENCHMARK.json` |
| `server/audit/exploits.test.ts` | one regression test per repaired exploit (E1–E10) | `npm test` |

The deep invariants go beyond `reconcile()`:

- Every commodity trade, share trade and dividend is backed by **exactly one** ledger transaction for **exactly** its amount, and by matching goods or share movements.
- Every production batch consumed its recipe's inputs; logged output equals output movements, so nothing is created outside the log.
- Open orders reserve exactly price × remaining, and closed orders reserve nothing.
- Collectible supply caps hold, and lottery pools match tickets sold.
- Loans match their disbursements, and liquidated companies hold nothing.
- **Every coin ever issued has a known reason.**

The fuzzer has simulated players send honest, careless and hostile commands through the real API router while the world ticks:

- foreign company ids;
- negative, fractional, NaN and oversized amounts;
- replays of earlier commands, which must return the identical stored response;
- trades with other players' companies;
- cancellations of others' orders.

Any success against another player's asset, any replay mismatch and any invariant break is reported. Runs are deterministic: the same seed gives the same economy.

## 3. Exploits and defects found and fixed

Severity follows the prompt (P0 = currency/inventory duplication, unauthorised transfers, broken reconciliation; P1 = broken chains, wrong profitability, settlement defects, NPC failures).

| # | Sev | Defect (how it was found) | Fix | Regression |
|---|---|---|---|---|
| 1 | P0 | **Liquidation paid for inflated cost basis.** The administrator bought a bankrupt company's stock at 50% of its *cost basis*, paid from the state treasury. A player could buy their own goods from a sister company at 10× the reference price, let the buyer fail, and have the treasury pay 5× the market value. (Hypothesis, then confirmed by test: the treasury paid 250 EC for wheat worth 50.) | Stock is valued at the lower of cost basis and market reference value. | E1 |
| 2 | P0 | **Borrow and walk away.** Loan proceeds could be withdrawn to the owner's wallet, or paid out as dividends, and the company left to fail with the bank writing off the loss. (Test.) | Loan covenant: while a company owes the National Bank, cash may leave to owners only above `outstanding debt + operating reserve`. This applies to withdrawals, dividends and NPC payout sweeps. | E8 |
| 3 | P0 | **Production boost created goods with no inputs.** The bought boost added output units with zero inputs and zero cost basis. (Fuzzer: `production.unlogged_output`.) | The boost is now extra **capacity**: extra batches that consume recipe inputs and energy and need storage. | E4, invariants |
| 4 | P1 | **Tunnelling.** An indebted company could pay a sister company an owner-chosen price, moving borrowed coins out before failing. (Hypothesis after #2, then test.) | While either of two same-owner companies owes the bank, they cannot trade with each other on the exchange and their supply contracts do not deliver. | E9 |
| 5 | P1 | **Related-party sales inflated share value.** Sales to a sister company counted towards the seller's valuation earnings and its IPO revenue test, so a player could pump a listed company with owner-priced sales and sell shares to NPC investors. (Code review.) | Valuation and listing use arm's-length figures: related-party revenue and margin are excluded per statement day. Leaderboards already did this. | E2 |
| 6 | P1 | **Hand-placed trades missing from accounts.** Trades placed between ticks (every manual player trade) were missing from operating statements, so revenue, profit, valuation and listing tests were wrong. (Probe: a 28 EC sale missing from tick-3 revenue.) | Trades record their cost basis and statement day (migration 0009); the next tick folds them in exactly once. | E3 |
| 7 | P1 | **New players switched off citizens' income.** The inflation controller's target was fixed at genesis supply, so each new player's starting capital read as excess money; with 8 players the grant stopped entirely. (Fuzzer issuance breakdown.) | Registration moves the target by the starting capital, as seed patches already did. | E6 |
| 8 | P1 | **Liquidated companies' savings stranded.** A liquidated company's bank savings stayed at the bank (never reaching creditors or owners) and kept earning interest. (Fuzzer: `bank.stranded_deposits`, `bankrupt.assets`.) | The administrator recalls savings first. Liquidated companies earn no interest and cannot deposit. | E5 |
| 9 | P1 | **Purchases ignored storage capacity**, allowing unlimited hoarding and market cornering. (Code review against the prompt's list.) | A buy must fit free storage, after counting holdings and open buy orders. | E10 |
| 10 | P1 | **NPC firms quit during temporary shocks.** They exited after about 18 days of losses whatever their cash, during temporary shocks. Severn Farm closed with 4,486 EC in the bank in the middle of a severity-3 agricultural disruption. (3-year trace.) | NPCs exit only when cash covers fewer than `npcExitRunwayDays` (10) days of fixed costs, and not during an active event hitting their own industry. | scenarios |
| 11 | P1 | **NPC pricing ignored a dead line's fixed costs.** Fixed costs were split evenly per production line, so when a line stopped selling (its buyer failed), the surviving line was priced below the company's real cost: milk at 35 against a true cost of about 43. (Trace.) | Fixed costs are recovered over the company's total expected sales. | scenarios |
| 12 | P2 | **No consumption function.** Household spending was a fixed per-capita budget, so income above it piled up (it never fed back into demand). | Configurable consumption function: spending rises (bounded) when savings exceed `householdBufferDays` of baseline spending and falls below it. | E7 |
| 13 | P2 | **Industry imbalance.** At reference prices a new flour mill lost money (−12 EC/day), a dairy needed 193 days to pay back, and pizza paid back in 29: retail captured the chain's value. | Seed patch `balance-v1`: flour 220 → 260 and cheese 320 → 360 reference. | calibration tests |
| 14 | P1 | **State enterprises liquidated while still receiving income.** Penny Energy, Ads and Logistics were liquidated when the city treasury could no longer support them, yet their service income kept arriving in the closed treasuries. (Scenario F deep audit: `bankrupt.assets`.) | State enterprises stay under administration and reopen once their own income covers their arrears. | E11 |
| 15 | P2 | **Per-company history lookups scanned all history**, so ticks slowed as a world aged. (Benchmark.) | Company-first indexes (migration 0009). | benchmark |

Also added: **release gates.** Live payments, payouts, real-money wagering and cash-convertible prizes are compile-time `false`. Every GBP_TEST money path asserts a simulated provider. A test proves that no wallet, reward, membership or lottery module makes a network call, and that the database refuses non-simulated GBP transactions.

### Attempted and found sound (no change needed)

- **Ledger:**
  - Repeated, concurrent and replayed commands execute once (per-user idempotency keys).
  - The ledger refuses mint/burn misuse, unbalanced postings, negative balances and over-reservation.
  - Database triggers make postings and inventory movements immutable.
  - Ticks are atomic and idempotent, and a replayed tick is skipped.
- **Commodities:**
  - Settlement moves goods and coins together, with one transaction per trade.
  - Self-trading is blocked.
  - Reservations release exactly.
  - Two buyers racing for the same units settle them once (alpha security test).
  - Buy/sell loops against NPCs cannot profit: NPC standing bids sit 4% under the best ask, and the fee applies.
- **Shares:**
  - Self and related-account share trades are invisible to each other (ultimate-owner check), and circular ownership is refused.
  - Dividends come from reserved treasury cash, with a record-date snapshot.
  - Shares are cancelled pro rata on liquidation.
  - A price crash changes valuations, never spendable coins.
- **Prestige and lotteries:**
  - Collectibles respect supply caps.
  - Lottery pools are funded by tickets, the rake is burned, and undersubscribed draws are refunded.
  - Boosts never stack, are capped at 10%, and expire.
- **GBP_TEST:**
  - Duplicate webhooks are ignored.
  - The £5 minimum is enforced, and withdrawals are reserved.
  - Rewards are paid only from a funded reserve.
  - Reconciliation holds under 1,000 simultaneous claims (scenario I).

## 4. Scenario and population results

Full tables are in `docs/audit/SCENARIOS.md`, with JSON per run. All 13 runs are deterministic (seeded) and use player agents acting through the API. **The deep audit is clean in every run**: no unexplained issuance, no duplicated goods or shares, every settlement backed by its ledger entry, and the simulated GBP book reconciles.

| Run | What happened | Money (circulating) | CPI per year | Consumer spend/day (start → end) | Operating at end |
|---|---|---|---|---|---|
| A Stable growth, 3 years, 10 players | Spending grows; no runaway inflation | +10.0% over 3 years | +2.8% | 2,390 → 2,904 | 9 (16 failures over 3 years, 7 of them mills) |
| B Severe recession, 180 days | Firms fail, spending recovers after the shock | +2.4% | −4.9% | 2,262 → 2,653 | 9 |
| C Supply-chain collapse, 120 days | **Chain does not rebuild within the year**; unmet demand 426 units/day | +2.7% | −6.4% | 2,401 → 895 | 4 |
| D Energy crisis, 120 days | Output capped; economy recovers | +2.0% | +0.6% | 2,750 → 2,337 | 10 |
| E Share bubble and reversal | Bubble deflates; no coins created or lost (valuations ≠ cash) | −0.8% | — | 2,821 → 2,686 | 14 |
| F Four largest NPC employers stripped | **Cascade**; state enterprises survive (fix #14); slow recovery | +2.3% | −7.3% | 2,278 → 973 | 2 |
| G Income grant ×6, controller off | Money +31.8%, but prices do not follow: excess money pools in households (prices are cost-based) | +31.8% | −2.4% | 2,541 → 3,263 | 12 |
| H Dominant player with a vertical chain | Cornered cheese (99%) and flour (78%) for a time; storage limits stop hoarding; NPC rivals keep pizza competitive | +3.2% | −4.8% | 2,556 → 2,501 | 8 |
| I 1,000 players: deposits, triple reward claims, simultaneous withdrawals | 3,000 claims: 500 rewards paid (the budget), 500 same-key replays ignored, 2,000 refused (budget spent or per-player limit); 1,000 duplicate webhooks ignored; 1,000 £5 withdrawals paid with duplicate payout events ignored; GBP book reconciles | — | — | — | — |
| 1 player, 1 year | | +5.7% | — | 2,495 → 2,019 | 7 |
| 10 players, 1 year | | +1.6% | −1.2% | 2,605 → 2,301 | 9 |
| 100 players, 1 year | | −1.8% | +4.7% | 2,994 → 2,293 | 14 |
| 1,000 players, 1 year | 5,050 EC of prestige sinks; 10 player companies (all the land allows) | −2.5% | +5.3% | 3,219 → 2,552 | 14 |

**Inflation is measurable and explainable.**

- **Issuance:** genesis and player starting capital (moved into the controller's target), the citizens' income grant (falls automatically as supply exceeds the target), NPC investor seed capital, central bank liquidity operations (rule-based), and capped rewarded ads.
- **Sinks:** licences, state-service wear, city upkeep, the exchange fee burn, prestige, boosts and lottery rake.
- **Transfers** (wages, purchases, dividends, loans, fees to state companies) are never counted as sinks.
- **Money and prices are only loosely linked.** Prices are cost-based, so printing money (scenario G) inflates household balances far more than prices, and the consumption function only partly converts it into demand. This is recorded in the issue register.

## 5. Profitability by industry (tier-1 forecast at reference prices, day 30)

| Industry | Before (EC/day, payback) | After |
|---|---|---|
| Pizza restaurant | +121, 29 days | +73, 48 days |
| Café | +53, 42 days | +53, 42 days |
| Dairy | +14, 193 days | +53, 53 days |
| Timber yard | +51, 44 days | +51, 44 days |
| Farm | +28, 62 days | +28, 62 days |
| Flour mill | **−12, never** | +27, 111 days |

All six are now viable at starting scale; none is guaranteed (these are forecasts at reference prices with no competition). Pizza remains the highest earner but no longer dominates by 4×.

## 6. Performance

`docs/audit/BENCHMARK.json` (Node 22, node:sqlite, a single container CPU; the Durable Object runs the same SQL):

| Measure | Before indexes | After (migration 0009 indexes) |
|---|---|---|
| Tick, average / p95 / max (365 days, living city) | 111 / 206 / 295 ms | **92 / 184 / 219 ms** |
| Biggest phase: NPC share decisions | 35.5 ms | 25.6 ms |
| SQL statements per tick | 3,465 | 3,465 |
| Ledger transfers per second | 10,700 | 10,200 |
| Order placement / matching per second | 1,861 / 931 | 1,474 / 737 (noise between runs) |
| Catch-up after 48 missed days | 3.7 s | 4.0 s |
| Tick with 1 / 10 / 100 active players (fuzzed commands) | 68 / 81 / 100 ms | 73 / 88 / 111 ms |
| API command cost | ~0.6 ms | ~0.6 ms |
| Heap / RSS | 23 / 381 MB | 26 / 378 MB |

Fix: the history tables were keyed `(tick, company_id)` while the hot queries filter by company and order by tick, so every lookup scanned all history and ticks slowed as a world aged. Migration 0009 adds company-first indexes.

Remaining bottleneck: NPC investors act one after another on an order book their own orders change, so their per-security market data cannot be cached without changing behaviour. At about 25 ms it is acceptable for the alpha. The 1,000-player run averaged 170 ms per tick (max 594 ms) with about 200 agent commands a day: well within a Durable Object alarm cycle.

## 7. Remaining issue register

| Sev | Issue | Why it remains / next step |
|---|---|---|
| **P1** | **Weak recovery after severe supply shocks.** After a supply-chain collapse (C) or the failure of major employers (F), the farm–mill–dairy chain does not rebuild within the year: 4 and 2 companies remain, and unmet demand is 364–426 units/day. | NPC re-entry is limited by land (5 of 10 lots are reserved for players), at most one entrant per 10 days, and entry tests that require profitable incumbents. Next step: entry that targets broken chain links, and NPC farm–mill supply contracts. |
| P2 | Flour mills remain the weakest link: 7 of 8 mills failed over 3 years in A. After shocks, a mill loses its wheat supply. | Same as above; players can still run mills profitably (a tier-1 forecast is +27 EC/day). |
| P2 | Money growth only weakly raises prices (G: +31.8% money, CPI flat); excess money pools in households. | Prices are cost-plus by design. If inflation should respond to money, add a demand-pull term to NPC pricing. |
| P2 | Bristol has only 10 vacant lots, so at most about 10 companies can be founded by players (shown again at 100 and 1,000 players). | Needs map expansion or multiple cities (art and layout work). |
| P2 | NPC momentum investors can be pumped up to 1.7× fair value. | Bounded by fundamentals and their finite budgets. Accepted as market risk. |
| P2 | Reference prices are static; they anchor NPC price bands and the state fallback, but are not indexed to measured inflation. | Index them to CPI if long-run inflation becomes significant. |
| P2 | Players can create SIMULATED GBP freely with test deposits. | By design for the test wallet; it is labelled SIMULATED and never convertible. |
| P3 | Very short scenario windows give noisy annualised CPI figures. | Read CPI from the full-length runs. |

## 8. Configurable parameters added or changed

Every balance change is in `EngineConfig` (stored per world; changes are versioned in `config_versions`) or in a named seed patch:

| Parameter | Default | Meaning |
|---|---|---|
| `householdBufferDays` | 15 | consumption function: savings households aim to hold (0 disables) |
| `wealthSpendGainBps` | 5000 | spending response to savings above or below the buffer |
| `wealthSpendMinBps` / `wealthSpendMaxBps` | 7000 / 18000 | bounds of that response |
| `npcExitRunwayDays` | 10 | an NPC quits only when its cash covers fewer days of fixed costs than this |
| seed patch `balance-v1` | flour 260, cheese 360 | reference prices of the intermediate goods |
| `supplyTargetMinor` | moves with player starting capital | inflation-controller target (unchanged rule, corrected input) |
