/** Proposed view models; adapt to existing game contracts. No backend endpoint claims. */
export type Money={currency:'EC';minor:number};
export type LoadStatus='loading'|'ready'|'empty'|'stale'|'error'|'unavailable';
export interface Snapshot{version:string;asOfTick:number;authority:'server'|'illustrative-fixture';loadStatus:LoadStatus}
export interface EconomicEvent extends Snapshot{
 eventId:string;kind:'boom'|'recession'|'crash'|'shortage'|'energy'|'inflation'|'spending'|'construction'|'disruption'|'bankruptcy'|'acquisition'|'stimulus';
 category:string;headline:string;body:string;severity:'minor'|'moderate'|'major';cityIds:string[];industryIds:string[];
 startTick:number;endTick:number|null;eventStatus:'scheduled'|'active'|'ended'|'cancelled';
 effects:Array<{metric:string;operation:'add'|'multiply'|'override'|'informational';value:number|null;unit:'minor-EC'|'bps'|'units'|'ticks'|'text';scopeIds:string[];effectiveFromTick:number;effectiveUntilTick:number|null}>;
}
export interface Destination extends Snapshot{
 cityId:string;countryId:string;displayName:string;neighbourhoods:Array<{id:string;name:string;eligible:boolean}>;
 status:'owned'|'available'|'locked'|'unavailable';lockReason:string|null;assetIds:string[];
 opportunities:Array<{industryId:string;metric:string;value:number;basis:string;periodTicks:number}>;
 expansionQuoteAvailable:boolean;reportCurrency:'EC';localCurrencyIndicator:string|null;
}
export interface ExpansionQuote{quoteId:string;cityId:string;neighbourhoodId:string;expiresAt:string;eligibilityVersion:string;
 lines:Array<{label:string;amount:Money;flow:'sink'|'provider-transfer'|'internal-transfer';destinationAccountId:string|null}>;total:Money;
}
export interface Shipment extends Snapshot{
 shipmentId:string;contractId:string;originCityId:string;destinationCityId:string;routeId:string;ownerCompanyId:string;
 commodityId:string;units:number;status:'pending'|'in-transit'|'delivered'|'delayed'|'customs-hold'|'disrupted';
 dispatchTick:number|null;expectedArrivalTick:number|null;actualArrivalTick:number|null;reasonCode:string|null;
 freight:Money;tariff:Money;tariffPolicyVersion:string;goodsValue:Money;titleTransferPolicyId:string;
 progressBps:number|null;events:Array<{eventId:string;tick:number;status:string}>;
}
export interface OwnershipNode{companyId:string;displayName:string;cityId:string;parentCompanyId:string|null;directOwnershipBps:number;status:'owned'|'proposed';registerVersion:string}
export interface AcquisitionProposal{proposalId:string;kind:'acquisition'|'hostile-offer'|'merger';bidderId:string;targetIds:string[];consideration:Money;
 currentStakeBps:number;proposedStakeBps:number;stage:'offer'|'voting'|'approved'|'closing'|'completed'|'rejected'|'withdrawn';
 vote:{recordTick:number;closesTick:number;eligibleShares:number;quorumBps:number;myVote:'for'|'against'|'abstain'|null}|null;conditions:string[];closingEventId:string|null;
}
export interface NewsArticle{articleId:string;eventId:string|null;headline:string;body:string;category:string;cityIds:string[];companyIds:string[];publishedTick:number;breaking:boolean;readAt:string|null;sourceVersion:string}
export interface BusinessVisualState{companyId:string;operatingStatus:'operating'|'closed'|'insolvent'|'bankrupt';activityAllowed:boolean;
 customerCount:number;deliveryEventIds:string[];lowStock:boolean;maintenanceRequired:boolean;upgradeJobId:string|null;milestoneEventId:string|null;
 ownershipTransferEventId:string|null;ownerLabel:string;attachmentProfileId:string|null;
}
export interface RegionalReport{cityId:string;periodStartTick:number;periodEndTick:number;revenue:Money|null;operatingProfit:Money|null;
 freightExpense:Money|null;tariffExpense:Money|null;marketShareBps:number|null;marketDefinition:string;valuationBasis:string|null}
export interface LivingWorldCapabilities{economicEvents:boolean;internationalExpansion:boolean;timedShipments:boolean;tariffs:boolean;acquisitions:boolean;shareholderVoting:boolean;internationalContracts:boolean}
