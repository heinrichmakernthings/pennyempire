import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { MarketShortage } from '@/shared/exchange';
import { fetchOpportunities, useQuery, type Opportunity } from '@/data/managementApi';
import { useDataSource } from '@/data/store';
import { formatBps, formatMoney, formatUnits } from '@/domain/money';
import { commodityLabel } from '@/domain/labels';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { EmptyState, ErrorState, IllustrativeBadge, Skeleton } from '@/ui/States';
import { StatusLabel } from '@/ui/StatusLabel';

export const ec = (minor: number) => ({ currency: 'EC' as const, minor });
const money = (minor: number, signed = false) => formatMoney(ec(minor), { signed });
const RISK_TONE = { low: 'positive', medium: 'warning', high: 'negative' } as const;
export const INDUSTRY_ICON: Record<string, string> = { farm: 'production-farm', mill: 'production-mill', dairy: 'production-dairy', pizza: 'production-pizza', cafe: 'production-cafe', timber: 'production-timber' };

/** Where would a new business make money? Every figure is derived from the live simulation and labelled FORECAST. */
export function OpportunitiesScreen() {
  const source = useDataSource();
  const q = useQuery((s) => fetchOpportunities(s), [source.authority], source.authority === 'server');
  return (
    <div className="pe-screen">
      <div className="pe-screen-head"><h1 className="pe-h1">Opportunities</h1>{source.authority !== 'server' && <IllustrativeBadge />}</div>
      {source.authority !== 'server' ? <EmptyState title="Opportunities need the game server">The finder reads live Bristol market data. Start the game server (npm run dev:all) to see real forecasts.</EmptyState>
        : q.status === 'loading' ? <Skeleton lines={8} label="Loading opportunities" />
        : q.status === 'error' ? <ErrorState title="Couldn’t load opportunities" message={q.error} onRetry={q.reload} />
        : <Finder note={q.data.forecastNote} items={q.data.opportunities} shortages={q.data.shortages} />}
    </div>
  );
}

function Finder({ note, items, shortages }: { note: string; items: Opportunity[]; shortages: MarketShortage[] }) {
  return (
    <div className="pe-stack">
      <p className="pe-callout" role="note"><Icon name="warning" size={18} /><span><strong>FORECAST.</strong> {note} Ranked by expected daily profit. Not a promise: prices, rivals and your own choices change the result.</span></p>
      <MarketGaps shortages={shortages} />
      <div className="pe-cards">{items.map((o, i) => <OpportunityCard key={o.industry} o={o} rank={i + 1} />)}</div>
    </div>
  );
}

function OpportunityCard({ o, rank }: { o: Opportunity; rank: number }) {
  const [open, setOpen] = useState(rank === 1);
  const f = o.forecast;
  return (
    <article className="pe-card" aria-labelledby={`op-${o.industry}`} data-testid={`opportunity-${o.industry}`}>
      <header className="pe-card-head">
        <div className="pe-row"><Icon name={INDUSTRY_ICON[o.industry] ?? 'startup'} size={28} /><div><h2 id={`op-${o.industry}`}>#{rank} {o.label}</h2><p className="pe-hint">{o.tagline}</p></div></div>
        <div className="pe-badge-row"><StatusLabel tone={RISK_TONE[o.risk]}>{o.risk[0]!.toUpperCase() + o.risk.slice(1)} risk</StatusLabel></div>
      </header>
      {o.labels.length > 0 && <div className="pe-badge-row" aria-label="Market conditions" data-testid={`labels-${o.industry}`}>{o.labels.map((l) => <StatusLabel key={l} tone={l === 'High risk' || l === 'Oversupplied' ? 'negative' : l === 'Competitive' ? 'warning' : 'positive'}>{l}</StatusLabel>)}</div>}
      <p><span className="pe-tag-forecast">FORECAST</span> <strong className={f.profitMinor >= 0 ? 'pe-pos' : 'pe-neg'}>{o.headline}</strong></p>
      <dl className="pe-kv">
        <div><dt>Profit / day (forecast)</dt><dd className={f.profitMinor >= 0 ? 'pe-pos' : 'pe-neg'}>{money(f.profitMinor, true)}</dd></div>
        <div><dt>Margin</dt><dd>{formatBps(Math.max(-10_000, f.marginBps))}</dd></div>
        <div><dt>Startup cost</dt><dd>{money(o.startup.totalMinor)}</dd></div>
        <div><dt>Payback</dt><dd>{f.paybackDays === null ? 'Not at default settings' : `about ${f.paybackDays} days`}</dd></div>
        <div><dt>Competitors</dt><dd>{o.market.competitors}</dd></div>
        <div><dt>Unserved demand / day</dt><dd>{formatUnits(o.market.unmetUnitsPerDay)}</dd></div>
      </dl>
      <div className="pe-row">
        <Link className="pe-btn pe-btn--primary" to={`/start?industry=${o.industry}`} data-testid={`start-${o.industry}`}>Start this company</Link>
        <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Hide details' : 'Why this forecast?'}</Button>
      </div>
      {open && (
        <div className="pe-stack">
          <ul className="pe-reasons">{o.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {o.warnings.length > 0 && <ul className="pe-reasons pe-warnings" aria-label="Warnings">{o.warnings.map((r) => <li key={r}>{r}</li>)}</ul>}
          <table className="pe-table pe-small" aria-label={`${o.label} forecast breakdown`}>
            <tbody>
              <tr><th scope="row">Sales ({formatUnits(f.unitsPerDay)} × {money(f.pricePerUnitMinor)})</th><td className="pe-financial-number">{money(f.revenueMinor)}</td></tr>
              <tr><th scope="row">Ingredients{o.inputs.length ? ` (${o.inputs.map((i) => `${formatUnits(i.unitsPerDay)} ${commodityLabel(i.commodityId)}`).join(', ')})` : ''}</th><td className="pe-financial-number">−{money(f.inputsMinor)}</td></tr>
              <tr><th scope="row">Energy</th><td className="pe-financial-number">−{money(f.energyMinor)}</td></tr>
              <tr><th scope="row">Wages</th><td className="pe-financial-number">−{money(f.wagesMinor)}</td></tr>
              <tr><th scope="row">Rent (cheapest vacant lot)</th><td className="pe-financial-number">−{money(f.rentMinor)}</td></tr>
              {f.feesMinor > 0 && <tr><th scope="row">Exchange fee</th><td className="pe-financial-number">−{money(f.feesMinor)}</td></tr>}
              <tr><th scope="row">Forecast profit</th><td className="pe-financial-number"><strong>{money(f.profitMinor, true)}</strong></td></tr>
            </tbody>
          </table>
          <p className="pe-hint">Market: Bristol wants {formatUnits(o.market.demandUnitsPerDay)}/day, rivals sell {formatUnits(o.market.supplyUnitsPerDay)}/day ({formatBps(Math.min(20_000, o.market.saturationBps))} served). Startup: licence {money(o.startup.licenceMinor)} · premises {money(o.startup.premisesMinor)} · equipment {money(o.startup.equipmentMinor)} · working capital {money(o.startup.workingCapitalMinor)}.</p>
        </div>
      )}
    </article>
  );
}

/** Live market gaps from the exchange: where demand outruns what producers plan to make. Every figure is computed from current simulation state. */
function MarketGaps({ shortages }: { shortages: MarketShortage[] }) {
  const rows = shortages.filter((s) => s.demandUnitsPerDay > 0);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="gaps-t"><h2 id="gaps-t" className="pe-h3">Bristol commodity markets: shortages and gaps</h2>
      <div className="pe-table-scroll"><table className="pe-table" aria-label="Commodity market gaps" data-testid="market-gaps">
        <thead><tr><th scope="col">Market</th><th scope="col" className="pe-num">Demand / day (est.)</th><th scope="col" className="pe-num">Producers plan / day</th><th scope="col" className="pe-num">Shortage / day</th><th scope="col" className="pe-num">Listed now</th><th scope="col" className="pe-num">Recent price</th><th scope="col" className="pe-num">Unit cost</th><th scope="col">Producers</th><th scope="col"><span className="pe-sr">Action</span></th></tr></thead>
        <tbody>{rows.map((s) => (
          <tr key={s.commodityId}><th scope="row">{s.label}</th><td className="pe-financial-number">{formatUnits(s.demandUnitsPerDay)}</td><td className="pe-financial-number">{formatUnits(s.supplyUnitsPerDay)}</td>
            <td className={`pe-financial-number ${s.shortageUnitsPerDay > 0 ? 'pe-neg' : ''}`}>{s.shortageUnitsPerDay > 0 ? formatUnits(s.shortageUnitsPerDay) : '—'}</td><td className="pe-financial-number">{formatUnits(s.listedUnits)}</td>
            <td className="pe-financial-number">{money(s.recentPriceMinor)}{s.priceBasis === 'reference' ? ' (ref.)' : ''}</td><td className="pe-financial-number">{s.unitCostMinor > 0 ? `${money(s.unitCostMinor)} → ${money(s.unitProfitMinor, true)}` : '—'}</td><td>{s.competitors}</td>
            <td>{s.industry ? <Link className="pe-btn pe-btn--secondary" to={`/start?industry=${s.industry}`}>Start a {s.industryLabel!.toLowerCase()}</Link> : <Link className="pe-btn pe-btn--secondary" to={`/commodities?commodity=${s.commodityId}`}>View market</Link>}</td></tr>))}</tbody>
      </table></div>
      <p className="pe-hint">Demand is an <strong>estimate</strong> (funded consumer budgets plus what companies plan to use). Producers' plans and prices are read from the live simulation. Unit cost is ingredients at today's best price plus energy; it excludes wages and rent.</p>
    </section>
  );
}
