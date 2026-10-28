import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchLots, fetchOpportunities, fetchStartupQuote, useQuery, type LotInfo, type Opportunity, type StartupQuote } from '@/data/managementApi';
import { useDataSource } from '@/data/store';
import { newIdempotencyKey, useCommand } from '@/data/useCommand';
import { formatMoney, parseDecimalToMinor } from '@/domain/money';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { EmptyState, ErrorState, IllustrativeBadge, Skeleton } from '@/ui/States';
import { Icon } from '@/ui/Icon';
import { INDUSTRY_ICON, ec } from './OpportunitiesScreen';

const money = (m: number) => formatMoney(ec(m));
const STEPS = ['Industry', 'Location', 'Premises & name', 'Review & confirm'];

/** Guided company creation. The server quotes every line; the confirm button sends the quoted total so a price change between review and confirm is refused, never silently charged. */
export function StartCompanyScreen() {
  const source = useDataSource();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const ops = useQuery((s) => fetchOpportunities(s), [], false);
  const lots = useQuery((s) => fetchLots(s), [], false);
  const industry = params.get('industry') ?? '';
  const lotId = params.get('lot') ?? '';
  const tier = Number(params.get('tier') ?? 1);
  const [name, setName] = useState('');
  const [capital, setCapital] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);
  const { send, pending } = useCommand();
  const [formError, setFormError] = useState<string | null>(null);
  const set = (k: string, v: string) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); if (k === 'industry') n.delete('lot'); return n; }, { replace: true });
  const capitalMinor = capital.trim() === '' ? undefined : parseDecimalToMinor(capital) ?? NaN;
  const quote = useQuery((s) => (industry && lotId ? fetchStartupQuote({ industry, plotId: lotId, tier, name: name.trim() || undefined, workingCapitalMinor: Number.isNaN(capitalMinor) ? undefined : capitalMinor }, s) : Promise.resolve(null)), [industry, lotId, tier, name, capitalMinor], false);
  useEffect(() => { setKey(newIdempotencyKey()); }, [industry, lotId, tier, name, capitalMinor]);

  if (source.authority !== 'server') return <div className="pe-screen"><h1 className="pe-h1">Start a company</h1><IllustrativeBadge /><EmptyState title="Company creation needs the game server">Start the game server (npm run dev:full) to found a real company.</EmptyState></div>;
  if (ops.status === 'loading' || lots.status === 'loading') return <div className="pe-screen"><h1 className="pe-h1">Start a company</h1><Skeleton lines={6} label="Loading" /></div>;
  if (ops.status === 'error' || lots.status === 'error') return <div className="pe-screen"><h1 className="pe-h1">Start a company</h1><ErrorState message={ops.status === 'error' ? ops.error : lots.status === 'error' ? lots.error : ''} onRetry={() => { ops.reload(); lots.reload(); }} /></div>;
  const industries = ops.data.opportunities;
  const chosen = industries.find((o) => o.industry === industry);
  const fitting = lots.data.lots.filter((l) => chosen && l.fits.includes(chosen.industry));
  const lot = lots.data.lots.find((l) => l.id === lotId);
  const q = quote.status === 'ready' ? quote.data?.quote ?? null : null;
  const step = !chosen ? 0 : !lot || lot.status !== 'vacant' ? 1 : !name.trim() ? 2 : 3;
  const canConfirm = !!q && q.ok && name.trim().length > 0 && !pending;

  const confirm = async () => {
    if (!q) return;
    setFormError(null);
    const res = await send({ type: 'company.create', plotId: lotId, industry: industry as never, name: name.trim(), tier, workingCapitalMinor: capitalMinor, expectedTotalMinor: q.totalMinor }, { idempotencyKey: key, expectedRevision: 0 },
      { success: `${name.trim()} founded`, failure: 'Company not created' });
    if (res?.ok) nav(`/companies?company=${encodeURIComponent(res.transactionId)}`);
    else if (res && !res.ok) { setFormError(res.error.message); quote.reload(); lots.reload(); }
  };

  return (
    <div className="pe-screen">
      <div className="pe-screen-head"><h1 className="pe-h1">Start a company</h1></div>
      <div className="pe-stack">
        <ol className="pe-steps" aria-label="Progress">{STEPS.map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} data-done={i < step}>{s}</li>)}</ol>

        <section aria-labelledby="s-ind"><h2 id="s-ind" className="pe-h3">1. Industry</h2>
          <ul className="pe-choice-list">{industries.map((o) => (
            <li key={o.industry}><button type="button" className="pe-choice" aria-pressed={o.industry === industry} data-testid={`pick-${o.industry}`} onClick={() => set('industry', o.industry)}>
              <Icon name={INDUSTRY_ICON[o.industry] ?? 'startup'} size={24} /><span><strong>{o.label}</strong> <span className="pe-tag-forecast">FORECAST</span> <span className={o.forecast.profitMinor >= 0 ? 'pe-pos' : 'pe-neg'}>{money(o.forecast.profitMinor)}/day</span><small>{o.tagline} Startup from {money(o.startup.totalMinor)}.</small></span>
            </button></li>))}</ul>
          <p className="pe-hint">Not sure? <Link to="/opportunities">Compare opportunities</Link> first.</p>
        </section>

        {chosen && (
          <section aria-labelledby="s-loc"><h2 id="s-loc" className="pe-h3">2. Location</h2>
            {fitting.length === 0 ? <EmptyState title="No suitable plot exists">This industry needs a larger plot than any in Bristol.</EmptyState> : (
              <ul className="pe-choice-list">{fitting.map((l) => (
                <li key={l.id}><button type="button" className="pe-choice" aria-pressed={l.id === lotId} disabled={l.status !== 'vacant'} data-testid={`lot-${l.id}`} onClick={() => set('lot', l.id)}>
                  <span><strong>{l.districtName || 'Bristol'}</strong> · {l.width}×{l.depth} plot ({l.id}){l.status !== 'vacant' ? ' · TAKEN' : ''}<small>Rent from {money(l.rentFrom[chosen.industry] ?? 0)}/day · property index {(l.propertyIndexBps / 100).toFixed(0)}%</small></span>
                </button></li>))}</ul>)}
            <p className="pe-hint">You can also pick a plot on the <Link to={`/city?start=${industry}`}>city map</Link>: vacant plots are marked “For lease”.</p>
          </section>
        )}

        {chosen && lot && lot.status === 'vacant' && (
          <section aria-labelledby="s-prem"><h2 id="s-prem" className="pe-h3">3. Premises and name</h2>
            <fieldset className="pe-fields">
              <legend className="pe-sr">Premises</legend>
              <ul className="pe-choice-list">{chosen.tiers.map((t) => (
                <li key={t.tier}><button type="button" className="pe-choice" aria-pressed={t.tier === tier} onClick={() => set('tier', String(t.tier))}>
                  <span><strong>{t.name}</strong><small>Fit-out {money(t.fitoutMinor)} · up to {t.staff} staff · capacity {t.capacity} per day</small></span></button></li>))}</ul>
              <Field label="Company name" error={q?.issues.find((i) => i.field === 'name')?.message} hint="3–32 characters. Unique in Bristol."><input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} data-testid="company-name" autoComplete="off" /></Field>
              <Field label={`Working capital (EC) — at least ${q ? q.workingCapitalMinMinor / 100 : '…'}`} error={q?.issues.find((i) => i.field === 'workingCapital')?.message} hint="Cash you keep in the company to pay wages, rent and ingredients until sales arrive."><input inputMode="decimal" placeholder={q ? String(q.workingCapitalDefaultMinor / 100) : ''} value={capital} onChange={(e) => setCapital(e.target.value)} /></Field>
            </fieldset>
          </section>
        )}

        {q && name.trim() && <Review q={q} name={name.trim()} lot={lot} chosen={chosen} />}
        {formError && <p className="pe-field-error" role="alert">{formError}</p>}
        {q && name.trim() && (
          <div className="pe-row">
            <Button variant="primary" pending={pending} disabled={!canConfirm} onClick={() => void confirm()} data-testid="confirm-create">Pay {money(q.totalMinor)} and found {name.trim()}</Button>
            {!q.ok && <span className="pe-hint" role="status">{q.issues[0]?.message}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function Review({ q, name, lot, chosen }: { q: StartupQuote; name: string; lot?: LotInfo; chosen?: Opportunity }) {
  return (
    <section aria-labelledby="s-rev"><h2 id="s-rev" className="pe-h3">4. Review the bill</h2>
      <div className="pe-table-scroll"><table className="pe-table" aria-label="Startup costs">
        <thead><tr><th scope="col">Item</th><th scope="col">Paid to</th><th scope="col" className="pe-num">Cost</th></tr></thead>
        <tbody>{q.lines.map((l) => <tr key={l.kind}><th scope="row">{l.label}<span className="pe-hint"> {l.note}</span></th><td>{l.paidTo}</td><td className="pe-financial-number">{money(l.amountMinor)}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row" colSpan={2}>Total from your wallet</th><td className="pe-financial-number"><strong>{money(q.totalMinor)}</strong></td></tr>
          <tr><th scope="row" colSpan={2}>Your wallet</th><td className="pe-financial-number">{money(q.walletAvailableMinor)}</td></tr></tfoot>
      </table></div>
      <p className="pe-hint">Daily running costs once open: rent {money(q.running.rentPerDayMinor)} + wages {money(q.running.wagesPerDayMinor)} ({q.running.staff} of {q.running.maxStaff} staff). {chosen && lot ? `${name} will be built in ${lot.districtName}.` : ''}</p>
      {q.issues.length > 0 && <ul className="pe-reasons pe-warnings" role="alert">{q.issues.map((i) => <li key={i.field + i.message}>{i.message}</li>)}</ul>}
    </section>
  );
}
