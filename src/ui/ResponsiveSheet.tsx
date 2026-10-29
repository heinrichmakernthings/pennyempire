import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Scrim closes on pointerdown, not mousedown: after a touch tap opens a sheet, browsers replay a synthetic mousedown at the
 * tap point, which would land on the fresh scrim and close it instantly.
 *
 * Modal surface: bottom sheet (<768px, max 80dvh), side overlay (tablet) or centred dialog.
 * Escape closes, focus is trapped while open and restored to the opener on close.
 */
export function ResponsiveSheet({ open, onClose, title, variant = 'sheet', children }: { open: boolean; onClose: () => void; title: string; variant?: 'sheet' | 'side'; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const el = ref.current;
    el?.querySelector<HTMLElement>('[data-autofocus]')?.focus() ?? el?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!items.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); (opener.current as HTMLElement | null)?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="pe-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`pe-sheet pe-sheet--${variant}`}>
        <div className="pe-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="pe-icon-btn" onClick={onClose} aria-label={`Close ${title}`}><Icon name="close" /></button>
        </div>
        <div className="pe-sheet-body">{children}</div>
      </div>
    </div>
  );
}
