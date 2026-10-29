import { ConnectionNotice } from './ConnectionNotice';
import type { ReactNode } from 'react';
import { useDataSource, useScreen } from '@/data/store';
import type { ClientScreenState, Loaded, ScreenKey } from '@/data/types';
import { IllustrativeBadge, ErrorState, Skeleton, StaleBanner } from './States';

/**
 * Wraps a screen in the shared loading / error / stale / illustrative states so every screen behaves identically.
 * Actions inside `children` receive only authoritative-or-labelled data; they are not rendered until data exists.
 */
export function ScreenData<K extends ScreenKey>({ screen, title, children, skeletonLines = 6, bare = false }: { screen: K; title: string; bare?: boolean; children: (data: ClientScreenState[K], loaded: Loaded<ClientScreenState[K]>) => ReactNode; skeletonLines?: number }) {
  const { entry, refresh } = useScreen(screen);
  const source = useDataSource();
  if (entry.status === 'loading' || entry.status === 'idle') return <div className="pe-screen" aria-busy="true"><h1 className="pe-h1">{title}</h1><Skeleton lines={skeletonLines} label={`Loading ${title}`} /></div>;
  if (entry.status === 'error') return <div className="pe-screen"><h1 className="pe-h1">{title}</h1><ErrorState title={`Couldn't load ${title.toLowerCase()}`} message={entry.error} onRetry={refresh} /></div>;
  const { loaded } = entry;
  if (bare) return <>{children(loaded.envelope.data, loaded)}</>;
  return (
    <div className="pe-screen">
      <div className="pe-screen-head">
        <h1 className="pe-h1">{title}</h1>
        {loaded.authority === 'illustrative-fixture' && <IllustrativeBadge />}
      </div>
      {loaded.authority === 'illustrative-fixture' && <ConnectionNotice connected={source.authority === 'server'} />}
      {entry.refreshError && <StaleBanner message={`Showing data from ${new Date(entry.loadedAt).toLocaleTimeString('en-GB')}. Refresh failed: ${entry.refreshError}. Actions are paused until refreshed.`} onRetry={refresh} />}
      {children(loaded.envelope.data, loaded)}
    </div>
  );
}
