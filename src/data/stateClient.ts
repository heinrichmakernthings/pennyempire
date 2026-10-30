import { useCallback, useState } from 'react';
import { useUi } from '@/state/ui';
import { useDataActions } from './store';
import { newIdempotencyKey } from './useCommand';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  let body: unknown; try { body = await res.json(); } catch { throw new Error(`Server returned a non-JSON response (${res.status})`); }
  if (!res.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? `Server error ${res.status}`);
  return body as T;
}
type Rec = Record<string, any>;   // the state-economy API is documented in docs/STATE-ECONOMY.md; screens read only the fields they show
export interface StateOverview { tick: number; myCompanies: { id: string; name: string }[]; providers: Rec[]; energy: Rec; logistics: Rec; bank: Rec; centralBank: Rec; inflation: Rec; money: Rec; events: Rec }
export const fetchStateOverview = () => get<StateOverview>('/api/state/overview');
export const fetchCompanyServices = (id: string) => get<{ services: Rec }>(`/api/state/company/${encodeURIComponent(id)}`);
export const fetchLoanQuote = (companyId: string, amountMinor: number, termDays: number) => get<{ quote: Rec }>(`/api/state/loan-quote?${new URLSearchParams({ companyId, amountMinor: String(amountMinor), termDays: String(termDays) })}`);

export function useStateCommand() {
  const { refreshAll } = useDataActions(); const notify = useUi((s) => s.notify); const [pending, setPending] = useState(false);
  const send = useCallback(async (body: Record<string, unknown>, labels: { success: string; failure: string }, onDone?: () => void): Promise<{ ok: boolean; data?: Record<string, any> }> => {
    setPending(true);
    try {
      const res = await fetch('/api/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, idempotencyKey: newIdempotencyKey(), expectedRevision: 0 }) });
      const out = (await res.json()) as { ok: boolean; data?: Record<string, any>; error?: { message: string } };
      if (out.ok) { if (labels.success) notify({ tone: 'success', title: labels.success }); refreshAll(); onDone?.(); } else notify({ tone: 'error', title: labels.failure, message: out.error?.message });
      return { ok: out.ok, data: out.data };
    } catch (e) { notify({ tone: 'error', title: labels.failure, message: e instanceof Error ? e.message : 'Unexpected error' }); return { ok: false }; } finally { setPending(false); }
  }, [refreshAll, notify]);
  return { send, pending };
}
