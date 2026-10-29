import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarketShortage } from '@/shared/exchange';
import type { LotInfo, Management, Opportunity, Ranking, StartupQuote } from '@/shared/management';
import { POLL_MS } from './store';

export type { LotInfo, Management, Opportunity, Ranking, StartupQuote };

/** GET JSON from the engine. These endpoints only exist on the real server; the UI shows an explicit notice when it runs on fixtures. */
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  let body: unknown; try { body = await res.json(); } catch { throw new Error(`Server returned a non-JSON response (${res.status})`); }
  if (!res.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? `Server error ${res.status}`);
  return body as T;
}

export const fetchOpportunities = (signal?: AbortSignal) => get<{ forecastNote: string; opportunities: Opportunity[]; shortages: MarketShortage[] }>('/api/opportunities', signal);
export const fetchLots = (signal?: AbortSignal) => get<{ lots: LotInfo[] }>('/api/lots', signal);
export const fetchRankings = (signal?: AbortSignal) => get<{ rankings: Ranking[] }>('/api/rankings', signal);
export const fetchManagement = (id: string, signal?: AbortSignal) => get<{ management: Management }>(`/api/companies/${encodeURIComponent(id)}/management`, signal);
export const fetchStartupQuote = (q: { industry: string; plotId: string; tier: number; name?: string; workingCapitalMinor?: number }, signal?: AbortSignal) => {
  const p = new URLSearchParams({ industry: q.industry, plotId: q.plotId, tier: String(q.tier) });
  if (q.name !== undefined) p.set('name', q.name);
  if (q.workingCapitalMinor !== undefined) p.set('workingCapitalMinor', String(q.workingCapitalMinor));
  return get<{ quote: StartupQuote }>(`/api/startup-quote?${p}`, signal);
};

export type Query<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: T; refreshing: boolean };

/** Loads once, reloads whenever `deps` change, and polls while the tab is visible. Keeps the last good data while reloading. */
export function useQuery<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[], poll = true): Query<T> & { reload: () => void } {
  const [state, setState] = useState<Query<T>>({ status: 'loading' });
  const loadRef = useRef(load); loadRef.current = load;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // Superseded requests are ignored rather than aborted, so navigating away never produces cancelled-request noise in the network log.
    const ctl = { signal: { aborted: false } as AbortSignal, abort() { (this.signal as { aborted: boolean }).aborted = true; } };
    setState((s) => (s.status === 'ready' ? { ...s, refreshing: true } : { status: 'loading' }));
    loadRef.current(new AbortController().signal).then(
      (data) => { if (!ctl.signal.aborted) setState({ status: 'ready', data, refreshing: false }); },
      (e: unknown) => { if (!ctl.signal.aborted) setState((s) => (s.status === 'ready' ? { ...s, refreshing: false } : { status: 'error', error: e instanceof Error ? e.message : 'Unknown error' })); },
    );
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  useEffect(() => {
    if (!poll) return;
    const t = setInterval(() => { if (!document.hidden) setTick((n) => n + 1); }, POLL_MS);
    return () => clearInterval(t);
  }, [poll]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}

import type { Article, CompetitorProfile, Standings } from '@/shared/living';
export type { Article, CompetitorProfile, Standings };
export const fetchStandings = (signal?: AbortSignal) => get<{ standings: Standings }>('/api/standings', signal);
export const fetchNews = (limit = 40, signal?: AbortSignal) => get<{ articles: Article[] }>(`/api/news?limit=${limit}`, signal);
export const fetchCompetitor = (id: string, signal?: AbortSignal) => get<{ profile: CompetitorProfile }>(`/api/competitors/${encodeURIComponent(id)}`, signal);

import type { CompanyActivity } from '@/shared/living';
export type { CompanyActivity };
export const fetchActivity = (signal?: AbortSignal) => get<{ tick: number; items: CompanyActivity[] }>('/api/city/activity', signal);
