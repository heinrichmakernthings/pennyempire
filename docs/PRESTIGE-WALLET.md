# Prestige, monetisation infrastructure, simulated GBP wallet and treasury (Prompt 9)

**Everything here is fictional or simulated.** Empire Coins (EC) are game currency with no cash value. GBP_TEST is a simulated pound wallet: no card, bank or payment provider is connected, nothing can be deposited or withdrawn for real, and the two currencies share no table, account or code path. Real-money lotteries, wagering, withdrawable securities and real payments remain out of scope (see `AGENTS.md`).

## 1. Prestige economy (`prestige.ts`, `boosts.ts`)
* 20 catalogue items in four categories (vehicles, property, corporate, luxury). Each has an id, category, price in EC, rarity, approved artwork reference, optional supply cap, tradeable flag, per-owner limit and prestige points. **Items without approved artwork are listed but cannot be bought**: rare collector's vehicle, waterfront property, private estate, corporate tower, premium offices, superyacht (the Phase 5 `OUTSTANDING.md` list).
* Buying burns the price as an explicit `sink` ledger transaction ("luxury purchase … (explicit sink)"), increments the minted count (hard cap checked in the same transaction), records a numbered ownership row (`veh-supercar#7`) and a purchase history entry. A retry is a no-op; duplicates of unique items, sold-out items and unaffordable items are refused with nothing changed.
* **Collectibles market**: only tradeable items can be listed (sculptures, display pieces, trophies, sports car, supercar, launch); asking price is bounded to 50× shop price; a sale is atomic (coins to the seller minus a 5% fee that is burned, ownership row moved, listing closed, history written); a unit has exactly one owner and one open listing; no real-money resale or cash conversion exists.
* **Prestige score** (distinct from net worth): item points count only after the item has been held 7 days, plus collection bonuses, businesses and titles. A transfer resets the holding clock and costs a fee, so moving an item between accounts earns nothing. City and global boards are recorded weekly (`prestige_scores`).
* **Visible status**: owned vehicles, boats, signs and monuments are drawn beside the owner's oldest company on the city map (approved Phase 5 sprites, native size). Landmark buildings (mansion, penthouse, HQ) have no placement on the map yet and show in the collection.
* **Boosts**: production +3% and marketing +5% for 7 days (EC prices, disclosed). They change real calculations: extra production units in the tick (with a carried fraction so small shops benefit, limited by free storage) and the awareness update. Boosts of one kind never add (the strongest applies), are capped at 10%, cannot be re-bought while active, expire, and have no effect on GBP, prizes or any cash contest.

## 2. GBP_TEST ledger and wallet (`gbpLedger.ts`, `gbpWallet.ts`)
A separate double-entry book in integer pence (debit +, credit −, every transaction sums to zero; DB triggers make postings immutable, status can only move posted → reversed).

| Account | Kind | Meaning |
|---|---|---|
| `gbp:cash` | asset | cash held (never below zero) |
| `gbp:payout_clearing` | asset | cash in flight to the payout provider |
| `gbp:wallet:<player>` | liability | what the game owes the player (credit balance, can never be overspent) |
| `gbp:pending:<player>` | liability | withdrawal reservations |
| `gbp:payable:processor` | liability | processor fees owed by the **business** |
| `gbp:rev:*`, `gbp:exp:*` | revenue / expense | advertising, premium, cosmetic; payment fees, hosting, rewards |
| `gbp:equity:owner`, `gbp:equity:prize_reserve` | equity | developer funding; restricted prize reserve |

Flows: **deposit** (sandbox provider event, idempotent by event id): Dr cash / Cr wallet, and the processor fee is booked as an expense owed to the processor, never taken from player funds. A duplicate webhook, a late failure after success, or a different event id for a settled deposit changes nothing. **Withdrawal** (minimum £5, available balance, at most 3 open): reserve (wallet → pending) → approve (cash → clearing; refused if the treasury cannot cover it) → settle (pending → clearing out) or reject/fail (reversal entries, never deletion). Concurrent or repeated requests cannot spend the same funds twice. `reconcileGbp` checks balance sums, cached balances, solvency (cash + clearing ≥ player liabilities), deposit/withdrawal records vs transactions and reversal pairing.

## 3. Rewards, prizes and lotteries
* **Rewarded video ads** (`rewards.ts`): the browser can only ask to watch and later present the provider's proof. The server checks daily limits and cooldown, opens a session with a secret nonce and a minimum watch time, the (mock) provider signs `session:nonce` with HMAC-SHA-256 only after the server clock says the time has passed, and the reward is issued only if the signature verifies, the session is open, unexpired and unused (one reward per session id). A false completion claim burns the session; three invalid completions pause rewarded ads for the day. Rewards: 50 EC (a capped faucet: up to 5 a day, disclosed, recorded as a labelled issuance) and a +2% production boost for 3 days. A real provider would replace the attestation step with a server-to-server completion event; no cash or cash-convertible asset is awarded for ad views.
* **Reward programmes**: source, eligibility (positive facts only — loss-based rules cannot be defined), award, budget, per-player maximum, funding from the restricted **prize reserve**, transaction id, player id, timestamp and an audit record. A programme cannot pay beyond its budget or the reserve; replays are idempotent; only human players are paid. Weekly-leaderboard awards and free-entry prize draws (secure random pick, entries hashed before the pick) use the same path.
* **Coin lotteries** (`lottery.ts`): fictional EC only, weekly, 100 EC tickets, max 10 per player, 10% rake burned, prizes 60/25/15% to distinct tickets, published exact odds, at least 4 tickets or everything is refunded. Draws use `crypto.getRandomValues` (rejection-sampled) outside the deterministic tick. Lotteries are created as a pure function of the tick, so replay and catch-up give identical books.

## 4. Premium membership (`membership.ts`)
Mock provider, example plan £2.99 per 30 game days. Subscribing books simulated cash, premium revenue and the simulated fee; each period has a unique provider reference so a renewal can never be charged twice; cancelling keeps benefits to the end of the period; a declined payment expires the membership without charging. Benefits are cosmetic and convenience only (themes, analytics, profile decoration, hidden placeholder ads); `NOT_INCLUDED` states that Premium never sells coins, cash, prizes or contest advantage.

## 5. Display advertising (`src/app/AdSlot.tsx`)
Top banner and sidebar (desktop), in-flow (all widths) and in-content mobile banner. Fixed reserved heights (no layout shift), no links or buttons (no accidental clicks), never overlaying controls, always labelled **SIMULATED AD**. Each placement records one anonymous impression (slot name only) when 50% visible; the treasury shows these as "simulated placements", never as revenue.

## 6. Treasury and commercial model (`commercial.ts`, `treasuryAdmin.ts`)
The treasury view separates **player funds held** (liability), cash, **booked** revenue, expenses, **rewards issued**, the prize reserve and operating profit; deposits are never revenue. Developer controls (`/dev/treasury`, developer builds only, or `/api/admin/treasury/*` with the administrator token) drive the sandbox providers (success, failure, cancellation, duplicate webhook, settle, duplicate settle, payout failure), fund the simulated treasury, create and fund programmes and draws, and record statements. Every action posts balanced entries and writes `gbp_audit`; there is no balance-edit action.

**Commercial scenarios** are arithmetic on editable assumptions (labelled *ASSUMPTION-BASED SCENARIO — NOT A FORECAST, NOTHING BOOKED*). With the shipped placeholders (monthly, pence → £):

| Scenario | Players | Gross | Net | Op. profit | Net ARPU | Sustainable reward budget | Cash for expected withdrawals |
|---|---|---|---|---|---|---|---|
| Cautious | 500 | £129.95 | £123.39 | £83.39 | £0.25 | £18.51 | £50.00 |
| Base | 5,000 | £3,373.75 | £3,286.52 | £3,136.52 | £0.66 | £821.63 | £1,400.00 |
| Optimistic | 50,000 | £80,480.00 | £79,356.28 | £78,056.28 | £1.59 | £23,806.88 | £27,000.00 |

Read these carefully: **in every scenario expected withdrawals exceed the sustainable reward budget**, so cash-outs would have to be funded from reserves or reduced; the margins are unrealistically high because staff, marketing, legal, tax, support and refunds are not modelled (the model warns about it); and rewarded-video eCPM is the dominant driver and the least certain input. No real revenue has occurred in this build.

## 7. Financial stress (`npm run`‑style: `tsx server/cli.ts finance-stress`, report in `docs/engine/finance-stress.md`)
S1: 300 players deposit £10 and request £10 cash-outs simultaneously — all paid, fully backed, ledger reconciles. S2: 1,000 players claim the same £5 reward three times against a £100 budget — exactly 20 awards, 2,960 refusals, spent = budget. S3: a lottery with 4,000 tickets — 3 distinct winners, prizes + burned rake = pool, pool account empty.

## 8. API, commands and deployment
Reads: `GET /api/prestige`, `/api/prestige/market`, `/api/prestige/leaderboard`, `/api/rewards`, `/api/wallet`, `/api/membership`; `POST /api/ads/attest`, `/api/ads/impression`. Commands (idempotent): `prestige.buy|list|unlist|buyListing`, `boost.buy`, `membership.subscribe|cancel`, `ad.reward.start|complete`, `lottery.buy`, `draw.enter`, `wallet.testDeposit|testWithdraw|cancelWithdrawal`. Treasury/sandbox: `/api/dev/treasury[/action]` (developer builds) and `/api/admin/treasury[/action]` (token). Migration `0007` is additive. The Worker needs `ADMIN_TOKEN` as a secret to use the admin API; developer endpoints stay off in deployment, so settling a withdrawal there needs the admin token.

## 9. Known limitations
* One human player per world: the collectibles market is empty until a second player exists (tests use several); there are no NPC collectors.
* Landmark buildings, collectibles and trophies appear in the collection but not on the map; six items wait for art; there is no separate profile screen.
* No research-acceleration reward (no research system yet); the coin faucet from rewarded ads is capped but real.
* The mock provider settles deposits instantly; withdrawals need a developer/admin action. No real payment, advertising or subscription provider is integrated, and doing so needs legal, licensing and safeguarding work first.
* Commercial figures are assumptions only (see above).
