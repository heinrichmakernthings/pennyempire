import { useScreen } from '@/data/store';
import { MoneyValue } from '@/ui/MoneyValue';
import { Icon } from '@/ui/Icon';
import { IllustrativeBadge } from '@/ui/States';
import { NavLink } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '@/data/authClient';
import { useNotifications } from './notifications';

/** Top strip: Empire Coins, daily profit, portfolio value (all EC) + player and city. Test GBP never appears here. */
export function FinancialHUD() {
  const { entry } = useScreen('city');
  const ready = entry.status === 'ready' ? entry : null;
  const player = ready?.loaded.envelope.data.player;
  const city = ready?.loaded.envelope.data.city;
  const asOf = ready?.loaded.envelope.asOf;
  const { status, user } = useAuth();
  const live = useNotifications();
  const signedIn = status === 'signed-in';
  // Real-event feed: polled while signed in; toasts only for events that arrive after the first load.
  useEffect(() => {
    if (!signedIn) return;
    void live.refresh(false);
    const t = setInterval(() => { if (!document.hidden) void useNotifications.getState().refresh(user?.settings.notifications !== false); }, 15_000);
    return () => clearInterval(t);
  }, [signedIn, user?.settings.notifications]);
  const unread = signedIn ? live.unread : player?.unreadNotifications ?? 0;
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
        <NavLink to="/notifications" className="pe-icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}><Icon name="notification" />{!!unread && <span className="pe-badge">{unread}</span>}</NavLink>
        {signedIn && <NavLink to="/account" className="pe-link-btn pe-hud-account" aria-label={`Account: ${user?.displayName}`}>{user?.displayName}</NavLink>}
        {user?.role === 'admin' && <NavLink to="/admin" className="pe-link-btn">Admin</NavLink>}
      </div>
    </header>
  );
}
