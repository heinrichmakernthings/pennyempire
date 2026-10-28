import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchListingQuote, useShareCommand } from '@/data/shareClient';
import { useDataSource } from '@/data/store';
import { newIdempotencyKey } from '@/data/useCommand';
import { formatBps, formatMoney, formatUnits, parseDecimalToMinor } from '@/domain/money';
import type { ListingQuoteDto } from '@/shared/securities';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { EmptyState, ErrorState } from '@/ui/States';
import { StatusLabel } from '@/ui/StatusLabel';

const ec = (minor: number) => formatMoney({ currency: 'EC', minor });

/** List a company on the Penny Exchange: requirements, offer terms, dilution and cost, then confirm. Every check and cost comes from the same server function that guards the action. */
export function IpoScreen() {
  const { companyId = '' } = useParams(); const source = useDataSource(); const { send, pending } = useShareCommand();
  const [shares, setShares] = useState('2000'); const [price, setPrice] = useState(''); const [quote, setQuote] = useState<ListingQuoteDto | null>(null); const [fair, setFair] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null); const [result, setResult] = useState<string | null>(null); const [key, setKey] = useState(newIdempotencyKey);
  // first look: fundamental estimate and requirements with a token offering
  useEffect(() => {
    if (source.authority !== 'server') return;
    fetchListingQuote({ companyId, newShares: 1, offerPriceMinor: 1 }).then((r) => { setFair(r.quote.priceRange.fairValueMinor); setPrice((r.quote.priceRange.fairValueMinor / 100).toFixed(2)); }).catch((e: Error) => setErr(e.message));
  }, [companyId, source.authority]);
  useEffect(() => {
    const n = Number(shares), p = parseDecimalToMinor(price);
    if (source.authority !== 'server' || !/^\d{1,7}$/.test(shares.trim()) || n <= 0 || !p || p <= 0) { setQuote(null); return; }
    setKey(newIdempotencyKey()); const h = setTimeout(() => { fetchListingQuote({ companyId, newShares: n, offerPriceMinor: p }).then((r) => { setQuote(r.quote); setErr(null); }).catch((e: Error) => setErr(e.message)); }, 250);
    return () => clearTimeout(h);
  }, [companyId, shares, price, source.authority]);
  if (source.authority !== 'server') return <div className="pe-screen"><h1 className="pe-h1">List a company</h1><EmptyState title="Listing needs the game server">Connect to the game server to list a company.</EmptyState></div>;
  const confirm = async () => {
    if (!quote) return;
    const r = await send({ type: 'share.list', companyId, newShares: Number(shares), offerPriceMinor: parseDecimalToMinor(price) }, { success: 'Company listed', failure: 'Listing refused' }, key);
    if (r.ok) setResult('Your company is now listed. The new shares are on offer at your price; the company receives the proceeds as they sell.'); else setErr(r.message);
  };
  return (
    <div className="pe-screen" data-testid="ipo-screen">
      <div className="pe-screen-head"><h1 className="pe-h1">List on the Penny Exchange</h1></div>
      <p className="pe-callout" role="note"><Icon name="warning" size={18} /><span>Fictional shares, Empire Coins only. Selling shares gives other players a stake in your company and a share of its dividends. Nothing here can be turned into real money.</span></p>
      {result ? <div className="pe-card pe-stack" role="status" data-testid="ipo-done"><h2 className="pe-h2">Listed</h2><p>{result}</p><p><Link className="pe-btn pe-btn--primary" to={`/stocks?c=${companyId}`}>Open the trading screen</Link></p></div> : (
        <div className="pe-stack">
          {err && <ErrorState title="Problem" message={err} />}
          <section className="pe-card pe-stack" aria-labelledby="ipo-1"><h2 id="ipo-1" className="pe-h2">1. Requirements</h2>
            {!quote ? <p className="pe-hint">Enter your offer below to see which requirements are met.</p> : <ul className="pe-checks" data-testid="ipo-checks">{quote.checks.map((c) => <li key={c.id}><StatusLabel tone={c.ok ? 'positive' : 'negative'}>{c.ok ? 'Met' : 'Not met'}</StatusLabel> <strong>{c.label}</strong><span className="pe-hint"> {c.detail}</span></li>)}</ul>}</section>
          <section className="pe-card pe-stack" aria-labelledby="ipo-2"><h2 id="ipo-2" className="pe-h2">2. Your offer</h2>
            <Field label="New shares to issue" hint={`Whole shares. The company currently has ${quote ? formatUnits(quote.dilution.issuedBefore) : '10,000'} shares.`}><input inputMode="numeric" value={shares} onChange={(e) => setShares(e.target.value)} data-testid="ipo-shares" /></Field>
            <Field label="Offer price per share (EC)" hint={quote ? `Allowed ${ec(quote.priceRange.lowMinor)} – ${ec(quote.priceRange.highMinor)}. Fundamental estimate ${ec(quote.priceRange.fairValueMinor)} a share (an estimate; the market sets real prices).` : fair ? `Fundamental estimate ${ec(fair)} a share.` : undefined}><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="ipo-price" /></Field></section>
          {quote && <section className="pe-card pe-stack" aria-labelledby="ipo-3" data-testid="ipo-review"><h2 id="ipo-3" className="pe-h2">3. Dilution and cost</h2>
            <dl className="pe-review"><dt>Raised if every share sells</dt><dd>{ec(quote.offeringValueMinor)} <span className="pe-hint">(paid into the company treasury)</span></dd><dt>Listing fee (paid by the company)</dt><dd>{ec(quote.listingFeeMinor)}</dd>
              <dt>Shares issued after</dt><dd>{formatUnits(quote.dilution.issuedAfter)}</dd><dt>Your stake now</dt><dd>{formatBps(quote.dilution.controllerStakeBeforeBps)}</dd><dt>Your stake after a full sale</dt><dd className={quote.dilution.controllerStakeAfterBps < 5_100 ? 'pe-neg' : ''}>{formatBps(quote.dilution.controllerStakeAfterBps)}</dd><dt>New investors would own</dt><dd>{formatBps(quote.dilution.newInvestorsBps)}</dd></dl>
            <p className="pe-hint">Unsold shares stay in the company’s treasury: they earn no dividend and dilute nobody until they are sold. The fee is a transfer to the Penny Exchange, not destroyed.</p>
            <Button variant="primary" block disabled={!quote.eligible} pending={pending} onClick={() => void confirm()} data-testid="ipo-confirm">{quote.eligible ? `List and offer ${formatUnits(Number(shares))} shares` : 'Requirements not met yet'}</Button></section>}
        </div>
      )}
      <p><Link to="/stocks">← Back to the exchange</Link></p>
    </div>
  );
}
