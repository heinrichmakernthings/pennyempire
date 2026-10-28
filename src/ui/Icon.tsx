import type { CSSProperties } from 'react';
import { uiIconUrl } from '@/assets/artAssets';

/** Tinted via currentColor (CSS mask) so the approved SVG set follows token colours. Falls back to nothing if the asset is absent. */
export function Icon({ name, size = 20, className = '' }: { name: string; size?: number; className?: string }) {
  const url = uiIconUrl(name);
  const style = { width: size, height: size, ...(url ? { '--icon-url': `url("${url}")` } : {}) } as CSSProperties;
  return <span className={`pe-icon ${url ? '' : 'pe-icon--missing'} ${className}`} style={style} aria-hidden="true" />;
}
