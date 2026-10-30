# State-economy scenario G — Market Crash

150 in-game days · deterministic · ledger reconciles: **true** · share register consistent: **true** · anomalies: **0**

## Setup
- One human player (scripted, passive apart from the stated actions) owns Quay Pizza and plays inside an otherwise NPC-driven economy.
- Market crash: from day 30 a recession, an agricultural disruption and an energy shortage overlap, so listed companies genuinely lose earnings; NPC investors price that in.

## Headline
- finalCpiBps: 88.97%
- peakInflation30Bps: 6.29%
- troughInflation30Bps: -10.26%
- cpiVolatilityBps: 1.71%
- peakEnergyShortageUnits: 0
- peakTariffMinor: 1.17 EC
- minMeanProfitMinor: 47.01 EC
- finalMeanProfitMinor: 59.58 EC
- bankruptcies: 1
- defaults: 0
- peakLoansMinor: 542.12 EC
- npcCashStartMinor: 21,923.39 EC
- npcCashEndMinor: 26,024.91 EC
- minNpcCashMinor: 21,923.39 EC
- stateTreasuryEndMinor: 12,344.74 EC
- circulatingStartMinor: 173,018.47 EC
- circulatingEndMinor: 170,782.74 EC
- marketIndexLowBps: 95.24%
- marketIndexEndBps: 124.28%
- peakUnmetUnits: 1541
- baseRateEndBps: 1.00%
- eventsStarted: 7
- playerWealthStartMinor: 56,684.42 EC
- playerWealthEndMinor: 69,286.68 EC
- playerCompanyStatus: operating

## Timeline
| day | CPI | infl 30d | base rate | tariff | energy short | mean profit | operating | bankrupt | NPC cash | loans | defaults | treasury | circulating | share idx | player wealth |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 6 | 101.5 | 0.0% | 2.00% | 90 | 0 | 7170 | 7 | 0 | 21923 | 0 | 0 | 23590 | 173018 | 100.0 | 56684 |
| 12 | 102.3 | 0.0% | 2.00% | 90 | 0 | 13737 | 7 | 0 | 26106 | 0 | 0 | 17446 | 172856 | 101.1 | 57107 |
| 18 | 101.5 | 0.0% | 2.00% | 90 | 0 | 14221 | 7 | 0 | 28721 | 0 | 0 | 14861 | 172761 | 95.2 | 57576 |
| 24 | 101.3 | 0.0% | 2.00% | 90 | 0 | 13365 | 7 | 0 | 29197 | 0 | 0 | 13719 | 172681 | 98.9 | 58083 |
| 30 | 100.5 | 0.0% | 2.00% | 90 | 0 | 12861 | 7 | 0 | 28914 | 0 | 0 | 12868 | 172601 | 102.1 | 58679 |
| 36 | 99.9 | -1.5% | 2.00% | 117 | 0 | 11609 | 7 | 0 | 27800 | 0 | 0 | 12252 | 172524 | 104.9 | 59335 |
| 42 | 104.1 | 1.7% | 2.00% | 117 | 0 | 8858 | 7 | 0 | 30412 | 0 | 0 | 8084 | 172443 | 109.3 | 59801 |
| 48 | 106.1 | 4.5% | 2.00% | 117 | 0 | 6961 | 7 | 0 | 28225 | 0 | 0 | 9711 | 172363 | 112.4 | 60093 |
| 54 | 107.7 | 6.3% | 2.00% | 117 | 0 | 7259 | 7 | 0 | 27459 | 0 | 0 | 10904 | 172285 | 113.4 | 60451 |
| 60 | 104.8 | 4.3% | 2.25% | 90 | 0 | 7345 | 7 | 0 | 27114 | 0 | 0 | 11770 | 172211 | 113.1 | 60897 |
| 66 | 103.1 | 3.2% | 2.25% | 96 | 0 | 8541 | 7 | 0 | 27095 | 0 | 0 | 12325 | 172133 | 113.9 | 61314 |
| 72 | 103.7 | -0.4% | 2.25% | 96 | 0 | 9303 | 7 | 0 | 26644 | 0 | 0 | 12220 | 172055 | 115.1 | 61915 |
| 78 | 102.0 | -3.8% | 2.25% | 96 | 0 | 9782 | 7 | 0 | 26569 | 0 | 0 | 11985 | 171975 | 116.6 | 62525 |
| 84 | 100.7 | -6.4% | 2.00% | 96 | 0 | 10354 | 7 | 0 | 29866 | 0 | 0 | 8444 | 171892 | 117.3 | 63137 |
| 90 | 98.6 | -5.8% | 2.00% | 90 | 0 | 9681 | 8 | 0 | 30970 | 0 | 0 | 10271 | 171713 | 118.9 | 63718 |
| 96 | 97.1 | -5.8% | 2.00% | 90 | 0 | 6746 | 8 | 0 | 29008 | 0 | 0 | 10843 | 171623 | 120.0 | 64448 |
| 102 | 94.8 | -8.6% | 1.75% | 90 | 0 | 7101 | 8 | 0 | 29223 | 542 | 0 | 11087 | 171532 | 120.2 | 65064 |
| 108 | 92.4 | -9.4% | 1.75% | 90 | 0 | 6876 | 8 | 0 | 29033 | 417 | 0 | 11663 | 171441 | 121.2 | 65826 |
| 114 | 90.4 | -10.2% | 1.50% | 90 | 0 | 6055 | 8 | 0 | 27999 | 292 | 0 | 13000 | 171347 | 122.9 | 66225 |
| 120 | 88.5 | -10.3% | 1.50% | 90 | 0 | 4701 | 8 | 0 | 27557 | 167 | 0 | 13783 | 171251 | 124.0 | 66156 |
| 126 | 88.7 | -8.7% | 1.25% | 90 | 0 | 4763 | 8 | 0 | 28314 | 41 | 0 | 9662 | 171155 | 125.3 | 66986 |
| 132 | 89.0 | -6.2% | 1.25% | 90 | 0 | 4773 | 8 | 0 | 28685 | 0 | 0 | 10241 | 171060 | 125.3 | 67245 |
| 138 | 87.4 | -5.4% | 1.25% | 90 | 0 | 6941 | 7 | 1 | 26656 | 0 | 0 | 10729 | 170970 | 125.9 | 68065 |
| 144 | 87.1 | -3.6% | 1.00% | 101 | 0 | 7263 | 7 | 1 | 25974 | 0 | 0 | 11527 | 170877 | 123.9 | 68994 |
| 150 | 89.0 | 0.5% | 1.00% | 101 | 0 | 5958 | 7 | 1 | 26025 | 0 | 0 | 12345 | 170783 | 124.3 | 69287 |
