import { fetchMembership, gbp, useGameCommand } from '@/data/walletClient';
import { useQuery } from '@/data/managementApi';
import { useDataSource } from '@/data/store';
import { AdSlot } from '@/app/AdSlot';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/ui/States';
import { StatusLabel } from '@/ui/StatusLabel';

/** Premium membership (SIMULATED subscription provider). Convenience and cosmetics only: nothing here sells coins, cash, prizes or an advantage in any contest. */
export function MembershipScreen() {
  const server = useDataSource().authority === 'server'; const q = useQuery(() => fetchMembership(), [], true); const { send, pending } = useGameCommand();
  return (
    <div className="pe-screen" data-testid="membership-screen">
      <div className="pe-screen-head"><h1 className="pe-h1">Premium membership</h1></div>
      <div className="pe-sim-banner" role="note"><span className="pe-sim-chip">SIMULATED</span><p><strong>Mock subscription provider.</strong> No real payment is taken: the “card” is a sandbox and the money in the ledger is simulated.</p></div>
      {!server ? <EmptyState title="Membership needs the game server">Start it with npm run dev:all.</EmptyState> : q.status === 'loading' ? <Skeleton lines={5} label="Loading membership" /> : q.status === 'error' ? <ErrorState title="Couldn’t load membership" message={q.error} onRetry={q.reload} /> : (() => {
        const m = q.data.membership;
        return (
          <div className="pe-stack">
            <section className="pe-card"><div className="pe-plan"><h2 className="pe-h2">{m.plan.name}</h2><strong>{gbp(m.plan.pricePence)}</strong><span className="pe-hint">per {m.plan.periodTicks} game days (example price, configurable)</span></div>
              <p data-testid="membership-status">Status: <StatusLabel tone={m.status === 'active' ? 'positive' : m.status === 'cancelled' ? 'warning' : 'neutral'}>{m.status}</StatusLabel>{m.active ? <> · {m.autoRenew ? `renews on day ${m.renewsAtTick}` : `benefits end on day ${m.endsAtTick}`} ({m.daysLeft} days left)</> : null}</p>
              <div className="pe-actions">
                {!m.active ? <Button variant="primary" pending={pending} onClick={() => void send({ type: 'membership.subscribe' }, { success: 'Premium activated (simulated)', failure: 'Subscription failed' }, q.reload)}>Subscribe (simulated)</Button> : null}
                {m.status === 'active' ? <Button pending={pending} onClick={() => void send({ type: 'membership.cancel' }, { success: 'Renewal cancelled; benefits continue until the end of the period', failure: 'Couldn’t cancel' }, q.reload)}>Cancel renewal</Button> : null}
                {m.status === 'cancelled' ? <Button variant="primary" pending={pending} onClick={() => void send({ type: 'membership.subscribe' }, { success: 'Premium renewed', failure: 'Couldn’t renew' }, q.reload)}>Resume</Button> : null}
              </div>
            </section>
            <section className="pe-card"><h2 className="pe-h3">Free vs Premium</h2><div className="pe-tbl-wrap"><table className="pe-table pe-compare" data-testid="benefits"><caption className="pe-sr">Benefits comparison</caption><thead><tr><th scope="col">Benefit</th><th scope="col">Free</th><th scope="col" className="pe-prem">Premium</th></tr></thead>
              <tbody>{m.benefits.map((b: any) => <tr key={b.id}><th scope="row">{b.label}</th><td>{b.free}</td><td className="pe-prem">{b.premium}</td></tr>)}</tbody></table></div><p className="pe-hint">{m.notIncluded}</p></section>
            <section className="pe-card"><h2 className="pe-h3">Payment history (simulated)</h2>{m.payments.length === 0 ? <p className="pe-hint">No payments.</p> : <ul className="pe-list pe-small">{m.payments.map((p: any) => <li key={p.providerRef}>Period {p.period} · {gbp(p.amountPence)} · {p.status} · day {p.tick}</li>)}</ul>}</section>
          </div>);
      })()}
      <AdSlot placement="in-flow" />
    </div>
  );
}
