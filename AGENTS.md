# Penny Empire — agent instructions

## Product guardrails
- Preserve the core product promise: accessible idle game + meaningful business decisions + interdependent local markets.
- Pixel-art city visuals paired with an elegant, dark market terminal; browser-first, responsive for mobile.
- Start with Bristol and a handful of industries. Add depth only once the end-to-end economic loop works.
- Use game coins for business resources, goods, shares and luxury assets. No redemption into real money in pre-alpha.
- A separate test GBP wallet may simulate 50p deposits, £5 withdrawals, and rewards. Label it SIMULATED everywhere and never connect it to real payment providers.
- No live lottery, paid raffle, real-money wagering, or withdrawable securities until specialist legal review, licensing, and approved payment/safeguarding infrastructure.
- No dark-pattern loss-chasing payouts, secretly manipulated stock crashes, or undisclosed odds.

## Engineering
- Use integer minor units for monetary arithmetic; avoid floating-point balances.
- State-changing actions must be validated server-side and idempotent where applicable.
- Financial/test wallet balances use immutable double-entry ledger entries, never mutable balance-only logic.
- Simulation must distinguish coin creation, destruction, and transfers; transfers are NOT sinks.
- Add tests for conservation, production recipes, trading fees, inventory constraints, insolvency and withdrawals.
- Never commit secrets, personal data or production credentials.
- Keep small, reviewable pull requests. Avoid destructive pushes or overwriting another agent's work.
- Match a selected visual target before building large-scale UI.
