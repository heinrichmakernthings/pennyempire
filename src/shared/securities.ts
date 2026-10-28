/** Wire types for the Penny Exchange. All money is integer minor Empire Coins (EC); shares are whole numbers. Fictional securities only: nothing here is convertible to real money. */
export type ListingStatus = 'unlisted' | 'open' | 'suspended' | 'delisted';
export type StakeClass = 'minority' | 'significant' | 'substantial' | 'majority';

export interface SecurityListing {
  companyId: string; ticker: string; name: string; industry: string; industryLabel: string; ownerKind: 'player' | 'npc' | 'state'; status: ListingStatus; suspendedReason: string | null;
  /** last executed trade, or null when nothing has traded yet; `priceBasis` says what the displayed price is */
  priceMinor: number | null; priceBasis: 'trade' | 'offer' | 'fundamental' | 'none'; priceStale: boolean; changeBps: number | null;
  fairValueMinor: number | null; premiumBps: number | null; issuedShares: number; outstandingShares: number; treasuryShares: number; marketCapMinor: number | null;
  bestBidMinor: number | null; bestAskMinor: number | null; spreadBps: number | null; volume7d: number; dividendYield30dBps: number; freeFloatBps: number; myShares: number; myStakeBps: number; assetId: string | null;
  liquidity: 'none' | 'thin' | 'ok';
}
export interface ExchangeHome { tick: number; gameDate: string; index: { valueBps: number; changeBps: number; marketCapMinor: number; turnoverMinor: number; series: { tick: number; valueBps: number }[] }; listings: SecurityListing[]; unlisted: { companyId: string; name: string; ticker: string; eligible: boolean }[]; feeBps: number; bandBps: number; notice: string }

export interface BookLevel { priceMinor: number; shares: number; orders: number }
export interface OwnershipRow { investorId: string; name: string; kind: string; shares: number; reserved: number; stakeBps: number; stakeClass: StakeClass; mine: boolean }
export interface SecurityDetail {
  listing: SecurityListing;
  valuation: { fairValuePerShareMinor: number; equityMinor: number; earningsValueMinor: number; dailyEarningsMinor: number; growthBps: number; riskBps: number; liquidationFloorMinor: number; components: Record<string, unknown>; basis: string } | null;
  band: { lowMinor: number; highMinor: number; refMinor: number; basis: string; bandBps: number } | null;
  book: { bids: BookLevel[]; asks: BookLevel[] };
  history: { tick: number; gameDate: string; openMinor: number | null; highMinor: number | null; lowMinor: number | null; closeMinor: number | null; vwapMinor: number | null; volume: number; fairMinor: number | null }[];
  ownership: { holders: OwnershipRow[]; outstanding: number; treasury: number; controller: { name: string; stakeBps: number } | null; thresholds: { significantBps: number; substantialBps: number; majorityBps: number }; control: { tick: number; gameDate: string; to: string; stakeBps: number }[] };
  dividends: { id: number; declaredGameDate: string; paymentGameDate: string; perShareMinor: number; totalMinor: number; status: string; eligibleShares: number }[];
  dividendCapacity: { capacityMinor: number; maxPerShareMinor: number; reserveMinor: number; eligibleShares: number };
  financials: { tick: number; gameDate: string; revenueMinor: number; netProfitMinor: number; cashMinor: number }[];
  offerings: { id: number; kind: string; gameDate: string; sharesOffered: number; sharesSold: number; priceMinor: number; proceedsMinor: number; status: string }[];
  trades: { id: number; gameDate: string; qty: number; priceMinor: number; mine: boolean }[];
  news: { id: number; gameDate: string; headline: string; body: string }[];
  mine: { shares: number; reservedShares: number; avgCostMinor: number | null; cashAvailableMinor: number; openOrders: { id: number; side: 'buy' | 'sell'; priceMinor: number; remaining: number; original: number; investorId: string; expiresTick: number | null }[]; controlsCompany: boolean };
  rules: { feeBps: number; bandBps: number; maxOrderDays: number };
}

export interface PortfolioPosition { companyId: string; ticker: string; name: string; investorId: string; investorName: string; shares: number; reservedShares: number; stakeBps: number; stakeClass: StakeClass; avgCostMinor: number | null; costBasisMinor: number; markMinor: number | null; markBasis: string; marketValueMinor: number | null; unrealisedMinor: number | null; realisedMinor: number; dividendsMinor: number; status: ListingStatus }
export interface PortfolioTx { id: string; kind: 'buy' | 'sell' | 'dividend' | 'ipo_fee' | 'liquidation' | 'issue'; gameDate: string; companyId: string; ticker: string; qty: number | null; priceMinor: number | null; amountMinor: number; feeMinor: number; note: string }
export interface SharePortfolio {
  cashAvailableMinor: number; cashReservedMinor: number;
  totals: { marketValueMinor: number; costBasisMinor: number; unrealisedMinor: number; realisedMinor: number; dividendIncomeMinor: number; feesPaidMinor: number; basisNote: string };
  positions: PortfolioPosition[]; transactions: PortfolioTx[]; allocation: { ticker: string; name: string; valueMinor: number; bps: number }[];
  note: string;
}

export interface ListingQuoteDto { companyId: string; kind: 'ipo' | 'follow_on'; eligible: boolean; checks: { id: string; ok: boolean; label: string; detail: string }[]; newShares: number; offerPriceMinor: number; offeringValueMinor: number; listingFeeMinor: number; priceRange: { lowMinor: number; highMinor: number; fairValueMinor: number }; dilution: { issuedBefore: number; issuedAfter: number; outstandingBefore: number; outstandingAfter: number; controllerStakeBeforeBps: number; controllerStakeAfterBps: number; newInvestorsBps: number } }
