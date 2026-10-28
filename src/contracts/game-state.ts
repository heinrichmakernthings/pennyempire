/** Wire contract v1. All money is integer minor units. No client authority. */
export type ID = string;
export type ISODateTime = string;
export type Money = { currency: 'EC' | 'GBP_TEST'; minor: number }; // safe integer, 100 minor = 1 unit
export type Industry = 'farm' | 'mill' | 'dairy' | 'pizza' | 'cafe' | 'timber';
export type AssetID = string; // must resolve in asset manifest
export type Owner = { id: ID; name: string; kind: 'player' | 'npc' | 'state' };
export interface Envelope<T> { schemaVersion: 1; revision: number; asOf: ISODateTime; nextTickAt: ISODateTime; data: T }
export interface HistoryPoint { at: ISODateTime; valueMinor: number }
export interface History { currency: 'EC' | 'GBP_TEST'; interval: 'hour' | 'day'; points: HistoryPoint[]; complete: boolean }
export interface Player { id: ID; displayName: string; cityId: ID; coins: Money; reservedCoins: Money; portfolioValue: Money; netWorth: Money; dailyProfit: Money; unreadNotifications: number }
export interface Plot { id: ID; column: number; row: number; width: number; depth: number; terrain: 'paving'|'grass'|'water'|'road'; roadMask: number; quayMask: number; companyId: ID|null; assetId: AssetID|null; owner: Owner|null; purchasable: boolean; price: Money|null }
export interface City { id: ID; name: string; plots: Plot[]; demand: {commodityId: ID; wantedUnits: number; suppliedUnits: number; referencePrice: Money}[]; events: {id: ID; title: string; severity:'info'|'warning'; startsAt:ISODateTime; endsAt:ISODateTime|null}[] }
export interface InventoryLine { commodityId: ID; availableUnits: number; reservedUnits: number; capacityUnits: number; estimatedHoursRemaining: number|null }
export interface Company {
 id: ID; name: string; cityId: ID; plotId: ID; industry: Industry; owner: Owner; level: number; assetId: AssetID;
 status: 'operating'|'paused'|'insolvent'; revision: number; valuation: Money; cash: Money;
 dailyRevenue: Money; dailyExpenses: Money; dailyProfit: Money; customersToday: number; marketShareBps: number;
 price: Money; minPrice: Money; maxPrice: Money; employees: number; maxEmployees: number; wagePerTick: Money;
 quality: 'basic'|'standard'|'premium'; reputationBps: number; capacityPerTick: number; plannedUnitsPerTick: number;
 marketingPerTick: Money; inventory: InventoryLine[]; recipeId: ID;
 ownership: {owner: Owner; shares: number; ownershipBps: number}[];
 upgrades: {id: ID; name: string; cost: Money; requirements: string[]; available: boolean; resultingAssetId: AssetID}[];
 profitHistory: History; revenueHistory: History; expenseHistory: History;
 permissions: {manage: boolean; buySupplies: boolean; upgrade: boolean};
}
export interface Recipe { id: ID; output: {commodityId: ID; units: number}; inputs: {commodityId: ID; units: number}[]; durationSeconds: number; energyUnits: number }
export interface Commodity { id: ID; name: string; unitLabel: string; iconAssetId: AssetID; referencePrice: Money; changeBps: number; localSupplyUnits: number; localDemandUnits: number; history: History }
export interface Order {id: ID; commodityId: ID; cityId: ID; companyId: ID; supplier: Owner; side:'buy'|'sell'; pricePerUnit: Money; originalUnits: number; remainingUnits: number; status:'open'|'partial'|'filled'|'cancelled'; createdAt: ISODateTime}
export interface Quote {id: ID; expiresAt: ISODateTime; revision: number; quantity: number; subtotal: Money; fee: Money; total: Money; availableUnits: number}
export interface Trade {id: ID; orderId: ID; commodityId: ID; quantity: number; pricePerUnit: Money; fee: Money; settledAt: ISODateTime}
export interface Listing {id: ID; companyId: ID; companyName: string; ownerKind: Owner['kind']; price: Money; changeBps: number; outstandingShares: number; marketCap: Money; dividendPerShare: Money; nextDividendAt: ISODateTime|null; revenue: Money; profit: Money; history: History; tradable: boolean}
export interface Holding {listingId: ID; shares: number; reservedShares: number; costBasis: Money; value: Money; unrealizedPnl: Money; dividendsReceived: Money}
export interface PrestigeItem {id: ID; name: string; description: string; assetId: AssetID|null; price: Money; owned: boolean; stockRemaining: number|null; placement:'plot'|'profile'; effect: {description: string; modifierBps: number; durationSeconds: number|null}|null; purchasable: boolean; unavailableReason: string|null}
export interface WalletTransaction {id: ID; reference: string; kind:'test_deposit'|'test_withdrawal'|'reward'; amount: Money; direction:'credit'|'debit'; status:'pending'|'settled'|'failed'; createdAt: ISODateTime; settledAt: ISODateTime|null}
export interface TestWallet {id: ID; mode:'SIMULATED'; currency:'GBP_TEST'; balanceMinor: number; reservedMinor: number; minimumWithdrawalMinor:500; canTestDeposit: boolean; canTestWithdraw: boolean; transactions: WalletTransaction[]; rewards: {id: ID; description: string; amount: Money; awardedAt: ISODateTime}[]}
export interface Page<T> {items:T[]; nextCursor:string|null}
export interface ScreenState {
 city: {player:Player;city:City;selectedCompany:Company|null};
 companies: {player:Player;companies:Page<Company>;recipes:Recipe[]};
 commodities: {player:Player;cityId:ID;commodities:Commodity[];orders:Page<Order>;ownOrders:Page<Order>;history:Page<Trade>;selectedCompany:Company|null;quote:Quote|null};
 stocks: {player:Player;listings:Page<Listing>;holdings:Holding[];quote:Quote|null;news:City['events']};
 prestige: {player:Player;items:Page<PrestigeItem>;eligiblePlots:Plot[]};
 wallet: {player:Player;wallet:TestWallet;transactions:Page<WalletTransaction>;portfolio:Holding[]};
}
export interface CommandMeta {idempotencyKey:string;expectedRevision:number}
export type Command = CommandMeta & (
 {type:'company.create';plotId:ID;industry:Industry;name:string;tier:number;workingCapitalMinor?:number;expectedTotalMinor:number} |
 {type:'company.configure';companyId:ID;priceMinor?:number;employees?:number;quality?:Company['quality'];plannedUnitsPerTick?:number;marketingMinorPerTick?:number;askPriceMinor?:number;autoProcure?:boolean} |
 {type:'company.service';companyId:ID} |
 {type:'company.reopen';companyId:ID} |
 {type:'company.fund'|'company.withdraw';companyId:ID;amountMinor:number} |
 {type:'company.procure';companyId:ID;batches:number} |
 {type:'company.upgrade';companyId:ID;upgradeId:ID} |
 {type:'commodity.order';companyId:ID;commodityId:ID;side:'buy'|'sell';quantity:number;limitPriceMinor:number;quoteId:string;orderKind?:'limit'|'market'|'direct';fromCompanyId?:string;slippageBps?:number;expiresInTicks?:number|null} |
 {type:'contract.propose';companyId:ID;counterpartyId:ID;role:'buyer'|'supplier';commodityId:ID;qtyPerDelivery:number;priceMinor:number;everyTicks:number;durationTicks:number} |
 {type:'contract.respond';contractId:number;accept:boolean} |
 {type:'contract.cancel';contractId:number} |
 {type:'order.cancel';orderId:ID} |
 {type:'shares.order';listingId:ID;side:'buy'|'sell';quantity:number;limitPriceMinor:number;quoteId:string} |
 {type:'prestige.buy';itemId:ID;plotId:ID|null;quoteId:string} |
 {type:'wallet.testDeposit'|'wallet.testWithdraw';amountMinor:number}
);
export type ApiError={code:'UNAUTHENTICATED'|'FORBIDDEN'|'STALE_REVISION'|'INSUFFICIENT_FUNDS'|'INSUFFICIENT_STOCK'|'QUOTE_EXPIRED'|'VALIDATION'|'UNAVAILABLE';message:string;fieldErrors?:Record<string,string>};
export type CommandResult={ok:true;revision:number;transactionId:ID;refreshScreens:(keyof ScreenState)[]}|{ok:false;error:ApiError};

export interface QuoteRequest { kind: "commodity"|"shares"|"prestige"|"company.create"; entityId: ID; companyId: ID|null; side: "buy"|"sell"; quantity: number; limitPriceMinor: number|null; cityId: ID }
