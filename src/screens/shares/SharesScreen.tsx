import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBreakpoint } from '@/app/useBreakpoint';
import type { History } from '@/contracts/game-state';
import { fetchNews, useQuery, type Article } from '@/data/managementApi';
import { fetchExchange, fetchOrderQuote, fetchSecurity, useShareCommand, type OrderQuoteDto } from '@/data/shareClient';
import { useDataSource } from '@/data/store';
import { newIdempotencyKey } from '@/data/useCommand';
import { formatBps, formatMoney, formatSignedBps, formatUnits, parseDecimalToMinor } from '@/domain/money';
import { phase5Url, STATE_SPRITE } from '@/assets/artAssets';
import type { BookLevel, ExchangeHome, SecurityDetail, SecurityListing } from '@/shared/securities';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { FinancialChart } from '@/ui/FinancialChart';
import { Icon } from '@/ui/Icon';
import { ResponsiveSheet } from '@/ui/ResponsiveSheet';
import { EmptyState, ErrorState, Skeleton } from '@/ui/States';
import { StatusLabel } from '@/ui/StatusLabel';
import { Tabs } from '@/ui/Tabs';
import { INDUSTRY_ICON } from '../OpportunitiesScreen';
import { StocksScreen } from '../StocksScreen';

const ec = (minor: number | null | undefined, opts: { signed?: boolean } = {}) => (minor === null || minor === undefined ? '—' : formatMoney({ currency: 'EC', minor }, opts));
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const MARKET_KINDS = new Set(['ipo', 'dividend', 'suspension', 'delisting', 'control', 'holder', 'earnings', 'market']);

/** `/stocks`: the real exchange when the game server is connected; the illustrative fixture screen otherwise. */
export function SharesRoute() { const source = useDataSource(); return source.authority === 'server' ? <SharesScreen /> : <StocksScreen />; }

function Logo({ l, size = 32 }: { l: Pick<SecurityListing, 'companyId' | 'industry'>; size?: number }) {
  const url = STATE_SPRITE[l.companyId] ? phase5Url(STATE_SPRITE[l.companyId]!) : undefined;
  return url ? <img src={url} alt="" width={size} height={size} style={{ objectFit: 'contain', imageRendering: 'pixelated' }} /> : <Icon name={INDUSTRY_ICON[l.industry] ?? 'companies'} size={size - 4} />;
}
const changeCell = (bps: number | null) => (bps === null ? <span className="pe-hint">no trades</span> : <span className={bps > 0 ? 'pe-pos' : bps < 0 ? 'pe-neg' : ''}>{formatSignedBps(bps)}</span>);

export function SharesScreen() {
  const bp = useBreakpoint();
  const [params, setParams] = useSearchParams();
  const home = useQuery((s) => fetchExchange(s), [], true);
  const selected = params.get('c');
  const first = home.status === 'ready' ? home.data.exchange.listings[0]?.companyId : undefined;
  const id = selected ?? first ?? null;
  const select = (c: string) => setParams({ c }, { replace: true });
  return (
    <div className="pe-screen" data-testid="shares-screen">
      <div className="pe-screen-head"><h1 className="pe-h1">Penny Exchange</h1></div>
      {home.status === 'loading' ? <Skeleton lines={8} label="Loading the exchange" />
        : home.status === 'error' ? <ErrorState title="Couldn’t load the exchange" message={home.error} onRetry={home.reload} />
        : (
          <div className="pe-stack">
            <MarketBar ex={home.data.exchange} />
            <div className="pe-shares">
              <aside className="pe-shares-list" aria-label="Listed companies">
                <Listings rows={home.data.exchange.listings} selected={id} onSelect={select} compact={bp === 'mobile'} />
                {home.data.exchange.unlisted.length > 0 && (
                  <section aria-labelledby="mine-t" className="pe-stack"><h2 id="mine-t" className="pe-h3">Your unlisted companies</h2>
                    <ul className="pe-list">{home.data.exchange.unlisted.map((u) => <li key={u.companyId} className="pe-list-row"><span>{u.name} <span className="pe-hint">{u.ticker}</span></span><Link className="pe-btn pe-btn--secondary" to={`/stocks/list/${u.companyId}`} data-testid={`list-${u.companyId}`}>{u.eligible ? 'List it' : 'Check requirements'}</Link></li>)}</ul>
                  </section>
                )}
              </aside>
              <div className="pe-shares-main">{id ? <CompanyPane key={id} companyId={id} bp={bp} /> : <EmptyState title="No companies are listed">Listings appear here once a company goes public.</EmptyState>}</div>
            </div>
            <MarketNews />
          </div>
        )}
    </div>
  );
}

function MarketBar({ ex }: { ex: ExchangeHome }) {
  const s = ex.index.series.map((p) => p.valueBps);
  const hi = Math.max(...s, 1), lo = Math.min(...s, hi);
  const pts = s.map((v, i) => `${(i / Math.max(1, s.length - 1)) * 100},${100 - ((v - lo) / Math.max(1, hi - lo)) * 100}`).join(' ');
  const unsafe = ex.listings.filter((l) => l.status === 'suspended').length;
  return (
    <section aria-label="Market summary" className="pe-card pe-marketbar" data-testid="market-bar">
      <img src={phase5Url('penny-exchange')} alt="" width={64} height={64} style={{ objectFit: 'contain', imageRendering: 'pixelated' }} />
      <dl className="pe-stats">
        <div><dt>Penny index</dt><dd className="pe-financial-number">{(ex.index.valueBps / 100).toFixed(2)} <span className={ex.index.changeBps >= 0 ? 'pe-pos' : 'pe-neg'}>{formatSignedBps(ex.index.changeBps)}</span></dd></div>
        <div><dt>Listed companies</dt><dd>{ex.listings.length}{unsafe ? ` · ${unsafe} suspended` : ''}</dd></div>
        <div><dt>Total market value</dt><dd className="pe-financial-number">{ec(ex.index.marketCapMinor)}</dd></div>
        <div><dt>Trading fee (seller)</dt><dd>{formatBps(ex.feeBps)}</dd></div>
      </dl>
      {s.length > 1 && <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pe-spark" role="img" aria-label="Index over the last 60 days"><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>}
      <p className="pe-hint">{ex.notice} Prices are set only by orders; each day a price may move at most ±{formatBps(ex.bandBps)} from the previous close.</p>
    </section>
  );
}

function Listings({ rows, selected, onSelect, compact }: { rows: SecurityListing[]; selected: string | null; onSelect: (id: string) => void; compact: boolean }) {
  return (
    <div className="pe-table-wrap" role="region" aria-label="Listed companies" tabIndex={0}>
      <table className="pe-table pe-small" data-testid="listings">
        <caption className="pe-sr">Listed companies on the Penny Exchange</caption>
        <thead><tr><th scope="col">Company</th><th scope="col" className="pe-end">Price</th>{!compact && <><th scope="col" className="pe-end">Change</th><th scope="col" className="pe-end">vs estimate</th><th scope="col" className="pe-end">Yield</th></>}</tr></thead>
        <tbody>{rows.map((l) => (
          <tr key={l.companyId} className={l.companyId === selected ? 'is-selected' : ''}>
            <th scope="row"><button type="button" className="pe-link-btn pe-listing-btn" aria-pressed={l.companyId === selected} onClick={() => onSelect(l.companyId)} data-testid={`listing-${l.ticker}`}><Logo l={l} size={24} /><span>{l.ticker}<small>{l.name}{l.status === 'suspended' ? ' · suspended' : ''}</small></span></button></th>
            <td className="pe-end pe-financial-number">{ec(l.priceMinor)}{l.priceBasis !== 'trade' && l.priceMinor !== null ? <small className="pe-hint"> ({l.priceBasis})</small> : null}</td>
            {!compact && <><td className="pe-end">{changeCell(l.changeBps)}</td><td className="pe-end">{l.premiumBps === null ? '—' : formatSignedBps(l.premiumBps)}</td><td className="pe-end">{formatBps(l.dividendYield30dBps)}</td></>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function CompanyPane({ companyId, bp }: { companyId: string; bp: string }) {
  const q = useQuery((s) => fetchSecurity(companyId, s), [companyId], true);
  const [tab, setTab] = useState('overview'); const [ticketOpen, setTicketOpen] = useState(false);
  if (q.status === 'loading') return <Skeleton lines={8} label="Loading company" />;
  if (q.status === 'error') return <ErrorState title="Couldn’t load this company" message={q.error} onRetry={q.reload} />;
  const d = q.data.detail; const l = d.listing;
  const tabs = [{ id: 'overview', label: 'Overview' }, { id: 'book', label: 'Order book' }, { id: 'financials', label: 'Financials' }, { id: 'ownership', label: 'Ownership' }, { id: 'dividends', label: 'Dividends' }, { id: 'news', label: 'News' }];
  const ticket = <Ticket d={d} onDone={q.reload} />;
  return (
    <div className="pe-shares-detail" data-testid="company-pane">
      <header className="pe-row pe-detail-head"><Logo l={l} size={48} /><div><h2 className="pe-h2" style={{ margin: 0 }}>{l.name} <span className="pe-hint">{l.ticker}</span></h2>
        <div className="pe-badge-row"><StatusLabel tone={l.status === 'open' ? 'positive' : l.status === 'suspended' ? 'negative' : 'neutral'}>{l.status === 'open' ? 'Trading' : l.status === 'suspended' ? 'Suspended' : l.status === 'unlisted' ? 'Not listed' : 'Delisted'}</StatusLabel>
          <StatusLabel tone="neutral">{l.ownerKind === 'state' ? 'State enterprise' : l.ownerKind === 'player' ? 'Player-controlled' : 'NPC-controlled'}</StatusLabel>
          {l.liquidity === 'thin' && <StatusLabel tone="warning">Thin market</StatusLabel>}{l.liquidity === 'none' && l.status === 'open' && <StatusLabel tone="warning">No orders</StatusLabel>}{l.priceStale && l.priceBasis === 'trade' && <StatusLabel tone="warning">Last trade is old</StatusLabel>}</div></div>
        {bp === 'mobile' && l.status === 'open' && <Button variant="primary" onClick={() => setTicketOpen(true)} data-testid="open-share-ticket">Trade</Button>}</header>
      {l.suspendedReason && <p className="pe-callout" role="alert"><span><strong>Trading suspended:</strong> {l.suspendedReason}. Resting orders can still be cancelled.</span></p>}
      <dl className="pe-stats pe-stats--wide" data-testid="quote-stats">
        <div><dt>Last trade price</dt><dd className="pe-financial-number" data-testid="last-price">{ec(l.priceMinor)}</dd><small className="pe-hint">{l.priceBasis === 'trade' ? 'from the latest executed trade' : l.priceBasis === 'offer' ? 'the offer price: nothing has traded yet' : l.priceBasis === 'fundamental' ? 'the fundamental estimate: nothing has traded' : 'no price yet'}</small></div>
        <div><dt>Best bid / ask</dt><dd className="pe-financial-number">{ec(l.bestBidMinor)} / {ec(l.bestAskMinor)}</dd></div>
        <div><dt>Fundamental estimate</dt><dd className="pe-financial-number">{ec(l.fairValueMinor)}</dd><small className="pe-hint">{l.premiumBps === null ? '' : `price is ${formatSignedBps(l.premiumBps)} vs estimate`}</small></div>
        <div><dt>Market value</dt><dd className="pe-financial-number">{ec(l.marketCapMinor)}</dd></div>
        <div><dt>Dividend yield (30 days)</dt><dd>{formatBps(l.dividendYield30dBps)}</dd></div>
        <div><dt>You own</dt><dd>{formatUnits(l.myShares)} shares{l.myStakeBps > 0 ? ` (${formatBps(l.myStakeBps)})` : ''}</dd></div>
      </dl>
      <div className="pe-shares-cols">
        <div className="pe-stack" style={{ minWidth: 0 }}>
          <Tabs tabs={tabs} value={tab} onChange={setTab} label="Company sections">
            {tab === 'overview' ? <Overview d={d} /> : tab === 'book' ? <Book d={d} /> : tab === 'financials' ? <Financials d={d} /> : tab === 'ownership' ? <Ownership d={d} /> : tab === 'dividends' ? <Dividends d={d} onDone={q.reload} /> : <CompanyNews d={d} />}
          </Tabs>
        </div>
        {bp !== 'mobile' && <aside className="pe-shares-ticket" aria-label="Share ticket">{ticket}</aside>}
      </div>
      <ResponsiveSheet open={ticketOpen && bp === 'mobile'} onClose={() => setTicketOpen(false)} title={`Trade ${l.ticker}`}>{ticket}</ResponsiveSheet>
    </div>
  );
}

function priceHistory(d: SecurityDetail): { price: History; fair: History } {
  let carry: number | null = null; const price: History['points'] = [], fair: History['points'] = [];
  for (const h of d.history) { if (h.closeMinor !== null) carry = h.closeMinor; if (carry !== null) price.push({ at: h.gameDate, valueMinor: carry }); if (h.fairMinor !== null) fair.push({ at: h.gameDate, valueMinor: h.fairMinor }); }
  const mk = (points: History['points']): History => ({ currency: 'EC', interval: 'day', points, complete: true });
  return { price: mk(price), fair: mk(fair) };
}

function Overview({ d }: { d: SecurityDetail }) {
  const { price, fair } = useMemo(() => priceHistory(d), [d]);
  const v = d.valuation;
  return (
    <div className="pe-stack">
      {price.points.length > 1 || fair.points.length > 1
        ? <FinancialChart title={`${d.listing.ticker} share price and fundamental estimate`} periodLabel="Last 60 days, daily close (price) vs the company’s estimated value per share" series={[{ key: 'p', label: 'Traded price (last close)', history: price, style: 'price' }, { key: 'f', label: 'Fundamental estimate (not a price)', history: fair, style: 'profit' }]} />
        : <EmptyState title="No price history yet">A price chart appears after a few days of trading.</EmptyState>}
      {v && (
        <section aria-labelledby="val-t" className="pe-card" data-testid="valuation"><h3 id="val-t" className="pe-h3">How the estimate is built <span className="pe-tag-forecast">ESTIMATE</span></h3>
          <dl className="pe-kv">
            <div><dt>Book equity</dt><dd>{ec(v.equityMinor)}</dd></div><div><dt>Earnings value ({String((v.components as { horizonDays?: number }).horizonDays ?? '')} days)</dt><dd>{ec(v.earningsValueMinor, { signed: true })}</dd></div>
            <div><dt>Average daily profit</dt><dd>{ec(v.dailyEarningsMinor, { signed: true })}</dd></div><div><dt>Growth / risk</dt><dd>{formatSignedBps(v.growthBps)} / −{formatBps(v.riskBps)}</dd></div>
            <div><dt>Floor if the company closed</dt><dd>{ec(v.liquidationFloorMinor)}</dd></div><div><dt>Per share</dt><dd><strong>{ec(v.fairValuePerShareMinor)}</strong></dd></div>
          </dl>
          {((v.components as { notes?: string[] }).notes ?? []).map((n) => <p key={n} className="pe-hint">{n}</p>)}
          <p className="pe-hint">{v.basis} Shares can trade above or below it.</p></section>
      )}
      {d.band && <p className="pe-hint" data-testid="band-note">Today’s allowed range: {ec(d.band.lowMinor)} – {ec(d.band.highMinor)} (±{formatBps(d.band.bandBps)} of {ec(d.band.refMinor)}, {d.band.basis === 'close' ? 'the previous close' : d.band.basis === 'offer' ? 'the offer price' : 'the fundamental estimate'}).</p>}
    </div>
  );
}

function Depth({ side, rows, max }: { side: 'bid' | 'ask'; rows: BookLevel[]; max: number }) {
  return (
    <div className="pe-depth-side"><h3>{side === 'bid' ? 'Buyers (bids)' : 'Sellers (asks)'}</h3>
      {rows.length === 0 ? <p className="pe-hint">None</p> : rows.map((r) => <div key={r.priceMinor} className="pe-depth-row" data-side={side === 'bid' ? 'bid' : 'ask'} style={{ ['--w' as string]: `${Math.max(4, (r.shares / max) * 100)}%` }}><span className="pe-financial-number">{ec(r.priceMinor)}</span><span className="pe-financial-number">{formatUnits(r.shares)}</span></div>)}
    </div>
  );
}
function Book({ d }: { d: SecurityDetail }) {
  const max = Math.max(1, ...d.book.bids.map((b) => b.shares), ...d.book.asks.map((a) => a.shares));
  return (
    <div className="pe-stack" data-testid="order-book">
      <div className="pe-depth"><Depth side="bid" rows={d.book.bids} max={max} /><Depth side="ask" rows={d.book.asks} max={max} /></div>
      <h3 className="pe-h3">Recent trades</h3>
      {d.trades.length === 0 ? <p className="pe-hint">No trades yet.</p> : <div className="pe-table-wrap" role="region" aria-label="Recent trades" tabIndex={0}><table className="pe-table pe-small"><thead><tr><th scope="col">Day</th><th scope="col" className="pe-end">Shares</th><th scope="col" className="pe-end">Price</th></tr></thead><tbody>{d.trades.slice(0, 12).map((t) => <tr key={t.id}><td>{dayOf(t.gameDate)}{t.mine ? ' (yours)' : ''}</td><td className="pe-end pe-financial-number">{formatUnits(t.qty)}</td><td className="pe-end pe-financial-number">{ec(t.priceMinor)}</td></tr>)}</tbody></table></div>}
    </div>
  );
}

function Financials({ d }: { d: SecurityDetail }) {
  if (d.financials.length === 0) return <EmptyState title="No reports yet">Daily results appear after the first trading day.</EmptyState>;
  const sum = (k: 'revenueMinor' | 'netProfitMinor') => d.financials.slice(-7).reduce((a, r) => a + r[k], 0);
  return (
    <div className="pe-stack"><dl className="pe-stats"><div><dt>Revenue, last 7 days</dt><dd className="pe-financial-number">{ec(sum('revenueMinor'))}</dd></div><div><dt>Net profit, last 7 days</dt><dd className={`pe-financial-number ${sum('netProfitMinor') >= 0 ? 'pe-pos' : 'pe-neg'}`}>{ec(sum('netProfitMinor'), { signed: true })}</dd></div><div><dt>Cash today</dt><dd className="pe-financial-number">{ec(d.financials.at(-1)!.cashMinor)}</dd></div></dl>
      <div className="pe-table-wrap" role="region" aria-label="Daily results" tabIndex={0}><table className="pe-table pe-small"><caption className="pe-sr">Daily company results</caption><thead><tr><th scope="col">Day</th><th scope="col" className="pe-end">Revenue</th><th scope="col" className="pe-end">Net profit</th><th scope="col" className="pe-end">Cash</th></tr></thead><tbody>{[...d.financials].reverse().map((r) => <tr key={r.tick}><td>{dayOf(r.gameDate)}</td><td className="pe-end pe-financial-number">{ec(r.revenueMinor)}</td><td className={`pe-end pe-financial-number ${r.netProfitMinor >= 0 ? 'pe-pos' : 'pe-neg'}`}>{ec(r.netProfitMinor, { signed: true })}</td><td className="pe-end pe-financial-number">{ec(r.cashMinor)}</td></tr>)}</tbody></table></div>
      <p className="pe-hint">Reported figures come from the company’s own daily books. Profit is after tax.</p></div>
  );
}

function Ownership({ d }: { d: SecurityDetail }) {
  const o = d.ownership; const cls = { minority: 'Minority', significant: 'Significant', substantial: 'Substantial', majority: 'Majority (control)' } as const;
  return (
    <div className="pe-stack" data-testid="ownership">
      <p>{formatUnits(o.outstanding)} shares are in shareholders’ hands{o.treasury > 0 ? `; ${formatUnits(o.treasury)} unsold shares sit in the company’s own treasury and earn no dividend` : ''}. Percentages use the shares in shareholders’ hands.</p>
      <div className="pe-table-wrap" role="region" aria-label="Shareholders" tabIndex={0}><table className="pe-table pe-small"><caption className="pe-sr">Shareholders</caption><thead><tr><th scope="col">Shareholder</th><th scope="col" className="pe-end">Shares</th><th scope="col" className="pe-end">Stake</th><th scope="col">Class</th></tr></thead><tbody>{o.holders.map((h) => <tr key={h.investorId} className={h.mine ? 'pe-rank-me' : ''}><th scope="row">{h.name}{h.mine ? ' (you)' : ''}</th><td className="pe-end pe-financial-number">{formatUnits(h.shares)}{h.reserved ? ` (${formatUnits(h.reserved)} for sale)` : ''}</td><td className="pe-end pe-financial-number">{formatBps(h.stakeBps)}</td><td>{cls[h.stakeClass]}</td></tr>)}</tbody></table></div>
      <div className="pe-card"><h3 className="pe-h3">Control and acquisitions</h3>
        <p>{o.controller ? <><strong>{o.controller.name}</strong> holds {formatBps(o.controller.stakeBps)} and controls this company.</> : 'Nobody holds more than half of the shares, so control stays with the current owner.'}</p>
        <ul className="pe-reasons"><li>Significant stake: {formatBps(o.thresholds.significantBps)} or more. Substantial: {formatBps(o.thresholds.substantialBps)} or more.</li><li>Control passes to whoever holds <strong>more than {formatBps(o.thresholds.majorityBps)}</strong> of the shares. Control means running the company; its cash and assets stay in the company.</li><li>A company cannot own shares in a company that (directly or indirectly) owns it.</li></ul>
        {o.control.length > 0 && <><h4 className="pe-h3">Control changes</h4><ul className="pe-reasons">{o.control.map((c, i) => <li key={i}>{dayOf(c.gameDate)}: {c.to} took control with {formatBps(c.stakeBps)}.</li>)}</ul></>}</div>
    </div>
  );
}

function Dividends({ d, onDone }: { d: SecurityDetail; onDone: () => void }) {
  const { send, pending } = useShareCommand(); const [per, setPer] = useState(''); const [msg, setMsg] = useState<string | null>(null); const [key, setKey] = useState(newIdempotencyKey);
  const cap = d.dividendCapacity; const perMinor = parseDecimalToMinor(per);
  const total = perMinor && cap.eligibleShares ? perMinor * cap.eligibleShares : null;
  const submit = async () => {
    if (!perMinor || perMinor <= 0) { setMsg('Enter an amount per share such as 0.05.'); return; }
    const r = await send({ type: 'dividend.declare', companyId: d.listing.companyId, perShareMinor: perMinor }, { success: 'Dividend declared', failure: 'Dividend refused' }, key);
    setMsg(r.ok ? 'Declared. Shareholders at this moment will be paid from the company treasury on the payment day.' : r.message); if (r.ok) { setKey(newIdempotencyKey()); onDone(); }
  };
  return (
    <div className="pe-stack" data-testid="dividends">
      {d.mine.controlsCompany && d.listing.status !== 'delisted' && (
        <form className="pe-card pe-stack" onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label="Declare a dividend"><h3 className="pe-h3">Declare a dividend</h3>
          <p className="pe-hint">Paid from the company treasury only. It can distribute {ec(cap.capacityMinor)} now (up to {ec(cap.maxPerShareMinor)} a share) and keeps {ec(cap.reserveMinor)} in reserve. Whoever holds shares when you declare is paid, even if they sell afterwards.</p>
          <Field label="Dividend per share (EC)"><input inputMode="decimal" value={per} onChange={(e) => { setPer(e.target.value); setKey(newIdempotencyKey()); }} data-testid="dividend-per-share" /></Field>
          {total !== null && <p className="pe-hint">Total {ec(total)} to {formatUnits(cap.eligibleShares)} shares. You would receive {ec((perMinor ?? 0) * d.mine.shares)}.</p>}
          <Button type="submit" variant="primary" pending={pending} data-testid="dividend-submit">Declare dividend</Button>{msg && <p role="status" className="pe-hint">{msg}</p>}</form>
      )}
      {d.dividends.length === 0 ? <p className="pe-hint">No dividends yet.</p> : <div className="pe-table-wrap" role="region" aria-label="Dividend history" tabIndex={0}><table className="pe-table pe-small"><caption className="pe-sr">Dividend history</caption><thead><tr><th scope="col">Declared</th><th scope="col">Paid</th><th scope="col" className="pe-end">Per share</th><th scope="col" className="pe-end">Total</th><th scope="col">Status</th></tr></thead><tbody>{d.dividends.map((v) => <tr key={v.id}><td>{dayOf(v.declaredGameDate)}</td><td>{dayOf(v.paymentGameDate)}</td><td className="pe-end pe-financial-number">{ec(v.perShareMinor)}</td><td className="pe-end pe-financial-number">{ec(v.totalMinor)}</td><td>{v.status === 'paid' ? 'Paid' : v.status === 'declared' ? 'Declared, awaiting payment' : 'Cancelled'}</td></tr>)}</tbody></table></div>}
      <p className="pe-hint">A declared dividend is not cash until it is paid. Dividends move coins from the company treasury to shareholders; no coin is created.</p>
    </div>
  );
}

function CompanyNews({ d }: { d: SecurityDetail }) {
  if (d.news.length === 0) return <EmptyState title="No news about this company">The Penny Post reports openings, dividends, suspensions and ownership changes as they happen.</EmptyState>;
  return <ul className="pe-news" aria-label="Company news">{d.news.map((n) => <li key={n.id} className="pe-card pe-news-item"><h3 className="pe-h3" style={{ margin: 0 }}>{n.headline}</h3><p className="pe-hint">{dayOf(n.gameDate)}</p><p>{n.body}</p></li>)}</ul>;
}

function MarketNews() {
  const q = useQuery((s) => fetchNews(40, s), [], true);
  if (q.status !== 'ready') return null;
  const items = q.data.articles.filter((a: Article) => MARKET_KINDS.has(a.kind)).slice(0, 8);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="mn-t" className="pe-stack" data-testid="market-news"><h2 id="mn-t" className="pe-h2">Market news</h2>
      <ul className="pe-news">{items.map((a) => <li key={a.id} className="pe-card pe-news-item" data-importance={a.importance}><h3 className="pe-h3" style={{ margin: 0 }}>{a.companyId ? <Link to={`/stocks?c=${a.companyId}`}>{a.headline}</Link> : a.headline}</h3><p className="pe-hint">{dayOf(a.gameDate)} · {a.kind}</p><p>{a.body}</p></li>)}</ul>
    </section>
  );
}

/** Buy/sell ticket: quote → review → confirm. Warnings (control gain/loss, thin book) and refusals come from the server's own rules. */
function Ticket({ d, onDone }: { d: SecurityDetail; onDone: () => void }) {
  const { send, pending } = useShareCommand();
  const l = d.listing; const [side, setSide] = useState<'buy' | 'sell'>('buy'); const [kind, setKind] = useState<'limit' | 'market'>('limit');
  const [qty, setQty] = useState('100'); const [price, setPrice] = useState(((l.bestAskMinor ?? l.priceMinor ?? 100) / 100).toFixed(2)); const [slip, setSlip] = useState('5'); const [days, setDays] = useState('10'); const [ack, setAck] = useState(false);
  const [quote, setQuote] = useState<OrderQuoteDto | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState<string | null>(null); const [key, setKey] = useState(newIdempotencyKey);
  useEffect(() => { setQuote(null); setKey(newIdempotencyKey()); setDone(null); setAck(false); }, [side, kind, qty, price, slip, days, l.companyId]);
  const tradable = l.status === 'open';
  const review = async () => {
    setErr(null); setDone(null); const n = Number(qty), p = parseDecimalToMinor(price);
    if (!/^\d{1,9}$/.test(qty.trim()) || n <= 0) { setErr('Enter a whole number of shares.'); return; }
    if (kind === 'limit' && (p === null || p <= 0)) { setErr('Enter a price such as 0.85.'); return; }
    setBusy(true);
    try { const r = await fetchOrderQuote({ companyId: l.companyId, side, quantity: String(n), kind, ...(kind === 'limit' ? { limitPriceMinor: String(p) } : { slippageBps: String(Math.round(Number(slip) * 100)) }) }); setQuote(r.quote); if (!r.quote.ok) setErr(r.quote.issues[0] ?? 'Not allowed.'); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not get a quote.'); }
    setBusy(false);
  };
  const place = async () => {
    if (!quote?.ok) return;
    const r = await send({ type: 'share.order', companyId: l.companyId, side, quantity: Number(qty), limitPriceMinor: quote.limitPriceMinor, orderKind: kind, slippageBps: kind === 'market' ? Math.round(Number(slip) * 100) : undefined, expiresInTicks: kind === 'limit' ? Number(days) : undefined, acknowledgeControlLoss: ack }, { success: side === 'buy' ? 'Buy order placed' : 'Sell order placed', failure: 'Order not placed' }, key);
    if (r.ok) { const x = r.data as { filled: number; remaining: number; averagePriceMinor: number | null } | undefined; setDone(x ? `${x.filled > 0 ? `${formatUnits(x.filled)} shares traded at ${ec(x.averagePriceMinor)} on average. ` : 'Nothing traded yet. '}${x.remaining > 0 && kind === 'limit' ? `${formatUnits(x.remaining)} wait on the book until filled, cancelled or expired.` : ''}` : 'Order placed.'); setQuote(null); setKey(newIdempotencyKey()); onDone(); } else setErr(r.message);
  };
  const cancel = async (id: number) => { await send({ type: 'share.cancel', orderId: id }, { success: 'Order cancelled', failure: 'Could not cancel' }); onDone(); };
  const needsAck = quote?.warnings.some((w) => /give up your majority/i.test(w)) ?? false;
  return (
    <div className="pe-ticket-box" data-testid="share-ticket">
      <h3 className="pe-h3" style={{ margin: 0 }}>Trade {l.ticker}</h3>
      {!tradable && <p className="pe-callout" role="note"><span>{l.status === 'suspended' ? 'Trading is suspended.' : 'This company is not open for trading.'} You can still cancel resting orders below.</span></p>}
      <div className="pe-seg" role="group" aria-label="Side">{(['buy', 'sell'] as const).map((s) => <button key={s} type="button" data-side={s} aria-pressed={side === s} onClick={() => setSide(s)} data-testid={`share-side-${s}`}>{s === 'buy' ? 'Buy' : 'Sell'}</button>)}</div>
      <div className="pe-seg" role="group" aria-label="Order type"><button type="button" aria-pressed={kind === 'limit'} onClick={() => setKind('limit')}>Limit</button><button type="button" aria-pressed={kind === 'market'} onClick={() => setKind('market')} data-testid="share-kind-market">Market (protected)</button></div>
      <p className="pe-hint">Cash available {ec(d.mine.cashAvailableMinor)} · you own {formatUnits(d.mine.shares)}{d.mine.reservedShares ? ` (${formatUnits(d.mine.reservedShares)} already offered)` : ''}{d.mine.avgCostMinor ? ` · average cost ${ec(d.mine.avgCostMinor)}` : ''}</p>
      <Field label="Shares (whole)"><input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="share-qty" disabled={!tradable} /></Field>
      {kind === 'limit' ? <>
        <Field label={`${side === 'buy' ? 'Highest' : 'Lowest'} price per share (EC)`} hint={d.band ? `Allowed today: ${ec(d.band.lowMinor)} – ${ec(d.band.highMinor)}` : undefined}><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="share-price" disabled={!tradable} /></Field>
        <Field label="Order lasts (days)" hint={`Up to ${d.rules.maxOrderDays}.`}><input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} disabled={!tradable} /></Field></>
        : <Field label="Price protection (%)" hint="Trades only within this margin of the best price on the other side; anything unfilled is cancelled."><input inputMode="decimal" value={slip} onChange={(e) => setSlip(e.target.value)} disabled={!tradable} /></Field>}
      {err && <p className="pe-field-error" role="alert" data-testid="share-error">{err}</p>}
      <Button onClick={() => void review()} pending={busy} disabled={!tradable} data-testid="share-review">Review order</Button>
      {done && <p className="pe-callout" role="status" data-testid="share-outcome">{done}</p>}
      {quote?.ok && (
        <section aria-label="Order review" className="pe-stack" data-testid="share-quote">
          <dl className="pe-review"><dt>{side === 'buy' ? 'Highest price' : 'Lowest price'}</dt><dd>{ec(quote.limitPriceMinor)}</dd><dt>Shares</dt><dd>{formatUnits(Number(qty))}</dd>
            <dt>Best price on the other side</dt><dd>{ec(quote.bestOppositeMinor)}</dd>{side === 'buy' ? <><dt className="pe-total">Coins reserved</dt><dd className="pe-total">{ec(quote.reserveMinor)}</dd></> : <><dt>Fee if fully sold ({formatBps(d.rules.feeBps)})</dt><dd>{ec(quote.estimatedFeeMinor)}</dd></>}</dl>
          {quote.warnings.map((w) => <p key={w} className="pe-callout" role="note"><Icon name="warning" size={16} /><span>{w}</span></p>)}
          {needsAck && <label className="pe-check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="ack-control" /> I understand I would lose control of this company.</label>}
          <p className="pe-hint">Market value is an estimate. Only completed sales and paid dividends put Empire Coins in your wallet.</p>
          <Button variant="primary" block pending={pending} disabled={needsAck && !ack} onClick={() => void place()} data-testid="share-confirm">Confirm {side === 'buy' ? 'purchase' : 'sale'} order</Button>
        </section>
      )}
      {d.mine.openOrders.length > 0 && (
        <section aria-label="Your open orders" className="pe-stack"><h4 className="pe-h3">Your open orders</h4>
          <ul className="pe-list">{d.mine.openOrders.map((o) => <li key={o.id} className="pe-list-row"><span>{o.side === 'buy' ? 'Buy' : 'Sell'} {formatUnits(o.remaining)}/{formatUnits(o.original)} @ {ec(o.priceMinor)}</span><Button variant="ghost" onClick={() => void cancel(o.id)} aria-label={`Cancel order ${o.id}`}>Cancel</Button></li>)}</ul></section>
      )}
    </div>
  );
}
