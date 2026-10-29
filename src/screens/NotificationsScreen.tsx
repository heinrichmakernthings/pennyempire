import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/ui/Button';
import { useNotifications } from '@/app/notifications';
import { useAuth } from '@/data/authClient';

/** Everything here happened in the shared Bristol economy: your fills, your companies' events, dividends and city-wide shocks. */
export function NotificationsScreen() {
  const { items, unread, loaded, refresh, markRead } = useNotifications();
  const status = useAuth((s) => s.status);
  useEffect(() => { if (status === 'signed-in') void refresh(); }, [refresh, status]);
  if (status !== 'signed-in') return <section className="pe-screen"><h1 className="pe-h">Notifications</h1><p className="pe-hint">Notifications are available when you are signed in to the private alpha.</p></section>;
  return (
    <section className="pe-screen">
      <div className="pe-detail-head"><h1 className="pe-h">Notifications</h1>{unread > 0 && <Button onClick={() => void markRead()}>Mark all read</Button>}</div>
      {!loaded ? <p className="pe-hint">Loading…</p> : items.length === 0 ? <p className="pe-empty">Nothing yet. Start a company and events about it will appear here.</p> : (
        <ul className="pe-list pe-notes">
          {items.map((n) => (
            <li key={n.key} className={`pe-list-row pe-note pe-note--${n.severity} ${n.unread ? 'is-unread' : ''}`}>
              <span className="pe-note-day">Day {n.tick}</span>
              <span className="pe-note-msg">{n.unread && <span className="pe-sr-only">Unread: </span>}{n.message}</span>
              {n.link && <Link to={n.link} className="pe-link-btn">Open</Link>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
