# State-economy scenario P — Pizza Restaurant Story (essential gameplay scenario)

164 in-game days · deterministic · ledger reconciles: **true** · share register consistent: **true** · anomalies: **0**

## Setup
- One human player (scripted, passive apart from the stated actions) owns Quay Pizza and plays inside an otherwise NPC-driven economy.
- The essential gameplay story: a profitable player pizza restaurant buys advertising, electricity and premises from the state companies, borrows from the National Bank, lists on the exchange; an energy crisis hits; the central bank raises rates; repayments cost more; investors react; the Penny Post reports it.

## Headline
- loanInterestPerDayBeforeMinor: 0.27 EC
- energyBillPerDayBeforeMinor: 16.20 EC
- energyBillPerDayInCrisisMinor: 37.62 EC
- tariffInCrisisMinor: 2.09 EC
- loanInterestPerDayAfterRiseMinor: 0.37 EC
- pizzaProfitInCrisisMinor: 81.69 EC
- pizzaProfitBeforeMinor: 93.94 EC
- shareIndexBeforeBps: 101.68%
- shareIndexAfterBps: 121.88%
- playerSharePriceChangeBps: 0.00%
- postArticles: 23
- finalCpiBps: 87.17%
- peakInflation30Bps: 17.55%
- troughInflation30Bps: -22.29%
- cpiVolatilityBps: 4.27%
- peakEnergyShortageUnits: 53
- peakTariffMinor: 2.09 EC
- minMeanProfitMinor: 29.97 EC
- finalMeanProfitMinor: 64.74 EC
- bankruptcies: 2
- defaults: 0
- peakLoansMinor: 2,854.20 EC
- npcCashStartMinor: 21,923.39 EC
- npcCashEndMinor: 28,342.32 EC
- minNpcCashMinor: 21,923.39 EC
- stateTreasuryEndMinor: 12,091.43 EC
- circulatingStartMinor: 173,018.47 EC
- circulatingEndMinor: 170,260.10 EC
- marketIndexLowBps: 95.18%
- marketIndexEndBps: 121.88%
- peakUnmetUnits: 1711
- baseRateEndBps: 5.00%
- eventsStarted: 7
- playerWealthStartMinor: 56,684.42 EC
- playerWealthEndMinor: 72,478.96 EC
- playerCompanyStatus: operating

## Story
- Day 14: the National Bank lends Quay Pizza 900 EC for 45 days.
- Day 14: Quay Pizza lists 2,000 new shares at 1.00 EC.
- Day 31: a severe energy shortage begins (grid capacity −55%, tariff +45%).
- Day 37: Penny Central Bank raises the base rate by 4 points.
- Penny Post, day 15: Quay Pizza reports record profit
- Penny Post, day 29: Quay Pizza reports record profit
- Penny Post, day 31: Energy crisis: Penny Energy cuts supply (severe)
- Penny Post, day 36: Bristol slips into recession (mild)
- Penny Post, day 37: Penny Central Bank changes the base rate
- Penny Post, day 42: Penny Central Bank changes the base rate
- Penny Post, day 49: Quay Pizza named Market Leader: Pizza Restaurant
- Penny Post, day 51: Conditions ease
- Penny Post, day 56: Penny Central Bank changes the base rate
- Penny Post, day 57: Quay Pizza reports record profit
- Penny Post, day 62: Conditions ease
- Penny Post, day 66: Visitors flood the harbourside (mild tourism surge)
- Penny Post, day 70: Penny Central Bank changes the base rate
- Penny Post, day 74: Quay Pizza reports record profit

## Notes
- ad: Billboard runs for 3–30 days.

## Timeline
| day | CPI | infl 30d | base rate | tariff | energy short | mean profit | operating | bankrupt | NPC cash | loans | defaults | treasury | circulating | share idx | player wealth |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 6 | 101.5 | 0.0% | 2.00% | 90 | 0 | 7170 | 7 | 0 | 21923 | 0 | 0 | 23590 | 173018 | 100.0 | 56684 |
| 12 | 102.3 | 0.0% | 2.00% | 90 | 0 | 13737 | 7 | 0 | 26106 | 0 | 0 | 17446 | 172856 | 101.1 | 57107 |
| 18 | 101.5 | 0.0% | 2.00% | 90 | 0 | 14219 | 7 | 0 | 28721 | 820 | 0 | 14862 | 172731 | 95.2 | 58316 |
| 24 | 101.3 | 0.0% | 2.00% | 90 | 0 | 13360 | 7 | 0 | 29197 | 700 | 0 | 13730 | 172624 | 98.6 | 58701 |
| 30 | 100.5 | 0.0% | 2.00% | 90 | 0 | 12857 | 7 | 0 | 28914 | 580 | 0 | 12876 | 172544 | 101.7 | 59175 |
| 36 | 115.0 | 13.3% | 2.00% | 209 | 23 | 6308 | 7 | 0 | 24671 | 460 | 0 | 13877 | 172447 | 107.1 | 59665 |
| 42 | 120.1 | 17.3% | 6.25% | 209 | 53 | 3419 | 8 | 0 | 26855 | 340 | 0 | 10810 | 172243 | 109.1 | 59916 |
| 48 | 119.3 | 17.6% | 6.25% | 131 | 0 | 2997 | 8 | 0 | 25851 | 220 | 0 | 11654 | 172137 | 109.2 | 60526 |
| 54 | 111.0 | 9.6% | 6.25% | 90 | 0 | 7564 | 8 | 0 | 26562 | 100 | 0 | 11966 | 172036 | 110.1 | 60818 |
| 60 | 101.3 | 0.8% | 6.50% | 90 | 0 | 8250 | 8 | 0 | 28771 | 596 | 0 | 12131 | 171947 | 112.2 | 61411 |
| 66 | 97.5 | -15.2% | 6.50% | 90 | 0 | 8357 | 8 | 0 | 29690 | 458 | 0 | 11918 | 171855 | 114.7 | 62423 |
| 72 | 94.7 | -21.1% | 6.25% | 90 | 0 | 8696 | 8 | 0 | 30486 | 321 | 0 | 11926 | 171762 | 116.2 | 63269 |
| 78 | 92.7 | -22.3% | 6.25% | 90 | 0 | 7568 | 8 | 0 | 29516 | 183 | 0 | 12971 | 171668 | 116.5 | 64426 |
| 84 | 91.6 | -17.5% | 6.00% | 90 | 0 | 5602 | 8 | 0 | 31695 | 46 | 0 | 8802 | 171567 | 117.0 | 64340 |
| 90 | 86.1 | -14.9% | 6.00% | 90 | 0 | 7574 | 8 | 1 | 30675 | 0 | 0 | 11242 | 171376 | 117.3 | 64511 |
| 96 | 88.9 | -8.9% | 6.00% | 90 | 0 | 4430 | 8 | 1 | 28703 | 0 | 0 | 12106 | 171274 | 117.7 | 64973 |
| 102 | 89.5 | -5.5% | 5.75% | 90 | 0 | 4990 | 8 | 1 | 28625 | 0 | 0 | 13201 | 171172 | 117.6 | 65659 |
| 108 | 87.7 | -5.4% | 5.75% | 90 | 0 | 4975 | 8 | 1 | 28652 | 0 | 0 | 13909 | 171073 | 119.2 | 66022 |
| 114 | 85.0 | -7.2% | 5.50% | 90 | 0 | 6956 | 7 | 2 | 27512 | 0 | 0 | 14958 | 170985 | 119.2 | 67046 |
| 120 | 84.4 | -2.0% | 5.50% | 90 | 0 | 7513 | 7 | 2 | 28227 | 0 | 0 | 15121 | 170899 | 119.2 | 67673 |
| 126 | 85.2 | -4.1% | 5.25% | 90 | 0 | 6714 | 7 | 2 | 31562 | 2854 | 0 | 11367 | 170813 | 120.9 | 67935 |
| 132 | 86.5 | -3.5% | 5.25% | 90 | 0 | 8290 | 7 | 2 | 30282 | 2283 | 0 | 11451 | 170724 | 120.9 | 69718 |
| 138 | 86.9 | -0.9% | 5.25% | 90 | 0 | 7045 | 7 | 2 | 29758 | 1713 | 0 | 12469 | 170634 | 120.5 | 70127 |
| 144 | 86.5 | 1.8% | 5.00% | 90 | 0 | 6261 | 7 | 2 | 29613 | 1142 | 0 | 12548 | 170546 | 121.1 | 70231 |
| 150 | 86.1 | 2.0% | 5.00% | 90 | 0 | 6628 | 7 | 2 | 28745 | 571 | 0 | 12989 | 170458 | 122.2 | 71170 |
| 156 | 86.4 | 1.4% | 5.00% | 90 | 0 | 6410 | 7 | 2 | 28034 | 0 | 0 | 13433 | 170372 | 122.2 | 71620 |
| 162 | 86.9 | 0.5% | 5.00% | 90 | 0 | 6482 | 7 | 2 | 27766 | 0 | 0 | 13659 | 170288 | 122.0 | 72192 |
| 164 | 87.2 | 0.4% | 5.00% | 90 | 0 | 6474 | 7 | 2 | 28342 | 0 | 0 | 12091 | 170260 | 121.9 | 72479 |
