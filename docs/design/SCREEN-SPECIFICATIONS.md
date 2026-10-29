# Phase 1 screen specifications — v1

Shared shell: FinancialHUD shows available EC, daily profit, portfolio value and Bristol; persistent primary navigation. Values use tabular figures. Keep GBP_TEST exclusively in the simulated wallet. A balance value always names its currency. Desktop inspector 336px; City remains visible. Main content max-width 1440px except city canvas. All screens use the loading/empty/error/stale/permission states below.

| Screen | Default layout and hierarchy | Core interactions | Contract root |
|---|---|---|---|
| City | Full city canvas; selected company inspector; unobtrusive city event strip | Pan, integer zoom, select building, keyboard-accessible company list, open management; ownership label on selection | ScreenState.city |
| Companies | Owned-company list on left, selected company detail on right. Overview: revenue, profit, customers, 7-day sparkline. Operations: pricing, staff, quality, production, stock and marketing. Financials: revenue/expenses history, ownership, valuation | Edit draft settings then Save/Cancel; buy supplies opens commodity screen with company and commodity preselected; upgrades require cost/requirements confirmation | ScreenState.companies |
| Commodity Exchange | Commodity list with price/change and shortage text; selected commodity order book and compact price history; buy/sell ticket; own orders/history below | Select buying company; integer quantity and limit price; request quote; show subtotal/fee/total; submit once; cancel remaining order quantity | ScreenState.commodities |
| Stock Exchange | Fictional listings with price/change/dividend; selected company financial summary and price chart; trade ticket; holdings below | Buy/sell integer shares after server quote; view ownership, dividends and business performance; state-enterprise marker | ScreenState.stocks |
| Prestige | Item grid, selected detail, owned state and placement preview | Disclose every boost magnitude/duration; purchase with EC quote; choose valid plot where applicable. Missing art items remain unavailable with reason, never a fake purchasable placeholder | ScreenState.prestige |
| Wallet | Prominent SIMULATED banner; separate GBP_TEST available/reserved balances; test deposit/withdraw actions; history and reward tabs; portfolio summary explicitly in EC | Integer pence input; £5 minimum test withdrawal; show pending/settled/failed; simulation-only receipts; no card fields, bank fields, live payment scripts or implied conversion from EC | ScreenState.wallet |

## Responsive layout

At ≥1200px: 184px labelled sidebar, 64px HUD, flexible centre, 336px optional inspector. At 768–1199px: 72px rail; inspector 360px overlay, close and focus return. Below 768px: HUD wraps to two lines; bottom nav City/Companies/Market/Portfolio/More; More contains Stocks/Prestige/Wallet/Rewards. Company detail becomes a full-width sheet (max 80dvh), draggable only as an enhancement with explicit close. Market order book becomes a list; ticket opens full-width, never a squeezed side panel. Charts min 280×120; tables with necessary horizontal scroll are independently contained and labelled. No page-level horizontal scrolling.

## Graph rules

One sparkline in company overview; expanded Financials shows revenue/expense chart with period switch. Exchange shows one selected instrument's history. No continuous flashing ticker, gradients or decorative motion. Display period, currency and source timestamp. Use zero baseline for profit and bars. Never connect gaps across missing observations; missing history is No history yet. Include table alternative and text summary; colour is supplemented by label/line style.

## State and command rules

- Loading: retain shell and skeleton content, disable actions until authoritative data exists.
- Empty: contextual next action, never fabricated companies/trades/history.
- Error: retry data load; keep unsaved configuration draft. Never optimistically mutate money, shares or inventory.
- Stale: retain data with timestamp and reconnect notice; commands blocked until refreshed or accepted with revision check.
- Forbidden: read-only company inspector; no hidden assumption that every selected building belongs to player.
- Pending command: stable idempotency key for retries; button disabled until resolution. Timeout triggers status/refetch, not a new transaction key.
- Quote expired/price changed: show fresh quote and require resubmission; never silently accept a changed total.
- Partial fills: show filled and remaining units; cancellation releases only remaining reservation.
- Confirmation required for purchases/upgrades/withdrawals; routine settings use explicit Save.

## Accessibility

44px targets; visible focus; semantic labels; escape closes dialogs; focus trapped only within modal panels and restored afterwards. Map has an equivalent accessible business list. Live region announces command outcome, not every market tick. Honour reduced motion; no information solely in colour, hover, pixel-art text or animation.

## State contract implementation

`src/contracts/game-state.ts` is the normative field list. ScreenState maps each screen to its actual DTOs. Null means absent/unknown, not zero. Histories are server aggregates, not sums invented by the client. Money minor values must be safe integers within backend-defined limits; available stock excludes reservations. Basis points are integers 0–10000. ISO times are UTC; display in selected locale. Server must validate every command, ownership, revision, bounds and idempotency and return atomic settlement results. TypeScript alone is not runtime validation.
