/** Wire types for the commodities exchange endpoints. Shared by the server (which builds them) and the UI (which renders them). */

export interface DirectoryRow {
  commodityId: string; name: string; unitLabel: string; referencePriceMinor: number;
  lastTradePriceMinor: number | null; vwap7dMinor: number | null; bestBidMinor: number | null; bestAskMinor: number | null; spreadMinor: number | null;
  volumeToday: number; volume7d: number; value7dMinor: number; listedUnits: number; bidUnits: number; demandUnitsPerDay: number; consumerUnitsToday: number; contractUnitsToday: number;
  shortageUnits: number; surplusUnits: number; channel: 'exchange' | 'retail'; status: 'shortage' | 'balanced' | 'surplus' | 'no-market'; changeBps: number; basis: 'trades' | 'reference';
}

export interface BookLevel { priceMinor: number; units: number; orders: number; suppliers: number }

export interface SupplierRow { companyId: string; name: string; ownerKind: 'player' | 'npc' | 'state'; askMinor: number; units: number; reputationBps: number; sold7d: number; delivered7d: number; missed7d: number; contractable: boolean; industry: string }

export interface CommodityDetail {
  commodityId: string; unitLabel: string; asks: BookLevel[]; bids: BookLevel[];
  history: { tick: number; gameDate: string; open: number | null; high: number | null; low: number | null; close: number | null; vwap: number | null; volume: number; bestBid: number | null; bestAsk: number | null; listed: number; demand: number }[];
  recentTrades: { id: number; tick: number; gameDate: string; qty: number; priceMinor: number; feeMinor: number; buyer: string; seller: string }[];
  suppliers: SupplierRow[];
}

export interface OwnOrder { id: number; companyId: string; companyName: string; commodityId: string; side: 'buy' | 'sell'; kind: 'limit' | 'market' | 'direct'; priceMinor: number; unitsOriginal: number; unitsRemaining: number; unitsFilled: number; avgFillMinor: number | null; reservedFundsMinor: number; reservedUnits: number; status: 'open' | 'partial' | 'filled' | 'cancelled' | 'expired'; endReason: string | null; createdTick: number; expiresTick: number | null; createdDate: string }

export interface OwnTrade { id: number; tick: number; gameDate: string; commodityId: string; role: 'bought' | 'sold'; counterparty: string; companyId: string; qty: number; priceMinor: number; grossMinor: number; feeMinor: number; netMinor: number; ledgerTxId: number | null }

export interface Holding { companyId: string; companyName: string; commodityId: string; units: number; reservedUnits: number; freeUnits: number; autoListedUnits: number; cashMinor: number; availableCashMinor: number }

export interface ContractDto {
  id: number; status: 'pending' | 'active' | 'declined' | 'cancelled' | 'completed' | 'failed'; role: 'buyer' | 'supplier'; buyerId: string; buyerName: string; supplierId: string; supplierName: string; commodityId: string; qtyPerDelivery: number; priceMinor: number; everyTicks: number;
  startTick: number; endTick: number; startDate: string; endDate: string; noticeTicks: number; cancelEffectiveTick: number | null; proposedBy: 'buyer' | 'supplier'; reason: string | null; consecutiveMisses: number; maxMisses: number;
  upcoming: { tick: number; gameDate: string; grossMinor: number }[]; history: { tick: number; gameDate: string; status: string; qty: number; grossMinor: number; feeMinor: number }[];
  delivered: number; missed: number; deliveredUnits: number; totalPaidMinor: number;
}

export interface MarketShortage {
  commodityId: string; label: string; industry: string | null; industryLabel: string | null;
  demandUnitsPerDay: number; supplyUnitsPerDay: number; shortageUnitsPerDay: number; listedUnits: number; competitors: number;
  recentPriceMinor: number; priceBasis: 'trades' | 'reference'; unitCostMinor: number; unitProfitMinor: number; status: 'shortage' | 'balanced' | 'surplus';
  explanation: string;
}
