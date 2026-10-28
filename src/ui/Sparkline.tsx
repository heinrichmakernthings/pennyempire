import type { History } from '@/contracts/game-state';
import { formatMoney } from '@/domain/money';
import { summarizeHistory, segments } from '@/domain/history';

/** 120×32 compact trend. Missing observations break the line (never interpolated). Always paired with a text summary. */
export function Sparkline({ history, label, width = 120, height = 32, tone = 'positive' }: { history: History; label: string; width?: number; height?: number; tone?: 'positive' | 'accent' | 'negative' }) {
  if (history.points.length === 0) return <span className="pe-hint">No history yet</span>;
  const vals = history.points.map((p) => p.valueMinor);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals), span = max - min || 1;
  const t0 = Date.parse(history.points[0]!.at), t1 = Date.parse(history.points[history.points.length - 1]!.at), tspan = t1 - t0 || 1;
  const pad = 3;
  const x = (at: string) => (history.points.length === 1 ? width / 2 : pad + ((Date.parse(at) - t0) / tspan) * (width - pad * 2));
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const summary = summarizeHistory(history);
  const money = (n: number) => formatMoney({ currency: history.currency, minor: n });
  return (
    <figure className="pe-spark">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${summary.text} Latest ${money(summary.last)}.`}>
        <line x1={0} x2={width} y1={y(0)} y2={y(0)} className="pe-spark-zero" />
        {segments(history).map((seg, i) => seg.length === 1
          ? <circle key={i} cx={x(seg[0]!.at)} cy={y(seg[0]!.valueMinor)} r={2} className={`pe-spark-dot pe-spark-${tone}`} />
          : <polyline key={i} fill="none" className={`pe-spark-line pe-spark-${tone}`} points={seg.map((p) => `${x(p.at).toFixed(1)},${y(p.valueMinor).toFixed(1)}`).join(' ')} />)}
      </svg>
      <figcaption className="pe-hint">{summary.text}</figcaption>
    </figure>
  );
}
