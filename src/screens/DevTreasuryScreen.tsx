import { useCallback, useEffect, useState } from 'react';
import { devTreasury, fetchTreasury, gbp } from '@/data/walletClient';
import { Button } from '@/ui/Button';
import { ErrorState, Skeleton } from '@/ui/States';
import { StatusLabel } from '@/ui/StatusLabel';

type Rec = Record<string, any>;
/** INTERNAL developer treasury dashboard (developer builds only). Every figure is read from the GBP_TEST ledger; the buttons drive the sandbox payment providers and the simulated treasury. */
export function DevTreasuryScreen() {
  const [d, setD] = useState<Rec | null>(null); const [error, setError] = useState<string | null>(null); const [note, setNote] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setD(await fetchTreasury()); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); } }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 4_000); return () => clearInterval(t); }, [load]);
  const act = async (action: string, body: Record<string, unknown> = {}) => { setBusy(true); const r = await devTreasury(action, body); setNote(`${r.ok ? '✓' : '✗'} ${r.message}`); await load(); setBusy(false); };
  if (error) return <div className="pe-screen"><h1 className="pe-h1">Treasury (developer)</h1><ErrorState title="Treasury unavailable" message={error} onRetry={load} /></div>;
  if (!d) return <div className="pe-screen"><h1 className="pe-h1">Treasury (developer)</h1><Skeleton lines={6} label="Loading treasury" /></div>;
  const t = d.treasury;
  return (
    <div className="pe-screen" data-testid="treasury">
      <div className="pe-screen-head"><h1 className="pe-h1">Treasury (developer)</h1><span className="pe-sim-chip">SIMULATED FUNDS</span></div>
      <p className={t.reconciles ? 'pe-dev-ok' : 'pe-neg'} data-testid="reconcile">GBP ledger reconciliation: <strong>{t.reconciles ? 'OK' : 'PROBLEMS'}</strong> · {t.transactions} transactions{t.problems.length ? ` · ${t.problems.join('; ')}` : ''}</p>
      {note ? <p role="status" className="pe-callout">{note}</p> : null}
      <section aria-labelledby="t1"><h2 id="t1" className="pe-h2">Money held vs money earned</h2>
        <dl className="pe-stats pe-stats--wide">
          <div><dt>Player funds held (liability)</dt><dd data-testid="liab">{gbp(t.playerFunds.walletLiabilitiesPence)}</dd><small className="pe-hint">{t.playerFunds.note}</small></div>
          <div><dt>Pending withdrawals</dt><dd>{gbp(t.playerFunds.pendingWithdrawalsPence)} ({t.playerFunds.pendingWithdrawalCount})</dd></div>
          <div><dt>Cash held</dt><dd>{gbp(t.cash.heldPence)}</dd><small className="pe-hint">clearing {gbp(t.cash.payoutClearingPence)}</small></div>
          <div><dt>Cash above player funds</dt><dd className={t.cash.coverageOfPlayerFundsPence < 0 ? 'pe-neg' : ''}>{gbp(t.cash.coverageOfPlayerFundsPence)}</dd></div>
          <div><dt>Business revenue (booked)</dt><dd data-testid="revenue">{gbp(t.revenue.totalPence)}</dd><small className="pe-hint">{t.revenue.note}</small></div>
          <div><dt>Expenses (fees + hosting)</dt><dd>{gbp(t.expenses.totalPence)}</dd><small className="pe-hint">owed to processor {gbp(t.expenses.owedToProcessorPence)}</small></div>
          <div><dt>Operating profit (booked)</dt><dd>{gbp(t.operatingProfitPence)}</dd></div>
          <div><dt>Rewards issued</dt><dd>{gbp(t.rewards.issuedPence)}</dd></div>
          <div><dt>Prize reserve available</dt><dd>{gbp(t.rewards.reservePence)}</dd><small className="pe-hint">{t.rewards.note}</small></div>
          <div><dt>Deposits received</dt><dd>{gbp(t.depositsTotalPence)}</dd><small className="pe-hint">not revenue</small></div>
          <div><dt>Simulated ad placements</dt><dd>{t.impressions.total}</dd><small className="pe-hint">{t.impressions.note}</small></div>
        </dl>
      </section>
      <section aria-labelledby="t2"><h2 id="t2" className="pe-h2">Sandbox controls</h2>
        <div className="pe-actions"><Button pending={busy} onClick={() => void act('fund', { amountPence: 10_000 })}>Fund treasury £100</Button><Button pending={busy} onClick={() => void act('create_program', { id: `prize-${Date.now()}`, name: 'Test prize £5', source: 'promotion', rules: [{ kind: 'open' }], awardPence: 500, budgetPence: 500 })}>Create £5 test programme</Button>
          {(t.rewards.programs as Rec[]).filter((p) => p.fundedPence < p.budgetPence).map((p) => <Button key={p.id} pending={busy} onClick={() => void act('fund_program', { id: p.id, amountPence: p.budgetPence - p.fundedPence })}>Fund {p.name}</Button>)}
          {(t.rewards.programs as Rec[]).filter((p) => p.fundedPence > p.spentPence && p.remainingPence > 0).map((p) => <Button key={`a-${p.id}`} pending={busy} onClick={() => void act('award', { programId: p.id })}>Award {p.name} to player</Button>)}</div>
        <p className="pe-hint">Simulated deposit (provider outcome):</p>
        <div className="pe-actions">{[50, 100, 500, 1_000].flatMap((p) => ['succeeded', 'failed', 'cancelled', 'duplicate'].map((o) => (p === 50 || o === 'succeeded') ? <Button key={`${p}-${o}`} pending={busy} onClick={() => void act('deposit', { amountPence: p, outcome: o })}>{gbp(p)} {o}</Button> : null))}</div>
        <div className="pe-actions"><Button pending={busy} onClick={() => void act('decline_next_subscription')}>Decline next subscription charge</Button></div>
      </section>
      <section aria-labelledby="t3"><h2 id="t3" className="pe-h2">Withdrawals</h2>
        {(d.withdrawals as Rec[]).length === 0 ? <p className="pe-hint">None.</p> : <div className="pe-tbl-wrap"><table className="pe-table pe-small" data-testid="dev-withdrawals"><caption className="pe-sr">Withdrawals</caption><thead><tr><th scope="col">Id</th><th scope="col">Player</th><th scope="col" className="pe-num">Amount</th><th scope="col">Status</th><th scope="col">Provider actions</th></tr></thead>
          <tbody>{(d.withdrawals as Rec[]).map((w) => <tr key={w.id}><td>{w.id}</td><td>{w.playerId}</td><td className="pe-num">{gbp(w.amountPence)}</td><td><StatusLabel tone={w.status === 'paid' ? 'positive' : w.status === 'requested' || w.status === 'approved' ? 'warning' : 'neutral'}>{w.status}</StatusLabel></td>
            <td className="pe-actions">{w.status === 'requested' ? <><Button pending={busy} onClick={() => void act('withdrawal', { id: w.id, action: 'approve' })}>Approve</Button><Button pending={busy} onClick={() => void act('withdrawal', { id: w.id, action: 'reject' })}>Reject</Button></> : null}{w.status === 'approved' ? <><Button pending={busy} onClick={() => void act('withdrawal', { id: w.id, action: 'pay' })}>Settle (paid)</Button><Button pending={busy} onClick={() => void act('withdrawal', { id: w.id, action: 'pay_duplicate' })}>Settle + duplicate webhook</Button><Button pending={busy} onClick={() => void act('withdrawal', { id: w.id, action: 'fail' })}>Payout fails</Button></> : null}</td></tr>)}</tbody></table></div>}
      </section>
      <section aria-labelledby="t4"><h2 id="t4" className="pe-h2">Commercial scenarios <span className="pe-tag-forecast">ASSUMPTIONS</span></h2>
        <p className="pe-hint">Scenario arithmetic from editable assumptions. Not a forecast; nothing here is booked, and no real revenue exists yet.</p>
        <div className="pe-tbl-wrap"><table className="pe-table pe-small" data-testid="scenarios"><caption className="pe-sr">Commercial scenarios</caption><thead><tr><th scope="col">Scenario</th><th scope="col" className="pe-num">Players / month</th><th scope="col" className="pe-num">Gross</th><th scope="col" className="pe-num">Net</th><th scope="col" className="pe-num">Operating profit</th><th scope="col" className="pe-num">Margin</th><th scope="col" className="pe-num">Net ARPU</th><th scope="col" className="pe-num">Sustainable rewards</th><th scope="col" className="pe-num">Cash for withdrawals</th></tr></thead>
          <tbody>{(t.scenarios as Rec[]).map((s) => <tr key={s.assumptions.name}><th scope="row">{s.assumptions.name}{s.warnings.length ? <><br /><small className="pe-hint">{s.warnings.join(' ')}</small></> : null}</th><td className="pe-num">{s.assumptions.monthlyActivePlayers.toLocaleString('en-GB')}</td><td className="pe-num">{gbp(s.grossRevenuePence)}</td><td className="pe-num">{gbp(s.netRevenuePence)}</td><td className="pe-num">{gbp(s.operatingProfitPence)}</td><td className="pe-num">{(s.operatingMarginBps / 100).toFixed(1)}%</td><td className="pe-num">{gbp(s.arppuPence)}</td><td className="pe-num">{gbp(s.sustainableRewardBudgetPence)}</td><td className="pe-num">{gbp(s.cashNeededForWithdrawalsPence)}</td></tr>)}</tbody></table></div>
      </section>
      <section aria-labelledby="t5"><h2 id="t5" className="pe-h2">Account audit trail</h2>
        <ul className="pe-list pe-small" data-testid="audit">{(d.audit as Rec[]).slice(0, 20).map((a) => <li key={a.id}>{new Date(a.ms).toLocaleTimeString('en-GB')} · {a.actor} · {a.action}{a.subject ? ` · ${a.subject}` : ''}{a.ok ? '' : ' · REFUSED'}</li>)}</ul>
      </section>
    </div>
  );
}
