import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabDef { id: string; label: string }
/** WAI-ARIA tabs with roving tabindex + arrow/Home/End keys. Panels are rendered by the caller via renderPanel. */
export function Tabs({ tabs, value, onChange, label, children }: { tabs: TabDef[]; value: string; onChange: (id: string) => void; label: string; children: ReactNode }) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = tabs.length; let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % n; else if (e.key === 'ArrowLeft') next = (i - 1 + n) % n; else if (e.key === 'Home') next = 0; else if (e.key === 'End') next = n - 1; else return;
    e.preventDefault(); onChange(tabs[next]!.id); refs.current[next]?.focus(); refs.current[next]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };
  return (
    <div className="pe-tabs">
      <div role="tablist" aria-label={label} className="pe-tablist">
        {tabs.map((t, i) => (
          <button key={t.id} ref={(el) => { refs.current[i] = el; }} role="tab" id={`${base}-tab-${t.id}`} aria-selected={value === t.id} aria-controls={`${base}-panel`} tabIndex={value === t.id ? 0 : -1} className="pe-tab" onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`} className="pe-tabpanel">{children}</div>
    </div>
  );
}
