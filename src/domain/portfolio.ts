import type { Holding, Listing, Money } from '@/contracts/game-state';

export interface PortfolioSummary { value: Money; costBasis: Money; unrealized: Money; dividends: Money; lines: { holding: Holding; listing: Listing | undefined; shareOfValueBps: number }[] }

/** Display-only aggregation of server-provided holdings (integers). Authoritative totals come from Player.portfolioValue. */
export function summarizePortfolio(holdings: Holding[], listings: Listing[]): PortfolioSummary {
  const sum = (f: (h: Holding) => number) => holdings.reduce((a, h) => a + f(h), 0);
  const value = sum((h) => h.value.minor);
  return {
    value: { currency: 'EC', minor: value }, costBasis: { currency: 'EC', minor: sum((h) => h.costBasis.minor) },
    unrealized: { currency: 'EC', minor: sum((h) => h.unrealizedPnl.minor) }, dividends: { currency: 'EC', minor: sum((h) => h.dividendsReceived.minor) },
    lines: holdings.map((h) => ({ holding: h, listing: listings.find((l) => l.id === h.listingId), shareOfValueBps: value === 0 ? 0 : Math.round((h.value.minor * 10_000) / value) })),
  };
}
