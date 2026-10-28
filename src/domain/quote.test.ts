import { buildQuote, isQuoteExpired } from './quote';

const base = { unitPriceMinor: 240, currency: 'EC' as const, feeBps: 200, availableUnits: 100, revision: 3, now: new Date('2026-10-28T12:00:00Z'), id: 'q1' };
const req = (o: Partial<Parameters<typeof buildQuote>[0]['request']> = {}) => ({ kind: 'commodity' as const, entityId: 'flour', companyId: 'c', side: 'buy' as const, quantity: 10, limitPriceMinor: 250, cityId: 'city', ...o });

describe('trading fee quotes', () => {
  it('buy: subtotal + fee = total, all integers', () => {
    const r = buildQuote({ ...base, request: req() });
    expect(r.ok && [r.quote.subtotal.minor, r.quote.fee.minor, r.quote.total.minor]).toEqual([2_400, 48, 2_448]);
  });
  it('sell: fee is deducted from proceeds', () => {
    const r = buildQuote({ ...base, request: req({ side: 'sell', limitPriceMinor: 200 }) });
    expect(r.ok && r.quote.total.minor).toBe(2_400 - 48);
  });
  it('rounds the fee half-up and conserves subtotal = total − fee', () => {
    const r = buildQuote({ ...base, unitPriceMinor: 125, request: req({ quantity: 1 }) });
    expect(r.ok && r.quote.fee.minor).toBe(3);
    expect(r.ok && r.quote.total.minor - r.quote.fee.minor).toBe(125);
  });
  it('enforces inventory limits and whole, positive quantities', () => {
    expect(buildQuote({ ...base, request: req({ quantity: 101 }) })).toMatchObject({ ok: false, field: 'quantity' });
    expect(buildQuote({ ...base, request: req({ quantity: 0 }) })).toMatchObject({ ok: false, field: 'quantity' });
    expect(buildQuote({ ...base, request: req({ quantity: 1.5 }) })).toMatchObject({ ok: false, field: 'quantity' });
  });
  it('rejects a buy limit below the current price', () => {
    expect(buildQuote({ ...base, request: req({ limitPriceMinor: 100 }) })).toMatchObject({ ok: false, field: 'limitPrice' });
  });
  it('quotes expire', () => {
    const r = buildQuote({ ...base, ttlSeconds: 30, request: req() });
    if (!r.ok) throw new Error('quote failed');
    expect(isQuoteExpired(r.quote, new Date('2026-10-28T12:00:29Z'))).toBe(false);
    expect(isQuoteExpired(r.quote, new Date('2026-10-28T12:00:30Z'))).toBe(true);
  });
});
