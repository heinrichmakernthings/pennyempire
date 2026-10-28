import { useScreen } from '@/data/store';
import { MoneyValue } from '@/ui/MoneyValue';
import { Icon } from '@/ui/Icon';
import { IllustrativeBadge } from '@/ui/States';
import { NavLink } from 'react-router-dom';

/** Top strip: Empire Coins, daily profit, portfolio value (all EC) + player and city. Test GBP never appears here. */
export function FinancialHUD() {
  const { entry } = useScreen('city');
  const ready = entry.status === 'ready' ? entry : null;
  const player = ready?.loaded.envelope.data.player;
  const city = ready?.loaded.envelope.data.city;
  const asOf = ready?.loaded.envelope.asOf;
  return (
    <header className="pe-hud">
      <div className="pe-brand"><span className="pe-brand-mark" aria-hidden="true">PE</span><div><strong>PENNY EMPIRE</strong><small>{city?.name ?? 'Bristol'}</small></div></div>
      <dl className="pe-hud-stats" aria-label="Financial summary, Empire Coins">
        <div><dt>Empire Coins</dt><dd>{player ? <MoneyValue value={player.coins} tone="neutral" /> : <span className="pe-skel-inline" aria-label="Loading" />}</dd></div>
        <div><dt>Daily profit</dt><dd>{player ? <MoneyValue value={player.dailyProfit} signed /> : <span className="pe-skel-inline" aria-label="Loading" />}</dd></div>
        <div><dt>Portfolio</dt><dd>{player ? <MoneyValue value={player.portfolioValue} tone="neutral" /> : <span className="pe-skel-inline" aria-label="Loading" />}</dd></div>
      </dl>
      <div className="pe-hud-meta">
        {ready?.loaded.authority === 'illustrative-fixture' && <IllustrativeBadge compact />}
        {ready?.loaded.authority === 'server' && <span className="pe-live" title="Values come from the server-authoritative economic simulation">Live simulation · Day {ready.loaded.envelope.revision}</span>}
        <span className="pe-hud-city"><Icon name="city" size={16} />{player ? player.displayName : '…'} · {city?.name ?? 'Bristol'}</span>
        {asOf && <time dateTime={asOf} className="pe-hint">{new Date(asOf).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC</time>}
        <NavLink to="/city" className="pe-icon-btn" aria-label={`Notifications${player?.unreadNotifications ? `, ${player.unreadNotifications} unread` : ''}`}><Icon name="notification" />{!!player?.unreadNotifications && <span className="pe-badge">{player.unreadNotifications}</span>}</NavLink>
      </div>
    </header>
  );
}
