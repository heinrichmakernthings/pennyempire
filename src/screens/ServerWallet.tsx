import { useState } from 'react';
import { fetchWallet, gbp, ecm, useGameCommand } from '@/data/walletClient';
import { useQuery } from '@/data/managementApi';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { ErrorState, Skeleton, EmptyState } from '@/ui/States';
import { StatusLabel } from '@/ui/StatusLabel';
import { Tabs } from '@/ui/Tabs';

const TABS = [{ id: 'move', label: 'Deposit & withdraw' }, { id: 'history', label: 'Transaction history' }, { id: 'payments', label: 'Payment status' }, { id: 'rewards', label: 'Rewards & prizes' }, { id: 'statement', label: 'Statement' }];
const PRESETS = [50, 100, 200, 500, 1_000];
const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const TONE: Record<string, 'positive' | 'warning' | 'negative' | 'neutral'> = { succeeded: 'positive', paid: 'positive', settled: 'positive', posted: 'positive', pending: 'warning', requested: 'warning', approved: 'warning', failed: 'negative', rejected: 'negative', cancelled: 'neutral', reversed: 'neutral' };

/** The player's SIMULATED GBP_TEST wallet, driven entirely by the server's double-entry ledger. No card, bank or provider fields exist. */
export function ServerWallet() {
  const q = useQuery(() => fetchWallet(), [], true); const [tab, setTab] = useState('move');
  if (q.status === 'loading') return <Skeleton lines={6} label="Loading your wallet" />;
  if (q.status === 'error') return <ErrorState title="Couldn’t load your wallet" message={q.error} onRetry={q.reload} />;
  const w = q.data;
  return (
    <div className="pe-stack" data-testid="server-wallet">
      <div className="pe-sim-banner" role="note"><span className="pe-sim-chip">SIMULATED</span><p><strong>Test funds only (GBP_TEST).</strong> {w.notice}</p></div>
      <dl className="pe-stats pe-stats--wide">
        <div><dt>Available balance</dt><dd className="pe-financial-number" data-testid="gbp-available">{gbp(w.availablePence)}</dd><small className="pe-hint">simulated</small></div>
        <div><dt>Pending withdrawals</dt><dd className="pe-financial-number" data-testid="gbp-pending">{gbp(w.pendingPence)}</dd><small className="pe-hint">reserved, cannot be spent</small></div>
        <div><dt>Minimum cash-out</dt><dd className="pe-financial-number">{gbp(w.minWithdrawalPence)}</dd></div>
        <div><dt>Empire Coins (separate)</dt><dd className="pe-financial-number">{ecm(w.coinsMinor)}</dd><small className="pe-hint">not convertible</small></div>
      </dl>
      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Wallet sections">
        {tab === 'move' ? <Move w={w} reload={q.reload} /> : tab === 'history' ? <History w={w} /> : tab === 'payments' ? <Payments w={w} reload={q.reload} /> : tab === 'rewards' ? <Rewards w={w} /> : <Statement w={w} />}
      </Tabs>
    </div>
  );
}

function Move({ w, reload }: { w: Record<string, any>; reload: () => void }) {
  const { send, pending } = useGameCommand(); const [custom, setCustom] = useState(''); const [wd, setWd] = useState('5.00');
  const wdPence = Math.round(Number(wd) * 100); const wdOk = Number.isFinite(wdPence) && wdPence >= w.minWithdrawalPence && wdPence <= w.availablePence;
  return (
    <div className="pe-forms">
      <section className="pe-card" aria-labelledby="dep-h"><h2 id="dep-h" className="pe-h3">Test deposit</h2>
        <p className="pe-hint">Credits GBP_TEST through the local sandbox provider. No real card is used and no real money moves.</p>
        <div className="pe-actions" role="group" aria-label="Quick amounts">{PRESETS.map((p) => <Button key={p} pending={pending} onClick={() => void send({ type: 'wallet.testDeposit', amountMinor: p }, { success: `Simulated deposit of ${gbp(p)}`, failure: 'Deposit failed' }, reload)}>{gbp(p)}</Button>)}</div>
        <Field label="Custom amount (£0.50–£500)" hint="Whole pence only."><input inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="0.75" /></Field>
        <Button pending={pending} disabled={!(Math.round(Number(custom) * 100) >= 50)} onClick={() => void send({ type: 'wallet.testDeposit', amountMinor: Math.round(Number(custom) * 100) }, { success: 'Simulated deposit', failure: 'Deposit failed' }, () => { setCustom(''); reload(); })}>Deposit custom amount</Button>
      </section>
      <section className="pe-card" aria-labelledby="wd-h"><h2 id="wd-h" className="pe-h3">Test withdrawal</h2>
        <p className="pe-hint">The minimum is {gbp(w.minWithdrawalPence)}. Your funds are reserved immediately; a (simulated) payout provider approves and settles the request.</p>
        <Field label="Amount (£)"><input inputMode="decimal" value={wd} onChange={(e) => setWd(e.target.value)} data-testid="wd-amount" /></Field>
        {!wdOk ? <p className="pe-hint" role="status">{wdPence < w.minWithdrawalPence ? `Enter at least ${gbp(w.minWithdrawalPence)}.` : 'That is more than your available balance.'}</p> : null}
        <Button variant="primary" pending={pending} disabled={!wdOk} data-testid="wd-submit" onClick={() => void send({ type: 'wallet.testWithdraw', amountMinor: wdPence }, { success: 'Withdrawal requested', failure: 'Withdrawal refused' }, reload)}>Request withdrawal</Button>
      </section>
    </div>
  );
}

function History({ w }: { w: Record<string, any> }) {
  if (w.transactions.length === 0) return <EmptyState title="No transactions yet">Make a simulated deposit to see your ledger history.</EmptyState>;
  return (
    <div className="pe-tbl-wrap"><table className="pe-table pe-small" data-testid="gbp-history"><caption className="pe-sr">Wallet ledger history</caption><thead><tr><th scope="col">When</th><th scope="col">Entry</th><th scope="col">Status</th><th scope="col" className="pe-num">Amount</th><th scope="col" className="pe-num">Balance</th></tr></thead>
      <tbody>{w.transactions.map((t: any) => <tr key={t.id}><td>{when(t.ms)}</td><th scope="row">{t.memo}<br /><small className="pe-hint">tx {t.id} · {t.kind}</small></th><td><StatusLabel tone={TONE[t.status] ?? 'neutral'}>{t.status}</StatusLabel></td><td className={`pe-num ${t.amountPence < 0 ? 'pe-neg' : 'pe-pos'}`}>{t.amountPence < 0 ? '−' : '+'}{gbp(Math.abs(t.amountPence))}</td><td className="pe-num">{gbp(t.balanceAfterPence)}</td></tr>)}</tbody></table></div>
  );
}

function Payments({ w, reload }: { w: Record<string, any>; reload: () => void }) {
  const { send, pending } = useGameCommand();
  return (
    <div className="pe-stack">
      <section className="pe-card"><h2 className="pe-h3">Withdrawals</h2>
        {w.withdrawals.length === 0 ? <p className="pe-hint">No withdrawals.</p> : <ul className="pe-list" data-testid="withdrawals">{w.withdrawals.map((x: any) => <li key={x.id}>{x.id} · {gbp(x.amountPence)} · <StatusLabel tone={TONE[x.status] ?? 'neutral'}>{x.status}</StatusLabel>{x.reason ? ` · ${x.reason}` : ''} {x.status === 'requested' ? <Button variant="ghost" pending={pending} onClick={() => void send({ type: 'wallet.cancelWithdrawal', withdrawalId: x.id }, { success: 'Withdrawal cancelled', failure: 'Couldn’t cancel' }, reload)}>Cancel</Button> : null}</li>)}</ul>}
      </section>
      <section className="pe-card"><h2 className="pe-h3">Deposits</h2>
        {w.deposits.length === 0 ? <p className="pe-hint">No deposits.</p> : <ul className="pe-list">{w.deposits.map((x: any) => <li key={x.id}>{x.id} · {gbp(x.amountPence)} · <StatusLabel tone={TONE[x.status] ?? 'neutral'}>{x.status}</StatusLabel>{x.failureReason ? ` · ${x.failureReason}` : ''}</li>)}</ul>}
      </section>
    </div>
  );
}
function Rewards({ w }: { w: Record<string, any> }) {
  return w.rewards.length === 0 ? <EmptyState title="No rewards or prizes yet">Rewards from funded programmes (simulated) appear here with their source.</EmptyState> : (
    <table className="pe-table pe-small" data-testid="reward-history"><caption className="pe-sr">Reward and prize history</caption><thead><tr><th scope="col">When</th><th scope="col">Programme</th><th scope="col">Source</th><th scope="col" className="pe-num">Amount</th></tr></thead>
      <tbody>{w.rewards.map((r: any) => <tr key={r.id}><td>{when(r.ms)}</td><th scope="row">{r.program}</th><td>{String(r.source).replace('_', ' ')}</td><td className="pe-num">{gbp(r.amountPence)}</td></tr>)}</tbody></table>
  );
}
function Statement({ w }: { w: Record<string, any> }) {
  const s = w.statement;
  return (
    <div className="pe-stack" data-testid="gbp-statement">
      <dl className="pe-stats pe-stats--wide">{[['Deposited', s.depositedPence], ['Rewards and prizes received', s.rewardsPence], ['Withdrawn (paid out)', s.withdrawnPence], ['Premium paid (simulated card)', s.premiumPaidPence], ['Processing fees (paid by the business)', s.feesPence]].map(([k, v]) => <div key={String(k)}><dt>{k}</dt><dd className="pe-financial-number">{gbp(Number(v))}</dd></div>)}</dl>
      <p className="pe-hint">Every line comes from the immutable ledger. Deposits are held for you as a liability; they are never counted as the game’s revenue.</p>
    </div>
  );
}
