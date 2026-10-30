import { useEffect, useRef, useState } from 'react';
import { attestAd, ecm, fetchRewards, gbp, useGameCommand } from '@/data/walletClient';
import { useQuery } from '@/data/managementApi';
import { useDataSource } from '@/data/store';
import { AdSlot } from '@/app/AdSlot';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/ui/States';
import { StatusLabel } from '@/ui/StatusLabel';
import { Tabs } from '@/ui/Tabs';

const TABS = [{ id: 'ads', label: 'Rewarded videos' }, { id: 'lottery', label: 'Coin lottery' }, { id: 'prizes', label: 'Prize draws' }];
const pct = (p: number) => `${(p * 100).toFixed(p < 0.1 ? 2 : 1)}%`;

/** Optional rewards: simulated rewarded videos (verified by the server), the fictional Empire Coin lottery with published odds, and free prize draws funded from the simulated treasury. */
export function RewardsScreen() {
  const server = useDataSource().authority === 'server'; const [tab, setTab] = useState('ads'); const q = useQuery(() => fetchRewards(), [], true);
  return (
    <div className="pe-screen" data-testid="rewards-screen">
      <div className="pe-screen-head"><h1 className="pe-h1">Rewards &amp; lottery</h1></div>
      <div className="pe-callout" role="note"><p>Everything here is optional and fictional. Rewards are issued by the server only. Lotteries use Empire Coins, which cannot be withdrawn. Cash-style prizes are SIMULATED GBP_TEST from a reserved test treasury.</p></div>
      {!server ? <EmptyState title="Rewards need the game server">Start it with npm run dev:all.</EmptyState> : q.status === 'loading' ? <Skeleton lines={5} label="Loading rewards" /> : q.status === 'error' ? <ErrorState title="Couldn’t load rewards" message={q.error} onRetry={q.reload} /> : (
        <Tabs tabs={TABS} value={tab} onChange={setTab} label="Reward sections">{tab === 'ads' ? <Ads d={q.data} reload={q.reload} /> : tab === 'lottery' ? <Lottery d={q.data} reload={q.reload} /> : <Prizes d={q.data} reload={q.reload} />}</Tabs>
      )}
      <AdSlot placement="in-flow" />
    </div>
  );
}

function Ads({ d, reload }: { d: Record<string, any>; reload: () => void }) {
  const { send, pending } = useGameCommand(); const [watch, setWatch] = useState<{ sessionId: string; label: string; total: number; started: number } | null>(null);
  const [left, setLeft] = useState(0); const [msg, setMsg] = useState<string | null>(null); const busy = useRef(false);
  useEffect(() => {
    if (!watch) return; const t = setInterval(() => setLeft(Math.max(0, watch.total - (Date.now() - watch.started))), 250); return () => clearInterval(t);
  }, [watch]);
  useEffect(() => {
    if (!watch || left > 0 || busy.current) return; busy.current = true;
    void (async () => {
      const a = await attestAd(watch.sessionId);       // the provider (server side) refuses early proofs; the browser cannot grant itself a reward
      if (!a.ok) { setMsg(a.message ?? 'The advertisement could not be verified.'); setWatch(null); busy.current = false; reload(); return; }
      const r = await send({ type: 'ad.reward.complete', sessionId: watch.sessionId, token: a.token }, { success: 'Reward received', failure: 'Reward refused' });
      setMsg(r.ok ? `Reward received: ${watch.label}` : 'The server refused the reward.'); setWatch(null); busy.current = false; reload();
    })();
  }, [left, watch, send, reload]);
  const start = async (id: string, label: string) => {
    setMsg(null); const r = await send({ type: 'ad.reward.start', rewardId: id }, { success: '', failure: 'Can’t start yet' });
    if (r.ok && r.data) { const total = Number(r.data.minWatchMs); setLeft(total); setWatch({ sessionId: String(r.data.sessionId), label, total, started: Date.now() }); }
  };
  return (
    <div className="pe-stack" data-testid="ads-rewards">
      <p className="pe-hint">{d.ads.provider} Watching is a choice and is never required. The server checks the viewing time, a signed proof from the provider, daily limits and cooldowns before it pays anything.</p>
      {watch ? (
        <section className="pe-card" role="region" aria-label="Simulated advertisement" data-testid="ad-player"><span className="pe-sim-chip">SIMULATED ADVERTISEMENT</span>
          <p>Playing a placeholder video… {Math.ceil(left / 1000)}s left. You will receive: <strong>{watch.label}</strong>.</p>
          <div className="pe-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(((watch.total - left) / watch.total) * 100)}><i style={{ width: `${((watch.total - left) / watch.total) * 100}%` }} /></div>
        </section>) : null}
      {msg ? <p role="status" className="pe-callout" data-testid="ad-message">{msg}</p> : null}
      <ul className="pe-shopgrid">{d.ads.catalogue.map((r: any) => (
        <li key={r.id} className="pe-shopitem" data-testid={`adreward-${r.id}`}><header><h3>{r.label}</h3></header><p className="pe-hint">{r.description}</p>
          <p className="pe-hint">{r.remainingToday} of {r.dailyLimit} left today{r.cooldownRemainingMs > 0 ? ` · next in ${Math.ceil(r.cooldownRemainingMs / 60_000)} min` : ''}</p>
          <Button variant="primary" pending={pending} disabled={!!watch || (!r.available && !r.openSessionId)} onClick={() => void start(r.id, r.label)}>Watch a short video</Button></li>))}</ul>
      <section className="pe-card"><h2 className="pe-h3">Reward history</h2>{d.ads.history.length === 0 ? <p className="pe-hint">Nothing yet.</p> : <ul className="pe-list pe-small">{d.ads.history.map((h: any) => <li key={h.id}>Day {h.tick}: {h.rewardId} · {h.kind === 'coins' ? ecm(h.amountMinor) : 'boost'}</li>)}</ul>}</section>
    </div>
  );
}

function Lottery({ d, reload }: { d: Record<string, any>; reload: () => void }) {
  const { send, pending } = useGameCommand(); const open = (d.lotteries as any[]).filter((l) => l.status === 'open' && l.daysLeft > 0).sort((a, b) => a.drawTick - b.drawTick)[0]; const done = (d.lotteries as any[]).filter((l) => l.status !== 'open');
  return (
    <div className="pe-stack" data-testid="lottery">
      {!open ? <EmptyState title="No draw is open">A new weekly draw opens automatically.</EmptyState> : (
        <section className="pe-card"><h2 className="pe-h3">{open.name}</h2>
          <p className="pe-hint">{open.notice}</p>
          <dl className="pe-stats pe-stats--wide"><div><dt>Ticket</dt><dd className="pe-financial-number">{ecm(open.ticketPriceMinor)}</dd></div><div><dt>Prize pool so far</dt><dd className="pe-financial-number">{ecm(open.prizePoolMinor)}</dd><small className="pe-hint">after a {open.rakeBps / 100}% fee that is burned</small></div><div><dt>Draw in</dt><dd className="pe-financial-number">{open.daysLeft} days</dd></div><div><dt>Tickets sold</dt><dd className="pe-financial-number">{open.ticketsSold}</dd></div></dl>
          <p>Prizes: {open.prizeSharesBps.map((s: number, i: number) => `${i + 1}${['st', 'nd', 'rd'][i]} ${s / 100}%`).join(' · ')} of the prize pool. Needs at least {open.minTickets} tickets, otherwise everyone is refunded.</p>
          <p data-testid="odds">Your tickets: {open.myTickets.length} of max {open.maxPerPlayer}. Published odds now: first prize {pct(open.odds.firstPrize)}, any prize {pct(open.odds.anyPrize)}. With one more ticket: first prize {pct(open.oddsIfYouBuyOne.firstPrize)}, any prize {pct(open.oddsIfYouBuyOne.anyPrize)}.</p>
          <Button variant="primary" pending={pending} disabled={open.myTickets.length >= open.maxPerPlayer} onClick={() => void send({ type: 'lottery.buy', lotteryId: open.id, count: 1 }, { success: 'Ticket bought', failure: 'Couldn’t buy a ticket' }, reload)}>Buy a ticket for {ecm(open.ticketPriceMinor)}</Button>
        </section>)}
      <section className="pe-card"><h2 className="pe-h3">Past draws</h2>
        {done.length === 0 ? <p className="pe-hint">No draws yet.</p> : done.map((l) => <div key={l.id}><h3 className="pe-h3">{l.name} · {l.status}</h3>{l.results.length ? <ul className="pe-list pe-small">{l.results.map((r: any) => <li key={r.place}>{r.place}. ticket #{r.ticketNumber} · {ecm(r.prizeMinor)}{r.ownerId === 'player-demo' ? ' (you!)' : ''}</li>)}</ul> : <p className="pe-hint">Cancelled: not enough tickets, all refunded.</p>}</div>)}
      </section>
    </div>
  );
}

function Prizes({ d, reload }: { d: Record<string, any>; reload: () => void }) {
  const { send, pending } = useGameCommand();
  return (
    <div className="pe-stack" data-testid="prizes">
      <p className="pe-hint">Free-entry prize draws never cost anything to enter. Prizes are SIMULATED GBP_TEST paid from a reserved test treasury, and a programme stops paying when its budget runs out.</p>
      {d.draws.length === 0 ? <EmptyState title="No prize draws right now">The developer creates draws from the treasury dashboard.</EmptyState> : <ul className="pe-shopgrid">{d.draws.map((x: any) => (
        <li key={x.id} className="pe-shopitem"><header><h3>{x.name}</h3><StatusLabel tone={x.status === 'open' ? 'positive' : 'neutral'}>{x.status}</StatusLabel></header><p>Prize {gbp(x.prizePence)} · {x.entries} entries · closes day {x.closesTick}</p>
          {x.status === 'open' ? (x.entered ? <StatusLabel tone="positive">You are entered</StatusLabel> : <Button variant="primary" pending={pending} onClick={() => void send({ type: 'draw.enter', drawId: x.id }, { success: 'Entered the draw', failure: 'Couldn’t enter' }, reload)}>Enter for free</Button>) : <p className="pe-hint">{x.winnerId ? `Winner: ${x.winnerId === 'player-demo' ? 'you!' : x.winnerId}` : 'No winner'}</p>}</li>))}</ul>}
      <section className="pe-card"><h2 className="pe-h3">Reward programmes</h2>{d.programs.length === 0 ? <p className="pe-hint">None yet.</p> : <table className="pe-table pe-small"><caption className="pe-sr">Programmes</caption><thead><tr><th scope="col">Programme</th><th scope="col">Source</th><th scope="col" className="pe-num">Award</th><th scope="col" className="pe-num">Budget left</th></tr></thead><tbody>{d.programs.map((p: any) => <tr key={p.id}><th scope="row">{p.name}</th><td>{String(p.source).replace('_', ' ')}</td><td className="pe-num">{gbp(p.awardPence)}</td><td className="pe-num">{gbp(p.budgetPence - p.spentPence)}</td></tr>)}</tbody></table>}</section>
    </div>
  );
}
