import { useEffect, useRef } from 'react';
import { useDataSource } from '@/data/store';

/**
 * Advertising placements, SIMULATED. Every placement has a fixed, reserved height (so nothing ever shifts when an ad loads), is non-interactive (no links or buttons, so nothing
 * can be clicked by accident), never overlays gameplay controls, and is labelled. No advertising network is connected: the creative is a house placeholder. Each placement
 * records one anonymous impression per page view (the slot name only) once it is actually visible, which the treasury shows as "simulated placements", never as revenue.
 * Placements: top banner and sidebar (desktop only), in-flow (any width, inside content) and mobile banner (phones, in content, never sticky).
 */
export type AdPlacement = 'top' | 'sidebar' | 'in-flow' | 'mobile';
const CLASS: Record<AdPlacement, string> = { top: 'pe-adslot pe-adslot--top', sidebar: 'pe-adslot pe-adslot--side', 'in-flow': 'pe-adslot pe-adslot--inflow', mobile: 'pe-adslot pe-adslot--mobile' };
const SLOT: Record<AdPlacement, string> = { top: 'top-banner', sidebar: 'sidebar', 'in-flow': 'in-flow', mobile: 'mobile-banner' };

export function AdSlot({ placement = 'top' }: { placement?: AdPlacement }) {
  const ref = useRef<HTMLElement>(null); const server = useDataSource().authority === 'server';
  useEffect(() => {
    const el = ref.current; if (!el || !server || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting && e.intersectionRatio > 0.5)) { io.disconnect(); void fetch('/api/ads/impression', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: SLOT[placement] }) }).catch(() => undefined); }
    }, { threshold: 0.5 });
    io.observe(el); return () => io.disconnect();
  }, [placement, server]);
  return (
    <aside ref={ref} className={CLASS[placement]} aria-label="Sponsored space (simulated advertisement)" data-placement={placement}>
      <span className="pe-sim-chip">SIMULATED AD</span>
      <span><b>Sponsored space</b>{placement === 'sidebar' ? <><br />Your advert could be here. No ads are served in pre-alpha.</> : ' · Placeholder: no advertising network is connected and no tracking is used.'}</span>
    </aside>
  );
}
