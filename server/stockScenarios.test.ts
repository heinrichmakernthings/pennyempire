// @vitest-environment node
import { formatStockScenario, runStockScenario, type StockScenarioId } from './stockScenarios';

const run = new Map<StockScenarioId, ReturnType<typeof runStockScenario>>();
const get = (id: StockScenarioId) => { if (!run.has(id)) run.set(id, runStockScenario(id, 90)); return run.get(id)!; };

describe.each<StockScenarioId>(['A', 'B', 'C', 'D', 'E', 'F'])('stock scenario %s', (id) => {
  it('keeps the ledger, the share register and every reservation consistent', () => {
    const r = get(id); expect(r.anomalies).toEqual([]); expect(r.ledgerReconciles).toBe(true); expect(r.sharesConsistent).toBe(true);
    expect(formatStockScenario(r)).toContain('## Timeline');
  });
});

describe('scenario outcomes', () => {
  it('A: a profitable startup lists, sells its offering, pays dividends from its own treasury and the founder keeps control', () => {
    const h = get('A').headline; expect(h.sharesSoldInOffering).toBe(3000); expect(h.dividendsPaidEC as number).toBeGreaterThan(0); expect(h.founderStakeBps as number).toBeGreaterThan(5_100);
    const tl = get('A').timeline; expect(tl.at(-1)!.priceMinor!).toBeGreaterThanOrEqual(tl[0]!.priceMinor!);          // trading, not valuation, moved the price
  });
  it('B: a business that loses its customers sees its market price fall and trading dry up', () => {
    const r = get('B'); expect(r.timeline.at(-1)!.priceMinor!).toBeLessThan(r.timeline[0]!.priceMinor!);   // the price is set by sellers hitting bids, not by the estimate
    expect(r.timeline.slice(-3).reduce((a, t) => a + t.volume, 0)).toBeLessThan(r.timeline.slice(0, 3).reduce((a, t) => a + t.volume, 0) + 1);
  });
  it('C: a bubble can run far above the estimate — only as fast as the daily band allows — and then reverses with losses for the speculators', () => {
    const h = get('C').headline; expect(h.premiumOverEstimatePct as number).toBeGreaterThan(100); expect(h.priceAfterEC as number).toBeLessThan((h.peakPriceEC as number) / 2); expect(h.speculatorNetEC as number).toBeLessThan(0);
  });
  it('D: one human investor trades against NPC participants, who supply most of the volume', () => {
    const h = get('D').headline; expect(h.npcInvestorShareOfVolumePct as number).toBeGreaterThan(50); expect(h.positions as number).toBeGreaterThan(0); expect(h.dividendIncomeEC as number).toBeGreaterThan(0);
  });
  it('E: a buyer who crosses 50% takes control by the published rule; the company’s cash stays in the company', () => {
    const h = get('E').headline; expect(h.controlDay as number).toBeGreaterThan(0); expect(String(h.ownerNow)).toBe('player:player-demo'); expect(h.stakeAtControlPct as number).toBeGreaterThan(50); expect(h.cafeCashAfterEC as number).toBeGreaterThan((h.cafeCashBeforeEC as number) * 0.5);
  });
  it('F: an insolvent company is suspended, then delisted; shareholders lose money and its shares disappear', () => {
    const h = get('F').headline; expect(h.suspendedOnDay as number).toBeGreaterThan(0); expect(h.finalStatus).toBe('delisted'); expect(h.sharesRemaining).toBe(0); expect(h.scriptedHoldersRealisedGainEC as number).toBeLessThan(0);
  });
});
