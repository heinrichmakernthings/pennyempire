# State-economy scenario D — Recession

150 in-game days · deterministic · ledger reconciles: **true** · share register consistent: **true** · anomalies: **0**

## Setup
- One human player (scripted, passive apart from the stated actions) owns Quay Pizza and plays inside an otherwise NPC-driven economy.
- Recession: on day 20 a severe recession event starts (60 days) and household confidence is cut by a configured 10% shock.

## Headline
- finalCpiBps: 96.64%
- peakInflation30Bps: 3.99%
- troughInflation30Bps: -11.77%
- cpiVolatilityBps: 2.01%
- peakEnergyShortageUnits: 0
- peakTariffMinor: 1.56 EC
- minMeanProfitMinor: 36.98 EC
- finalMeanProfitMinor: 47.54 EC
- bankruptcies: 1
- defaults: 0
- peakLoansMinor: 297.20 EC
- npcCashStartMinor: 21,923.39 EC
- npcCashEndMinor: 26,769.03 EC
- minNpcCashMinor: 21,923.39 EC
- stateTreasuryEndMinor: 11,279.82 EC
- circulatingStartMinor: 173,018.47 EC
- circulatingEndMinor: 170,807.06 EC
- marketIndexLowBps: 95.24%
- marketIndexEndBps: 120.47%
- peakUnmetUnits: 1536
- baseRateEndBps: 1.00%
- eventsStarted: 6
- playerWealthStartMinor: 56,684.42 EC
- playerWealthEndMinor: 67,993.58 EC
- playerCompanyStatus: operating

## Timeline
| day | CPI | infl 30d | base rate | tariff | energy short | mean profit | operating | bankrupt | NPC cash | loans | defaults | treasury | circulating | share idx | player wealth |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 6 | 101.5 | 0.0% | 2.00% | 90 | 0 | 7170 | 7 | 0 | 21923 | 0 | 0 | 23590 | 173018 | 100.0 | 56684 |
| 12 | 102.3 | 0.0% | 2.00% | 90 | 0 | 13737 | 7 | 0 | 26106 | 0 | 0 | 17446 | 172856 | 101.1 | 57107 |
| 18 | 101.5 | 0.0% | 2.00% | 90 | 0 | 14221 | 7 | 0 | 28721 | 0 | 0 | 14861 | 172761 | 95.2 | 57576 |
| 24 | 101.5 | 0.0% | 2.00% | 90 | 0 | 11712 | 7 | 0 | 27723 | 0 | 0 | 13576 | 172682 | 98.9 | 57968 |
| 30 | 100.8 | 0.0% | 2.00% | 90 | 0 | 10153 | 7 | 0 | 26842 | 0 | 0 | 12451 | 172606 | 101.4 | 58515 |
| 36 | 99.3 | -2.1% | 2.00% | 90 | 0 | 10036 | 7 | 0 | 26377 | 0 | 0 | 11675 | 172529 | 104.0 | 59079 |
| 42 | 96.5 | -5.8% | 1.75% | 90 | 0 | 9812 | 7 | 0 | 29615 | 0 | 0 | 7719 | 172449 | 107.0 | 59801 |
| 48 | 93.7 | -7.7% | 1.75% | 90 | 0 | 8936 | 7 | 0 | 28490 | 0 | 0 | 7995 | 172370 | 109.5 | 60320 |
| 54 | 90.9 | -10.5% | 1.75% | 90 | 0 | 7675 | 7 | 0 | 28700 | 0 | 0 | 8095 | 172290 | 111.6 | 60270 |
| 60 | 89.0 | -11.8% | 1.50% | 90 | 0 | 7323 | 7 | 0 | 28264 | 0 | 0 | 8260 | 172212 | 112.3 | 60854 |
| 66 | 88.7 | -10.7% | 1.50% | 90 | 0 | 6121 | 7 | 0 | 28053 | 0 | 0 | 8455 | 172134 | 112.5 | 61019 |
| 72 | 89.2 | -7.5% | 1.25% | 90 | 0 | 6267 | 7 | 0 | 27021 | 0 | 0 | 8928 | 172057 | 111.7 | 61665 |
| 78 | 90.5 | -3.3% | 1.25% | 90 | 0 | 6720 | 7 | 0 | 26348 | 0 | 0 | 9248 | 171981 | 112.6 | 61944 |
| 84 | 91.3 | 0.5% | 1.00% | 90 | 0 | 7250 | 7 | 0 | 28982 | 0 | 0 | 6230 | 171903 | 112.8 | 62263 |
| 90 | 91.8 | 3.3% | 1.00% | 90 | 0 | 6890 | 8 | 0 | 29454 | 0 | 0 | 8100 | 171726 | 113.0 | 63004 |
| 96 | 92.2 | 4.0% | 1.00% | 90 | 0 | 4066 | 8 | 0 | 27633 | 0 | 0 | 8514 | 171636 | 111.8 | 63598 |
| 102 | 92.6 | 3.8% | 1.25% | 90 | 0 | 4673 | 8 | 0 | 28423 | 297 | 0 | 9144 | 171548 | 113.1 | 64074 |
| 108 | 92.8 | 2.5% | 1.25% | 90 | 0 | 4776 | 8 | 0 | 28437 | 229 | 0 | 9847 | 171458 | 114.2 | 64710 |
| 114 | 93.5 | 2.4% | 1.50% | 101 | 0 | 4480 | 8 | 0 | 28367 | 160 | 0 | 10551 | 171367 | 116.0 | 65147 |
| 120 | 95.0 | 3.5% | 1.50% | 101 | 0 | 3698 | 8 | 0 | 28383 | 91 | 0 | 11510 | 171268 | 117.5 | 65520 |
| 126 | 89.4 | -3.0% | 1.25% | 101 | 0 | 6743 | 7 | 1 | 27552 | 23 | 0 | 8264 | 171178 | 118.0 | 66452 |
| 132 | 89.3 | -3.6% | 1.25% | 101 | 0 | 5943 | 7 | 1 | 28071 | 0 | 0 | 8867 | 171087 | 118.5 | 66719 |
| 138 | 89.7 | -3.4% | 1.25% | 101 | 0 | 5273 | 7 | 1 | 27291 | 0 | 0 | 9786 | 170998 | 119.0 | 67078 |
| 144 | 92.6 | -0.9% | 1.00% | 148 | 0 | 5606 | 7 | 1 | 27236 | 0 | 0 | 10406 | 170905 | 119.8 | 67621 |
| 150 | 96.6 | 1.7% | 1.00% | 156 | 0 | 4754 | 7 | 1 | 26769 | 0 | 0 | 11280 | 170807 | 120.5 | 67994 |
