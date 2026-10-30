import { holdings, listings } from '@/data/fixtures/markets';
import { player } from '@/data/fixtures/bristol';
import { summarizePortfolio } from './portfolio';

describe('portfolio summary', () => {
  it('sums holdings in integers and matches the player portfolio value', () => {
    const s = summarizePortfolio(holdings, listings);
    expect(s.value.minor).toBe(player.portfolioValue.minor);
    expect(s.unrealized.minor).toBe(s.value.minor - s.costBasis.minor);
    expect(s.lines.reduce((a, l) => a + l.shareOfValueBps, 0)).toBeGreaterThanOrEqual(9_998);
  });
  it('empty portfolio is zero, not NaN', () => { expect(summarizePortfolio([], listings).value.minor).toBe(0); });
});
