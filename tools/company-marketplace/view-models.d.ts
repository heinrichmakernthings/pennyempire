/** Frontend view-model proposals. This file does not replace the existing wire contract. */
export type Minor = number; // safe integer; runtime validation still required
export type IndustryId = 'farm'|'mill'|'dairy'|'pizza'|'cafe'|'timber';
export interface Capability { enabled: boolean; unavailableReason?: string }
export interface Phase4Capabilities { companyCreation: Capability; upgrades: Capability; protectedMarketOrders: Capability; supplierContracts: Capability; shipments: Capability }
export interface OpportunityView { industry: IndustryId; commodityId: string; wantedUnits: number|null; suppliedUnits: number|null; periodLabel: string; asOf: string; estimatedStartupMinor: Minor|null; recipeId: string; eligiblePlotIds: string[] }
export interface StartupDraft { cityId: string; industry: IndustryId; plotId: string|null; name: string }
export interface StartupQuoteView { id: string; revision: number; expiresAt: string; terms: StartupDraft; costs: {id:string;label:string;minor:Minor;kind:'purchase'|'fee'|'treasury_transfer'}[]; totalMinor:Minor; openingCompanyFundsMinor:Minor; playerAvailableAfterMinor:Minor; recurringCosts:{label:string;minor:Minor;period:'game-day'}[]; requirements:string[] }
export interface CompanyCreationResultView { companyId:string; plotId:string; status:'operating'|'paused'|'insolvent'; confirmedName:string; refreshedRevision:number; initialProductionPlan:number }
export interface ProductionDraft { plannedUnitsPerTick:number; employees:number; priceMinor:Minor; quality:'basic'|'standard'|'premium'; marketingMinorPerTick:Minor }
export interface BookDepthView { commodityId:string; asOf:string; complete:boolean; cursor:string|null; bids:DepthLevel[]; asks:DepthLevel[] }
export interface DepthLevel { priceMinor:Minor; availableUnits:number; cumulativeUnits:number }
export interface TradeDraftView { companyId:string; commodityId:string; side:'buy'|'sell'; kind:'limit'|'protected-market'; quantity:number; protectionPriceMinor:Minor }
export interface QuoteReviewView { quoteId:string; revision:number; expiresAt:string; terms:TradeDraftView; requestedUnits:number; executableUnits:number; executionGrossMinor:Minor; feeMinor:Minor; feePayer:'buyer'|'seller'; feeRateBps:number; estimatedNetMinor:Minor; maximumReservedMinor:Minor|null; reservedStockUnits:number|null; timeInForce:'GTC'|'IOC'; priceGuaranteed:boolean }
export interface SupplierProfileView { id:string; name:string; ownerKind:'player'|'npc'|'state'; districtName:string|null; currentListings:{commodityId:string;units:number;priceMinor:Minor}[]; verifiedDeliveryMetric:null|{completed:number;total:number;period:string} }
export interface ContractDraftView { buyerCompanyId:string; supplierCompanyId:string; commodityId:string; unitsPerDelivery:number; everyGameDays:number; durationGameDays:number; maximumUnitPriceMinor:Minor; autoRenew:false }
export interface ContractView extends ContractDraftView { id:string; revision:number; status:'offered'|'active'|'paused'|'completed'|'cancelled'|'rejected'; acceptedAt:string|null; nextDeliveryAt:string|null; failureReason:string|null; cancellationTerms:string; fundsPolicy:string }
export interface SupplyChainNodeView { id:string; companyId:string|null; role:'producer'|'processor'|'retailer'|'consumer'; commodityId:string; availableUnits:number|null; requiredUnits:number|null; state:'ready'|'shortage'|'blocked'|'unknown'; supplierIds:string[] }
export interface SupplyConnectionView { id:string; from:string; to:string; commodityId:string; recipeUnits:number; supplierId:string|null; shipment:null|{id:string;units:number;status:'dispatched'|'arrived'|'failed';eta:string|null} }
