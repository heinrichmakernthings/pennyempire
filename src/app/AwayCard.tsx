import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { request, useAuth } from '@/data/authClient';
import { MoneyValue } from '@/ui/MoneyValue';
import { Button } from '@/ui/Button';

interface AwayCompany { id: string; name: string; industry: string; status: string; revenueMinor: number; profitMinor: number; unitsSold: number; coveredMinor: number }
interface Summary { sinceTick: number; nowTick: number; days: number; sinceDate: string; companies: AwayCompany[]; totals: { revenueMinor: number; profitMinor: number; unitsSold: number; coveredMinor: number }; headlines: string[]; show: boolean }
const ec = (minor: number) => ({ currency: 'EC' as const, minor });

/** "While you were away": one card on return, built by the server from the day statements. Dismissing it marks those days as seen. */
export function AwayCard() {
  const { status } = useAuth();
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    if (status !== 'signed-in' && status !== 'open') return;
    let alive = true;
    request<{ summary: Summary }>('/api/away').then((r) => { if (alive && r.status === 200) setS(r.body.summary); }).catch(() => {});
    return () => { alive = false; };
  }, [status]);
  if (!s?.show) return null;
  const dismiss = () => { void request('/api/away/seen', { method: 'POST', body: { upTo: s.nowTick } }); setS(null); };
  const t = s.totals;
  return (
    <div className="pe-onboard-wrap"><aside className="pe-onboard pe-away" aria-label="While you were away" data-testid="away-card">
      <div className="pe-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>While you were away — {s.days} day{s.days === 1 ? '' : 's'} in Bristol</strong>
        <Button onClick={dismiss}>Got it</Button>
      </div>
      <p>
        Your businesses sold <strong>{t.unitsSold.toLocaleString()}</strong> units for <MoneyValue value={ec(t.revenueMinor)} /> and made <MoneyValue value={ec(t.profitMinor)} signed /> {t.profitMinor >= 0 ? 'profit' : 'in losses'}.
        {t.coveredMinor > 0 && <> Your wallet covered <MoneyValue value={ec(t.coveredMinor)} /> of bills they could not pay.</>}
      </p>
      <ul className="pe-onboard-list">
        {s.companies.map((c) => (
          <li key={c.id} className={c.status === 'bankrupt' ? 'is-done' : ''}>
            <Link to={`/companies/${c.id}`}>{c.name}</Link>: <MoneyValue value={ec(c.profitMinor)} signed /> from {c.unitsSold.toLocaleString()} sold
            {c.status === 'insolvent' && <strong className="pe-neg"> — insolvent: add cash and reopen it</strong>}
            {c.status === 'bankrupt' && <span> — closed</span>}
            {c.coveredMinor > 0 && c.status === 'operating' && <span className="pe-hint"> — needed <MoneyValue value={ec(c.coveredMinor)} /> from your wallet</span>}
          </li>
        ))}
      </ul>
      {s.headlines.length > 0 && <p className="pe-hint">In the news: {s.headlines.join(' · ')}</p>}
    </aside></div>
  );
}
