# State-economy scenario C — Inflation

150 in-game days · deterministic · ledger reconciles: **true** · share register consistent: **true** · anomalies: **0**

## Setup
- One human player (scripted, passive apart from the stated actions) owns Quay Pizza and plays inside an otherwise NPC-driven economy.
- Inflation: from day 20 the citizen income grant is multiplied by 6, the supply controller and the state upkeep burn are switched off, so issuance greatly exceeds sinks.

## Headline
- finalCpiBps: 93.82%
- peakInflation30Bps: 4.94%
- troughInflation30Bps: -11.87%
- cpiVolatilityBps: 1.61%
- peakEnergyShortageUnits: 0
- peakTariffMinor: 0.96 EC
- minMeanProfitMinor: 17.36 EC
- finalMeanProfitMinor: 17.36 EC
- bankruptcies: 0
- defaults: 0
- peakLoansMinor: 1,195.33 EC
- npcCashStartMinor: 21,923.39 EC
- npcCashEndMinor: 27,009.38 EC
- minNpcCashMinor: 21,923.39 EC
- stateTreasuryEndMinor: 19,050.73 EC
- circulatingStartMinor: 173,018.47 EC
- circulatingEndMinor: 217,409.15 EC
- marketIndexLowBps: 95.24%
- marketIndexEndBps: 130.38%
- peakUnmetUnits: 1942
- baseRateEndBps: 1.25%
- eventsStarted: 7
- playerWealthStartMinor: 56,684.42 EC
- playerWealthEndMinor: 70,707.47 EC
- playerCompanyStatus: operating

## Timeline
| day | CPI | infl 30d | base rate | tariff | energy short | mean profit | operating | bankrupt | NPC cash | loans | defaults | treasury | circulating | share idx | player wealth |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 6 | 101.5 | 0.0% | 2.00% | 90 | 0 | 7170 | 7 | 0 | 21923 | 0 | 0 | 23590 | 173018 | 100.0 | 56684 |
| 12 | 102.3 | 0.0% | 2.00% | 90 | 0 | 13737 | 7 | 0 | 26106 | 0 | 0 | 17446 | 172856 | 101.1 | 57107 |
| 18 | 101.5 | 0.0% | 2.00% | 90 | 0 | 14221 | 7 | 0 | 28721 | 0 | 0 | 14861 | 172761 | 95.2 | 57576 |
| 24 | 101.3 | 0.0% | 2.00% | 90 | 0 | 13398 | 7 | 0 | 29234 | 0 | 0 | 13722 | 174121 | 98.9 | 58083 |
| 30 | 100.4 | 0.0% | 2.00% | 90 | 0 | 13671 | 7 | 0 | 29109 | 0 | 0 | 13031 | 176199 | 102.1 | 58652 |
| 36 | 99.2 | -2.3% | 2.00% | 96 | 0 | 13565 | 7 | 0 | 28715 | 0 | 0 | 13005 | 178277 | 104.9 | 59214 |
| 42 | 99.1 | -3.1% | 1.75% | 96 | 0 | 9199 | 8 | 0 | 32582 | 0 | 0 | 10223 | 180249 | 110.6 | 59228 |
| 48 | 99.9 | -1.5% | 1.75% | 96 | 0 | 8640 | 8 | 0 | 29436 | 0 | 0 | 12512 | 182309 | 112.9 | 59793 |
| 54 | 99.3 | -2.0% | 1.75% | 96 | 0 | 7169 | 8 | 0 | 30651 | 0 | 0 | 14109 | 184373 | 116.1 | 60762 |
| 60 | 94.2 | -6.2% | 1.50% | 90 | 0 | 10141 | 8 | 0 | 32737 | 1195 | 0 | 14311 | 186437 | 119.0 | 61600 |
| 66 | 89.9 | -9.3% | 1.50% | 90 | 0 | 9063 | 8 | 0 | 32217 | 919 | 0 | 14678 | 188500 | 121.7 | 62445 |
| 72 | 88.3 | -11.0% | 1.25% | 90 | 0 | 9149 | 8 | 0 | 30776 | 644 | 0 | 16369 | 190563 | 122.8 | 63286 |
| 78 | 88.1 | -11.9% | 1.25% | 90 | 0 | 8082 | 8 | 0 | 30033 | 368 | 0 | 17829 | 192628 | 120.5 | 64369 |
| 84 | 87.6 | -11.7% | 1.00% | 90 | 0 | 6905 | 8 | 0 | 30872 | 92 | 0 | 13820 | 194690 | 121.7 | 64914 |
| 90 | 87.8 | -6.7% | 1.00% | 90 | 0 | 6517 | 8 | 0 | 29937 | 0 | 0 | 14456 | 196752 | 122.8 | 65697 |
| 96 | 88.9 | -1.1% | 1.00% | 90 | 0 | 6833 | 8 | 0 | 29546 | 0 | 0 | 15248 | 198813 | 124.4 | 66636 |
| 102 | 89.1 | 0.9% | 0.75% | 90 | 0 | 6339 | 8 | 0 | 29685 | 0 | 0 | 16436 | 200874 | 126.1 | 67358 |
| 108 | 90.5 | 2.7% | 0.75% | 90 | 0 | 6813 | 8 | 0 | 30126 | 0 | 0 | 16832 | 202938 | 126.0 | 68056 |
| 114 | 91.1 | 4.0% | 1.00% | 90 | 0 | 5094 | 8 | 0 | 28674 | 0 | 0 | 15739 | 205000 | 124.5 | 68707 |
| 120 | 92.0 | 4.8% | 1.00% | 90 | 0 | 2988 | 8 | 0 | 27095 | 0 | 0 | 18472 | 207073 | 125.5 | 68556 |
| 126 | 93.3 | 4.9% | 1.25% | 90 | 0 | 6472 | 8 | 0 | 29064 | 0 | 0 | 13397 | 209140 | 127.3 | 69186 |
| 132 | 91.8 | 3.0% | 1.25% | 90 | 0 | 6121 | 8 | 0 | 28818 | 0 | 0 | 14671 | 211204 | 127.8 | 69761 |
| 138 | 92.3 | 2.0% | 1.25% | 90 | 0 | 5310 | 8 | 0 | 28922 | 0 | 0 | 15959 | 213272 | 128.7 | 70335 |
| 144 | 93.2 | 2.3% | 1.25% | 90 | 0 | 4104 | 8 | 0 | 29307 | 0 | 0 | 17287 | 215344 | 128.7 | 70353 |
| 150 | 93.8 | 2.0% | 1.25% | 90 | 0 | 1736 | 8 | 0 | 27009 | 0 | 0 | 19051 | 217409 | 130.4 | 70707 |
