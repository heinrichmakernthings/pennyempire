import '@/design/phase10.css';
import { useId, useState, type ReactNode } from 'react';

/** Inline help works with a mouse, keyboard or touch; never relies on a title tooltip. */
export function HelpTip({ children, label = 'What does this mean?' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <span className="pe-help" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
    <button type="button" className="pe-tip" aria-expanded={open} aria-controls={id} aria-label={label} onClick={() => setOpen(!open)}>?</button>
    {open && <span id={id} className="pe-tip-text" role="note">{children}</span>}
  </span>;
}
