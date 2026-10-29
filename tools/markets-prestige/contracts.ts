/** Proposed Phase 5 frontend view contracts. Not implemented backend API types. */
export type MinorEC = number; // Runtime: Number.isSafeInteger; 100 minor EC = 1 EC.
export type Tick = number;
export type LoadState = 'loading'|'ready'|'empty'|'stale'|'error'|'unavailable';
export interface Snapshot { cityId:string; asOfTick:Tick; version:string; status:LoadState }
export interface Listing extends Snapshot {
 companyId:string; displayName:string; ticker:string|null; industryId:string; assetId:string;
 listingStatus:'unlisted'|'open'|'halted'|'delisted'; currency:'EC'; sharePriceMinor:MinorEC|null;
 sharesOutstanding:number|null; changeBps:number|null; quoteAsOfTick:Tick|null;
 history:Array<{tick:Tick;priceMinor:MinorEC|null}>;
}
export interface FinancialReport {
 companyId:string;reportId:string;periodStartTick:Tick;periodEndTick:Tick;
 revenueMinor:MinorEC;expensesMinor:MinorEC;operatingProfitMinor:MinorEC;
 netProfitMinor:MinorEC|null;debtMinor:MinorEC|null;cashMinor:MinorEC;
 reportStatus:'provisional'|'final';
}
export interface ShareOrderQuote {
 quoteId:string;quoteVersion:string;companyId:string;currency:'EC';side:'buy'|'sell';type:'market'|'limit';
 quantity:number;limitPriceMinor:MinorEC|null;maximumSpendMinor:MinorEC|null;
 notionalMinor:MinorEC;feeMinor:MinorEC;totalReservationMinor:MinorEC;netProceedsMinor:MinorEC;
 expiresAt:string;warningCodes:string[];
}
export interface ShareOrder {
 orderId:string;companyId:string;status:'pending'|'open'|'partial'|'filled'|'cancelled'|'rejected';
 originalShares:number;filledShares:number;remainingShares:number;reservationMinor:MinorEC;
 fills:Array<{priceMinor:MinorEC;shares:number;feeMinor:MinorEC;tick:Tick}>;rejectionCode:string|null;
}
export interface PrestigeItem {
 itemId:string;displayName:string;assetId:string|null;category:'vehicles'|'properties'|'waterfront'|'collectibles';
 rarity:string;currency:'EC';priceMinor:MinorEC|null;prestigePoints:number;
 purchaseAvailability:'available'|'owned'|'locked'|'art-outstanding'|'unavailable';
 allowedPlacementTypes:Array<'roadside'|'plot'|'water'|'forecourt'>;
 nameplateColours:string[];perks:Array<{id:string;description:string;durationTicks:number}>;
}
export interface OwnedPrestige {
 instanceId:string;ownerId:string;itemId:string;purchasedAtTick:Tick;acquisitionCostMinor:MinorEC;
 placement:{cityId:string;plotId:string;anchor:[number,number];orientation:string};
 nameplateText:string;nameplateColour:string;
 activePerks:Array<{id:string;expiresAtTick:Tick;effectDescription:string}>;
}
export interface Portfolio extends Snapshot {
 currency:'EC';cashAvailableMinor:MinorEC;cashReservedMinor:MinorEC;
 privateStakes:Array<{companyId:string;ownershipBps:number;attributableValuationMinor:MinorEC;valuationBasis:string;asOfTick:Tick}>;
 publicPositions:Array<{companyId:string;shares:number;reservedShares:number;marketValueMinor:MinorEC|null}>;
 dividendCashPaidMinor:MinorEC;realisedPnlMinor:MinorEC;unrealisedPnlMinor:MinorEC|null;
 historicalSnapshots:Array<{tick:Tick;valueMinor:MinorEC|null}>;prestigeInstanceIds:string[];
}
export type NewsType='ipo'|'dividend'|'market-crash'|'acquisition'|'bankruptcy'|'state-announcement'|'commodity-shortage'|'milestone'|'international-expansion';
export interface EconomicNews {
 eventId:string;type:NewsType;title:string;bodyTokens:Record<string,string|number>;companyId:string|null;cityId:string;
 occurredAtTick:Tick;effectiveAtTick:Tick|null;severity:'info'|'positive'|'warning'|'negative';
 action:{label:string;targetId:string;route:string}|null;readAt:string|null;
}
export interface FinancialCapabilities {
 viewListings:boolean;tradeShares:boolean;marketOrders:boolean;cancelOrders:boolean;
 playerDividends:boolean;buyPrestige:boolean;placePrestige:boolean;temporaryPerks:boolean;
}
