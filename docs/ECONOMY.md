# Economy rules — draft v0.1

## Currencies
- **Empire Coins (EC)**: fictional, non-redeemable in-game currency; may be created by NPC consumer sales or grants and destroyed by state fees, licences, luxury purchases and upkeep.
- **Test GBP**: separately ledged simulated balance, cannot be deposited or withdrawn for real; intended to test UI and treasury logic.
- **Premium cosmetics**: design later; must not create a route to cash redemption in alpha.

## Basic production recipes (illustrative, tune through tests)
- Farm: land + energy + labour -> wheat.
- Flour mill: 2 wheat + energy + labour -> 1 flour.
- Dairy: feed + energy + labour -> cheese.
- Pizza shop: 1 flour + 1 cheese + energy + labour -> 1 pizza.
- Café: milk + supplies + energy + labour -> drinks.
- Timber yard: land + energy + labour -> timber.
Do not require unattainable inputs at launch; state suppliers offer bounded fallback quantities.

## Demand and pricing
For each city and category, define a finite daily NPC demand budget. Allocate customers among eligible companies according to a reproducible weighted score of price, quality, reputation, marketing and stock availability. Cap demand by actual production and inventory. Pricing too high should reduce demand; underpricing can cause losses.

## Markets
Player-driven limit orders for commodities. Reserve buyers' coins and sellers' inventory before matching. Atomic settlement transfers goods and coins, subtracting clearly disclosed exchange fees to a sink account. No phantom inventory, negative balances or double fills.

## State companies
Provide advertising, utilities, real estate, logistics, and market infrastructure. State profits retained in a state treasury are not destroyed until an explicit, recorded burn. Their shares may be traded in fictional coins, with dividends sourced from actual game-company coin profits. Never secretly crash markets solely to confiscate balances.

## Inflation
Track coin supply, velocity, NPC injections and sinks per tick. Adjust configured fees, upkeep and supply based on transparent rules. Use deterministic simulation seeds and audited event logs.

## Shares
Fictional securities with no cash conversion. Corporate valuation derives from gameplay metrics plus player trading. Dividends transfer coins from company treasury, not mint new coins.

## Tests
Property tests for conservation of coins between source/sink accounts, inventory conservation, settlement atomicity, tick idempotency and insolvency boundaries. Stress tests for low active-player counts and supplier failure.
