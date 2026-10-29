import { Link } from 'react-router-dom';
import type { Company } from '@/contracts/game-state';
import { formatBps, formatUnits } from '@/domain/money';
import { MoneyValue } from '@/ui/MoneyValue';
import { Button } from '@/ui/Button';
import { StatusLabel } from '@/ui/StatusLabel';
import { Icon } from '@/ui/Icon';
import { Sparkline } from '@/ui/Sparkline';
import { commodityLabel, companyStatusTone, industryLabel, ownerKindLabel } from '@/domain/labels';
import { frameById } from '@/assets/artAssets';

/** Read-only summary of the selected company. Ownership/permissions come from the DTO; nothing is assumed to be the player's. */
export function CompanyInspector({ company, illustrative, onClose, showClose = true }: { company: Company; illustrative: boolean; onClose: () => void; showClose?: boolean }) {
  const low = company.inventory.filter((l) => l.estimatedHoursRemaining !== null && l.estimatedHoursRemaining <= 6 && l.capacityUnits > 0);
  const owned = company.permissions.manage;
  return (
    <article className="pe-inspector" aria-labelledby="insp-title">
      <header className="pe-insp-head">
        <div>
          <h2 id="insp-title">{company.name}</h2>
          <p className="pe-hint">{industryLabel(company.industry)} · Level {company.level}</p>
        </div>
        {showClose && <button type="button" className="pe-icon-btn" onClick={onClose} aria-label="Close company panel"><Icon name="close" /></button>}
      </header>
      <p className="pe-insp-tags">
        <StatusLabel tone={company.status === 'operating' ? 'positive' : company.status === 'paused' ? 'warning' : 'negative'}>{companyStatusTone(company.status)}</StatusLabel>
        <StatusLabel tone={owned ? 'accent' : 'neutral'}>{owned ? 'Your company' : `${ownerKindLabel(company.owner.kind)} company · read-only`}</StatusLabel>
        {illustrative && <StatusLabel tone="neutral">Illustrative data</StatusLabel>}
      </p>
      <p className="pe-owner"><Icon name="ownership" size={16} /> Owner: <strong>{company.owner.name}</strong></p>
      {!frameById.has(company.assetId) && <p className="pe-hint">Artwork for this company is not available.</p>}
      <dl className="pe-stats">
        <div><dt>Revenue / day</dt><dd><MoneyValue value={company.dailyRevenue} tone="neutral" /></dd></div>
        <div><dt>Profit / day</dt><dd><MoneyValue value={company.dailyProfit} signed /></dd></div>
        <div><dt>Customers today</dt><dd className="pe-financial-number">{formatUnits(company.customersToday)}</dd></div>
        <div><dt>Market share</dt><dd className="pe-financial-number">{formatBps(company.marketShareBps)}</dd></div>
        <div><dt>Price</dt><dd><MoneyValue value={company.price} tone="neutral" /></dd></div>
        <div><dt>Staff</dt><dd className="pe-financial-number">{company.employees} / {company.maxEmployees}</dd></div>
      </dl>
      <div className="pe-insp-trend"><span className="pe-hint">Profit, last 7 days (EC)</span><Sparkline history={company.profitHistory} label={`${company.name} profit per day`} /></div>
      {low.length > 0 && (
        <div className="pe-callout" role="status"><Icon name="warning" size={18} /><div><strong>{low.map((l) => commodityLabel(l.commodityId)).join(', ')} running low</strong><p>About {Math.min(...low.map((l) => l.estimatedHoursRemaining ?? 0))} hours of stock left. Consider buying supplies.</p></div></div>
      )}
      <div className="pe-insp-actions">
        <Link className="pe-btn pe-btn--primary pe-btn--block" to={`/companies?company=${encodeURIComponent(company.id)}`}>{owned ? 'Manage company' : 'View company details'}</Link>
        {owned && company.permissions.buySupplies && <Link className="pe-btn pe-btn--secondary pe-btn--block" to={`/commodities?company=${encodeURIComponent(company.id)}`}><Icon name="marketplace" size={18} /> Buy supplies</Link>}
        <Button variant="ghost" block onClick={onClose}>Clear selection</Button>
      </div>
    </article>
  );
}
