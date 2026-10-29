# Private-alpha stress results

## 1 player — invariants hold

| fact | value |
|---|---|
| players | 1 |
| registerP50Ms | 22.5 |
| registerP95Ms | 22.5 |
| requests | 9 |
| requestP50Ms | 2.7 |
| requestP95Ms | 55.1 |
| requestMaxMs | 55.1 |
| companiesFounded | 1 |
| refusedNoFreeLot | 0 |
| prestigeBought | 1 |
| shareOrders | 1 |
| commodityOrders | 1 |
| tickAvgMs | 81 |
| tickMaxMs | 153 |
| playerCompaniesOperatingAfter30d | 1 |
| npcCompanies | 7 |
| circulatingEC | 150728.07 |

## 10 players — invariants hold

| fact | value |
|---|---|
| players | 10 |
| registerP50Ms | 18.9 |
| registerP95Ms | 25.8 |
| requests | 88 |
| requestP50Ms | 1.6 |
| requestP95Ms | 3.6 |
| requestMaxMs | 11.2 |
| companiesFounded | 9 |
| refusedNoFreeLot | 1 |
| prestigeBought | 10 |
| shareOrders | 10 |
| commodityOrders | 9 |
| tickAvgMs | 111 |
| tickMaxMs | 158 |
| playerCompaniesOperatingAfter30d | 6 |
| npcCompanies | 5 |
| circulatingEC | 304540.78 |

## 100 players — invariants hold

| fact | value |
|---|---|
| players | 100 |
| registerP50Ms | 18.4 |
| registerP95Ms | 28.3 |
| requests | 720 |
| requestP50Ms | 0.9 |
| requestP95Ms | 3.4 |
| requestMaxMs | 14.8 |
| companiesFounded | 10 |
| refusedNoFreeLot | 90 |
| prestigeBought | 100 |
| shareOrders | 93 |
| commodityOrders | 10 |
| tickAvgMs | 149 |
| tickMaxMs | 273 |
| playerCompaniesOperatingAfter30d | 6 |
| npcCompanies | 5 |
| circulatingEC | 1878752.12 |

## Heavy simultaneous trading — invariants hold

| fact | value |
|---|---|
| companies | 10 |
| ordersSubmitted | 300 |
| accepted | 300 |
| refused | 0 |
| requestP95Ms | 653.9 |
| trades | 392 |
| openOrders | 253 |
| tickAvgMs | 145 |
| tickMaxMs | 310 |

## Recession + inflation + energy shortage, with a starved company — invariants hold

| fact | value |
|---|---|
| eventsTriggered | 200/200/200/200 |
| cashWithdrawn | true |
| overspendSet | true |
| playerCompanyStatus | insolvent |
| playerCompanyBankrupt | true |
| residualPaidToOwnerWallet | no residual |
| bankruptciesDuring40Days | 3 |
| npcCompaniesOperating | 5 |
| householdsAvgBeforeMinor | 1768470 |
| unmetUnits | 800 |
| tickAvgMs | 80 |
| tickMaxMs | 209 |

## Large NPC economy, 180 days unattended — invariants hold

| fact | value |
|---|---|
| days | 180 |
| npcCompanies | 6 |
| npcDecisions | 379 |
| trades | 1402 |
| failedTicks | 0 |
| tickAvgMs | 84 |
| tickMaxMs | 279 |
