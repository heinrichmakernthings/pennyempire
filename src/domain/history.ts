import type { History, HistoryPoint } from '@/contracts/game-state';

const INTERVAL_MS = { hour: 3_600_000, day: 86_400_000 } as const;

/** Splits a history into contiguous runs. A gap larger than 1.5 intervals is a missing observation: runs never join across it. */
export function segments(h: History): HistoryPoint[][] {
  const out: HistoryPoint[][] = [];
  let cur: HistoryPoint[] = [];
  for (const p of h.points) {
    const prev = cur[cur.length - 1];
    if (prev && Date.parse(p.at) - Date.parse(prev.at) > INTERVAL_MS[h.interval] * 1.5) { out.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}

export interface HistorySummary { first: number; last: number; deltaMinor: number; gaps: number; text: string }
export function summarizeHistory(h: History): HistorySummary {
  if (h.points.length === 0) return { first: 0, last: 0, deltaMinor: 0, gaps: 0, text: 'No history yet' };
  const first = h.points[0]!.valueMinor, last = h.points[h.points.length - 1]!.valueMinor;
  const gaps = Math.max(0, segments(h).length - 1);
  const unit = h.interval === 'day' ? 'days' : 'hours';
  const dir = last > first ? 'up' : last < first ? 'down' : 'flat';
  return { first, last, deltaMinor: last - first, gaps, text: `${h.points.length} ${unit}, ${dir}${gaps ? `, ${gaps} missing observation${gaps > 1 ? 's' : ''}` : ''}` };
}
