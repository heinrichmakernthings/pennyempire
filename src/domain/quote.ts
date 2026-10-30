import type { Money, Quote, QuoteRequest } from '@/contracts/game-state';
import { feeFromBps, isSafeMinor, money } from './money';

export interface QuoteInputs {
  request: QuoteRequest;
  /** Reference/limit price per unit in minor units supplied by the (future) server. */
  unitPriceMinor: number;
  currency: Money['currency'];
  feeBps: number;
  availableUnits: number;
  revision: number;
  /** Injected clock + id so quotes are deterministic in tests and fixtures. */
  now: Date;
  id: string;
  ttlSeconds?: number;
}

export type QuoteResult = { ok: true; quote: Quote } | { ok: false; field: 'quantity' | 'limitPrice'; message: string };

/**
 * ILLUSTRATIVE quote maths used only by the fixture adapter. In production the server issues quotes;
 * the client must display, never compute, authoritative totals. Kept in domain/ (not in components) and fully integer.
 */
export function buildQuote(i: QuoteInputs): QuoteResult {
  const q = i.request.quantity;
  if (!Number.isSafeInteger(q) || q <= 0) return { ok: false, field: 'quantity', message: 'Enter a whole number of units greater than zero.' };
  if (q > i.availableUnits) return { ok: false, field: 'quantity', message: `Only ${i.availableUnits} units available.` };
  if (i.request.limitPriceMinor !== null) {
    if (!isSafeMinor(i.request.limitPriceMinor) || i.request.limitPriceMinor <= 0) return { ok: false, field: 'limitPrice', message: 'Enter a positive limit price.' };
    if (i.request.side === 'buy' && i.request.limitPriceMinor < i.unitPriceMinor) return { ok: false, field: 'limitPrice', message: 'Limit is below the current price; the order would rest unfilled.' };
  }
  const subtotal = i.unitPriceMinor * q;
  const fee = feeFromBps(subtotal, i.feeBps);
  const total = i.request.side === 'buy' ? subtotal + fee : subtotal - fee;
  return {
    ok: true,
    quote: {
      id: i.id,
      expiresAt: new Date(i.now.getTime() + (i.ttlSeconds ?? 30) * 1000).toISOString(),
      revision: i.revision,
      quantity: q,
      subtotal: money(i.currency, subtotal),
      fee: money(i.currency, fee),
      total: money(i.currency, total),
      availableUnits: i.availableUnits,
    },
  };
}

export const isQuoteExpired = (q: Pick<Quote, 'expiresAt'>, now: Date) => Date.parse(q.expiresAt) <= now.getTime();
