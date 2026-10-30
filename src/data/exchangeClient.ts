import type { CommodityDetail, ContractDto, DirectoryRow, Holding, OwnOrder, OwnTrade } from '@/shared/exchange';

export type { CommodityDetail, ContractDto, DirectoryRow, Holding, OwnOrder, OwnTrade };
export interface ContractOptions {
  referencePriceMinor: number;
  suppliers: { companyId: string; name: string; ownerKind: string; dailyOutput: number; askMinor: number; maxPerDay: number }[];
  buyers: { companyId: string; name: string; ownerKind: string; dailyNeed: number; maxPerDay: number }[];
  limits: { maxTicks: number; noticeTicks: number; maxMisses: number; shareBps: number };
}
export interface CommodityView { detail: CommodityDetail; orders: OwnOrder[]; trades: OwnTrade[]; holdings: Holding[]; contractOptions: ContractOptions }

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  let body: unknown; try { body = await res.json(); } catch { throw new Error(`Server returned a non-JSON response (${res.status})`); }
  if (!res.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? `Server error ${res.status}`);
  return body as T;
}
export const fetchDirectory = (signal?: AbortSignal) => get<{ commodities: DirectoryRow[]; note: string }>('/api/exchange/commodities', signal);
export const fetchCommodity = (id: string, signal?: AbortSignal) => get<CommodityView>(`/api/exchange/commodities/${encodeURIComponent(id)}`, signal);
export const fetchContracts = (signal?: AbortSignal) => get<{ contracts: ContractDto[] }>('/api/exchange/contracts', signal);
export const fetchAllOrders = (signal?: AbortSignal) => get<{ orders: OwnOrder[] }>('/api/exchange/orders', signal);
export const fetchAllTrades = (signal?: AbortSignal) => get<{ trades: OwnTrade[] }>('/api/exchange/trades', signal);

export interface ServerQuote { id: string; revision: number; kind: 'limit' | 'market' | 'direct'; limitPriceMinor: number; reserveMinor: number; slippageBps: number | null; quantity: number; subtotal: { minor: number }; fee: { minor: number }; total: { minor: number }; availableUnits: number }
export type QuoteResult = { ok: true; quote: ServerQuote } | { ok: false; error: { message: string; fieldErrors?: Record<string, string> } };
export async function requestExchangeQuote(b: { companyId: string; commodityId: string; side: 'buy' | 'sell'; quantity: number; limitPriceMinor: number; orderKind: 'limit' | 'market' | 'direct'; fromCompanyId?: string; slippageBps?: number; expiresInTicks?: number | null }): Promise<QuoteResult> {
  const res = await fetch('/api/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'commodity', entityId: b.commodityId, companyId: b.companyId, side: b.side, quantity: b.quantity, limitPriceMinor: b.limitPriceMinor, cityId: 'city-bristol', orderKind: b.orderKind, fromCompanyId: b.fromCompanyId, slippageBps: b.slippageBps, expiresInTicks: b.expiresInTicks }) });
  return (await res.json()) as QuoteResult;
}
