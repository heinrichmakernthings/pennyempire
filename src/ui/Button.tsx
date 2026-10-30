import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: ButtonVariant; pending?: boolean; block?: boolean }

export function Button({ variant = 'secondary', pending = false, block = false, className = '', disabled, children, type = 'button', ...rest }: Props) {
  return (
    <button type={type} className={`pe-btn pe-btn--${variant} ${block ? 'pe-btn--block' : ''} ${className}`} disabled={disabled || pending} aria-busy={pending || undefined} {...rest}>
      {pending && <span className="pe-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
