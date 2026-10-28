import { useEffect, useMemo, useState } from 'react';
import { requestExchangeQuote, type Holding, type ServerQuote } from '@/data/exchangeClient';
import { newIdempotencyKey, useCommand } from '@/data/useCommand';
import { formatMoney, formatUnits, parseDecimalToMinor } from '@/domain/money';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Tip } from '../company/panels';

const ec = (minor: number) => formatMoney({ currency: 'EC', minor });
export interface TicketDefaults { side?: 'buy' | 'sell'; companyId?: string; limitMinor?: number; qty?: number; /** buy only from this supplier */ fromCompanyId?: string; fromName?: string }

/**
 * Buy/sell ticket for the Penny Exchange. Quote first (server-authoritative: executable units, fee, reservation), review, then confirm.
 * Company money and stock are shown separately from the player's wallet; reservations are listed next to what is spendable.
 */
export function OrderTicket({ commodityId, name, unit, referenceMinor, bestAskMinor, bestBidMinor, holdings, defaults, onPlaced, heading = true }: {
  commodityId: string; name: string; unit: string; referenceMinor: number; bestAskMinor: number | null; bestBidMinor: number | null; holdings: Holding[]; defaults?: TicketDefaults; onPlaced?: () => void; heading?: boolean;
}) {
  const { send, pending } = useCommand();
  const [side, setSide] = useState<'buy' | 'sell'>(defaults?.side ?? 'buy');
  const [kind, setKind] = useState<'limit' | 'market' | 'direct'>(defaults?.fromCompanyId ? 'direct' : 'limit');
  const direct = kind === 'direct' ? defaults?.fromCompanyId : undefined;
  const [companyId, setCompanyId] = useState(defaults?.companyId ?? holdings[0]?.companyId ?? '');
  const [qty, setQty] = useState(String(defaults?.qty ?? 10));
  const [limit, setLimit] = useState(((defaults?.limitMinor ?? bestAskMinor ?? referenceMinor) / 100).toFixed(2));
  const [slip, setSlip] = useState('5');
  const [days, setDays] = useState('30');
  const [quote, setQuote] = useState<ServerQuote | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const co = holdings.find((h) => h.companyId === companyId) ?? holdings[0];
  useEffect(() => { if (!holdings.some((h) => h.companyId === companyId) && holdings[0]) setCompanyId(holdings[0].companyId); }, [holdings, companyId]);
  useEffect(() => { setQuote(null); setKey(newIdempotencyKey()); setOutcome(null); }, [side, kind, companyId, qty, limit, slip, days, commodityId]);
  useEffect(() => { if (defaults) { if (defaults.side) setSide(defaults.side); if (defaults.companyId) setCompanyId(defaults.companyId); if (defaults.qty) setQty(String(defaults.qty)); if (defaults.limitMinor) setLimit((defaults.limitMinor / 100).toFixed(2)); setKind(defaults.fromCompanyId ? 'direct' : 'limit'); } }, [defaults?.fromCompanyId, defaults?.side, defaults?.companyId, defaults?.qty, defaults?.limitMinor]);   // eslint-disable-line react-hooks/exhaustive-deps

  const n = Number(qty), lim = parseDecimalToMinor(limit);
  const basicErrors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!/^\d{1,9}$/.test(qty.trim()) || n <= 0) e.quantity = 'Enter a whole number of units greater than zero.';
    if (kind !== 'market' && (lim === null || lim <= 0)) e.limit = 'Enter a price such as 2.40.';
    if (kind === 'market' && !(Number(slip) >= 0 && Number(slip) <= 20)) e.slippage = 'Choose 0–20%.';
    if (!/^\d{1,3}$/.test(days.trim()) || Number(days) < 1 || Number(days) > 60) e.days = 'Choose 1–60 days.';
    if (!co) e.company = 'You need a company that can trade.';
    return e;
  }, [qty, n, kind, lim, slip, days, co]);

  const review = async () => {
    setErrors(basicErrors); setOutcome(null);
    if (Object.keys(basicErrors).length) return;
    setBusy(true);
    try {
      const r = await requestExchangeQuote({ companyId, commodityId, side, quantity: n, limitPriceMinor: kind === 'market' ? 0 : lim!, orderKind: kind, fromCompanyId: direct, slippageBps: kind === 'market' ? Math.round(Number(slip) * 100) : undefined, expiresInTicks: kind === 'limit' ? Number(days) : null });
      if (r.ok) setQuote(r.quote); else setErrors({ form: r.error.message, ...(r.error.fieldErrors ?? {}) });
    } catch (e) { setErrors({ form: e instanceof Error ? e.message : 'Could not reach the exchange.' }); }
    setBusy(false);
  };
  const place = async () => {
    if (!quote) return;
    const res = await send({ type: 'commodity.order', companyId, commodityId, side, quantity: quote.quantity, limitPriceMinor: quote.limitPriceMinor, quoteId: quote.id, orderKind: kind, fromCompanyId: direct, slippageBps: quote.slippageBps ?? undefined, expiresInTicks: kind === 'limit' ? Number(days) : null },
      { idempotencyKey: key, expectedRevision: quote.revision }, { success: side === 'buy' ? 'Buy order placed' : 'Sell order placed', failure: 'Order not placed' });
    if (res?.ok) {
      const d = (res as unknown as { data?: { filled: number; remaining: number; status: string } }).data;
      setOutcome(d ? `${d.filled > 0 ? `${formatUnits(d.filled)} ${unit}s filled at once. ` : 'Nothing filled yet. '}${d.remaining > 0 && kind === 'limit' ? `${formatUnits(d.remaining)} remain on the book until filled, cancelled or expired.` : d.remaining > 0 ? `${formatUnits(d.remaining)} could not be filled ${kind === 'direct' ? 'from that supplier at your price' : 'inside your price protection'} and were cancelled.` : 'The order is complete.'}` : 'Order placed.');
      setQuote(null); setKey(newIdempotencyKey()); onPlaced?.();
    } else if (res && !res.ok) setErrors({ form: res.error.message });
  };

  const freeNote = co ? (side === 'sell' ? `Free to sell: ${formatUnits(co.freeUnits)} ${unit}s (${formatUnits(co.reservedUnits)} reserved by your open sell orders${co.autoListedUnits > 0 ? `; ${formatUnits(co.autoListedUnits)} more sit in your automatic daily listing and are released if you place a sale` : ''})` : `Available to spend: ${ec(co.availableCashMinor)} of ${ec(co.cashMinor)} company cash${co.availableCashMinor < co.cashMinor ? ` (${ec(co.cashMinor - co.availableCashMinor)} is reserved by open buy orders)` : ''}`) : '';
  return (
    <form className="pe-ticket-box" onSubmit={(e) => { e.preventDefault(); void review(); }} aria-label={`Trade ${name}`} data-testid="order-ticket">
      {heading && <h3 className="pe-h3" style={{ margin: 0 }}>Trade {name}</h3>}
      <div className="pe-seg" role="group" aria-label="Side">{(['buy', 'sell'] as const).map((s) => <button key={s} type="button" data-side={s} aria-pressed={side === s} onClick={() => setSide(s)} data-testid={`side-${s}`}>{s === 'buy' ? 'Buy' : 'Sell'}</button>)}</div>
      {direct && <p className="pe-callout" role="note" data-testid="direct-note"><span>Direct purchase from <strong>{defaults?.fromName ?? 'the chosen supplier'}</strong>: fills only against their listing at up to your price; anything they cannot supply is cancelled. <button type="button" className="pe-btn pe-btn--ghost" onClick={() => setKind('limit')}>Use the open market instead</button></span></p>}
      <div className="pe-seg" role="group" aria-label="Order type">
        <button type="button" aria-pressed={kind === 'limit'} onClick={() => setKind('limit')}>Limit</button>
        <button type="button" aria-pressed={kind === 'market'} onClick={() => setKind('market')} data-testid="kind-market">Market (protected)</button>
      </div>
      <Field label="Trading company" error={errors.company}><select value={companyId} onChange={(e) => setCompanyId(e.target.value)} data-testid="ticket-company">{holdings.map((h) => <option key={h.companyId} value={h.companyId}>{h.companyName}</option>)}</select></Field>
      {freeNote && <p className="pe-hint" data-testid="free-note">{freeNote}</p>}
      <Field label={`Quantity (${unit}s, whole units)`} error={errors.quantity}><input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="ticket-qty" /></Field>
      {kind === 'limit' ? (
        <>
          <Field label={`${side === 'buy' ? 'Highest' : 'Lowest'} price per ${unit} (EC)`} error={errors.limit} hint={`Reference ${ec(referenceMinor)} · best sell ${bestAskMinor === null ? 'none' : ec(bestAskMinor)} · best buy ${bestBidMinor === null ? 'none' : ec(bestBidMinor)}`}><input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} data-testid="ticket-limit" /></Field>
          <Field label="Order lasts (days)" error={errors.days} hint="Unfilled quantity expires and releases its reservation."><input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        </>
      ) : (
        <Field label="Price protection (%)" error={errors.slippage} hint={`Fills immediately against the live book, never beyond best price ± this margin; anything unfilled is cancelled. ${side === 'buy' ? (bestAskMinor === null ? 'Nobody is selling right now.' : `Best sell ${ec(bestAskMinor)}.`) : (bestBidMinor === null ? 'Nobody is buying right now.' : `Best buy ${ec(bestBidMinor)}.`)}`}><input inputMode="decimal" value={slip} onChange={(e) => setSlip(e.target.value)} /></Field>
      )}
      {errors.form && <p className="pe-field-error" role="alert" data-testid="ticket-error">{errors.form}</p>}
      <Button type="submit" pending={busy} disabled={!co} data-testid="ticket-review">Review order</Button>
      {outcome && <p className="pe-callout" role="status" data-testid="ticket-outcome">{outcome}</p>}
      {quote && (
        <section aria-label="Order review" data-testid="ticket-quote" className="pe-stack">
          <dl className="pe-review">
            <dt>Company</dt><dd>{co?.companyName}</dd>
            <dt>{kind === 'market' ? `Price ${side === 'buy' ? 'cap' : 'floor'}` : `${side === 'buy' ? 'Highest' : 'Lowest'} price`} <Tip>{kind === 'market' ? 'Protection price: the order never trades beyond this.' : 'The order never trades at a worse price than this.'}</Tip></dt><dd>{ec(quote.limitPriceMinor)} per {unit}</dd>
            <dt>Requested</dt><dd>{formatUnits(quote.quantity)} {unit}s</dd>
            <dt>Fillable right now <Tip>Units on the live book at or inside your price. The rest would rest on the book (limit) or be cancelled (market).</Tip></dt><dd>{formatUnits(quote.availableUnits)} {unit}s</dd>
            <dt>Estimated value of fills</dt><dd>{ec(quote.subtotal.minor)}</dd>
            <dt>Exchange fee ({side === 'sell' ? 'paid by you, the seller' : 'paid by the seller'})</dt><dd>{ec(quote.fee.minor)}</dd>
            <dt className="pe-total">{side === 'buy' ? 'You would pay now' : 'You would receive now'}</dt><dd className="pe-total">{ec(quote.total.minor)}</dd>
            <dt>{side === 'buy' ? 'Coins reserved while the order rests' : 'Units reserved while the order rests'}</dt><dd>{side === 'buy' ? ec(quote.reserveMinor) : `${formatUnits(quote.quantity)} ${unit}s`}</dd>
            <dt>Order type</dt><dd>{kind === 'market' ? 'Immediate-or-cancel (market)' : kind === 'direct' ? 'Direct purchase, immediate-or-cancel' : `Limit, lasts ${days} day(s)`}</dd>
          </dl>
          <Button variant="primary" block pending={pending} onClick={() => void place()} data-testid="ticket-confirm">Confirm {side === 'buy' ? 'purchase order' : 'sale order'}</Button>
        </section>
      )}
    </form>
  );
}
