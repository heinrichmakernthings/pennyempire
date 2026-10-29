# Financial stress scenarios (simulated treasury)

Deterministic except the lottery draw (secure randomness). Everything uses the real engine functions.

## S1 — Mass withdrawal

300 players each deposit £10 (simulated) and request a £10 cash-out at the same moment; the treasury holds only the deposits (player funds) and no business money: payments are fully backed because processor fees are a business liability and are never taken from player funds.

GBP ledger reconciles: **true** · Empire Coin ledger reconciles: **true**

- players: 300
- paid: 300
- refusedForLackOfCash: 0
- walletLiabilitiesPence: 0
- pendingPence: 0
- coverageOfPlayerFundsPence: 0
- transactions: 1,500

## S2 — Simultaneous reward claims

1000 players each claim the same £5 reward three times (two identical keys and one new key) against a £100 budget.

GBP ledger reconciles: **true** · Empire Coin ledger reconciles: **true**

- claimants: 1,000
- awarded: 20
- duplicatesIgnored: 20
- refused: 2,960
- spentPence: 10,000
- budgetPence: 10,000
- transactions: 22

## S3 — Large coin lottery

400 players buy the maximum 10 tickets each; the draw uses the secure generator.

GBP ledger reconciles: **true** · Empire Coin ledger reconciles: **true**

- ticketsSold: 4,000
- drawn: 1
- winners: 3
- distinctWinnerTickets: 3
- prizesMinor: 36,000,000
- poolMinor: 40,000,000
- rakeBurnedMinor: 4,000,000
- issuedChange: 0
- transactions: 0
