import type { City } from '@/contracts/game-state';
import type { CompanySummary } from '@/data/types';
import { formatUnits, formatMoney } from '@/domain/money';
import { Icon } from '@/ui/Icon';
import { StatusLabel } from '@/ui/StatusLabel';
import { AccessibleCompanyList } from './AccessibleCompanyList';

const NAMES: Record<string, string> = { flour: 'Flour', cheese: 'Cheese', timber: 'Timber', pizza: 'Pizza', wheat: 'Wheat', milk: 'Milk', energy: 'Energy' };

/** City economic summary: demand vs supply gaps and events, plus the accessible business list. */
export function CityOverview({ city, directory, selectedId, playerId, onSelect }: { city: City; directory: CompanySummary[]; selectedId: string | null; playerId: string; onSelect: (id: string) => void }) {
  return (
    <section className="pe-overview" aria-labelledby="ov-title">
      <h2 id="ov-title">{city.name} economy</h2>
      <h3 className="pe-h3">Supply vs demand (units / day)</h3>
      <ul className="pe-demand">
        {city.demand.map((d) => {
          const gap = d.wantedUnits - d.suppliedUnits; const pct = Math.min(100, Math.round((d.suppliedUnits * 100) / Math.max(1, d.wantedUnits)));
          return (
            <li key={d.commodityId}>
              <div className="pe-demand-row"><strong>{NAMES[d.commodityId] ?? d.commodityId}</strong><span className="pe-financial-number">{formatUnits(d.suppliedUnits)} / {formatUnits(d.wantedUnits)}</span></div>
              <div className="pe-meter" role="img" aria-label={`${pct}% of demand met${gap > 0 ? `, shortfall ${gap} units` : ', no shortfall'}. Reference price ${formatMoney(d.referencePrice)}.`}><span style={{ width: `${pct}%` }} className={gap > 0 && pct < 75 ? 'is-low' : ''} /></div>
              {gap > 0 && pct < 75 && <StatusLabel tone="warning">Shortage: {formatUnits(gap)} units</StatusLabel>}
            </li>
          );
        })}
      </ul>
      <h3 className="pe-h3">City news</h3>
      <ul className="pe-events">{city.events.map((e) => <li key={e.id}><Icon name={e.severity === 'warning' ? 'warning' : 'notification'} size={16} /><span>{e.title}</span></li>)}</ul>
      <h3 className="pe-h3">Businesses ({directory.length})</h3>
      <AccessibleCompanyList companies={directory} selectedId={selectedId} playerId={playerId} onSelect={onSelect} />
    </section>
  );
}
