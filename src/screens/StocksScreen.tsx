import { useState } from 'react';
import { useBreakpoint } from '@/app/useBreakpoint';
import type { Holding, Listing } from '@/contracts/game-state';
import { formatMoney, formatSignedBps, formatUnits } from '@/domain/money';
import { Button } from '@/ui/Button';
import { DataTable } from '@/ui/DataTable';
import { FinancialChart } from '@/ui/FinancialChart';
import { MoneyValue } from '@/ui/MoneyValue';
import { ResponsiveSheet } from '@/ui/ResponsiveSheet';
import { ScreenData } from '@/ui/ScreenData';
import { EmptyState } from '@/ui/States';
import { StatusLabel } from '@/ui/StatusLabel';
import { TradeTicket } from '@/ui/TradeTicket';

export function StocksScreen() {
  return <ScreenData screen="stocks" title="Stock Exchange">{(d) => <StocksView listings={d.listings.items} holdings={d.holdings} />}</ScreenData>;
}

function StocksView({ listings, holdings }: { listings: Listing[]; holdings: Holding[] }) {
  const bp = useBreakpoint();
  const [selectedId, setSelectedId] = useState(listings.find((l) => l.tradable)?.id ?? listings[0]?.id ?? '');
  const [ticketOpen, setTicketOpen] = useState(false);
  const l = listings.find((x) => x.id === selectedId);
  if (!l) return <EmptyState title="No companies are listed">Fictional listings will appear here.</EmptyState>;
  const ticket = <TradeTicket kind="shares" entityId={l.id} entityName={l.companyName} cityId="city-bristol" referenceMinor={l.price.minor} currency="EC" tradable={l.tradable} untradableReason="State enterprises are shown for information; they are not tradable in pre-alpha." />;
  return (
    <div className="pe-market">
      <p className="pe-callout pe-market-note" role="note">All companies and shares are fictional and use Empire Coins (EC) only. Shares cannot be redeemed for money.</p>
      <section aria-labelledby="ls-t" className="pe-market-list">
        <h2 id="ls-t" className="pe-h2">Listings</h2>
        <ListingList listings={listings} selectedId={selectedId} onSelect={setSelectedId} />
      </section>
      <section aria-labelledby="fn-t" className="pe-market-book">
        <div className="pe-detail-head"><div><h2 id="fn-t" className="pe-h2">{l.companyName}</h2><p className="pe-insp-tags">{l.ownerKind === 'state' && <StatusLabel tone="accent">State enterprise</StatusLabel>}{!l.tradable && <StatusLabel tone="warning">Not tradable</StatusLabel>}</p></div>
          {bp === 'mobile' && <Button variant="primary" onClick={() => setTicketOpen(true)}>Trade shares</Button>}</div>
        <CompanyFundamentals l={l} />
        <FinancialChart title={`${l.companyName} share price`} periodLabel="Last 7 days, daily" series={[{ key: 'p', label: 'Share price', history: l.history, style: 'price' }]} />
      </section>
      {bp !== 'mobile' && <aside className="pe-market-ticket" aria-label="Share ticket">{ticket}</aside>}
      <ResponsiveSheet open={ticketOpen && bp === 'mobile'} onClose={() => setTicketOpen(false)} title={`Trade ${l.companyName}`}>{ticket}</ResponsiveSheet>
      <section aria-labelledby="hd-t" className="pe-market-own"><h2 id="hd-t" className="pe-h2">Your holdings</h2><HoldingsTable holdings={holdings} listings={listings} /></section>
    </div>
  );
}

function ListingList({ listings, selectedId, onSelect }: { listings: Listing[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <DataTable caption="Fictional company listings" rowKey={(l) => l.id} rows={listings} rowAction={{ label: (l) => `Select ${l.companyName}`, onSelect: (l) => onSelect(l.id), selected: (l) => l.id === selectedId }}
      columns={[
        { key: 'n', header: 'Company', render: (l) => l.companyName },
        { key: 'p', header: 'Price', align: 'end', render: (l) => <MoneyValue value={l.price} fixed tone="neutral" /> },
        { key: 'c', header: 'Change', align: 'end', render: (l) => <span className={l.changeBps > 0 ? 'pe-pos' : l.changeBps < 0 ? 'pe-neg' : ''}>{formatSignedBps(l.changeBps)}</span> },
        { key: 'd', header: 'Dividend / share', align: 'end', render: (l) => <MoneyValue value={l.dividendPerShare} fixed tone="neutral" /> },
      ]} />
  );
}

function CompanyFundamentals({ l }: { l: Listing }) {
  return (
    <dl className="pe-stats pe-stats--wide">
      <div><dt>Market cap</dt><dd><MoneyValue value={l.marketCap} tone="neutral" /></dd></div>
      <div><dt>Revenue / day</dt><dd><MoneyValue value={l.revenue} tone="neutral" /></dd></div>
      <div><dt>Profit / day</dt><dd><MoneyValue value={l.profit} signed /></dd></div>
      <div><dt>Shares outstanding</dt><dd className="pe-financial-number">{formatUnits(l.outstandingShares)}</dd></div>
      <div><dt>Next dividend</dt><dd>{l.nextDividendAt ? new Date(l.nextDividendAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'None scheduled'}</dd></div>
    </dl>
  );
}

export function HoldingsTable({ holdings, listings }: { holdings: Holding[]; listings: Listing[] }) {
  const name = (id: string) => listings.find((l) => l.id === id)?.companyName ?? id;
  return (
    <DataTable caption="Your share holdings" rowKey={(h) => h.listingId} rows={holdings} empty={<EmptyState title="You hold no shares yet">Pick a listing and request a quote to start.</EmptyState>}
      columns={[
        { key: 'n', header: 'Company', render: (h) => name(h.listingId) },
        { key: 's', header: 'Shares', align: 'end', render: (h) => `${formatUnits(h.shares)}${h.reservedShares ? ` (${formatUnits(h.reservedShares)} reserved)` : ''}` },
        { key: 'v', header: 'Value', align: 'end', render: (h) => <MoneyValue value={h.value} tone="neutral" /> },
        { key: 'p', header: 'Unrealised P&L', align: 'end', render: (h) => <MoneyValue value={h.unrealizedPnl} signed /> },
        { key: 'd', header: 'Dividends', align: 'end', render: (h) => formatMoney(h.dividendsReceived) },
      ]} />
  );
}
