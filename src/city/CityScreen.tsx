import { FirstBusiness } from './FirstBusiness';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useBreakpoint } from '@/app/useBreakpoint';
import { fetchActivity, useQuery } from '@/data/managementApi';
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
import { LotPanel } from './LotPanel';
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
  const [lotId, setLotId] = useState<string | null>(null);
  const handle = useRef<CityViewportHandle | null>(null);
  const registerHandle = useCallback((h: CityViewportHandle | null) => { handle.current = h; }, []);

  const act = useQuery(async (sig) => ({...await fetchActivity(sig), receivedAt: performance.now()}), [source.authority], true, source.authority === 'server');
  const activityData = act.status === 'ready' ? act.data : undefined;
  const activity = useMemo(() => activityData ? new Map(activityData.items.map((i) => [i.companyId, i])) : undefined, [activityData]);
  const meta = useMemo(() => source.mapMeta(data.city.id), [source, data.city.id]);
  // Server data is re-fetched every few seconds; only rebuild the scene (and its cached ground layer) when its content actually changes.
  const sceneKey = JSON.stringify([data.city.plots, data.directory.map((d) => [d.id, d.plotId, d.name, d.owner.id, d.status]), data.player.id]);
  const scene = useMemo(() => buildScene(data.city, meta, data.directory, data.player.id), [sceneKey, meta]);
  const byId = useMemo(() => new Map(data.directory.map((c) => [c.id, c])), [sceneKey]);
  const hoverCaption = useCallback((id: string) => { const c = byId.get(id); return c ? { title: c.name, subtitle: `${industryLabel(c.industry)} · ${c.owner.id === data.player.id ? 'Your company' : `${ownerKindLabel(c.owner.kind)}: ${c.owner.name}`}` } : null; }, [byId, data.player.id]);
  const onSelect = useCallback((id: string | null) => { setLotId(null); select(id); }, [select]);
  const onSelectLot = useCallback((id: string) => { select(null); setLotId(id); }, [select]);
  const vacant = useMemo(() => data.city.plots.filter((p) => !p.assetId && !p.companyId && (p.width > 1 || p.depth > 1)), [sceneKey]);
  const focusFromList = (id: string) => { setLotId(null); select(id); handle.current?.focusCompany(id); setListOpen(false); };

  const companyDetail = useCompany(selectedId);
  const lotPanel = lotId && !illustrative ? <LotPanel lotId={lotId} onClose={() => setLotId(null)} showClose={bp === 'desktop'} /> : null;
  const panel = lotPanel ?? (selectedId && inspectorOpen ? (
    companyDetail.entry?.status === 'ready' ? <CompanyInspector company={companyDetail.entry.loaded.envelope.data} illustrative={companyDetail.entry.loaded.authority !== 'server'} onClose={() => select(null)} showClose={bp === 'desktop'} />
    : companyDetail.entry?.status === 'error' ? <ErrorState title="Couldn't load company" message={companyDetail.entry.error} onRetry={companyDetail.retry} />
    : <div className="pe-inspector"><Skeleton lines={6} label="Loading company" /></div>
  ) : null);
  const overview = (
    <>
      <CityOverview city={data.city} directory={data.directory} selectedId={selectedId} playerId={data.player.id} onSelect={focusFromList} />
      {!illustrative && vacant.length > 0 && (
        <section aria-labelledby="vacant-title" className="pe-stack">
          <h3 id="vacant-title" className="pe-h3">Plots for lease ({vacant.length})</h3>
          <ul className="pe-list">{vacant.map((p) => <li key={p.id} className="pe-list-row"><span>{p.id} · {p.width}×{p.depth}</span><Button onClick={() => onSelectLot(p.id)} aria-label={`Select plot ${p.id}`}>Select</Button></li>)}</ul>
        </section>
      )}
    </>
  );

  const failed = atlas.status === 'ready' ? atlas.atlas.failedSources : [];
  return (
    <div className="pe-city" data-testid="city-screen">
      <h1 className="pe-sr">City — Bristol</h1>
      <div className="pe-city-stage">
        <FirstBusiness data={data} illustrative={illustrative} />
        <div className="pe-city-toolbar">
          {bp !== 'desktop' && <Button onClick={() => setListOpen(true)} aria-haspopup="dialog"><Icon name="companies" size={18} /> Businesses ({data.directory.length})</Button>}
          {bp !== 'desktop' && <Button onClick={() => setOverviewOpen(true)} aria-haspopup="dialog"><Icon name="stocks" size={18} /> City summary</Button>}
          {data.city.events[0] && <p className="pe-event-strip" role="status"><Icon name={data.city.events[0].severity === 'warning' ? 'warning' : 'notification'} size={16} /> {data.city.events.find((e) => e.severity === 'warning')?.title ?? data.city.events[0].title}</p>}
        </div>
        <div className="pe-city-canvas-area">
          {atlas.status === 'loading' && <div className="pe-city-overlay"><Skeleton lines={4} label="Loading Bristol artwork" /></div>}
          {atlas.status === 'error' && <div className="pe-city-overlay"><ErrorState title="City artwork unavailable" message={atlas.message} onRetry={atlas.retry} /></div>}
          {atlas.status === 'ready' && <CityViewport scene={scene} atlas={atlas.atlas} activity={illustrative ? undefined : activity} activityTick={activityData?.tick} activityReceivedAt={activityData?.receivedAt} selectedId={selectedId} selectedLotId={illustrative ? null : lotId} onSelectLot={illustrative ? undefined : onSelectLot} hoverCaption={hoverCaption} onSelect={onSelect} registerHandle={registerHandle} />}
          {failed.length > 0 && <p className="pe-city-warn" role="status"><Icon name="warning" size={16} /> {failed.length} art file(s) failed to load; placeholders are shown. {[...new Set(failed.map((f) => f.split('/').pop()))].join(', ')}</p>}
        </div>
        <p className="pe-hint pe-city-caption">{illustrative ? 'Illustrative city. Activity appears when the live simulation is connected.' : 'Street activity reflects the latest trading day. Figures represent sales and staffing levels, not individual tracked customers.'}</p>
      </div>

      {bp === 'desktop' && <aside className="pe-side" aria-label="Company and city details">{panel ?? overview}</aside>}
      {bp !== 'desktop' && (
        <ResponsiveSheet open={!!panel} onClose={() => { setLotId(null); select(null); }} title={bp === 'tablet' ? 'Company' : 'Company details'} variant={bp === 'tablet' ? 'side' : 'sheet'}>{panel}</ResponsiveSheet>
      )}
      <ResponsiveSheet open={listOpen} onClose={() => setListOpen(false)} title="Businesses in Bristol" variant={bp === 'tablet' ? 'side' : 'sheet'}>
        <AccessibleCompanyList companies={data.directory} selectedId={selectedId} playerId={data.player.id} onSelect={focusFromList} />
      </ResponsiveSheet>
      <ResponsiveSheet open={overviewOpen} onClose={() => setOverviewOpen(false)} title="City summary" variant={bp === 'tablet' ? 'side' : 'sheet'}>{overview}</ResponsiveSheet>
    </div>
  );
}
