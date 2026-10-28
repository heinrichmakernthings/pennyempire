import type { ReactNode } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';

export function Skeleton({ lines = 3, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div className="pe-skeleton" role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => <span key={i} className="pe-skeleton-line" style={{ width: `${90 - ((i * 17) % 40)}%` }} />)}
      <span className="pe-sr">{label}…</span>
    </div>
  );
}
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="pe-empty"><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}
export function ErrorState({ title = 'Something went wrong', message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div className="pe-error" role="alert">
      <Icon name="warning" size={24} />
      <div><h3>{title}</h3>{message && <p>{message}</p>}</div>
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
    </div>
  );
}
export function StaleBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="pe-stale" role="status"><Icon name="warning" size={18} /><span>{message}</span><Button variant="ghost" onClick={onRetry}>Refresh</Button></div>;
}
/** Marks fixture-backed numbers so they can never be mistaken for authoritative server state. */
export function IllustrativeBadge({ compact = false }: { compact?: boolean }) {
  return <span className="pe-illustrative" title="Illustrative data. No game server is connected; these values are not real economic state.">{compact ? 'Demo data' : 'Illustrative data · no server connected'}</span>;
}
