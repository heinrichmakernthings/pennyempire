import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import type { Company } from '@/contracts/game-state';
import type { ClientScreenState, GameDataSource, Loaded, ScreenKey } from './types';

export type Entry<K extends ScreenKey = ScreenKey> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; loaded: Loaded<ClientScreenState[K]>; loadedAt: number; refreshing: boolean; refreshError: string | null };

export type CompanyEntry = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; loaded: Loaded<Company> };

export interface DataState {
  source: GameDataSource;
  entries: { [K in ScreenKey]?: Entry<K> };
  companies: Record<string, CompanyEntry>;
  ensureCompany(id: string): void;
  ensure(key: ScreenKey): void;
  refresh(key: ScreenKey): void;
}

/** Client-side cache of server (or fixture) screen payloads. It never mutates balances; it only stores what the source returned. */
export function createDataStore(source: GameDataSource): StoreApi<DataState> {
  const inflight = new Map<ScreenKey, AbortController>();
  return createStore<DataState>((set, get) => {
    const run = async (key: ScreenKey, isRefresh: boolean) => {
      inflight.get(key)?.abort();
      const ctl = new AbortController(); inflight.set(key, ctl);
      const prev = get().entries[key];
      set((s) => ({ entries: { ...s.entries, [key]: isRefresh && prev?.status === 'ready' ? { ...prev, refreshing: true } : { status: 'loading' } } }));
      try {
        const loaded = await source.load(key, { signal: ctl.signal });
        set((s) => ({ entries: { ...s.entries, [key]: { status: 'ready', loaded, loadedAt: Date.now(), refreshing: false, refreshError: null } } }));
      } catch (e) {
        if (ctl.signal.aborted) return;
        const message = e instanceof Error ? e.message : 'Unknown error';
        const before = get().entries[key];
        // Stale-while-error: keep showing the last good payload but say the refresh failed.
        set((s) => ({ entries: { ...s.entries, [key]: before?.status === 'ready' ? { ...before, refreshing: false, refreshError: message } : { status: 'error', error: message } } }));
      } finally { if (inflight.get(key) === ctl) inflight.delete(key); }
    };
    return {
      source, entries: {}, companies: {},
      ensureCompany: (id) => {
        if (get().companies[id]) return;
        set((s) => ({ companies: { ...s.companies, [id]: { status: 'loading' } } }));
        source.loadCompany(id).then(
          (loaded) => set((s) => ({ companies: { ...s.companies, [id]: { status: 'ready', loaded } } })),
          (e: unknown) => set((s) => ({ companies: { ...s.companies, [id]: { status: 'error', error: e instanceof Error ? e.message : 'Unknown error' } } })),
        );
      },
      ensure: (key) => { const e = get().entries[key]; if (!e || e.status === 'idle') void run(key, false); },
      refresh: (key) => void run(key, true),
    };
  });
}

const Ctx = createContext<StoreApi<DataState> | null>(null);
export function DataProvider({ source, store, children }: { source?: GameDataSource; store?: StoreApi<DataState>; children: ReactNode }) {
  const ref = useRef<StoreApi<DataState> | null>(store ?? null);
  if (!ref.current) { if (!source) throw new Error('DataProvider needs a source or store'); ref.current = createDataStore(source); }
  return <Ctx.Provider value={ref.current}>{children}</Ctx.Provider>;
}
const useDataStore = () => { const s = useContext(Ctx); if (!s) throw new Error('DataProvider missing'); return s; };

export function useScreen<K extends ScreenKey>(key: K) {
  const store = useDataStore();
  const entry = useStore(store, (s) => s.entries[key]) as Entry<K> | undefined;
  useEffect(() => { store.getState().ensure(key); }, [store, key]);
  return { entry: entry ?? ({ status: 'loading' } as Entry<K>), refresh: () => store.getState().refresh(key) };
}
export const useDataSource = () => useStore(useDataStore(), (s) => s.source);

export function useCompany(id: string | null) {
  const store = useDataStore();
  const entry = useStore(store, (s) => (id ? s.companies[id] : undefined));
  useEffect(() => { if (id) store.getState().ensureCompany(id); }, [store, id]);
  const retry = () => { if (!id) return; store.setState((s) => { const { [id]: _drop, ...rest } = s.companies; return { companies: rest }; }); store.getState().ensureCompany(id); };
  return { entry, retry };
}
