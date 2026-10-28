import { useEffect, useState } from 'react';
import type { Quote } from '@/contracts/game-state';
import { useDataSource } from '@/data/store';
import { newIdempotencyKey, useCommand } from '@/data/useCommand';
import { formatMoney, parseDecimalToMinor } from '@/domain/money';
import { isQuoteExpired } from '@/domain/quote';
import { Button } from './Button';
import { Field } from './Field';
import { MoneyValue } from './MoneyValue';
import { StatusLabel } from './StatusLabel';

export interface TicketProps {
  kind: 'commodity' | 'shares';
  entityId: string;
  entityName: string;
  cityId: string;
  /** Unit price the instrument currently trades at (for the limit-price default only; the quote is authoritative). */
  referenceMinor: number;
  currency: 'EC';
  companies?: { id: string; name: string }[];
  defaultCompanyId?: string | null;
  tradable?: boolean;
  untradableReason?: string;
}

/**
 * Quote-first ticket: request quote → review subtotal/fee/total → confirm. A changed or expired quote must be re-requested;
 * totals are never accepted silently. Orders are sent through useCommand and are NOT executed in this build.
 */
export function TradeTicket(p: TicketProps) {
  const source = useDataSource();
  const { send, pending } = useCommand();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [qty, setQty] = useState('1');
  const [limit, setLimit] = useState((p.referenceMinor / 100).toFixed(2));
  const [pickedCompany, setPickedCompany] = useState('');
  // Derived, not copied into state: the owned-company list may arrive after first render.
  const companyId = (p.companies?.some((c) => c.id === pickedCompany) ? pickedCompany : '') || (p.companies?.some((c) => c.id === p.defaultCompanyId) ? p.defaultCompanyId : null) || p.companies?.[0]?.id || '';
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [now, setNow] = useState(() => new Date());
  const [key, setKey] = useState(newIdempotencyKey);

  useEffect(() => { setQuote(null); setLimit((p.referenceMinor / 100).toFixed(2)); setErrors({}); }, [p.entityId, p.referenceMinor]);
  useEffect(() => { setQuote(null); setKey(newIdempotencyKey()); }, [side, qty, limit, companyId]); // editing the ticket invalidates the quote
  useEffect(() => { if (!quote) return; const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, [quote]);

  const expired = quote ? isQuoteExpired(quote, now) : false;
  const secondsLeft = quote ? Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - now.getTime()) / 1000)) : 0;

  const requestQuote = async () => {
    const q = Number(qty), l = parseDecimalToMinor(limit);
    const e: Record<string, string | undefined> = {};
    if (!/^\d{1,9}$/.test(qty.trim()) || q <= 0) e.quantity = 'Enter a whole number of units greater than zero.';
    if (l === null || l <= 0) e.limit = 'Enter a limit price such as 2.40.';
    if (p.kind === 'commodity' && !companyId) e.company = 'Choose which company is trading.';
    setErrors(e);
    if (Object.values(e).some(Boolean) || l === null) return;
    setQuoting(true);
    const res = await source.requestQuote({ kind: p.kind, entityId: p.entityId, companyId: companyId || null, side, quantity: q, limitPriceMinor: l, cityId: p.cityId });
    setQuoting(false);
    if (res.ok) { setNow(new Date()); setQuote(res.quote); } else setErrors({ [res.error.fieldErrors ? Object.keys(res.error.fieldErrors)[0]! : 'form']: res.error.message });
  };

  const place = async () => {
    if (!quote || expired) return;
    const l = parseDecimalToMinor(limit)!;
    const body = p.kind === 'commodity'
      ? { type: 'commodity.order' as const, companyId, commodityId: p.entityId, side, quantity: quote.quantity, limitPriceMinor: l, quoteId: quote.id }
      : { type: 'shares.order' as const, listingId: p.entityId, side, quantity: quote.quantity, limitPriceMinor: l, quoteId: quote.id };
    await send(body, { idempotencyKey: key, expectedRevision: quote.revision }, { success: 'Order placed', failure: 'Order not placed' });
  };

  if (p.tradable === false) return <div className="pe-callout" role="note"><strong>Not tradable</strong><p>{p.untradableReason ?? 'This instrument cannot be traded.'}</p></div>;
  return (
    <form className="pe-ticket pe-stack" onSubmit={(e) => { e.preventDefault(); void requestQuote(); }} aria-label={`Trade ${p.entityName}`}>
      <h3 className="pe-h3">Trade {p.entityName}</h3>
      <div role="group" aria-label="Side" className="pe-segment">
        {(['buy', 'sell'] as const).map((s) => <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)}>{s === 'buy' ? 'Buy' : 'Sell'}</button>)}
      </div>
      {p.companies && p.companies.length > 0 && <Field label="Trading company" error={errors.company}><select value={companyId} onChange={(e) => setPickedCompany(e.target.value)}>{p.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
      {p.companies && p.companies.length === 0 && <p className="pe-callout" role="note">You need a company you can manage to trade commodities.</p>}
      <Field label="Quantity (whole units)" error={errors.quantity}><input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
      <Field label="Limit price per unit (EC)" error={errors.limit} hint={`Current reference ${formatMoney({ currency: p.currency, minor: p.referenceMinor })}`}><input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} /></Field>
      {errors.form && <p className="pe-field-error" role="alert">{errors.form}</p>}
      <Button type="submit" pending={quoting} disabled={p.companies?.length === 0}>Get quote</Button>
      {quote && (
        <section className="pe-quote" aria-label="Quote">
          <dl>
            <div><dt>Subtotal</dt><dd><MoneyValue value={quote.subtotal} tone="neutral" /></dd></div>
            <div><dt>Fee</dt><dd><MoneyValue value={quote.fee} tone="neutral" /></dd></div>
            <div className="pe-quote-total"><dt>{side === 'buy' ? 'You pay' : 'You receive'}</dt><dd><MoneyValue value={quote.total} tone="neutral" /></dd></div>
          </dl>
          {expired ? <StatusLabel tone="warning">Quote expired — request a new quote</StatusLabel> : <p className="pe-hint" role="timer" aria-live="off">Quote valid for {secondsLeft}s. Illustrative fee schedule.</p>}
          <Button variant="primary" block pending={pending} disabled={expired} onClick={() => void place()}>Confirm {side === 'buy' ? 'purchase' : 'sale'}</Button>
        </section>
      )}
    </form>
  );
}
