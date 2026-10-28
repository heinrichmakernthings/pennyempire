import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from '@/ui/Icon';
import { ResponsiveSheet } from '@/ui/ResponsiveSheet';
import { useBreakpoint } from './useBreakpoint';
import { ROUTES } from './routes';

/** Sidebar (desktop, labelled), rail (tablet, icon + tooltip) and bottom bar with a More sheet (mobile). */
export function PrimaryNavigation() {
  const bp = useBreakpoint();
  const [more, setMore] = useState(false);
  const loc = useLocation();
  if (bp !== 'mobile') {
    return (
      <nav className="pe-nav" aria-label="Main">
        <ul>
          {ROUTES.map((r) => (
            <li key={r.path}>
              <NavLink to={r.path} className="pe-nav-link" title={r.label} aria-label={bp === 'tablet' ? r.label : undefined}>
                <Icon name={r.icon} /><span className={bp === 'tablet' ? 'pe-sr' : ''}>{r.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    );
  }
  const primary = ROUTES.filter((r) => r.mobile === 'primary');
  const rest = ROUTES.filter((r) => r.mobile === 'more');
  const moreActive = rest.some((r) => loc.pathname.startsWith(r.path));
  return (
    <>
      <nav className="pe-bottom-nav" aria-label="Main">
        <ul>
          {primary.map((r) => <li key={r.path}><NavLink to={r.path} className="pe-bottom-link"><Icon name={r.icon} /><span>{r.short}</span></NavLink></li>)}
          <li><button type="button" className={`pe-bottom-link ${moreActive ? 'active' : ''}`} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}><Icon name="settings" /><span>More</span></button></li>
        </ul>
      </nav>
      <ResponsiveSheet open={more} onClose={() => setMore(false)} title="More">
        <ul className="pe-more-list">
          {rest.map((r) => <li key={r.path}><NavLink to={r.path} className="pe-more-link" onClick={() => setMore(false)}><Icon name={r.icon} /> {r.label}</NavLink></li>)}
        </ul>
      </ResponsiveSheet>
    </>
  );
}
