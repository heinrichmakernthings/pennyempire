import { useId } from 'react';
import type { History } from '@/contracts/game-state';
import { formatMoney } from '@/domain/money';
import { segments, summarizeHistory } from '@/domain/history';
import { DataTable } from './DataTable';

export interface Series { key: string; label: string; history: History; style: 'revenue' | 'expense' | 'profit' | 'price' }

const W = 560, H = 180, L = 56, R = 12, T = 12, B = 28;
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Subtle multi-series line chart: ≥280×120, named period + currency, zero baseline, gaps never bridged,
 * dash/colour double-encoding, and an always-available accessible table. Values come from typed server aggregates only.
 */
export function FinancialChart({ title, series, periodLabel }: { title: string; series: Series[]; periodLabel: string }) {
  const id = useId();
  const all = series.flatMap((s) => s.history.points);
  if (all.length === 0) return <div className="pe-empty"><p>No history yet</p></div>;
  const currency = series[0]!.history.currency;
  const vals = all.map((p) => p.valueMinor);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals), span = max - min || 1;
  const times = all.map((p) => Date.parse(p.at));
  const t0 = Math.min(...times), t1 = Math.max(...times), ts = t1 - t0 || 1;
  const x = (at: string) => L + ((Date.parse(at) - t0) / ts) * (W - L - R);
  const y = (v: number) => T + (1 - (v - min) / span) * (H - T - B);
  const ticks = [min, min + span / 2, max].map((v) => Math.round(v));
  const days = [...new Set(all.map((p) => p.at))].sort();
  const lookup = (s: Series, at: string) => s.history.points.find((p) => p.at === at)?.valueMinor;
  const summary = series.map((s) => `${s.label}: ${summarizeHistory(s.history).text}`).join('; ');
  return (
    <figure className="pe-chart" aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`}><strong>{title}</strong> <span className="pe-hint">· {periodLabel} · {currency === 'EC' ? 'Empire Coins (EC)' : currency}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="pe-chart-svg" role="img" aria-label={`${title}. ${summary}. A table with the same data follows.`}>
        {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 0 ? 'pe-chart-zero' : 'pe-chart-grid'} /><text x={L - 6} y={y(v) + 4} textAnchor="end" className="pe-chart-label">{formatMoney({ currency, minor: v }).replace(/ (EC|GBP_TEST)$/, '')}</text></g>)}
        {[days[0], days[days.length - 1]].filter((d): d is string => !!d).map((d, i) => <text key={d} x={x(d)} y={H - 8} textAnchor={i === 0 ? 'start' : 'end'} className="pe-chart-label">{fmtDay(d)}</text>)}
        {series.map((s) => segments(s.history).map((seg, i) => seg.length === 1
          ? <circle key={`${s.key}${i}`} cx={x(seg[0]!.at)} cy={y(seg[0]!.valueMinor)} r={3} className={`pe-chart-dot pe-chart-${s.style}`} />
          : <polyline key={`${s.key}${i}`} fill="none" className={`pe-chart-line pe-chart-${s.style}`} points={seg.map((p) => `${x(p.at).toFixed(1)},${y(p.valueMinor).toFixed(1)}`).join(' ')} />))}
      </svg>
      <ul className="pe-legend">{series.map((s) => <li key={s.key}><span className={`pe-swatch pe-chart-${s.style}`} aria-hidden="true" />{s.label}</li>)}</ul>
      <details className="pe-details">
        <summary>View as table</summary>
        <DataTable caption={`${title} data table`} rowKey={(d) => d} rows={days}
          columns={[{ key: 'd', header: 'Day (UTC)', render: (d) => fmtDay(d) }, ...series.map((s) => ({ key: s.key, header: s.label, align: 'end' as const, render: (d: string) => { const v = lookup(s, d); return v === undefined ? 'No data' : formatMoney({ currency, minor: v }); } }))]} />
      </details>
    </figure>
  );
}
