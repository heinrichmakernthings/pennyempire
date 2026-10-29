import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';

/** Labelled control with inline error + hint wired via aria-describedby. Native controls only. */
export function Field({ label, error, hint, children }: { label: string; error?: string | null; hint?: ReactNode; children: ReactElement<Record<string, unknown>> }) {
  const id = useId();
  const described = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="pe-field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': described })}
      {hint && <p id={`${id}-hint`} className="pe-hint">{hint}</p>}
      {error && <p id={`${id}-err`} className="pe-field-error" role="alert">{error}</p>}
    </div>
  );
}
