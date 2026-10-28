import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBreakpoint } from '@/app/useBreakpoint';
import { commodityIconUrl } from '@/assets/artAssets';
import { fetchCommodity, fetchContracts, fetchDirectory, type CommodityView, type ContractDto, type DirectoryRow, type OwnOrder } from '@/data/exchangeClient';
import { useQuery } from '@/data/managementApi';
import { newIdempotencyKey, useCommand } from '@/data/useCommand';
import { commodityLabel } from '@/domain/labels';
import { formatBps, formatMoney, formatUnits } from '@/domain/money';
import { Button } from '@/ui/Button';
import { FinancialChart } from '@/ui/FinancialChart';
import { Icon } from '@/ui/Icon';
import { ResponsiveSheet } from '@/ui/ResponsiveSheet';
import { EmptyState, ErrorState, Skeleton } from '@/ui/States';
import { StatusLabel } from '@/ui/StatusLabel';
import { Tip } from '../company/panels';
import { ContractForm } from './ContractSheet';
import { OrderTicket, type TicketDefaults } from './OrderTicket';

const ec = (m: number | null | undefined) => (m === null || m === undefined ? '—' : formatMoney({ currency: 'EC', minor: m }));
const CommodityIcon = ({ id, size = 32 }: { id: string; size?: number }) => { const u = commodityIconUrl(id); return u ? <img src={u} width={size} height={size} alt="" /> : <Icon name="inventory" size={size} />; };
const statusPill = (r: DirectoryRow) => r.status === 'shortage' ? <span className="pe-pill" data-tone="short">Shortage {formatUnits(r.shortageUnits)}</span> : r.status === 'surplus' ? <span className="pe-pill" data-tone="surplus">Surplus {formatUnits(r.surplusUnits)}</span> : r.status === 'no-market' ? <span className="pe-pill">No market</span> : <span className="pe-pill" data-tone="ok">Balanced</span>;

/** The Penny Exchange terminal: every number comes from the server's order book, trades and ledger. */
export function ExchangeScreen() {
  const [params, setParams] = useSearchParams();
  const bp = useBreakpoint();
  const dir = useQuery((s) => fetchDirectory(s), []);
  const wanted = params.get('commodity');
  const rows = dir.status === 'ready' ? dir.data.commodities : [];
  const selected = rows.find((r) => r.commodityId === wanted) ?? rows.find((r) => r.status === 'shortage') ?? rows[0];
  const [ticket, setTicket] = useState<TicketDefaults | undefined>();
  const [sheet, setSheet] = useState<'ticket' | 'contract' | null>(null);
  const [version, setVersion] = useState(0);
  const view = useQuery((s) => (selected ? fetchCommodity(selected.commodityId, s) : Promise.reject(new Error('none'))), [selected?.commodityId, version]);
  const contracts = useQuery((s) => fetchContracts(s), [version]);
  const refresh = () => { setVersion((v) => v + 1); dir.reload(); };
  if (dir.status === 'loading') return <div className="pe-screen"><h1 className="pe-h1">Commodity Exchange</h1><Skeleton lines={8} label="Loading the exchange" /></div>;
  if (dir.status === 'error') return <div className="pe-screen"><h1 className="pe-h1">Commodity Exchange</h1><ErrorState title="Exchange unavailable" message={dir.error} onRetry={dir.reload} /></div>;
  if (!selected) return <div className="pe-screen"><h1 className="pe-h1">Commodity Exchange</h1><EmptyState title="Nothing is traded yet">The exchange has no commodities.</EmptyState></div>;
  const v = view.status === 'ready' ? view.data : null;
  const choose = (id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('commodity', id); return n; }, { replace: true });
  const defaultsFor = (d: TicketDefaults) => { setTicket({ ...d, companyId: d.companyId ?? params.get('company') ?? undefined }); if (bp !== 'desktop') setSheet('ticket'); };
  const ticketEl = v && selected.channel === 'retail' ? <div className="pe-ticket-box" data-testid="retail-note"><h3 className="pe-h3" style={{ margin: 0 }}>Sold over the counter</h3><p className="pe-hint">{commodityLabel(selected.commodityId)} goes straight to consumers (or the city), not through the exchange, so there is nothing to bid on. Its price is your shelf price: change it, quality and marketing from the company page.</p><Link className="pe-btn pe-btn--primary" to="/companies">Manage companies</Link></div> : v ? <OrderTicket key={selected.commodityId} commodityId={selected.commodityId} name={commodityLabel(selected.commodityId)} unit={selected.unitLabel} referenceMinor={selected.referencePriceMinor} bestAskMinor={selected.bestAskMinor} bestBidMinor={selected.bestBidMinor} holdings={v.holdings} defaults={ticket ?? (params.get('company') ? { companyId: params.get('company')! } : undefined)} onPlaced={refresh} /> : <Skeleton lines={6} label="Loading ticket" />;
  return (
    <div className="pe-screen">
      <div className="pe-screen-head"><h1 className="pe-h1">Commodity Exchange</h1><span className="pe-live">Bristol market · real orders, real trades</span></div>
      <div className="pe-ex" data-testid="exchange">
        <nav className="pe-ex-list" aria-label="Commodities">
          {rows.map((r) => (
            <button key={r.commodityId} type="button" className="pe-ex-row" aria-pressed={r.commodityId === selected.commodityId} onClick={() => choose(r.commodityId)} data-testid={`pick-${r.commodityId}`}>
              <CommodityIcon id={r.commodityId} />
              <span className="pe-ex-name"><strong>{commodityLabel(r.commodityId)}</strong><small>{ec(r.lastTradePriceMinor ?? r.referencePriceMinor)}{r.basis === 'reference' ? ' (ref.)' : ''} · <span className={r.changeBps > 0 ? 'pe-pos' : r.changeBps < 0 ? 'pe-neg' : ''}>{r.changeBps > 0 ? '+' : ''}{formatBps(r.changeBps)}</span></small></span>
              {r.status !== 'balanced' && r.status !== 'no-market' && <span className="pe-pill" data-tone={r.status === 'shortage' ? 'short' : 'surplus'}>{r.status === 'shortage' ? 'Short' : 'Surplus'}</span>}
            </button>))}
        </nav>
        <div className="pe-ex-main">
          <MarketHeader r={selected} />
          {bp !== 'desktop' && (selected.channel === 'retail' ? ticketEl : <Button variant="primary" block onClick={() => setSheet('ticket')} data-testid="open-ticket">Trade {commodityLabel(selected.commodityId)}</Button>)}
          {view.status === 'error' ? <ErrorState title="Couldn't load this market" message={view.error} onRetry={view.reload} /> : !v ? <Skeleton lines={8} label="Loading market" /> : (
            <>
              <Depth v={v} unit={selected.unitLabel} onPick={(side, price) => defaultsFor({ side, limitMinor: price, qty: 10 })} />
              <History v={v} name={commodityLabel(selected.commodityId)} />
              <Suppliers v={v} row={selected} onBuy={(sup) => defaultsFor({ side: 'buy', limitMinor: sup.askMinor, qty: Math.min(20, sup.units), fromCompanyId: sup.companyId, fromName: sup.name })} onContract={() => setSheet('contract')} />
              <OrdersPanel orders={v.orders} onChanged={refresh} /><TradesPanel v={v} />
            </>
          )}
          {contracts.status === 'ready' && <ContractsPanel contracts={contracts.data.contracts} onChanged={refresh} onNew={() => setSheet('contract')} />}
        </div>
        {bp === 'desktop' && <aside className="pe-ex-side" aria-label="Order ticket">{ticketEl}<ChainStrip rows={rows} onPick={choose} /></aside>}
      </div>
      <ResponsiveSheet open={sheet === 'ticket' && bp !== 'desktop'} onClose={() => setSheet(null)} title={`Trade ${commodityLabel(selected.commodityId)}`}>{ticketEl}</ResponsiveSheet>
      <ResponsiveSheet open={sheet === 'contract'} onClose={() => setSheet(null)} title={`Supply contract: ${commodityLabel(selected.commodityId)}`}>
        {v && <ContractForm commodityId={selected.commodityId} unit={selected.unitLabel} options={v.contractOptions} holdings={v.holdings} onDone={() => { refresh(); }} />}
      </ResponsiveSheet>
    </div>
  );
}

function MarketHeader({ r }: { r: DirectoryRow }) {
  return (
    <section aria-labelledby="mk-t" className="pe-stack">
      <div className="pe-ex-head"><CommodityIcon id={r.commodityId} size={48} /><div><h2 id="mk-t" className="pe-h2" style={{ margin: 0 }}>{commodityLabel(r.commodityId)} in Bristol</h2><p className="pe-hint">{statusPill(r)} {r.status === 'shortage' ? `Estimated demand exceeds listed supply by ${formatUnits(r.shortageUnits)} per day: a chance for suppliers.` : r.status === 'surplus' ? 'More is listed than the city needs: expect falling prices.' : ''}</p></div></div>
      <dl className="pe-stats pe-stats--wide" data-testid="market-stats">
        <div><dt>Last executed price <Tip>The price of the most recent real trade. If nothing has traded, the reference price is shown instead and labelled.</Tip></dt><dd>{ec(r.lastTradePriceMinor ?? r.referencePriceMinor)}{r.basis === 'reference' ? ' (reference)' : ''}</dd></div>
        <div><dt>Best buy price (bid) <Tip>The highest price anyone is currently offering to pay.</Tip></dt><dd>{ec(r.bestBidMinor)}</dd></div>
        <div><dt>Best sell price (ask) <Tip>The lowest price anyone is currently asking.</Tip></dt><dd>{ec(r.bestAskMinor)}</dd></div>
        <div><dt>Average price, 7 days</dt><dd>{ec(r.vwap7dMinor)}</dd></div>
        <div><dt>Traded today / 7 days</dt><dd>{formatUnits(r.volumeToday)} / {formatUnits(r.volume7d)}</dd></div>
        <div><dt>{r.channel === 'retail' ? 'On shop shelves now' : 'Listed for sale now'}</dt><dd>{formatUnits(r.channel === 'retail' ? r.listedUnits : r.listedUnits)}</dd></div>
        <div><dt>Estimated demand / day <Tip>ESTIMATE: what consumers' funded budgets and companies' production plans want per day.</Tip></dt><dd>{formatUnits(r.demandUnitsPerDay)}</dd></div>
        <div><dt>Sold under contract today</dt><dd>{formatUnits(r.contractUnitsToday)}</dd></div>
      </dl>
    </section>
  );
}

function Depth({ v, unit, onPick }: { v: CommodityView; unit: string; onPick: (side: 'buy' | 'sell', price: number) => void }) {
  const { asks, bids } = v.detail;
  const cum = (levels: typeof asks) => { let t = 0; return levels.map((l) => ({ ...l, cum: (t += l.units) })); };
  const a = cum(asks), b = cum(bids); const max = Math.max(1, a.at(-1)?.cum ?? 0, b.at(-1)?.cum ?? 0);
  const col = (rows: ReturnType<typeof cum>, side: 'ask' | 'bid') => rows.length === 0 ? <p className="pe-hint">{side === 'ask' ? 'Nobody is selling right now.' : 'Nobody is bidding right now.'}</p> : rows.map((l) => (
    <button key={l.priceMinor} type="button" className="pe-depth-row" data-side={side} style={{ ['--w' as string]: `${(l.cum / max) * 100}%` }} onClick={() => onPick(side === 'ask' ? 'buy' : 'sell', l.priceMinor)} aria-label={`${side === 'ask' ? 'Buy from' : 'Sell to'} the ${ec(l.priceMinor)} level: ${l.units} ${unit}s listed, ${l.cum} cumulative`}>
      <span className="pe-financial-number">{ec(l.priceMinor)}</span><span>{formatUnits(l.units)} · Σ {formatUnits(l.cum)}</span>
    </button>));
  return (
    <section aria-labelledby="dp-t"><h2 id="dp-t" className="pe-h3">Order book depth <Tip>Listed prices are what people ASK or BID; they are not trades. Bars show cumulative units. Orders fill best price first, then oldest first. Tap a level to prefill the ticket.</Tip></h2>
      <div className="pe-depth" data-testid="depth">
        <div className="pe-depth-side"><h3>Sell orders (asks)</h3>{col(a, 'ask')}</div>
        <div className="pe-depth-side"><h3>Buy orders (bids)</h3>{col(b, 'bid')}</div>
      </div>
      <p className="pe-legend"><span><b>Listed</b> = resting orders</span><span><b>Executed</b> = real trades (below)</span><span><b>Reserved</b> = locked by open orders</span></p>
    </section>
  );
}

function History({ v, name }: { v: CommodityView; name: string }) {
  const h = v.detail.history;
  const mk = (pick: (r: (typeof h)[number]) => number | null) => ({ currency: 'EC' as const, interval: 'day' as const, complete: h.every((r) => pick(r) !== null), points: h.filter((r) => pick(r) !== null).map((r) => ({ at: r.gameDate, valueMinor: pick(r)! })) });
  const vwap = mk((r) => r.vwap), ask = mk((r) => r.bestAsk);
  return (
    <section aria-labelledby="ph-t"><h2 id="ph-t" className="pe-h3">{name} price history</h2>
      {vwap.points.length === 0 && ask.points.length === 0 ? <p className="pe-hint">No history yet: statistics are recorded at the end of each day.</p> : (
        <div className="pe-table-scroll"><FinancialChart title={`${name}: average executed price and best listed price`} periodLabel="Last 30 days, daily (days without trades are gaps, not zeros)" series={[{ key: 'v', label: 'Average executed price', history: vwap, style: 'price' }, { key: 'a', label: 'Best listed sell price', history: ask, style: 'expense' }]} /></div>)}
      <div className="pe-table-scroll"><table className="pe-table pe-small" aria-label="Daily market statistics">
        <thead><tr><th scope="col">Day</th><th scope="col" className="pe-num">Traded</th><th scope="col" className="pe-num">Avg price</th><th scope="col" className="pe-num">Low–High</th><th scope="col" className="pe-num">Listed</th><th scope="col" className="pe-num">Est. demand</th></tr></thead>
        <tbody>{[...h].reverse().slice(0, 7).map((r) => <tr key={r.tick}><td>{new Date(r.gameDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</td><td className="pe-financial-number">{formatUnits(r.volume)}</td><td className="pe-financial-number">{ec(r.vwap)}</td><td className="pe-financial-number">{r.low === null ? '—' : `${ec(r.low)}–${ec(r.high)}`}</td><td className="pe-financial-number">{formatUnits(r.listed)}</td><td className="pe-financial-number">{formatUnits(r.demand)}</td></tr>)}</tbody>
      </table></div>
    </section>
  );
}

function Suppliers({ v, row, onBuy, onContract }: { v: CommodityView; row: DirectoryRow; onBuy: (s: { companyId: string; name: string; askMinor: number; units: number }) => void; onContract: () => void }) {
  const mine = new Set(v.holdings.map((h) => h.companyId));
  return (
    <section aria-labelledby="sp-t"><h2 id="sp-t" className="pe-h3">Compare suppliers <Tip>Everyone with goods listed for sale, cheapest first. Track record comes from real trades and contract deliveries in the last 7 days; “n/a” means no data yet.</Tip></h2>
      {v.detail.suppliers.length === 0 ? <EmptyState title="Nobody is selling">No supplier has {commodityLabel(row.commodityId)} listed right now.</EmptyState> : (
        <div className="pe-table-scroll"><table className="pe-table" aria-label="Suppliers" data-testid="suppliers">
          <thead><tr><th scope="col">Supplier</th><th scope="col">Type</th><th scope="col" className="pe-num">Price</th><th scope="col" className="pe-num">Available</th><th scope="col" className="pe-num">Sold (7d)</th><th scope="col" className="pe-num">Contract deliveries (7d)</th><th scope="col"><span className="pe-sr">Action</span></th></tr></thead>
          <tbody>{v.detail.suppliers.map((s) => (
            <tr key={s.companyId}><th scope="row">{s.name}{mine.has(s.companyId) ? ' (you)' : ''}</th><td>{s.ownerKind === 'state' ? 'State supplier' : s.ownerKind === 'npc' ? 'NPC company' : 'Player'}</td>
              <td className="pe-financial-number">{ec(s.askMinor)}</td><td className="pe-financial-number">{formatUnits(s.units)}</td><td className="pe-financial-number">{formatUnits(s.sold7d)}</td>
              <td className="pe-financial-number">{s.delivered7d + s.missed7d === 0 ? 'n/a' : `${s.delivered7d} ok · ${s.missed7d} missed`}</td>
              <td>{mine.has(s.companyId) ? <span className="pe-hint">your listing</span> : <Button variant="primary" onClick={() => onBuy(s)} aria-label={`Buy ${commodityLabel(row.commodityId)} from ${s.name} at ${ec(s.askMinor)}`}>Buy</Button>}</td></tr>))}</tbody>
        </table></div>)}
      <div className="pe-row"><Button onClick={onContract} data-testid="open-contract"><Icon name="contract" size={18} /> Set up a supply contract</Button></div>
    </section>
  );
}

function OrdersPanel({ orders, onChanged }: { orders: OwnOrder[]; onChanged: () => void }) {
  const { send, pending } = useCommand();
  const open = orders.filter((o) => o.status === 'open' || o.status === 'partial');
  const ended = orders.filter((o) => !(o.status === 'open' || o.status === 'partial')).slice(0, 6);
  const row = (o: OwnOrder) => (
    <tr key={o.id}><td>{o.side === 'buy' ? 'Buy' : 'Sell'}{o.kind === 'market' ? ' (market)' : ''}</td><th scope="row">{o.companyName}</th><td className="pe-financial-number">{ec(o.priceMinor)}</td><td className="pe-financial-number">{formatUnits(o.unitsFilled)} of {formatUnits(o.unitsOriginal)}{o.avgFillMinor !== null ? ` @ ${ec(o.avgFillMinor)}` : ''}</td>
      <td className="pe-financial-number">{o.side === 'buy' ? ec(o.reservedFundsMinor) : `${formatUnits(o.reservedUnits)} units`}</td>
      <td><StatusLabel tone={o.status === 'partial' ? 'warning' : o.status === 'filled' ? 'positive' : 'neutral'}>{o.status === 'partial' ? 'Partly filled' : o.status === 'expired' ? 'Expired' : o.status[0]!.toUpperCase() + o.status.slice(1)}</StatusLabel>{o.expiresTick !== null && (o.status === 'open' || o.status === 'partial') ? <span className="pe-hint"> expires day {o.expiresTick}</span> : null}</td>
      <td>{(o.status === 'open' || o.status === 'partial') && <Button disabled={pending} data-testid={`cancel-${o.id}`} aria-label={`Cancel the remaining ${o.unitsRemaining} units of order ${o.id}`} onClick={async () => { await send({ type: 'order.cancel', orderId: String(o.id) }, { idempotencyKey: newIdempotencyKey(), expectedRevision: 0 }, { success: 'Order cancelled; reservation released', failure: 'Order not cancelled' }); onChanged(); }}>Cancel remainder</Button>}</td></tr>);
  return (
    <section aria-labelledby="oo-t"><h2 id="oo-t" className="pe-h3">Your orders on this market</h2>
      {orders.length === 0 ? <EmptyState title="No orders yet">Orders you place appear here with their reservations.</EmptyState> : (
        <div className="pe-table-scroll"><table className="pe-table pe-small" aria-label="Your orders" data-testid="own-orders">
          <thead><tr><th scope="col">Side</th><th scope="col">Company</th><th scope="col" className="pe-num">Limit</th><th scope="col" className="pe-num">Filled</th><th scope="col" className="pe-num">Reserved</th><th scope="col">Status</th><th scope="col"><span className="pe-sr">Action</span></th></tr></thead>
          <tbody>{[...open, ...ended].map(row)}</tbody></table></div>)}
    </section>
  );
}

function TradesPanel({ v }: { v: CommodityView }) {
  return (
    <section aria-labelledby="tr-t"><h2 id="tr-t" className="pe-h3">Your confirmed trades <Tip>Executed trades only. Each one moved real goods and coins through the ledger; sellers pay the exchange fee.</Tip></h2>
      {v.trades.length === 0 ? <EmptyState title="No trades yet">Confirmed trades are listed here.</EmptyState> : (
        <div className="pe-table-scroll"><table className="pe-table pe-small" aria-label="Your trades" data-testid="own-trades">
          <thead><tr><th scope="col">Day</th><th scope="col">You</th><th scope="col">Counterparty</th><th scope="col" className="pe-num">Units</th><th scope="col" className="pe-num">Price</th><th scope="col" className="pe-num">Fee</th><th scope="col" className="pe-num">Net</th></tr></thead>
          <tbody>{v.trades.map((t) => <tr key={t.id}><td>{new Date(t.gameDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</td><td>{t.role === 'bought' ? 'Bought' : 'Sold'}</td><th scope="row">{t.counterparty}</th><td className="pe-financial-number">{formatUnits(t.qty)}</td><td className="pe-financial-number">{ec(t.priceMinor)}</td><td className="pe-financial-number">{ec(t.feeMinor)}</td><td className={`pe-financial-number ${t.netMinor >= 0 ? 'pe-pos' : 'pe-neg'}`}>{t.netMinor >= 0 ? '+' : '−'}{ec(Math.abs(t.netMinor))}</td></tr>)}</tbody></table></div>)}
    </section>
  );
}

function ContractsPanel({ contracts, onChanged, onNew }: { contracts: ContractDto[]; onChanged: () => void; onNew: () => void }) {
  const { send, pending } = useCommand();
  return (
    <section aria-labelledby="ct-t"><h2 id="ct-t" className="pe-h3">Supply contracts <Tip>Recurring deliveries on fixed terms. Each delivery is its own atomic settlement. Cancellation takes effect after the notice period.</Tip></h2>
      {contracts.length === 0 ? <EmptyState title="No contracts yet" action={<Button onClick={onNew}>Set up a supply contract</Button>}>Lock in a supplier or a customer for steady deliveries.</EmptyState> : (
        <ul className="pe-list" data-testid="contracts">{contracts.map((k) => (
          <li key={k.id} className="pe-list-row" style={{ alignItems: 'flex-start' }}>
            <div className="pe-stack" style={{ gap: 4 }}>
              <strong>{k.role === 'buyer' ? `Buying ${commodityLabel(k.commodityId)} from ${k.supplierName}` : `Supplying ${commodityLabel(k.commodityId)} to ${k.buyerName}`}</strong>
              <span className="pe-hint">{formatUnits(k.qtyPerDelivery)} every {k.everyTicks} day(s) at {ec(k.priceMinor)} · {new Date(k.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}–{new Date(k.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} · {k.delivered} delivered, {k.missed} missed · {ec(k.totalPaidMinor)} settled</span>
              {k.status === 'active' && k.upcoming.length > 0 && <span className="pe-hint">Next: {k.upcoming.slice(0, 3).map((u) => `${new Date(u.gameDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} (${ec(u.grossMinor)})`).join(', ')}</span>}
              {k.cancelEffectiveTick !== null && k.status === 'active' && <span className="pe-hint">Cancellation takes effect on day {k.cancelEffectiveTick}.</span>}
              {k.reason && <span className="pe-hint">{k.reason}</span>}
              {k.history.length > 0 && <span className="pe-hint">Recent: {k.history.slice(0, 4).map((h) => `${new Date(h.gameDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${h.status === 'delivered' ? 'delivered' : 'missed'}`).join(' · ')}</span>}
            </div>
            <div className="pe-row"><StatusLabel tone={k.status === 'active' ? 'positive' : k.status === 'pending' ? 'warning' : 'neutral'}>{k.status[0]!.toUpperCase() + k.status.slice(1)}</StatusLabel>
              {(k.status === 'active' && k.cancelEffectiveTick === null || k.status === 'pending') && <Button disabled={pending} data-testid={`cancel-contract-${k.id}`} onClick={async () => { await send({ type: 'contract.cancel', contractId: k.id }, { idempotencyKey: newIdempotencyKey(), expectedRevision: 0 }, { success: k.status === 'pending' ? 'Offer withdrawn' : `Cancellation scheduled (${k.noticeTicks} days' notice)`, failure: 'Could not cancel' }); onChanged(); }}>Cancel</Button>}</div>
          </li>))}</ul>)}
    </section>
  );
}

/** Wheat → flour → pizza: the live supply chain, with each market's shortage status. */
function ChainStrip({ rows, onPick }: { rows: DirectoryRow[]; onPick: (id: string) => void }) {
  const by = new Map(rows.map((r) => [r.commodityId, r]));
  const nodes = ['wheat', 'flour', 'pizza'].map((id) => by.get(id)).filter((x): x is DirectoryRow => !!x);
  return (
    <section aria-label="Supply chain" className="pe-ticket-box"><h3 className="pe-h3" style={{ margin: 0 }}>Bristol supply chain</h3>
      <div className="pe-chain">{nodes.map((n, i) => (<span key={n.commodityId} style={{ display: 'contents' }}>
        {i > 0 && <span className="pe-chain-arrow" aria-hidden="true"><Icon name="arrow" size={18} /></span>}
        <button type="button" className="pe-chain-node pe-ex-row" onClick={() => onPick(n.commodityId)}><CommodityIcon id={n.commodityId} size={28} /><strong>{commodityLabel(n.commodityId)}</strong><small>{ec(n.lastTradePriceMinor ?? n.referencePriceMinor)}</small>{statusPill(n)}</button></span>))}</div>
      <p className="pe-hint">Mills buy wheat, pizza restaurants buy flour and cheese. A gap at one link starves the next.</p>
    </section>
  );
}
