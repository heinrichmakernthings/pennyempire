import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBreakpoint } from '@/app/useBreakpoint';
import type { Commodity, Order, Trade } from '@/contracts/game-state';
import { useScreen } from '@/data/store';
import { useCommand, newIdempotencyKey } from '@/data/useCommand';
import { formatSignedBps, formatUnits } from '@/domain/money';
import { commodityLabel } from '@/domain/labels';
import { Button } from '@/ui/Button';
import { DataTable } from '@/ui/DataTable';
import { FinancialChart } from '@/ui/FinancialChart';
import { Icon } from '@/ui/Icon';
import { MoneyValue } from '@/ui/MoneyValue';
import { ResponsiveSheet } from '@/ui/ResponsiveSheet';
import { ScreenData } from '@/ui/ScreenData';
import { EmptyState } from '@/ui/States';
import { StatusLabel } from '@/ui/StatusLabel';
import { TradeTicket } from '@/ui/TradeTicket';

export function CommodityScreen() {
  return <ScreenData screen="commodities" title="Commodity Exchange">{(d) => <CommodityView {...d} />}</ScreenData>;
}

function CommodityView({ cityId, commodities, orders, ownOrders, history }: { cityId: string; commodities: Commodity[]; orders: { items: Order[] }; ownOrders: { items: Order[] }; history: { items: Trade[] } }) {
  const [params] = useSearchParams();
  const bp = useBreakpoint();
  const [selectedId, setSelectedId] = useState(commodities.find((c) => c.localDemandUnits > c.localSupplyUnits)?.id ?? commodities[0]?.id ?? '');
  const [ticketOpen, setTicketOpen] = useState(false);
  const companies = useScreen('companies').entry;
  const owned = companies.status === 'ready' ? companies.loaded.envelope.data.companies.items.filter((c) => c.permissions.buySupplies).map((c) => ({ id: c.id, name: c.name })) : undefined;
  const c = commodities.find((x) => x.id === selectedId);
  const book = useMemo(() => orders.items.filter((o) => o.commodityId === selectedId && o.side === 'sell' && o.remainingUnits > 0).sort((a, b) => a.pricePerUnit.minor - b.pricePerUnit.minor), [orders.items, selectedId]);
  if (!c) return <EmptyState title="No commodities listed">Nothing is traded in this city yet.</EmptyState>;
  const gap = c.localDemandUnits - c.localSupplyUnits;
  const ticket = <TradeTicket kind="commodity" entityId={c.id} entityName={c.name} cityId={cityId} referenceMinor={c.referencePrice.minor} currency="EC" companies={owned} defaultCompanyId={params.get('company')} />;
  return (
    <div className="pe-market">
      <section aria-labelledby="cl-t" className="pe-market-list">
        <h2 id="cl-t" className="pe-h2">Commodities in Bristol</h2>
        <DataTable caption="Commodities" rowKey={(x) => x.id} rows={commodities} rowAction={{ label: (x) => `Select ${x.name}`, onSelect: (x) => setSelectedId(x.id), selected: (x) => x.id === selectedId }}
          columns={[
            { key: 'n', header: 'Commodity', render: (x) => x.name },
            { key: 'p', header: 'Price', align: 'end', render: (x) => <MoneyValue value={x.referencePrice} fixed tone="neutral" /> },
            { key: 'c', header: 'Change', align: 'end', render: (x) => <span className={x.changeBps > 0 ? 'pe-pos' : x.changeBps < 0 ? 'pe-neg' : ''}>{formatSignedBps(x.changeBps)}</span> },
            { key: 's', header: 'Supply gap', align: 'end', render: (x) => (x.localDemandUnits > x.localSupplyUnits ? <StatusLabel tone="warning">Short {formatUnits(x.localDemandUnits - x.localSupplyUnits)}</StatusLabel> : <StatusLabel tone="positive">Covered</StatusLabel>) },
          ]} />
      </section>
      <section aria-labelledby="ob-t" className="pe-market-book">
        <div className="pe-detail-head"><div><h2 id="ob-t" className="pe-h2">{c.name} order book</h2><p className="pe-hint">{gap > 0 ? `Shortage: demand exceeds supply by ${formatUnits(gap)} ${c.unitLabel}s per day.` : 'Local supply covers demand.'}</p></div>
          {bp === 'mobile' && <Button variant="primary" onClick={() => setTicketOpen(true)}>Trade {c.name}</Button>}</div>
        <OrderBook orders={book} unit={c.unitLabel} />
        <FinancialChart title={`${c.name} reference price`} periodLabel="Last 7 days, daily" series={[{ key: 'p', label: 'Price', history: c.history, style: 'price' }]} />
      </section>
      {bp !== 'mobile' && <aside className="pe-market-ticket" aria-label="Trade ticket">{ticket}</aside>}
      <ResponsiveSheet open={ticketOpen && bp === 'mobile'} onClose={() => setTicketOpen(false)} title={`Trade ${c.name}`}>{ticket}</ResponsiveSheet>
      <section aria-labelledby="oo-t" className="pe-market-own">
        <h2 id="oo-t" className="pe-h2">Your orders</h2>
        <OwnOrders orders={ownOrders.items} />
        <h2 className="pe-h2">Trade history</h2>
        <TradeHistory trades={history.items} commodities={commodities} />
      </section>
    </div>
  );
}

function OrderBook({ orders, unit }: { orders: Order[]; unit: string }) {
  return (
    <DataTable caption="Sell orders (supply)" rowKey={(o) => o.id} rows={orders} empty={<EmptyState title="No sell orders">Nobody is offering this right now. Prices fall back to the NPC state supplier once that exists.</EmptyState>}
      columns={[
        { key: 'p', header: `Price per ${unit}`, align: 'end', render: (o) => <MoneyValue value={o.pricePerUnit} fixed tone="neutral" /> },
        { key: 'u', header: 'Units available', align: 'end', render: (o) => formatUnits(o.remainingUnits) },
        { key: 's', header: 'Supplier', render: (o) => `${o.supplier.name}${o.supplier.kind === 'player' ? ' (you)' : ''}` },
      ]} />
  );
}

function OwnOrders({ orders }: { orders: Order[] }) {
  const { send, pending } = useCommand();
  return (
    <DataTable caption="Your open orders" rowKey={(o) => o.id} rows={orders} empty={<EmptyState title="No open orders">Orders you place appear here.</EmptyState>}
      columns={[
        { key: 'c', header: 'Commodity', render: (o) => `${o.side === 'buy' ? 'Buy' : 'Sell'} ${commodityLabel(o.commodityId)}` },
        { key: 'p', header: 'Limit', align: 'end', render: (o) => <MoneyValue value={o.pricePerUnit} fixed tone="neutral" /> },
        { key: 'f', header: 'Filled', align: 'end', render: (o) => `${formatUnits(o.originalUnits - o.remainingUnits)} of ${formatUnits(o.originalUnits)}` },
        { key: 'r', header: 'Remaining', align: 'end', render: (o) => formatUnits(o.remainingUnits) },
        { key: 's', header: 'Status', render: (o) => <StatusLabel tone={o.status === 'partial' ? 'warning' : 'neutral'}>{o.status === 'partial' ? 'Partly filled' : o.status}</StatusLabel> },
        { key: 'a', header: 'Action', render: (o) => <Button disabled={pending} aria-label={`Cancel remaining ${o.remainingUnits} units of order ${o.id}`} onClick={() => void send({ type: 'order.cancel', orderId: o.id }, { idempotencyKey: newIdempotencyKey(), expectedRevision: 1 }, { success: 'Order cancelled', failure: 'Order not cancelled' })}><Icon name="close" size={16} /> Cancel remaining</Button> },
      ]} />
  );
}

function TradeHistory({ trades, commodities }: { trades: Trade[]; commodities: Commodity[] }) {
  const name = (id: string) => commodities.find((c) => c.id === id)?.name ?? id;
  return (
    <DataTable caption="Trade history" rowKey={(t) => t.id} rows={trades} empty={<EmptyState title="No trades yet">Settled trades are listed here.</EmptyState>}
      columns={[
        { key: 't', header: 'Settled (UTC)', render: (t) => new Date(t.settledAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) },
        { key: 'c', header: 'Commodity', render: (t) => name(t.commodityId) },
        { key: 'q', header: 'Quantity', align: 'end', render: (t) => formatUnits(t.quantity) },
        { key: 'p', header: 'Price', align: 'end', render: (t) => <MoneyValue value={t.pricePerUnit} fixed tone="neutral" /> },
        { key: 'f', header: 'Fee', align: 'end', render: (t) => <MoneyValue value={t.fee} tone="neutral" /> },
      ]} />
  );
}
