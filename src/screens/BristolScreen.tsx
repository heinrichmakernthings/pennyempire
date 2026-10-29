import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchNews, fetchStandings, useQuery, type Article, type Standings } from '@/data/managementApi';
import { useDataSource } from '@/data/store';
import { formatBps, formatMoney } from '@/domain/money';
import { Icon } from '@/ui/Icon';
import { EmptyState, ErrorState, Skeleton } from '@/ui/States';
import { StatusLabel } from '@/ui/StatusLabel';
import { Tabs } from '@/ui/Tabs';

const TABS = [{ id: 'news', label: 'The Penny Post' }, { id: 'boards', label: 'Leaderboards' }, { id: 'titles', label: 'Titles' }];
const KIND_ICON: Record<string, string> = { opening: 'startup', closure: 'warning', bankruptcy: 'warning', title: 'prestige', expansion: 'companies', shortage: 'marketplace', economy: 'city', policy: 'prestige', credit: 'warning', scandal: 'warning' };
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Bristol at a glance: what happened (news from recorded events), who leads (persisted weekly boards) and who holds which title. NPC and player companies are listed on exactly the same footing. */
export function BristolScreen() {
  const source = useDataSource();
  const [tab, setTab] = useState('news');
  return (
    <div className="pe-screen">
      <div className="pe-screen-head"><h1 className="pe-h1">Bristol: news &amp; rankings</h1></div>
      {source.authority !== 'server' ? <EmptyState title="Rankings need the game server">News and rankings are generated from the live simulation. Start the game server (npm run dev:all) to see them.</EmptyState> : (
        <Tabs tabs={TABS} value={tab} onChange={setTab} label="Bristol sections">
          {tab === 'news' ? <News /> : tab === 'boards' ? <Boards /> : <Titles />}
        </Tabs>
      )}
    </div>
  );
}

function News() {
  const q = useQuery((s) => fetchNews(40, s), [], true);
  if (q.status === 'loading') return <Skeleton lines={6} label="Loading the Penny Post" />;
  if (q.status === 'error') return <ErrorState title="Couldn’t load the Penny Post" message={q.error} onRetry={q.reload} />;
  if (q.data.articles.length === 0) return <EmptyState title="Nothing to report yet">The Penny Post prints stories only when something really happens in Bristol: an opening, a closure, a new title or a shortage.</EmptyState>;
  return (
    <ol className="pe-news" aria-label="Penny Post articles" data-testid="penny-post">
      {q.data.articles.map((a: Article) => (
        <li key={a.id} className="pe-card pe-news-item" data-importance={a.importance}>
          <header className="pe-row"><Icon name={KIND_ICON[a.kind] ?? 'city'} size={22} /><div><h2 className="pe-h3">{a.companyId ? <Link to={`/competitors/${a.companyId}`}>{a.headline}</Link> : a.headline}</h2><p className="pe-hint"><time dateTime={a.gameDate}>{day(a.gameDate)}</time> · {a.kind}</p></div></header>
          <p>{a.body}</p>
        </li>
      ))}
    </ol>
  );
}

const fmt = (key: string, unit: 'minor' | 'bps', v: number) => (unit === 'minor' ? formatMoney({ currency: 'EC', minor: Math.round(v) }, { signed: key === 'profit' }) : formatBps(Math.round(v)));

function Boards() {
  const q = useQuery((s) => fetchStandings(s), [], true);
  if (q.status === 'loading') return <Skeleton lines={6} label="Loading leaderboards" />;
  if (q.status === 'error') return <ErrorState title="Couldn’t load leaderboards" message={q.error} onRetry={q.reload} />;
  const s: Standings = q.data.standings;
  if (!s.boards.length) return <EmptyState title="Boards publish weekly">The first leaderboards appear after a week of trading (day 7).</EmptyState>;
  return (
    <div className="pe-stack">
      <p className="pe-hint">Updated every 7 game days (last published day {s.asOfBoardTick}). Wash trades between companies of one owner never count.</p>
      <div className="pe-cards">{s.boards.map((b) => (
        <section key={`${b.key}-${b.scope}`} className="pe-card" aria-labelledby={`b-${b.key}-${b.scope}`}>
          <h2 id={`b-${b.key}-${b.scope}`} className="pe-h3">{b.label}</h2>
          <table className="pe-table pe-small"><caption className="pe-sr">{b.label}</caption>
            <thead><tr><th scope="col">#</th><th scope="col">Company</th><th scope="col" className="pe-num">Value</th></tr></thead>
            <tbody>{b.rows.map((r) => <tr key={r.companyId} className={r.mine ? 'pe-rank-me' : ''}><td>{r.rank}</td><th scope="row"><Link to={`/competitors/${r.companyId}`}>{r.name}</Link> {r.mine ? '(you)' : r.ownerKind === 'npc' ? <span className="pe-hint">NPC</span> : null}</th><td className="pe-financial-number">{fmt(b.key, b.unit, r.value)}</td></tr>)}</tbody>
          </table>
        </section>
      ))}</div>
    </div>
  );
}

function Titles() {
  const q = useQuery((s) => fetchStandings(s), [], true);
  if (q.status === 'loading') return <Skeleton lines={5} label="Loading titles" />;
  if (q.status === 'error') return <ErrorState title="Couldn’t load titles" message={q.error} onRetry={q.reload} />;
  const s = q.data.standings;
  if (!s.titles.length) return <EmptyState title="No titles yet">Titles are awarded with the first weekly leaderboard.</EmptyState>;
  return (
    <div className="pe-stack">
      <ul className="pe-cards" aria-label="Current titles">{s.titles.map((t) => (
        <li key={t.key} className="pe-card"><h2 className="pe-h3">{t.label}</h2><p><Link to={`/competitors/${t.holderId}`}>{t.holderName}</Link> {t.ownerKind === 'player' ? <StatusLabel tone="positive">You</StatusLabel> : <StatusLabel tone="neutral">NPC</StatusLabel>}</p><p className="pe-hint">Held since day {t.sinceTick}. A challenger must beat the holder by 5% to take it.</p></li>
      ))}</ul>
      {s.recentChanges.length > 0 && <section><h2 className="pe-h3">Title changes</h2><ul className="pe-reasons">{s.recentChanges.map((c, i) => <li key={i}>{day(c.gameDate)}: {c.to} {c.from ? `took “${c.label}” from ${c.from}` : `was named “${c.label}”`}</li>)}</ul></section>}
    </div>
  );
}
