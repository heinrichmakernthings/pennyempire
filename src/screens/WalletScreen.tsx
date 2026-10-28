import { useState } from 'react';
import type { TestWallet, WalletTransaction } from '@/contracts/game-state';
import { useScreen } from '@/data/store';
import { newIdempotencyKey, useCommand } from '@/data/useCommand';
import { formatMoney } from '@/domain/money';
import { MIN_TEST_WITHDRAWAL_MINOR, checkTestDeposit, checkTestWithdrawal } from '@/domain/wallet';
import { Button } from '@/ui/Button';
import { DataTable } from '@/ui/DataTable';
import { Field } from '@/ui/Field';
import { MoneyValue } from '@/ui/MoneyValue';
import { ScreenData } from '@/ui/ScreenData';
import { EmptyState } from '@/ui/States';
import { StatusLabel } from '@/ui/StatusLabel';
import { Tabs } from '@/ui/Tabs';

/** Separate, permanently labelled SIMULATED GBP_TEST wallet. No card/bank fields, no providers, no EC conversion. */
export function WalletScreen() {
  return (
    <ScreenData screen="wallet" title="Wallet (simulated)">
      {(d) => <WalletView wallet={d.wallet} portfolioValue={d.player.portfolioValue} coins={d.player.coins} transactions={d.transactions.items} />}
    </ScreenData>
  );
}

export function SimulatedBanner() {
  return (
    <div className="pe-sim-banner" role="note">
      <StatusLabel tone="warning">SIMULATED</StatusLabel>
      <p><strong>Test funds only.</strong> GBP_TEST is a simulation. Nothing here is real money, can be paid in, or withdrawn. No payment provider is connected. This build has no server, so test actions are not executed.</p>
    </div>
  );
}

function WalletView({ wallet, portfolioValue, coins, transactions }: { wallet: TestWallet; portfolioValue: { currency: 'EC' | 'GBP_TEST'; minor: number }; coins: { currency: 'EC' | 'GBP_TEST'; minor: number }; transactions: WalletTransaction[] }) {
  const [tab, setTab] = useState('history');
  return (
    <div className="pe-stack">
      <SimulatedBanner />
      <TestBalance wallet={wallet} />
      <div className="pe-forms">
        <TestDepositForm wallet={wallet} />
        <TestWithdrawalForm wallet={wallet} />
      </div>
      <Tabs label="Wallet history" value={tab} onChange={setTab} tabs={[{ id: 'history', label: 'Ledger history' }, { id: 'rewards', label: 'Rewards' }]}>
        {tab === 'history' ? <LedgerHistory transactions={transactions} /> : (
          <DataTable caption="Simulated rewards" rowKey={(r) => r.id} rows={wallet.rewards} empty={<EmptyState title="No rewards yet">Simulated rewards appear here.</EmptyState>}
            columns={[{ key: 'd', header: 'Reward', render: (r) => r.description }, { key: 'a', header: 'Amount', align: 'end', render: (r) => <MoneyValue value={r.amount} tone="neutral" /> }, { key: 't', header: 'Awarded (UTC)', render: (r) => new Date(r.awardedAt).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }) }]} />
        )}
      </Tabs>
      <section aria-labelledby="ec-t" className="pe-ec-note">
        <h2 id="ec-t" className="pe-h3">Empire Coins are separate</h2>
        <p className="pe-hint">Your in-game portfolio (<MoneyValue value={portfolioValue} tone="neutral" />) and coins (<MoneyValue value={coins} tone="neutral" />) are Empire Coins. They cannot be converted into GBP_TEST or real money.</p>
      </section>
    </div>
  );
}

function TestBalance({ wallet }: { wallet: TestWallet }) {
  const available = { currency: 'GBP_TEST' as const, minor: wallet.balanceMinor - wallet.reservedMinor };
  return (
    <dl className="pe-stats pe-stats--wide" aria-label="Simulated GBP_TEST balances">
      <div><dt>Available (SIMULATED)</dt><dd><MoneyValue value={available} tone="neutral" /></dd></div>
      <div><dt>Reserved (SIMULATED)</dt><dd><MoneyValue value={{ currency: 'GBP_TEST', minor: wallet.reservedMinor }} tone="neutral" /></dd></div>
    </dl>
  );
}

function useTestForm(type: 'wallet.testDeposit' | 'wallet.testWithdraw') {
  const { send, pending } = useCommand();
  const { refresh } = useScreen('wallet');
  const [key, setKey] = useState(newIdempotencyKey);
  return { pending, submit: async (amountMinor: number) => { const r = await send({ type, amountMinor }, { idempotencyKey: key, expectedRevision: 1 }, { success: 'Simulated request submitted', failure: 'Simulated request not sent' }); if (r?.ok) { setKey(newIdempotencyKey()); refresh(); } } };
}

function TestDepositForm({ wallet }: { wallet: TestWallet }) {
  const [v, setV] = useState('0.50'); const [err, setErr] = useState<string | null>(null);
  const { submit, pending } = useTestForm('wallet.testDeposit');
  return (
    <form className="pe-stack pe-form-card" onSubmit={(e) => { e.preventDefault(); const r = checkTestDeposit(v); if (!r.ok) setErr(r.message); else { setErr(null); void submit(r.minor); } }} aria-label="Simulated deposit">
      <h2 className="pe-h3">Simulated deposit</h2>
      <Field label="Amount (GBP_TEST, SIMULATED)" error={err} hint="Minimum £0.50. Test funds only."><input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} /></Field>
      <Button type="submit" variant="primary" pending={pending} disabled={!wallet.canTestDeposit}>Add test funds</Button>
    </form>
  );
}

function TestWithdrawalForm({ wallet }: { wallet: TestWallet }) {
  const [v, setV] = useState('5.00'); const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const { submit, pending } = useTestForm('wallet.testWithdraw');
  return (
    <form className="pe-stack pe-form-card" onSubmit={(e) => { e.preventDefault(); const r = checkTestWithdrawal(v, wallet); if (!r.ok) { setErr(r.message); setConfirm(null); } else { setErr(null); setConfirm(r.minor); } }} aria-label="Simulated withdrawal">
      <h2 className="pe-h3">Simulated withdrawal</h2>
      <Field label="Amount (GBP_TEST, SIMULATED)" error={err} hint={`Minimum ${formatMoney({ currency: 'GBP_TEST', minor: wallet.minimumWithdrawalMinor })}. This is a UI rule only — no payout exists.`}><input inputMode="decimal" value={v} onChange={(e) => { setV(e.target.value); setConfirm(null); }} /></Field>
      <Button type="submit" disabled={!wallet.canTestWithdraw || wallet.balanceMinor - wallet.reservedMinor < MIN_TEST_WITHDRAWAL_MINOR}>Review simulated withdrawal</Button>
      {confirm !== null && (
        <div className="pe-quote" role="group" aria-label="Confirm simulated withdrawal">
          <p>Simulate withdrawing <strong>{formatMoney({ currency: 'GBP_TEST', minor: confirm })}</strong>. No money moves.</p>
          <Button variant="primary" pending={pending} onClick={() => void submit(confirm)}>Confirm simulated withdrawal</Button>
        </div>
      )}
    </form>
  );
}

function LedgerHistory({ transactions }: { transactions: WalletTransaction[] }) {
  const kind = (t: WalletTransaction) => (t.kind === 'test_deposit' ? 'Test deposit' : t.kind === 'test_withdrawal' ? 'Test withdrawal' : 'Reward');
  return (
    <DataTable caption="Simulated wallet ledger" rowKey={(t) => t.id} rows={transactions} empty={<EmptyState title="No simulated transactions yet">Test deposits, withdrawals and rewards are listed here.</EmptyState>}
      columns={[
        { key: 'r', header: 'Reference', render: (t) => t.reference },
        { key: 'k', header: 'Type', render: (t) => kind(t) },
        { key: 'a', header: 'Amount', align: 'end', render: (t) => <MoneyValue value={{ ...t.amount, minor: t.direction === 'debit' ? -t.amount.minor : t.amount.minor }} signed /> },
        { key: 's', header: 'Status', render: (t) => <StatusLabel tone={t.status === 'settled' ? 'positive' : t.status === 'failed' ? 'negative' : 'warning'}>{t.status}</StatusLabel> },
        { key: 'd', header: 'Created (UTC)', render: (t) => new Date(t.createdAt).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }) },
      ]} />
  );
}
