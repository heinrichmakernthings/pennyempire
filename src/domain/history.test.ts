import type { History } from '@/contracts/game-state';
import { segments, summarizeHistory } from './history';

const day = (d: number, v: number) => ({ at: new Date(Date.UTC(2026, 9, d)).toISOString(), valueMinor: v });
const h = (points: { at: string; valueMinor: number }[]): History => ({ currency: 'EC', interval: 'day', points, complete: true });

describe('history', () => {
  it('never bridges missing observations', () => {
    const s = segments(h([day(20, 1), day(21, 2), day(23, 3), day(24, 4)]));
    expect(s.map((x) => x.length)).toEqual([2, 2]);
  });
  it('summarises empty history as "No history yet"', () => { expect(summarizeHistory(h([])).text).toBe('No history yet'); });
  it('reports direction and gaps in text', () => {
    expect(summarizeHistory(h([day(20, 5), day(22, 9)])).text).toMatch(/up, 1 missing/);
  });
});
