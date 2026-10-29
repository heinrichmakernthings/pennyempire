import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { request, useAuth } from '@/data/authClient';

interface Step { id: string; label: string; detail: string; link: string; done: boolean }
/** Getting-started checklist, computed by the server from what the player has really done. Founding a company takes well under a minute. */
export function OnboardingCard() {
  const { status, user } = useAuth();
  const [data, setData] = useState<{ steps: Step[]; complete: number; total: number } | null>(null);
  useEffect(() => {
    if (status !== 'signed-in' && status !== 'open') return;
    let alive = true;
    const load = () => request<{ steps: Step[]; complete: number; total: number }>('/api/onboarding').then((r) => { if (alive && r.status === 200) setData(r.body); }).catch(() => {});
    void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [status]);
  if (!data || user?.settings.hideOnboarding || data.complete >= data.total) return null;
  const next = data.steps.find((s) => !s.done);
  return (
    <aside className="pe-card pe-onboard" aria-label="Getting started">
      <div className="pe-card-head"><h2>Getting started</h2><span className="pe-pill">{data.complete}/{data.total}</span></div>
      <div className="pe-meter" role="progressbar" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.complete} aria-label="Getting started progress"><span style={{ width: `${(data.complete / data.total) * 100}%` }} /></div>
      <ol className="pe-onboard-list">
        {data.steps.map((s) => <li key={s.id} className={s.done ? 'is-done' : s.id === next?.id ? 'is-next' : ''}><span aria-hidden="true">{s.done ? '✓' : '○'}</span> {s.done ? s.label : <Link to={s.link}>{s.label}</Link>}{s.id === next?.id && <p className="pe-hint">{s.detail}</p>}</li>)}
      </ol>
    </aside>
  );
}
