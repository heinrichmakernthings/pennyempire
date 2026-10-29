/** Proposed presentation adapter types; not an existing backend API. */
export type OwnerKind = 'player' | 'npc' | 'state';
export type CompanyLifecycle = 'operating' | 'closed' | 'bankrupt';
export interface CompanyIdentity {
 id: string; ownerId: string; ownerKind: OwnerKind; name: string; cityId: string;
 industryId: string; personaId?: string; brandAccent?: string; ownedCosmeticIds: string[];
}
export interface MarketPeriod {
 cityId: string; productId: string; channel: 'retail' | 'wholesale';
 fromTick: number; throughTick: number; currency: 'EC'; unit: string;
}
export interface CompanyReport {
 companyId: string; period: MarketPeriod; salesUnits: number | null;
 revenueMinor: number | null; reputationBps: number | null;
 previousUnits: number | null; distinctCustomers: number | null;
 previousDistinctCustomers: number | null; previousRank: number | null;
}
export interface ActivitySnapshot {
 companyId: string; status: CompanyLifecycle; asOfTick: number;
 retailUnits: number; productionActive: boolean;
 /** Optional real queue telemetry. Do not infer exact customers from units. */
 queueLength?: number;
}
export interface SettledTransfer {
 id: string; status: 'settled'; tick: number; sellerCompanyId: string;
 buyerCompanyId: string; commodityId: string; quantity: number;
 /** Render only if matching path/building anchors exist. */
 presentationRouteId?: string;
}
export interface LocalNewsEvent {
 id: string; tick: number; cityId: string; companyIds: string[];
 kind: 'opening'|'leader'|'expansion'|'rivalry'|'shortage'|'hiring'|'bankruptcy'|'acquisition'|'milestone';
 headline: string; body: string; personaId?: string;
 confirmed: true; affectedCommodityId?: string;
}
