import { Link } from 'react-router-dom';
import { summarizePortfolio } from '@/domain/portfolio';
import { formatBps, formatUnits } from '@/domain/money';
import { DataTable } from '@/ui/DataTable';
import { MoneyValue } from '@/ui/MoneyValue';
import { SharePortfolioPanel } from './shares/SharePortfolioPanel';
import { ScreenData } from '@/ui/ScreenData';
import { EmptyState } from '@/ui/States';

/** Everything on this screen is Empire Coins. Simulated GBP lives only in the Wallet. */
export function PortfolioScreen() {
  return (
    <ScreenData screen="portfolio" title="Portfolio">
      {({ player, holdings, listings }, loaded) => {
        const s = summarizePortfolio(holdings, listings);
        return (
          <div className="pe-stack">
            <p className="pe-hint">Values in Empire Coins (EC), the in-game currency. Not money and not convertible to money.</p>
            <dl className="pe-stats pe-stats--wide">
              <div><dt>Net worth</dt><dd><MoneyValue value={player.netWorth} tone="neutral" /></dd></div>
              <div><dt>Available coins</dt><dd><MoneyValue value={player.coins} tone="neutral" /></dd></div>
              <div><dt>Reserved in orders</dt><dd><MoneyValue value={player.reservedCoins} tone="neutral" /></dd></div>
              <div><dt>Shares value</dt><dd><MoneyValue value={s.value} tone="neutral" /></dd></div>
              <div><dt>Unrealised P&amp;L</dt><dd><MoneyValue value={s.unrealized} signed /></dd></div>
              <div><dt>Dividends received</dt><dd><MoneyValue value={s.dividends} tone="neutral" /></dd></div>
            </dl>
            {loaded.authority === 'server' ? <SharePortfolioPanel /> : <>
            <h2 className="pe-h2">Holdings</h2>
            <DataTable caption="Portfolio holdings" rowKey={(l) => l.holding.listingId} rows={s.lines}
              empty={<EmptyState title="Your portfolio is empty" action={<Link className="pe-btn pe-btn--primary" to="/stocks">Browse the Stock Exchange</Link>}>Buy shares in fictional companies to build a portfolio.</EmptyState>}
              columns={[
                { key: 'n', header: 'Company', render: (l) => l.listing?.companyName ?? l.holding.listingId },
                { key: 's', header: 'Shares', align: 'end', render: (l) => formatUnits(l.holding.shares) },
                { key: 'v', header: 'Value', align: 'end', render: (l) => <MoneyValue value={l.holding.value} tone="neutral" /> },
                { key: 'w', header: 'Weight', align: 'end', render: (l) => formatBps(l.shareOfValueBps) },
                { key: 'p', header: 'P&L', align: 'end', render: (l) => <MoneyValue value={l.holding.unrealizedPnl} signed /> },
              ]} />
            {s.lines.length > 0 && <div className="pe-alloc" role="img" aria-label={`Allocation: ${s.lines.map((l) => `${l.listing?.companyName ?? l.holding.listingId} ${formatBps(l.shareOfValueBps)}`).join(', ')}`}>{s.lines.map((l, i) => <span key={l.holding.listingId} className={`pe-alloc-${i % 4}`} style={{ width: `${l.shareOfValueBps / 100}%` }} />)}</div>}
            </>}
          </div>
        );
      }}
    </ScreenData>
  );
}
