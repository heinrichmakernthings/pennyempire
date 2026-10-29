# Claude Code Prompt 1 — frontend foundation and asset integration

Read README.md, AGENTS.md, docs/ARCHITECTURE.md, docs/ECONOMY.md and docs/design/PRODUCTION-READINESS.md first. Use DESIGN-SYSTEM.md, SCREEN-SPECIFICATIONS.md, src/contracts/game-state.ts and assets/art/runtime/manifest.json as the implementation contracts. Preserve the approved target at assets/art/reference/approved-bristol.png.

Implement the React + TypeScript frontend foundation on a new feature branch. First run the standalone art review bench (`python -m http.server 8765`, open `/tools/art-review/`) and reproduce its findings. Resolve asset blockers named in the readiness report before calling the city production-ready. Do not replace the atlas contract with untracked hard-coded image offsets.

## Component structure

AppShell → PrimaryNavigation, FinancialHUD, RouteOutlet, NotificationRegion.
CityScreen → CityViewport → TerrainLayer, EntityLayer, SelectionLayer, AccessibleCompanyList; CompanyInspector.
CompaniesScreen → CompanyList, CompanyOverview, OperationsForm, CompanyFinancials.
CommodityScreen → CommodityList, OrderBook, TradeTicket, OwnOrders, TradeHistory.
StocksScreen → ListingList, CompanyFundamentals, PriceHistory, ShareTicket, Holdings.
PrestigeScreen → ItemGrid, ItemDetails, PlacementPicker.
WalletScreen → SimulatedBanner, TestBalance, TestDepositForm, TestWithdrawalForm, LedgerHistory.
Shared → MoneyValue, StatusLabel, Button, Field, Tabs, ResponsiveSheet, EmptyState, ErrorState, Sparkline, FinancialChart, DataTable.

## Integration order

1. Set up typed client, runtime DTO validation, routes, tokens and fixture adapter. All fixtures labelled Illustrative data.
2. Import manifest/reference renderer; prove a six-industry static district, exact tile connectivity, transparent contours, consistent door/person scale and depth ordering.
3. Implement City selection, keyboard company list and responsive inspector; build Companies read-only then local draft forms.
4. Build Commodity/Stocks with deterministic fixture quote and pending/error states; no claim of real matching or persistence.
5. Build Prestige unavailable-art states and clearly simulated Wallet. Test £5 threshold and no EC/GBP conflation.
6. Add graphs from typed series, accessible tables, empty history and missing-data gaps.
7. Only then connect server endpoints. Server owns balances, production, matching and immutable ledger; client forms never write authoritative balances.

## Acceptance criteria

- All six initial industries appear and remain selectable at desktop and mobile, with no source-sheet neighbours leaking into frames.
- Camera remains 2:1; roads connect at edge midpoints; water/quay boundaries align; hit testing uses plot geometry.
- No page overflow at 390/768/1440px. At 390px, city itself may pan. 44px controls, keyboard focus, dialog escape/focus return, accessible map alternative.
- UI distinguishes owned/NPC/state companies and read-only permissions. Every screen has loading, empty, error, stale and pending states.
- Integer money and quantities; quote fee/total displayed; partial-fill/cancel and stale revision states handled.
- Wallet permanently SIMULATED with GBP_TEST; EC portfolio remains separately labelled. No live payment integration.
- Subtle graphs have units, periods, zero baselines where needed and accessible tables.
- Run typecheck, build, interaction tests and asset boundary tests; attach desktop/mobile captures and report unresolved art defects.

This prompt authorizes a frontend implementation with fixtures. It does not certify an economic backend, full animation set, production-ready art or live finances.
