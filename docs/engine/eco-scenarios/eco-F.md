# State-economy scenario F — Credit Crunch

150 in-game days · deterministic · ledger reconciles: **true** · share register consistent: **true** · anomalies: **0**

## Setup
- One human player (scripted, passive apart from the stated actions) owns Quay Pizza and plays inside an otherwise NPC-driven economy.
- Credit crunch: at day 15 every NPC firm and the player that the bank will lend to borrows; on day 40 the central bank lifts the base rate to 12% and a severe credit crunch begins.

## Headline
- loansTaken: 6
- finalCpiBps: 92.46%
- peakInflation30Bps: 9.46%
- troughInflation30Bps: -14.18%
- cpiVolatilityBps: 1.79%
- peakEnergyShortageUnits: 0
- peakTariffMinor: 1.04 EC
- minMeanProfitMinor: 47.05 EC
- finalMeanProfitMinor: 69.44 EC
- bankruptcies: 2
- defaults: 0
- peakLoansMinor: 7,801.65 EC
- npcCashStartMinor: 21,923.39 EC
- npcCashEndMinor: 26,560.69 EC
- minNpcCashMinor: 21,923.39 EC
- stateTreasuryEndMinor: 14,116.96 EC
- circulatingStartMinor: 173,018.47 EC
- circulatingEndMinor: 170,569.86 EC
- marketIndexLowBps: 90.28%
- marketIndexEndBps: 113.85%
- peakUnmetUnits: 1901
- baseRateEndBps: 10.75%
- eventsStarted: 7
- playerWealthStartMinor: 56,684.42 EC
- playerWealthEndMinor: 70,381.52 EC
- playerCompanyStatus: operating

## Timeline
| day | CPI | infl 30d | base rate | tariff | energy short | mean profit | operating | bankrupt | NPC cash | loans | defaults | treasury | circulating | share idx | player wealth |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 6 | 101.5 | 0.0% | 2.00% | 90 | 0 | 7170 | 7 | 0 | 21923 | 0 | 0 | 23590 | 173018 | 100.0 | 56684 |
| 12 | 102.3 | 0.0% | 2.00% | 90 | 0 | 13737 | 7 | 0 | 26106 | 0 | 0 | 17446 | 172856 | 101.1 | 57107 |
| 18 | 101.5 | 0.0% | 2.00% | 90 | 0 | 14279 | 7 | 0 | 36418 | 7802 | 0 | 14785 | 172760 | 90.3 | 57576 |
| 24 | 101.5 | 0.0% | 2.00% | 90 | 0 | 13362 | 7 | 0 | 30218 | 2918 | 0 | 13690 | 172677 | 94.4 | 58075 |
| 30 | 100.8 | 0.0% | 2.00% | 90 | 0 | 13067 | 7 | 0 | 29288 | 2084 | 0 | 12987 | 172597 | 98.3 | 58655 |
| 36 | 99.7 | -1.7% | 2.00% | 96 | 0 | 12426 | 7 | 0 | 27947 | 1251 | 0 | 12629 | 172516 | 101.2 | 59313 |
| 42 | 100.0 | -2.3% | 11.75% | 96 | 0 | 8724 | 8 | 0 | 29633 | 417 | 0 | 10674 | 172329 | 106.8 | 59210 |
| 48 | 100.3 | -1.1% | 11.75% | 96 | 0 | 7209 | 8 | 0 | 28015 | 0 | 0 | 11541 | 172235 | 108.1 | 60069 |
| 54 | 99.0 | -2.5% | 11.75% | 96 | 0 | 7264 | 8 | 0 | 28268 | 0 | 0 | 11793 | 172140 | 109.3 | 61006 |
| 60 | 95.3 | -5.5% | 11.50% | 90 | 0 | 8167 | 8 | 0 | 29365 | 326 | 0 | 11965 | 172048 | 111.0 | 61815 |
| 66 | 91.2 | -8.6% | 11.50% | 90 | 0 | 7106 | 8 | 0 | 29559 | 251 | 0 | 12250 | 171955 | 112.0 | 62422 |
| 72 | 87.8 | -12.1% | 11.25% | 90 | 0 | 5826 | 8 | 0 | 29922 | 175 | 0 | 12625 | 171861 | 113.3 | 62383 |
| 78 | 86.1 | -14.2% | 11.25% | 90 | 0 | 5889 | 8 | 0 | 28759 | 100 | 0 | 13697 | 171766 | 111.2 | 63368 |
| 84 | 85.4 | -13.8% | 11.00% | 90 | 0 | 4705 | 8 | 0 | 30804 | 25 | 0 | 9478 | 171670 | 110.9 | 63161 |
| 90 | 85.3 | -10.4% | 11.00% | 90 | 0 | 6008 | 8 | 1 | 28180 | 0 | 0 | 12616 | 171480 | 111.8 | 63729 |
| 96 | 87.4 | -4.1% | 11.00% | 90 | 0 | 5170 | 8 | 1 | 27546 | 0 | 0 | 13057 | 171384 | 112.4 | 64345 |
| 102 | 88.1 | 0.3% | 10.75% | 90 | 0 | 5616 | 8 | 1 | 27559 | 0 | 0 | 13934 | 171288 | 113.4 | 65119 |
| 108 | 87.2 | 1.2% | 10.75% | 90 | 0 | 5316 | 8 | 1 | 27745 | 0 | 0 | 14165 | 171192 | 114.2 | 65487 |
| 114 | 84.9 | -0.6% | 10.75% | 90 | 0 | 6975 | 7 | 2 | 26321 | 0 | 0 | 14816 | 171104 | 114.2 | 66543 |
| 120 | 84.5 | -1.0% | 10.75% | 90 | 0 | 7385 | 7 | 2 | 25850 | 0 | 0 | 15871 | 171016 | 114.2 | 67308 |
| 126 | 86.1 | -1.5% | 10.50% | 90 | 0 | 6791 | 7 | 2 | 27871 | 0 | 0 | 11406 | 170928 | 114.2 | 67562 |
| 132 | 88.5 | 0.5% | 10.50% | 90 | 0 | 7805 | 7 | 2 | 27056 | 0 | 0 | 11541 | 170841 | 114.2 | 68536 |
| 138 | 90.0 | 3.2% | 10.50% | 90 | 0 | 7181 | 7 | 2 | 26307 | 0 | 0 | 12821 | 170750 | 113.2 | 69192 |
| 144 | 90.4 | 6.5% | 10.75% | 104 | 0 | 6466 | 7 | 2 | 26220 | 0 | 0 | 13905 | 170661 | 113.6 | 69662 |
| 150 | 92.5 | 9.5% | 10.75% | 104 | 0 | 6944 | 7 | 2 | 26561 | 0 | 0 | 14117 | 170570 | 113.8 | 70382 |
