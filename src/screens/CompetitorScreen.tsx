import { Link, useParams } from 'react-router-dom';
import { fetchCompetitor, useQuery } from '@/data/managementApi';
import { useDataSource } from '@/data/store';
import { formatBps, formatMoney } from '@/domain/money';
import { Icon } from '@/ui/Icon';
import { EmptyState, ErrorState, Skeleton } from '@/ui/States';
import { StatusLabel } from '@/ui/StatusLabel';
import { INDUSTRY_ICON } from './OpportunitiesScreen';
import { npcPortrait } from '@/assets/npcPortraits';

/** What anyone in Bristol can see of a company: price, reputation, standing and history. Never its cash, margins or plans. */
export function CompetitorScreen() {
  const { id = '' } = useParams();
  const source = useDataSource();
  const q = useQuery((s) => fetchCompetitor(id, s), [id, source.authority], false);
  return (
    <div className="pe-screen">
      <div className="pe-screen-head"><h1 className="pe-h1">Competitor profile</h1></div>
      {source.authority !== 'server' ? <EmptyState title="Profiles need the game server">Competitor profiles are read from the live simulation.</EmptyState>
        : q.status === 'loading' ? <Skeleton lines={6} label="Loading competitor" />
        : q.status === 'error' ? <ErrorState title="Couldn’t load this company" message={q.error} onRetry={q.reload} />
        : <Profile p={q.data.profile} />}
      <p><Link to="/bristol">← Back to news &amp; rankings</Link></p>
    </div>
  );
}

function Profile({ p }: { p: import('@/shared/living').CompetitorProfile }) {
  const representative=npcPortrait(p.companyId,p.ownerKind);
  return (
    <article className="pe-card pe-stack" data-testid="competitor-profile" aria-labelledby="comp-name">
      <header className="pe-row">{representative?.url ? <img className="pe-pixel-art" src={representative.url} width={72} height={72} alt={`${representative.name}, NPC representative`} /> : <Icon name={INDUSTRY_ICON[p.industry] ?? 'companies'} size={32} />}<div><h2 id="comp-name">{p.name}</h2><p className="pe-hint">{p.industryLabel} · {p.district} · {p.ownerKind === 'player' ? 'Player-owned' : 'NPC-owned'}</p>{representative && <p className="pe-hint">{representative.name} · company representative</p>}</div>
        <StatusLabel tone={p.status === 'operating' ? 'positive' : p.status === 'paused' ? 'warning' : 'negative'}>{p.status === 'closed' ? 'Closed' : p.status[0]!.toUpperCase() + p.status.slice(1)}</StatusLabel></header>
      <dl className="pe-kv">
        <div><dt>Selling price</dt><dd>{formatMoney({ currency: 'EC', minor: p.priceMinor })}</dd></div>
        <div><dt>Quality</dt><dd>{p.quality}</dd></div>
        <div><dt>Reputation</dt><dd>{formatBps(p.reputationBps)}</dd></div>
        <div><dt>Rank in Bristol</dt><dd>{p.market.rank ? `#${p.market.rank} of ${p.market.of}` : '—'}</dd></div>
        <div><dt>Market share</dt><dd>{formatBps(p.market.shareBps)}</dd></div>
        <div><dt>Sales volume</dt><dd>{p.market.unitsPerDayBand}</dd></div>
        <div><dt>Team size</dt><dd>{p.staffBand}</dd></div>
        <div><dt>Open for</dt><dd>{p.ageDays} days</dd></div>
      </dl>
      {p.titles.length > 0 && <p><strong>Titles:</strong> {p.titles.join(' · ')}</p>}
      {p.recent.length > 0 && <section><h3 className="pe-h3">In the news</h3><ul className="pe-reasons">{p.recent.map((r, i) => <li key={i}>{new Date(r.gameDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}: {r.text}</li>)}</ul></section>}
      <p className="pe-hint">{p.notice} Share investment, acquisitions and corporate groups are not available in this version.</p>
    </article>
  );
}
