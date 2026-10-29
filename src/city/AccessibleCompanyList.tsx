import type { CompanySummary } from '@/data/types';
import { industryLabel, ownerKindLabel } from '@/domain/labels';

/** Text equivalent of the map: every selectable business, with ownership, as native buttons. */
export function AccessibleCompanyList({ companies, selectedId, playerId, onSelect }: { companies: CompanySummary[]; selectedId: string | null; playerId: string; onSelect: (id: string) => void }) {
  const sorted = [...companies].sort((a, b) => Number(b.owner.id === playerId) - Number(a.owner.id === playerId) || a.name.localeCompare(b.name));
  return (
    <ul className="pe-company-list" aria-label="Businesses in Bristol">
      {sorted.map((c) => {
        const mine = c.owner.id === playerId;
        return (
          <li key={c.id}>
            <button type="button" className="pe-company-btn" aria-pressed={selectedId === c.id} onClick={() => onSelect(c.id)}>
              <span><strong>{c.name}</strong><small>{industryLabel(c.industry)} · Lvl {c.level}</small></span>
              <small className={mine ? 'pe-pos' : ''}>{mine ? 'Your company' : `${ownerKindLabel(c.owner.kind)} · ${c.owner.name}`}</small>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
