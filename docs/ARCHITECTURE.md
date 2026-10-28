# Technical architecture — proposal

## Client
TypeScript + React + Vite. Three primary browser surfaces: pixel-art city; business manager; market terminal. Responsive mobile panels.

## API
Server-authoritative endpoints for accounts, cities, companies, production configuration, inventories, order placement/cancellation, matching, treasury, and history. Do not trust client-supplied prices, balances, permissions or completion claims.

## Persistence
Relational storage with transactional guarantees for inventory, ownership and financial ledger. Select actual database after reviewing deployment and concurrency requirements. Match orders inside serialisable transaction or equivalent single-writer system.

## Core entities
User; Invite; City; District; Company; Industry; ProductionRecipe; Inventory; SupplyContract; Commodity; Order; Trade; CompanyShare; Holding; EconomicTick; EconomicEvent; StateTreasury; CurrencyLedgerEntry; TestWallet; TestWalletLedgerEntry; RewardProgram; AuditLog.

## Ledger requirements
Immutable double-entry, integer minor units, reference IDs, idempotency keys, reconciliation routines, anti-negative-balance invariants, clear segregation of game coins vs simulated test GBP. Ledger entries and asset transfers must commit atomically.

## Simulated wallet
Deposit and cash-out interfaces use TEST ONLY providers/mocks. No production card/bank credentials, external payout endpoints or live-money feature flag. £5 simulated cash-out threshold is UI functionality, not entitlement to a real payment.

## Security / operations
Invite-only auth, rate limits, input validation, CSRF/XSS protections, role-based admin permissions, audit trail, monitoring, secret management and regular backups. Do not expose precise user geolocation. Financial compliance, payments and gambling licensing require a separate release gate.
