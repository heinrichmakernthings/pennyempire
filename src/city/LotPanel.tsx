import { Link } from 'react-router-dom';
import { fetchLots, fetchOpportunities, useQuery } from '@/data/managementApi';
import { formatMoney } from '@/domain/money';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Skeleton } from '@/ui/States';

const ec = (minor: number) => formatMoney({ currency: 'EC', minor });

/** A vacant plot: what fits here, what rent it would carry, and a direct way into company creation. Server data only. */
export function LotPanel({ lotId, onClose, showClose = true }: { lotId: string; onClose: () => void; showClose?: boolean }) {
  const lots = useQuery((s) => fetchLots(s), [lotId], false);
  const ops = useQuery((s) => fetchOpportunities(s), [], false);
  const lot = lots.status === 'ready' ? lots.data.lots.find((l) => l.id === lotId) : undefined;
  const label = (id: string) => (ops.status === 'ready' ? ops.data.opportunities.find((o) => o.industry === id)?.label : undefined) ?? id;
  return (
    <article className="pe-inspector" aria-labelledby="lot-title" data-testid="lot-panel">
      <header className="pe-insp-head">
        <div><h2 id="lot-title">Vacant plot</h2><p className="pe-hint">{lot ? `${lot.districtName} · ${lot.width}×${lot.depth} · ${lot.id}` : lotId}</p></div>
        {showClose && <button type="button" className="pe-icon-btn" onClick={onClose} aria-label="Close plot panel"><Icon name="close" /></button>}
      </header>
      {!lot ? <Skeleton lines={4} label="Loading plot" /> : lot.status !== 'vacant' ? <p className="pe-callout" role="status">This plot has just been taken.</p> : (
        <div className="pe-stack">
          <p>Free to lease. Property index {(lot.propertyIndexBps / 100).toFixed(0)}% of the city baseline sets the rent.</p>
          <ul className="pe-list">{lot.fits.map((ind) => (
            <li key={ind} className="pe-list-row"><div><strong>{label(ind)}</strong><p className="pe-hint">Rent from {ec(lot.rentFrom[ind] ?? 0)} per day</p></div>
              <Link className="pe-btn pe-btn--primary" to={`/start?industry=${ind}&lot=${lot.id}`} data-testid={`lot-start-${ind}`}>Start here</Link></li>))}</ul>
          <Link className="pe-btn pe-btn--secondary pe-btn--block" to="/opportunities">Compare opportunities</Link>
        </div>
      )}
      <Button variant="ghost" block onClick={onClose}>Clear selection</Button>
    </article>
  );
}
