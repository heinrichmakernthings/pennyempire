import { Link } from 'react-router-dom';
import { useId, useState, type ReactNode } from 'react';
import type { Company } from '@/contracts/game-state';
import { fetchRankings, useQuery, type Management } from '@/data/managementApi';
import { newIdempotencyKey, useCommand } from '@/data/useCommand';
import { commodityLabel } from '@/domain/labels';
import { formatBps, formatMoney, formatUnits } from '@/domain/money';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { ErrorState, Skeleton } from '@/ui/States';
import { ec } from '../OpportunitiesScreen';
import { ProcureSheet } from '../exchange/ProcureSheet';
import { ResponsiveSheet } from '@/ui/ResponsiveSheet';

const money = (minor: number) => formatMoney(ec(minor));

/** Explains a term in plain words. A real button, so it works on touch and keyboard, not just hover. */
export function Tip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false); const id = useId();
  return <><button type="button" className="pe-tip" aria-expanded={open} aria-controls={id} aria-label="What does this mean?" title={typeof children === 'string' ? children : undefined} onClick={() => setOpen((v) => !v)}>?</button>{open && <p id={id} className="pe-tip-text" role="note">{children}</p>}</>;
}

export function Meter({ label, valueText, pct, tone = 'good', tip }: { label: string; valueText: string; pct: number; tone?: 'good' | 'warn' | 'bad'; tip?: string }) {
  return (
    <div className="pe-meter">
      <div className="pe-meter-label"><span>{label}{tip && <Tip>{tip}</Tip>}</span><strong>{valueText}</strong></div>
      <div className="pe-bar" data-tone={tone === 'good' ? undefined : tone} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-valuetext={valueText}><span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
    </div>
  );
}

export function Diagnosis({ m }: { m: Management }) {
  if (m.diagnosis.length === 0) return <p className="pe-hint">Nothing to report yet. Results appear after the first full day of trading.</p>;
  return <ul className="pe-diag" aria-label="Why is this company making or losing money?">{m.diagnosis.map((d, i) => <li key={i} data-kind={d.kind}><Icon name={d.kind === 'good' ? 'profit' : d.kind === 'bad' ? 'loss' : 'warning'} size={18} /><span>{d.text}</span></li>)}</ul>;
}

/** Small status chips driven by real production/stock state (Phase 3 state icons). */
export function ActivityBadges({ c, m }: { c: Company; m: Management }) {
  const chips: { icon: string; text: string }[] = [];
  if (m.closed) chips.push({ icon: 'state-closed', text: 'Closed (bankrupt)' });
  else if (c.status === 'insolvent') chips.push({ icon: 'state-closed', text: 'Insolvent' });
  else {
    const lim = m.production.limitedBy;
    if (lim === 'inputs' || lim === 'supply' || lim === 'cash') chips.push({ icon: 'state-missing-inputs', text: 'Missing inputs' });
    if (lim === 'storage') chips.push({ icon: 'state-overproduction', text: 'Storage full' });
    if (lim === 'staff') chips.push({ icon: 'staff', text: 'Short-staffed' });
    if (lim === 'condition' || m.equipment.conditionBps < 5_000) chips.push({ icon: 'warning', text: 'Equipment worn' });
    if (c.dailyProfit.minor > 0) chips.push({ icon: 'state-profit', text: 'Profitable' });
    if (c.dailyProfit.minor < 0) chips.push({ icon: 'state-loss', text: 'Losing money' });
    if (m.rank?.rank === 1 && m.rank.of > 1) chips.push({ icon: 'ranking', text: 'Local leader' });
    if (chips.length === 0) chips.push({ icon: 'state-startup', text: 'Starting up' });
  }
  return <div className="pe-badge-row" aria-label="Activity">{chips.map((x) => <span key={x.text} className="pe-activity"><Icon name={x.icon} size={16} />{x.text}</span>)}</div>;
}

export function Rankings({ industry, companyId, deps }: { industry: string; companyId: string; deps: unknown[] }) {
  const q = useQuery((s) => fetchRankings(s), deps, false);
  if (q.status === 'loading') return <Skeleton lines={3} label="Loading rankings" />;
  if (q.status === 'error') return <ErrorState title="Rankings unavailable" message={q.error} onRetry={q.reload} />;
  const r = q.data.rankings.find((x) => x.industry === industry);
  if (!r) return null;
  return (
    <div className="pe-table-scroll">
      <table className="pe-table" aria-label={`${r.label} ranking in Bristol`}>
        <caption className="pe-sr">{r.label} ranking in Bristol, by units sold per day (7-day average)</caption>
        <thead><tr><th scope="col">#</th><th scope="col">Company</th><th scope="col" className="pe-num">Sold / day</th><th scope="col" className="pe-num">Share</th><th scope="col" className="pe-num">Reputation</th><th scope="col" className="pe-num">Price</th></tr></thead>
        <tbody>{r.rows.map((x) => <tr key={x.companyId} className={x.companyId === companyId ? 'pe-rank-me' : ''}><td>{x.rank}</td><th scope="row">{x.mine ? x.name : <Link to={`/competitors/${x.companyId}`}>{x.name}</Link>}{x.mine ? ' (you)' : ''}</th><td className="pe-financial-number">{formatUnits(x.unitsPerDay)}</td><td className="pe-financial-number">{formatBps(x.shareBps)}</td><td className="pe-financial-number">{formatBps(x.reputationBps)}</td><td className="pe-financial-number">{money(x.priceMinor)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export function ProductionPanel({ c, m }: { c: Company; m: Management }) {
  const p = m.production;
  const pct = c.capacityPerTick > 0 ? (Math.min(p.outputUnits, c.capacityPerTick) / c.capacityPerTick) * 100 : 0;
  return (
    <div className="pe-stack">
      <dl className="pe-kv">
        <div><dt>Production target <Tip>Batches the company tries to make every day. It makes fewer if staff, storage, ingredients or cash run short.</Tip></dt><dd>{p.plannedBatches} batches ({formatUnits(p.outputUnits)} units)</dd></div>
        <div><dt>Capacity today <Tip>What your staff and equipment can actually produce: workplace capacity × staffing × equipment condition.</Tip></dt><dd>{p.effectiveBatches} batches ({formatUnits(c.capacityPerTick)} units)</dd></div>
      </dl>
      <Meter label="Target vs capacity" valueText={`${Math.round(pct)}%`} pct={pct} tone={p.outputUnits > c.capacityPerTick ? 'warn' : 'good'} tip="Above 100% means the target cannot be met with current staff or equipment." />
      <div className="pe-table-scroll">
        <table className="pe-table pe-small" aria-label="Recent production">
          <thead><tr><th scope="col">Day</th><th scope="col" className="pe-num">Planned</th><th scope="col" className="pe-num">Made</th><th scope="col" className="pe-num">Units</th><th scope="col">Held back by</th></tr></thead>
          <tbody>{p.log.length === 0 ? <tr><td colSpan={5} className="pe-hint">No production yet.</td></tr> : [...p.log].reverse().slice(0, 8).map((l) => <tr key={l.tick}><td>{l.gameDate}</td><td className="pe-financial-number">{l.planned}</td><td className="pe-financial-number">{l.produced}</td><td className="pe-financial-number">{formatUnits(l.outputUnits)}</td><td>{LIMIT_LABEL[l.limitedBy] ?? l.limitedBy}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
const LIMIT_LABEL: Record<string, string> = { plan: 'Nothing (target met)', staff: 'Not enough staff', storage: 'Storage full or 5 days of unsold stock', inputs: 'Ran out of ingredients', cash: 'No cash for ingredients', supply: 'Nobody selling', condition: 'Worn equipment', closed: 'Closed' };

export function SupplyChainPanel({ c, m, canAct, onChanged }: { c: Company; m: Management; canAct: boolean; onChanged?: () => void }) {
  const { send, pending } = useCommand();
  const [compare, setCompare] = useState<string | null>(null);
  const [batches, setBatches] = useState('2');
  const [key, setKey] = useState(newIdempotencyKey);
  if (m.supplyChain.length === 0) return <p className="pe-hint">This business makes its product from nothing but energy: no ingredients to buy.</p>;
  const n = Number(batches);
  const buy = async () => {
    const res = await send({ type: 'company.procure', companyId: c.id, batches: n }, { idempotencyKey: key, expectedRevision: c.revision }, { success: `Bought ingredients for ${n} batches`, failure: 'Supplies not bought' });
    if (res) setKey(newIdempotencyKey());
  };
  return (
    <div className="pe-stack">
      <div className="pe-table-scroll"><table className="pe-table pe-small" aria-label="Ingredients and suppliers">
        <thead><tr><th scope="col">Ingredient</th><th scope="col" className="pe-num">Per batch</th><th scope="col" className="pe-num">In stock</th><th scope="col" className="pe-num">For sale in Bristol</th><th scope="col" className="pe-num">Best price</th><th scope="col"><span className="pe-sr">Compare</span></th></tr></thead>
        <tbody>{m.supplyChain.map((s) => <tr key={s.commodityId}><th scope="row">{commodityLabel(s.commodityId)}</th><td className="pe-financial-number">{s.perBatch}</td><td className="pe-financial-number">{formatUnits(s.inStock)}</td><td className={`pe-financial-number ${s.forSale < s.perBatch * Math.max(1, m.production.plannedBatches) ? 'pe-neg' : ''}`}>{formatUnits(s.forSale)}</td><td className="pe-financial-number">{s.bestAskMinor === null ? `${money(s.stateFallbackMinor ?? 0)} (state supplier)` : money(s.bestAskMinor)}</td>
          <td>{canAct && <Button onClick={() => setCompare(s.commodityId)} data-testid={`compare-${s.commodityId}`} aria-label={`Compare ${commodityLabel(s.commodityId)} suppliers`}>{s.inStock < s.perBatch * Math.max(1, m.production.plannedBatches) ? 'Find supplier' : 'Compare'}</Button>}</td></tr>)}</tbody>
      </table></div>
      <p className="pe-hint">If nobody is selling, the state supplier (Bristol Provisions) sells a limited amount at a premium. Auto-purchasing buys what the day's target needs.</p>
      {compare && (() => { const s = m.supplyChain.find((x) => x.commodityId === compare)!; return (
        <ResponsiveSheet open onClose={() => setCompare(null)} title={`${commodityLabel(compare)} for ${c.name}`}>
          <ProcureSheet companyId={c.id} commodityId={compare} needUnits={s.perBatch * Math.max(1, m.production.plannedBatches)} haveUnits={s.inStock} onBought={() => onChanged?.()} />
        </ResponsiveSheet>); })()}
      {canAct && (
        <div className="pe-row">
          <label className="pe-row" htmlFor="batches-input">Batches to buy now <Tip>Buys ingredients immediately for this many batches from the cheapest sellers, using the company's cash.</Tip></label>
          <input id="batches-input" type="number" min={1} max={100} step={1} value={batches} onChange={(e) => { setBatches(e.target.value); setKey(newIdempotencyKey()); }} className="pe-input-sm" />
          <Button variant="primary" pending={pending} disabled={!Number.isInteger(n) || n < 1 || n > 100} onClick={() => void buy()} data-testid="buy-supplies">Buy supplies now</Button>
        </div>
      )}
    </div>
  );
}

export function EquipmentPanel({ c, m, canAct }: { c: Company; m: Management; canAct: boolean }) {
  const { send, pending } = useCommand();
  const [key, setKey] = useState(newIdempotencyKey);
  const cond = m.equipment.conditionBps / 100;
  return (
    <div className="pe-stack">
      <Meter label="Equipment condition" valueText={`${Math.round(cond)}%`} pct={cond} tone={cond < 35 ? 'bad' : cond < 60 ? 'warn' : 'good'} tip={`Equipment wears ${m.equipment.wearBpsPerDay / 100}% on every day it produces. Output falls to ${Math.round(m.equipment.capacityFactorBps / 100)}% of normal at this condition.`} />
      {canAct && <div className="pe-row"><Button disabled={m.equipment.serviceCostMinor <= 0} pending={pending} onClick={async () => { const r = await send({ type: 'company.service', companyId: c.id }, { idempotencyKey: key, expectedRevision: c.revision }, { success: 'Equipment serviced', failure: 'Service not completed' }); if (r) setKey(newIdempotencyKey()); }} data-testid="service">Service equipment ({money(m.equipment.serviceCostMinor)})</Button><span className="pe-hint">Paid to Bristol Works; restores 100%.</span></div>}
    </div>
  );
}

export function StaffPanel({ m }: { m: Management }) {
  const s = m.staff;
  const pct = s.max > 0 ? (s.employees / s.max) * 100 : 0;
  const note = s.employees < s.needed ? `Understaffed: you need about ${s.needed} to hit your target.` : s.employees > s.needed ? `You need about ${s.needed} to hit your target; the rest cost wages but add no output.` : 'Staffing matches your production target.';
  return (
    <div className="pe-stack">
      <Meter label="Staff" valueText={`${s.employees} of ${s.max}`} pct={pct} tone={s.employees < s.needed ? 'bad' : s.employees > s.needed ? 'warn' : 'good'} tip="Workplace capacity is the most people the building can hold. More staff than the target needs adds wages, not output." />
      <p className="pe-hint">{note} Wage {money(s.wagePerDayMinor)} per person per day. Each hire or dismissal costs one day’s wage ({money(s.changeFeeMinor)}); you can hire {s.changesLeftToday.hire} and dismiss {s.changesLeftToday.dismiss} more today.</p>
    </div>
  );
}

export function UpgradesPanel({ c, m, canAct }: { c: Company; m: Management; canAct: boolean }) {
  const { send, pending } = useCommand();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  return (
    <div className="pe-stack">
      <p className="pe-hint">Premises: <strong>{m.tierName}</strong> (tier {m.premisesTier}). Company cash: {money(c.cash.minor)}. Upgrades are paid from the company’s cash to Bristol Works and change real capacity, storage, productivity or running costs.</p>
      <ul className="pe-list">{m.upgrades.map((u) => (
        <li key={u.id} className="pe-list-row">
          <div><strong>{u.name}</strong>{u.installed && <span className="pe-status pe-status--positive"> Installed</span>}<p className="pe-hint">{u.description} {u.effect && <>Effect: {u.effect}.</>} Cost {money(u.costMinor)}.{u.blocker && !u.installed ? ` ${u.blocker}` : ''}{!u.blocker && !u.affordable && !u.installed ? ' Not enough company cash yet.' : ''}</p></div>
          {!u.installed && canAct && (pendingId === u.id
            ? <div className="pe-row"><Button variant="primary" pending={pending} data-testid={`confirm-${u.id}`} onClick={async () => { const r = await send({ type: 'company.upgrade', companyId: c.id, upgradeId: u.id }, { idempotencyKey: key, expectedRevision: c.revision }, { success: `${u.name} installed`, failure: 'Upgrade not installed' }); setKey(newIdempotencyKey()); if (r) setPendingId(null); }}>Confirm {money(u.costMinor)}</Button><Button onClick={() => setPendingId(null)}>Cancel</Button></div>
            : <Button disabled={!!u.blocker || !u.affordable} onClick={() => { setPendingId(u.id); setKey(newIdempotencyKey()); }} data-testid={`upgrade-${u.id}`}>Review</Button>)}
        </li>))}
      </ul>
    </div>
  );
}
