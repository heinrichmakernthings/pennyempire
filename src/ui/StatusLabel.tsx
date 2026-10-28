import type { ReactNode } from 'react';

export type StatusTone = 'positive' | 'negative' | 'warning' | 'neutral' | 'accent';
/** Status is always text; colour is only reinforcement. */
export function StatusLabel({ tone = 'neutral', children }: { tone?: StatusTone; children: ReactNode }) {
  return <span className={`pe-status pe-status--${tone}`}>{children}</span>;
}
