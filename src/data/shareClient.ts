import { useCallback, useState } from 'react';
import type { ExchangeHome, ListingQuoteDto, SecurityDetail, SharePortfolio } from '@/shared/securities';
import { useUi } from '@/state/ui';
import { useDataActions } from './store';
import { newIdempotencyKey } from './useCommand';

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  let body: unknown; try { body = await res.json(); } catch { throw new Error(`Server returned a non-JSON response (${res.status})`); }
  if (!res.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? `Server error ${res.status}`);
  return body as T;
}
export const fetchExchange = (signal?: AbortSignal) => get<{ exchange: ExchangeHome }>('/api/securities', signal);
export const fetchSecurity = (id: string, signal?: AbortSignal) => get<{ detail: SecurityDetail }>(`/api/securities/${encodeURIComponent(id)}`, signal);
export const fetchSharePortfolio = (signal?: AbortSignal) => get<{ portfolio: SharePortfolio }>('/api/portfolio/securities', signal);
export interface OrderQuoteDto { ok: boolean; issues: string[]; warnings: string[]; band: { lowMinor: number; highMinor: number; refMinor: number; basis: string } | null; limitPriceMinor: number | null; reserveMinor: number; estimatedFeeMinor: number; bestOppositeMinor: number | null; availableMinor: number; freeShares: number }
export const fetchOrderQuote = (p: Record<string, string>, signal?: AbortSignal) => get<{ quote: OrderQuoteDto }>(`/api/securities/order-quote?${new URLSearchParams(p)}`, signal);
export const fetchListingQuote = (p: { companyId: string; newShares: number; offerPriceMinor: number; fromTreasury?: boolean }, signal?: AbortSignal) => get<{ quote: ListingQuoteDto }>(`/api/securities/listing-quote?${new URLSearchParams({ companyId: p.companyId, newShares: String(p.newShares), offerPriceMinor: String(p.offerPriceMinor), fromTreasury: String(p.fromTreasury === true) })}`, signal);

export type ShareCmdResult = { ok: true; data?: Record<string, unknown> } | { ok: false; message: string };
/** Sends a share/dividend command with its own idempotency key. Success only refreshes what the server says; nothing is edited locally. */
export function useShareCommand() {
  const { refreshAll } = useDataActions(); const notify = useUi((s) => s.notify); const [pending, setPending] = useState(false);
  const send = useCallback(async (body: Record<string, unknown>, labels: { success: string; failure: string }, key = newIdempotencyKey()): Promise<ShareCmdResult> => {
    setPending(true);
    try {
      const res = await fetch('/api/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, idempotencyKey: key, expectedRevision: 0 }) });
      const out = (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { message: string } };
      if (out.ok) { notify({ tone: 'success', title: labels.success }); refreshAll(); return { ok: true, data: out.data }; }
      notify({ tone: 'error', title: labels.failure, message: out.error?.message }); return { ok: false, message: out.error?.message ?? 'Refused' };
    } catch (e) { const m = e instanceof Error ? e.message : 'Unexpected error'; notify({ tone: 'error', title: labels.failure, message: m }); return { ok: false, message: m }; } finally { setPending(false); }
  }, [refreshAll, notify]);
  return { send, pending };
}
