import { useSyncExternalStore } from 'react';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';
const QUERIES = { desktop: '(min-width: 1200px)', tablet: '(min-width: 768px)' } as const;

function current(): Breakpoint {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop';
  if (window.matchMedia(QUERIES.desktop).matches) return 'desktop';
  return window.matchMedia(QUERIES.tablet).matches ? 'tablet' : 'mobile';
}
function subscribe(cb: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const lists = Object.values(QUERIES).map((q) => window.matchMedia(q));
  lists.forEach((l) => l.addEventListener('change', cb));
  return () => lists.forEach((l) => l.removeEventListener('change', cb));
}
/** Breakpoints from docs/design/DESIGN-SYSTEM.md: desktop ≥1200, tablet 768–1199, mobile <768. */
export const useBreakpoint = (): Breakpoint => useSyncExternalStore(subscribe, current, () => 'desktop');
