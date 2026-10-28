import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCommodity } from '@/data/exchangeClient';
import { useQuery } from '@/data/managementApi';
import { commodityLabel } from '@/domain/labels';
import { formatMoney, formatUnits } from '@/domain/money';
import { Button } from '@/ui/Button';
import { ErrorState, Skeleton } from '@/ui/States';
import { OrderTicket, type TicketDefaults } from './OrderTicket';

const ec = (m: number | null) => (m === null ? '—' : formatMoney({ currency: 'EC', minor: m }));

/**
 * Contextual purchasing: opened from a company's supply panel, already scoped to that company and the missing ingredient.
 * Compare live suppliers, pick one, review the server quote and confirm: goods arrive in the company's inventory when it settles.
 */
export function ProcureSheet({ companyId, commodityId, needUnits, haveUnits, onBought }: { companyId: string; commodityId: string; needUnits: number; haveUnits: number; onBought: () => void }) {
  const [version, setVersion] = useState(0);
  const q = useQuery((s) => fetchCommodity(commodityId, s), [commodityId, version], false);
  const [pick, setPick] = useState<TicketDefaults | undefined>();
  if (q.status === 'loading') return <Skeleton lines={6} label="Loading suppliers" />;
  if (q.status === 'error') return <ErrorState title="Couldn't load suppliers" message={q.error} onRetry={q.reload} />;
  const v = q.data; const unit = v.detail.unitLabel;
  const holdings = v.holdings.filter((h) => h.companyId === companyId);
  const deficit = Math.max(0, needUnits - haveUnits);
  const mine = new Set(v.holdings.map((h) => h.companyId));
  return (
    <div className="pe-stack" data-testid="procure-sheet">
      <p>{deficit > 0 ? <>Your plan needs <strong>{formatUnits(needUnits)}</strong> {unit}s of {commodityLabel(commodityId).toLowerCase()} per day and you hold <strong>{formatUnits(haveUnits)}</strong>: short by <strong>{formatUnits(deficit)}</strong>.</> : <>You hold enough {commodityLabel(commodityId).toLowerCase()} for today's plan ({formatUnits(haveUnits)} on hand vs {formatUnits(needUnits)} needed); you can still stock up.</>}</p>
      <div className="pe-table-scroll"><table className="pe-table pe-small" aria-label={`${commodityLabel(commodityId)} suppliers`}>
        <thead><tr><th scope="col">Supplier</th><th scope="col">Type</th><th scope="col" className="pe-num">Price</th><th scope="col" className="pe-num">Available</th><th scope="col"><span className="pe-sr">Action</span></th></tr></thead>
        <tbody>{v.detail.suppliers.length === 0 ? <tr><td colSpan={5} className="pe-hint">Nobody is selling right now.</td></tr> : v.detail.suppliers.map((s) => (
          <tr key={s.companyId}><th scope="row">{s.name}</th><td>{s.ownerKind === 'state' ? 'State supplier' : s.ownerKind === 'npc' ? 'NPC' : 'Player'}</td><td className="pe-financial-number">{ec(s.askMinor)}</td><td className="pe-financial-number">{formatUnits(s.units)}</td>
            <td>{mine.has(s.companyId) && s.companyId === companyId ? <span className="pe-hint">yours</span> : <Button variant="primary" data-testid={`procure-${s.companyId}`} onClick={() => setPick({ side: 'buy', companyId, limitMinor: s.askMinor, qty: Math.max(1, Math.min(s.units, deficit || 20)), fromCompanyId: s.companyId, fromName: s.name })} aria-label={`Buy ${commodityLabel(commodityId)} directly from ${s.name}`}>Buy</Button>}</td></tr>))}</tbody>
      </table></div>
      {holdings.length > 0 && <OrderTicket key={`${commodityId}-${pick?.fromCompanyId ?? ''}-${pick?.limitMinor ?? 0}`} commodityId={commodityId} name={commodityLabel(commodityId)} unit={unit} referenceMinor={v.detail.asks[0]?.priceMinor ?? 100} bestAskMinor={v.detail.asks[0]?.priceMinor ?? null} bestBidMinor={v.detail.bids[0]?.priceMinor ?? null} holdings={holdings} defaults={pick ?? { side: 'buy', companyId, qty: deficit || 20, limitMinor: v.detail.asks[0]?.priceMinor }} heading={false} onPlaced={() => { setVersion((n) => n + 1); onBought(); }} />}
      <Link className="pe-btn pe-btn--secondary" to={`/commodities?commodity=${encodeURIComponent(commodityId)}&company=${encodeURIComponent(companyId)}`}>Open the full {commodityLabel(commodityId)} market</Link>
    </div>
  );
}
