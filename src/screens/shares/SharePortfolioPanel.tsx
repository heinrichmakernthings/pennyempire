import { Link } from 'react-router-dom';
import { fetchSharePortfolio } from '@/data/shareClient';
import { useQuery } from '@/data/managementApi';
import { formatBps, formatMoney, formatUnits } from '@/domain/money';
import { ErrorState, Skeleton } from '@/ui/States';

const ec = (m: number | null, signed = false) => (m === null ? '—' : formatMoney({ currency: 'EC', minor: m }, { signed }));
const tone = (m: number | null) => (m === null ? '' : m > 0 ? 'pe-pos' : m < 0 ? 'pe-neg' : '');

/** The player's investments in fictional shares. Estimated values (marked at the last trade) are kept apart from realised gains and dividends, which are the only things that become spendable coins. */
export function SharePortfolioPanel() {
  const q = useQuery((s) => fetchSharePortfolio(s), [], true);
  if (q.status === 'loading') return <Skeleton lines={5} label="Loading your investments" />;
  if (q.status === 'error') return <ErrorState title="Couldn’t load your investments" message={q.error} onRetry={q.reload} />;
  const p = q.data.portfolio; const t = p.totals;
  return (
    <section aria-labelledby="shp-t" className="pe-stack" data-testid="share-portfolio"><h2 id="shp-t" className="pe-h2">Share investments</h2>
      <dl className="pe-stats pe-stats--wide">
        <div><dt>Empire Coins available</dt><dd className="pe-financial-number">{ec(p.cashAvailableMinor)}</dd><small className="pe-hint">{p.cashReservedMinor > 0 ? `${ec(p.cashReservedMinor)} reserved by open orders` : 'nothing reserved'}</small></div>
        <div><dt>Market value of shares <span className="pe-tag-forecast">ESTIMATE</span></dt><dd className="pe-financial-number" data-testid="sp-value">{ec(t.marketValueMinor)}</dd><small className="pe-hint">at last trade prices; not spendable</small></div>
        <div><dt>Unrealised gain / loss <span className="pe-tag-forecast">ESTIMATE</span></dt><dd className={`pe-financial-number ${tone(t.unrealisedMinor)}`}>{ec(t.unrealisedMinor, true)}</dd></div>
        <div><dt>Realised gain / loss</dt><dd className={`pe-financial-number ${tone(t.realisedMinor)}`} data-testid="sp-realised">{ec(t.realisedMinor, true)}</dd><small className="pe-hint">from completed sales and liquidations</small></div>
        <div><dt>Dividend income</dt><dd className="pe-financial-number pe-pos" data-testid="sp-dividends">{ec(t.dividendIncomeMinor)}</dd><small className="pe-hint">paid into your wallet</small></div>
        <div><dt>Trading fees paid</dt><dd className="pe-financial-number">{ec(t.feesPaidMinor)}</dd></div>
      </dl>
      <p className="pe-hint">{p.note}</p>
      {p.positions.length === 0 ? <p className="pe-hint">You hold no shares yet. <Link to="/stocks">Open the exchange</Link> to find a company.</p> : (
        <div className="pe-table-wrap" role="region" aria-label="Share positions" tabIndex={0}><table className="pe-table pe-small" data-testid="positions">
          <caption className="pe-sr">Your share positions</caption>
          <thead><tr><th scope="col">Company</th><th scope="col" className="pe-end">Shares</th><th scope="col" className="pe-end">Stake</th><th scope="col" className="pe-end">Avg cost</th><th scope="col" className="pe-end">Price</th><th scope="col" className="pe-end">Value (est.)</th><th scope="col" className="pe-end">Unrealised</th><th scope="col" className="pe-end">Dividends</th></tr></thead>
          <tbody>{p.positions.map((x) => (
            <tr key={`${x.investorId}:${x.companyId}`}><th scope="row"><Link to={`/stocks?c=${x.companyId}`}>{x.ticker}</Link> <small className="pe-hint">{x.name}{x.investorId !== 'player-demo' ? ` · held by ${x.investorName}` : ''}{x.status === 'unlisted' ? ' · not listed' : ''}</small></th>
              <td className="pe-end pe-financial-number">{formatUnits(x.shares)}{x.reservedShares ? ` (${formatUnits(x.reservedShares)} on offer)` : ''}</td><td className="pe-end">{formatBps(x.stakeBps)}</td>
              <td className="pe-end pe-financial-number">{ec(x.avgCostMinor)}</td><td className="pe-end pe-financial-number">{ec(x.markMinor)}{x.markBasis !== 'trade' && x.markMinor !== null ? <small className="pe-hint"> ({x.markBasis})</small> : null}</td>
              <td className="pe-end pe-financial-number">{ec(x.marketValueMinor)}</td><td className={`pe-end pe-financial-number ${tone(x.unrealisedMinor)}`}>{ec(x.unrealisedMinor, true)}</td><td className="pe-end pe-financial-number">{ec(x.dividendsMinor)}</td></tr>
          ))}</tbody></table></div>
      )}
      {p.allocation.length > 1 && <div aria-label="Allocation" className="pe-alloc">{p.allocation.map((a) => <span key={a.ticker} style={{ flexGrow: a.bps }} title={`${a.name} ${formatBps(a.bps)}`}>{a.ticker} {formatBps(a.bps)}</span>)}</div>}
      <details><summary>Transaction history ({p.transactions.length})</summary>
        <div className="pe-table-wrap" role="region" aria-label="Share transactions" tabIndex={0}><table className="pe-table pe-small"><caption className="pe-sr">Share transactions</caption><thead><tr><th scope="col">Day</th><th scope="col">What</th><th scope="col">Company</th><th scope="col" className="pe-end">Shares</th><th scope="col" className="pe-end">Price</th><th scope="col" className="pe-end">Coins</th><th scope="col" className="pe-end">Fee</th></tr></thead>
          <tbody>{p.transactions.map((x) => <tr key={x.id}><td>{new Date(x.gameDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</td><td>{x.note}</td><td>{x.ticker}</td><td className="pe-end pe-financial-number">{x.qty === null ? '' : formatUnits(x.qty)}</td><td className="pe-end pe-financial-number">{x.priceMinor === null ? '' : ec(x.priceMinor)}</td><td className={`pe-end pe-financial-number ${tone(x.amountMinor)}`}>{ec(x.amountMinor, true)}</td><td className="pe-end pe-financial-number">{x.feeMinor ? ec(x.feeMinor) : ''}</td></tr>)}</tbody></table></div></details>
    </section>
  );
}
