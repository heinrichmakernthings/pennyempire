import { useCallback, useMemo, useRef, useState } from 'react';
import { useBreakpoint } from '@/app/useBreakpoint';
import { useCompany, useDataSource } from '@/data/store';
import type { CityScreenState } from '@/data/types';
import { industryLabel, ownerKindLabel } from '@/domain/labels';
import { useUi } from '@/state/ui';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { ScreenData } from '@/ui/ScreenData';
import { ErrorState, Skeleton } from '@/ui/States';
import { ResponsiveSheet } from '@/ui/ResponsiveSheet';
import { AccessibleCompanyList } from './AccessibleCompanyList';
import { CityOverview } from './CityOverview';
import { CityViewport, type CityViewportHandle } from './CityViewport';
import { CompanyInspector } from './CompanyInspector';
import { buildScene } from './scene';
import { useArtAtlas } from './useArtAtlas';

export function CityScreen() {
  return <ScreenData screen="city" title="City" skeletonLines={8} bare>{(data, loaded) => <CityView data={data} illustrative={loaded.authority !== 'server'} />}</ScreenData>;
}

function CityView({ data, illustrative }: { data: CityScreenState; illustrative: boolean }) {
  const bp = useBreakpoint();
  const source = useDataSource();
  const atlas = useArtAtlas();
  const selectedId = useUi((s) => s.selectedCompanyId);
  const inspectorOpen = useUi((s) => s.inspectorOpen);
  const select = useUi((s) => s.select);
  const [listOpen, setListOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const handle = useRef<CityViewportHandle | null>(null);
  const registerHandle = useCallback((h: CityViewportHandle | null) => { handle.current = h; }, []);

  const meta = useMemo(() => source.mapMeta(data.city.id), [source, data.city.id]);
  // Server data is re-fetched every few seconds; only rebuild the scene (and its cached ground layer) when its content actually changes.
  const sceneKey = JSON.stringify([data.city.plots, data.directory.map((d) => [d.id, d.plotId, d.name, d.owner.id, d.status]), data.player.id]);
  const scene = useMemo(() => buildScene(data.city, meta, data.directory, data.player.id), [sceneKey, meta]);
  const byId = useMemo(() => new Map(data.directory.map((c) => [c.id, c])), [sceneKey]);
  const hoverCaption = useCallback((id: string) => { const c = byId.get(id); return c ? { title: c.name, subtitle: `${industryLabel(c.industry)} · ${c.owner.id === data.player.id ? 'Your company' : `${ownerKindLabel(c.owner.kind)}: ${c.owner.name}`}` } : null; }, [byId, data.player.id]);
  const onSelect = useCallback((id: string | null) => select(id), [select]);
  const focusFromList = (id: string) => { select(id); handle.current?.focusCompany(id); setListOpen(false); };

  const companyDetail = useCompany(selectedId);
  const panel = selectedId && inspectorOpen ? (
    companyDetail.entry?.status === 'ready' ? <CompanyInspector company={companyDetail.entry.loaded.envelope.data} illustrative={companyDetail.entry.loaded.authority !== 'server'} onClose={() => select(null)} showClose={bp === 'desktop'} />
    : companyDetail.entry?.status === 'error' ? <ErrorState title="Couldn't load company" message={companyDetail.entry.error} onRetry={companyDetail.retry} />
    : <div className="pe-inspector"><Skeleton lines={6} label="Loading company" /></div>
  ) : null;
  const overview = <CityOverview city={data.city} directory={data.directory} selectedId={selectedId} playerId={data.player.id} onSelect={focusFromList} />;

  const failed = atlas.status === 'ready' ? atlas.atlas.failedSources : [];
  return (
    <div className="pe-city" data-testid="city-screen">
      <h1 className="pe-sr">City — Bristol</h1>
      <div className="pe-city-stage">
        <div className="pe-city-toolbar">
          {bp !== 'desktop' && <Button onClick={() => setListOpen(true)} aria-haspopup="dialog"><Icon name="companies" size={18} /> Businesses ({data.directory.length})</Button>}
          {bp !== 'desktop' && <Button onClick={() => setOverviewOpen(true)} aria-haspopup="dialog"><Icon name="stocks" size={18} /> City summary</Button>}
          {data.city.events[0] && <p className="pe-event-strip" role="status"><Icon name={data.city.events[0].severity === 'warning' ? 'warning' : 'notification'} size={16} /> {data.city.events.find((e) => e.severity === 'warning')?.title ?? data.city.events[0].title}</p>}
        </div>
        <div className="pe-city-canvas-area">
          {atlas.status === 'loading' && <div className="pe-city-overlay"><Skeleton lines={4} label="Loading Bristol artwork" /></div>}
          {atlas.status === 'error' && <div className="pe-city-overlay"><ErrorState title="City artwork unavailable" message={atlas.message} onRetry={atlas.retry} /></div>}
          {atlas.status === 'ready' && <CityViewport scene={scene} atlas={atlas.atlas} selectedId={selectedId} hoverCaption={hoverCaption} onSelect={onSelect} registerHandle={registerHandle} />}
          {failed.length > 0 && <p className="pe-city-warn" role="status"><Icon name="warning" size={16} /> {failed.length} art file(s) failed to load; placeholders are shown. {[...new Set(failed.map((f) => f.split('/').pop()))].join(', ')}</p>}
        </div>
        {illustrative && <p className="pe-hint pe-city-caption">City layout and company values are illustrative fixtures. Static art only: walk cycles and production animation are still being produced.</p>}
      </div>

      {bp === 'desktop' && <aside className="pe-side" aria-label="Company and city details">{panel ?? overview}</aside>}
      {bp !== 'desktop' && (
        <ResponsiveSheet open={!!panel} onClose={() => select(null)} title={bp === 'tablet' ? 'Company' : 'Company details'} variant={bp === 'tablet' ? 'side' : 'sheet'}>{panel}</ResponsiveSheet>
      )}
      <ResponsiveSheet open={listOpen} onClose={() => setListOpen(false)} title="Businesses in Bristol" variant={bp === 'tablet' ? 'side' : 'sheet'}>
        <AccessibleCompanyList companies={data.directory} selectedId={selectedId} playerId={data.player.id} onSelect={focusFromList} />
      </ResponsiveSheet>
      <ResponsiveSheet open={overviewOpen} onClose={() => setOverviewOpen(false)} title="City summary" variant={bp === 'tablet' ? 'side' : 'sheet'}>{overview}</ResponsiveSheet>
    </div>
  );
}
