import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMarket, fetchPrestige, ecm, useGameCommand } from '@/data/walletClient';
import { useQuery } from '@/data/managementApi';
import { useDataSource } from '@/data/store';
import { AdSlot } from '@/app/AdSlot';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { EmptyState, ErrorState, Skeleton } from '@/ui/States';
import { Sprite } from '@/ui/Sprite';
import { StatusLabel } from '@/ui/StatusLabel';
import { Tabs } from '@/ui/Tabs';
import { FixturePrestigeScreen } from './FixturePrestige';

const TABS = [{ id: 'store', label: 'Prestige Store' }, { id: 'collection', label: 'My collection' }, { id: 'market', label: 'Collectibles market' }, { id: 'boosts', label: 'Boosts' }, { id: 'ranks', label: 'Rankings' }];
const CAT: Record<string, string> = { vehicle: 'Vehicles', property: 'Property', corporate: 'Corporate prestige', luxury: 'Luxury assets' };
const Rarity = ({ r }: { r: string }) => <span className={`pe-rarity pe-rarity--${r}`}>{r}</span>;

/** The prestige economy: luxury goods for Empire Coins, your collection, the player-to-player collectibles market, capped boosts and prestige rankings. Everything is read from and written to the server. */
export function PrestigeScreen() {
  // Without the game server (fixture mode) the original offline preview is shown; with it, the real store.
  return useDataSource().authority === 'server' ? <ServerPrestige /> : <FixturePrestigeScreen />;
}

function ServerPrestige() {
  const source = useDataSource(); const [tab, setTab] = useState('store');
  const q = useQuery(() => fetchPrestige(), [], true);
  return (
    <div className="pe-screen" data-testid="prestige-screen">
      <div className="pe-screen-head"><h1 className="pe-h1">Prestige</h1></div>
      <div className="pe-callout" role="note"><p>Prestige items are fictional status goods bought with <strong>Empire Coins</strong>. The price is destroyed (a currency sink). Coins are not money and cannot be withdrawn; the simulated GBP wallet is completely separate.</p></div>
      {source.authority !== 'server' ? <EmptyState title="The Prestige Store needs the game server">Purchases, ownership and rankings are stored by the server. Start it with npm run dev:all.</EmptyState> : q.status === 'loading' ? <Skeleton lines={6} label="Loading the Prestige Store" /> : q.status === 'error' ? <ErrorState title="Couldn’t load the Prestige Store" message={q.error} onRetry={q.reload} /> : (
        <Tabs tabs={TABS} value={tab} onChange={setTab} label="Prestige sections">
          {tab === 'store' ? <Store d={q.data} reload={q.reload} /> : tab === 'collection' ? <Collection d={q.data} reload={q.reload} /> : tab === 'market' ? <Market reload={q.reload} /> : tab === 'boosts' ? <Boosts d={q.data} reload={q.reload} /> : <Ranks d={q.data} />}
        </Tabs>
      )}
      <AdSlot placement="in-flow" />
    </div>
  );
}

function Store({ d, reload }: { d: Record<string, any>; reload: () => void }) {
  const { send, pending } = useGameCommand(); const [cat, setCat] = useState('all'); const items = (d.items as any[]).filter((i) => cat === 'all' || i.category === cat);
  return (
    <div className="pe-stack" data-testid="prestige-store">
      <dl className="pe-stats pe-stats--wide"><div><dt>Your Empire Coins</dt><dd className="pe-financial-number">{ecm(d.coinsMinor)}</dd></div><div><dt>Your prestige score</dt><dd className="pe-financial-number" data-testid="prestige-score">{d.score.total}</dd><small className="pe-hint">items count after being held {d.holdTicks} days</small></div></dl>
      <div className="pe-actions" role="group" aria-label="Category">{['all', 'vehicle', 'property', 'corporate', 'luxury'].map((c) => <Button key={c} variant={cat === c ? 'primary' : 'secondary'} onClick={() => setCat(c)}>{c === 'all' ? 'All' : CAT[c]}</Button>)}</div>
      <ul className="pe-shopgrid" aria-label="Prestige items">
        {items.map((i) => (
          <li key={i.id} className="pe-shopitem" data-testid={`item-${i.id}`}>
            <header><h3>{i.name}</h3><Rarity r={i.rarity} /></header>
            <div className="pe-art"><Sprite asset={i.asset} name={i.name} /></div>
            <p className="pe-hint">{i.description}</p>
            <p className="pe-financial-number">{ecm(i.priceMinor)}</p>
            <p className="pe-hint">{i.supplyCap ? `Limited: ${i.remaining} of ${i.supplyCap} left` : 'Unlimited supply'} · {i.tradeable ? 'tradeable collectible' : 'not tradeable'} · {i.prestigePoints} prestige</p>
            {i.purchasable ? <Button variant="primary" pending={pending} onClick={() => { if (window.confirm(`Buy ${i.name} for ${ecm(i.priceMinor)}? The price is spent permanently.`)) void send({ type: 'prestige.buy', itemId: i.id }, { success: `${i.name} bought`, failure: 'Couldn’t buy' }, reload); }}>Buy for {ecm(i.priceMinor)}</Button> : <StatusLabel tone="neutral">{i.unavailableReason}</StatusLabel>}
          </li>))}
      </ul>
    </div>
  );
}

function Collection({ d, reload }: { d: Record<string, any>; reload: () => void }) {
  const { send, pending } = useGameCommand(); const [ask, setAsk] = useState<Record<string, string>>({});
  const inv = d.inventory as any[]; const s = d.score;
  return (
    <div className="pe-stack" data-testid="prestige-collection">
      <dl className="pe-stats pe-stats--wide">{[['Items', s.items], ['Collections', s.collections], ['Businesses', s.businesses], ['Titles', s.titles], ['Total prestige', s.total]].map(([k, v]) => <div key={String(k)}><dt>{k}</dt><dd className="pe-financial-number">{v}</dd></div>)}</dl>
      {inv.length === 0 ? <EmptyState title="Your collection is empty">Buy something in the Prestige Store. Owned luxury items appear on your company forecourts in the city, and on your profile.</EmptyState> : (
        <ul className="pe-shopgrid" aria-label="Owned items">{inv.map((o) => (
          <li key={o.id} className="pe-shopitem" data-testid={`owned-${o.id}`}>
            <header><h3>{o.name}</h3><Rarity r={o.rarity} /></header>
            <div className="pe-art"><Sprite asset={o.asset} name={o.name} /></div>
            <p className="pe-hint">#{o.serial}{o.supplyCap ? ` of ${o.supplyCap}` : ''} · bought day {o.acquiredTick} ({o.acquiredHow}) · {o.earningPrestige ? `earning ${o.prestigePoints} prestige` : 'prestige starts after a week of ownership'}</p>
            {o.tradeable && !o.listed ? (<div className="pe-actions"><Field label="Asking price (EC)"><input type="number" min={1} value={ask[o.id] ?? ''} onChange={(e) => setAsk({ ...ask, [o.id]: e.target.value })} /></Field><Button pending={pending} onClick={() => void send({ type: 'prestige.list', ownedId: o.id, askMinor: Math.round(Number(ask[o.id] ?? 0) * 100) }, { success: 'Listed on the market', failure: 'Couldn’t list' }, reload)}>List for sale</Button></div>) : o.listed ? <StatusLabel tone="warning">Listed for sale</StatusLabel> : <StatusLabel tone="neutral">Not tradeable</StatusLabel>}
          </li>))}</ul>)}
      <p className="pe-hint">Showcase: cars, boats and signs appear beside your companies on the <Link to="/city">city map</Link>; landmark buildings and monuments appear on your profile.</p>
    </div>
  );
}

function Market({ reload }: { reload: () => void }) {
  const q = useQuery(() => fetchMarket(), [], true); const { send, pending } = useGameCommand();
  if (q.status === 'loading') return <Skeleton lines={4} label="Loading the market" />;
  if (q.status === 'error') return <ErrorState title="Couldn’t load the market" message={q.error} onRetry={q.reload} />;
  const d = q.data; const again = () => { q.reload(); reload(); };
  return (
    <div className="pe-stack" data-testid="collectibles-market">
      <p className="pe-hint">{d.note}</p>
      {d.listings.length === 0 ? <EmptyState title="Nothing is for sale right now">List one of your tradeable collectibles from My collection.</EmptyState> : (
        <div className="pe-tbl-wrap"><table className="pe-table"><caption className="pe-sr">Collectibles for sale</caption><thead><tr><th scope="col">Item</th><th scope="col">Seller</th><th scope="col" className="pe-num">Asking</th><th scope="col" className="pe-num">Shop price</th><th scope="col" /></tr></thead>
          <tbody>{d.listings.map((l: any) => <tr key={l.id}><th scope="row">{l.name} #{l.serial}</th><td>{l.sellerName}</td><td className="pe-num">{ecm(l.askMinor)}</td><td className="pe-num">{ecm(l.shopPriceMinor)}</td><td>{l.mine ? <Button variant="ghost" pending={pending} onClick={() => void send({ type: 'prestige.unlist', listingId: l.id }, { success: 'Listing cancelled', failure: 'Couldn’t cancel' }, again)}>Cancel</Button> : <Button variant="primary" pending={pending} onClick={() => void send({ type: 'prestige.buyListing', listingId: l.id }, { success: 'Bought', failure: 'Couldn’t buy' }, again)}>Buy</Button>}</td></tr>)}</tbody></table></div>)}
      <section className="pe-card"><h2 className="pe-h3">Trade history</h2>
        {d.history.length === 0 ? <p className="pe-hint">No trades yet.</p> : <ul className="pe-list pe-small">{d.history.map((h: any, i: number) => <li key={i}>Day {h.tick}: {h.name} · {h.kind === 'purchase' ? `bought from the shop by ${h.to}` : `${h.from} → ${h.to}`} · {ecm(h.priceMinor)}{h.feeMinor ? ` (fee ${ecm(h.feeMinor)} burned)` : ''}</li>)}</ul>}
      </section>
    </div>
  );
}

function Boosts({ d, reload }: { d: Record<string, any>; reload: () => void }) {
  const { send, pending } = useGameCommand(); const b = d.boosts;
  return (
    <div className="pe-stack" data-testid="boosts-tab">
      <div className="pe-callout" role="note"><p>{b.note}</p></div>
      <ul className="pe-shopgrid">{b.offers.map((o: any) => { const live = (b.active as any[]).find((a) => a.kind === o.kind && a.source === 'purchase'); return (
        <li key={o.id} className="pe-shopitem"><header><h3>{o.label}</h3></header><p className="pe-hint">{o.description}</p><p className="pe-financial-number">{ecm(o.priceMinor)} · {o.days} days</p>
          {live ? <StatusLabel tone="positive">Active until day {live.endTick}</StatusLabel> : <Button variant="primary" pending={pending} onClick={() => void send({ type: 'boost.buy', offerId: o.id }, { success: 'Boost activated', failure: 'Couldn’t activate' }, reload)}>Activate for {ecm(o.priceMinor)}</Button>}</li>); })}</ul>
      <section className="pe-card"><h2 className="pe-h3">Active boosts</h2>{b.active.length === 0 ? <p className="pe-hint">None.</p> : <ul className="pe-list">{b.active.map((a: any) => <li key={a.id}>{a.kind} +{a.bps / 100}% · {a.source.replace('_', ' ')} · ends day {a.endTick}</li>)}</ul>}<p className="pe-hint">Only the strongest boost of each kind applies (cap {b.capBps / 100}%).</p></section>
    </div>
  );
}

function Ranks({ d }: { d: Record<string, any> }) {
  const [scope, setScope] = useState<'city' | 'global'>('city'); const board = d.boards[scope];
  return (
    <div className="pe-stack" data-testid="prestige-ranks">
      <div className="pe-actions"><Button variant={scope === 'city' ? 'primary' : 'secondary'} onClick={() => setScope('city')}>Bristol</Button><Button variant={scope === 'global' ? 'primary' : 'secondary'} onClick={() => setScope('global')}>Global</Button></div>
      <p className="pe-hint">Prestige is not net worth. It counts rare items held for a week or more, collections, businesses and titles; moving an item between accounts earns nothing. Updated weekly (day {board.tick}).</p>
      {board.rows.length === 0 ? <EmptyState title="No rankings yet">The first prestige rankings are published on day 7.</EmptyState> : (
        <table className="pe-table"><caption className="pe-sr">Prestige rankings</caption><thead><tr><th scope="col">#</th><th scope="col">Owner</th><th scope="col" className="pe-num">Prestige</th><th scope="col">Breakdown</th></tr></thead>
          <tbody>{board.rows.map((r: any) => <tr key={r.ownerId} className={r.mine ? 'pe-rank-me' : ''}><td>{r.rank}</td><th scope="row">{r.name}{r.mine ? ' (you)' : ''}</th><td className="pe-num">{r.score}</td><td className="pe-hint">items {r.breakdown.items} · collections {r.breakdown.collections} · businesses {r.breakdown.businesses} · titles {r.breakdown.titles}</td></tr>)}</tbody></table>)}
    </div>
  );
}
