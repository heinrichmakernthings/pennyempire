import { useCallback, useEffect, useState } from 'react';
import type { EconomyDashboard } from '../../server/api/dashboard';
import { formatMoney } from '@/domain/money';
import { Button } from '@/ui/Button';
import { DataTable } from '@/ui/DataTable';
import { FinancialChart } from '@/ui/FinancialChart';
import { ErrorState, Skeleton } from '@/ui/States';
import { StatusLabel } from '@/ui/StatusLabel';

const ec = (minor: number, signed = false) => formatMoney({ currency: 'EC', minor }, { signed });
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const DAY = 86_400_000;

/**
 * INTERNAL developer economy dashboard (not in the player navigation). Every number is read from the server's ledger and history tables —
 * nothing here is computed in the browser. The endpoint is disabled on deployed environments.
 */
export function DevEconomyScreen() {
  const [d, setD] = useState<EconomyDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/dev/economy'); const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
      setD(j as EconomyDashboard); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 3_000); return () => clearInterval(t); }, [load]);
  const run = async (count: number) => { setBusy(true); try { await fetch('/api/dev/tick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ count }) }); await load(); } finally { setBusy(false); } };

  if (error && !d) return <div className="pe-screen"><h1 className="pe-h1">Economy dashboard</h1><ErrorState title="Dashboard unavailable" message={`${error}. This internal page needs the local game server with developer endpoints enabled (npm run server).`} onRetry={() => void load()} /></div>;
  if (!d) return <div className="pe-screen"><h1 className="pe-h1">Economy dashboard</h1><Skeleton lines={8} label="Loading economy dashboard" /></div>;
  const epoch = Date.parse(`${d.config.epochDate}T00:00:00.000Z`);
  const hist = (pick: (r: EconomyDashboard['series'][number]) => number) => ({ currency: 'EC' as const, interval: 'day' as const, complete: true, points: d.series.map((r) => ({ at: new Date(epoch + r.tick * DAY).toISOString(), valueMinor: pick(r) })) });
  const m = d.money;
  return (
    <div className="pe-screen pe-dev">
      <div className="pe-screen-head"><h1 className="pe-h1">Economy dashboard</h1><span className="pe-live">Live ledger · Day {d.tick}</span></div>
      <p className="pe-dev-banner" role="note"><strong>Internal developer tool.</strong> Fictional Empire Coins only. Numbers are read from the server ledger and history tables; the page refreshes every 3 seconds. Not part of the player experience.</p>
      {error && <p className="pe-field-error" role="alert">Refresh failed: {error}</p>}
      <div className="pe-row">
        <Button disabled={busy} onClick={() => void run(1)}>Run 1 day</Button><Button disabled={busy} onClick={() => void run(30)}>Run 30 days</Button>
        <StatusLabel tone={d.reconciliation.ok ? 'positive' : 'negative'}>{d.reconciliation.ok ? 'Ledger reconciles' : 'LEDGER MISMATCH'}</StatusLabel>
        <span className="pe-hint">{d.reconciliation.transactions.toLocaleString('en-GB')} transactions · {d.reconciliation.accounts} accounts · game date {d.gameDate.slice(0, 10)}</span>
      </div>
      {!d.reconciliation.ok && <ErrorState title="Reconciliation failed" message={d.reconciliation.problems.slice(0, 5).join(' · ')} />}

      <section aria-labelledby="sup-t"><h2 id="sup-t" className="pe-h2">Currency supply</h2>
        <dl className="pe-stats pe-stats--wide">
          <div><dt>Circulating supply</dt><dd>{ec(m.circulating)}</dd></div>
          <div><dt>Total issued</dt><dd>{ec(m.issued)}</dd></div>
          <div><dt>Total destroyed</dt><dd>{ec(m.destroyed)}</dd></div>
          <div><dt>Target / deviation</dt><dd>{ec(m.target)} · {pct(m.deviationBps)}</dd></div>
          <div><dt>Last tick: issued / destroyed</dt><dd>{ec(d.flows.lastTick.issued)} / {ec(d.flows.lastTick.destroyed)}</dd></div>
          <div><dt>State treasury</dt><dd>{ec(m.stateTreasury)}</dd></div>
          <div><dt>State enterprises</dt><dd>{ec(m.stateEnterprises)}</dd></div>
          <div><dt>NPC households</dt><dd>{ec(m.households)}</dd></div>
          <div><dt>Companies (cash)</dt><dd>{ec(m.companies)}</dd></div>
          <div><dt>Player wallets</dt><dd>{ec(m.players)}</dd></div>
          <div><dt>Goods in stock (at cost)</dt><dd>{ec(m.goodsAtCost)}</dd></div>
        </dl>
        <FinancialChart title="Circulating supply" periodLabel={`Last ${d.series.length} days, daily`} series={[{ key: 'c', label: 'Circulating', history: hist((r) => r.circulating), style: 'revenue' }]} />
        <FinancialChart title="Where the coins are" periodLabel={`Last ${d.series.length} days, daily`} series={[
          { key: 'h', label: 'NPC households', history: hist((r) => r.households), style: 'profit' }, { key: 'co', label: 'Companies', history: hist((r) => r.companies), style: 'expense' }, { key: 's', label: 'State', history: hist((r) => r.state), style: 'price' }]} />
        <div className="pe-forms">
          <div><h3 className="pe-h3">Currency issued (sources)</h3><DataTable caption="Currency issued by reason" rowKey={(r) => r.reason} rows={d.flows.issuedByReason} columns={[{ key: 'r', header: 'Reason', render: (r) => r.reason }, { key: 'a', header: 'Total', align: 'end', render: (r) => ec(r.amount) }]} /></div>
          <div><h3 className="pe-h3">Currency destroyed (sinks)</h3><DataTable caption="Currency destroyed by kind" rowKey={(r) => r.kind} rows={d.flows.destroyedByKind} empty={<p className="pe-hint">Nothing destroyed yet.</p>} columns={[{ key: 'k', header: 'Kind', render: (r) => r.kind }, { key: 'a', header: 'Total', align: 'end', render: (r) => ec(r.amount) }]} /></div>
        </div>
        <p className="pe-hint">Transfers to state companies (rent, energy, advertising, taxes) are <strong>not</strong> sinks: they stay in circulation via the state treasury and are paid back out as civil payroll. Only the lines above leave the economy.</p>
      </section>

      <section aria-labelledby="out-t"><h2 id="out-t" className="pe-h2">Economic output and demand</h2>
        <dl className="pe-stats pe-stats--wide">
          <div><dt>Consumer spend (last day)</dt><dd>{ec(d.output.consumerSpendLastTick)}</dd></div>
          <div><dt>Trade value (last day)</dt><dd>{ec(d.output.tradeValueLastTick)}</dd></div>
          <div><dt>Units produced (last day)</dt><dd>{d.output.unitsProducedLastTick.toLocaleString('en-GB')}</dd></div>
          <div><dt>Avg daily retail revenue (30d)</dt><dd>{ec(d.output.avgDailyOutput30)}</dd></div>
        </dl>
        <DataTable caption="Consumer demand by funded rule" rowKey={(r) => r.rule} rows={d.demand} empty={<p className="pe-hint">No demand recorded yet.</p>}
          columns={[{ key: 'l', header: 'Demand rule (funder)', render: (r) => r.label }, { key: 'b', header: 'Budget', align: 'end', render: (r) => ec(r.budget) }, { key: 's', header: 'Spent', align: 'end', render: (r) => ec(r.spent) }, { key: 'w', header: 'Units wanted', align: 'end', render: (r) => r.unitsWanted }, { key: 'u', header: 'Units sold', align: 'end', render: (r) => r.unitsSold }, { key: 'm', header: 'Unmet', align: 'end', render: (r) => <span className={r.unmet > 0 ? 'pe-neg' : ''}>{r.unmet}</span> }]} />
      </section>

      <section aria-labelledby="co-t"><h2 id="co-t" className="pe-h2">Companies and profitability</h2>
        <p className="pe-hint">{d.companies.count} companies · {d.companies.operating} operating · {d.companies.paused} paused · <span className={d.companies.insolvent ? 'pe-neg' : ''}>{d.companies.insolvent} insolvent</span> · {d.companies.profitable} profitable (7-day average)</p>
        <DataTable caption="Company profitability" rowKey={(r) => r.id} rows={d.companies.list}
          columns={[{ key: 'n', header: 'Company', render: (r) => r.name }, { key: 'o', header: 'Owner', render: (r) => r.owner }, { key: 'i', header: 'Industry', render: (r) => r.industry }, { key: 'st', header: 'Status', render: (r) => <StatusLabel tone={r.status === 'operating' ? 'positive' : r.status === 'insolvent' ? 'negative' : 'warning'}>{r.status}</StatusLabel> },
            { key: 'rev', header: 'Revenue (7d avg)', align: 'end', render: (r) => ec(r.avgRevenue7) }, { key: 'p', header: 'Profit (7d avg)', align: 'end', render: (r) => <span className={r.avgProfit7 > 0 ? 'pe-pos' : r.avgProfit7 < 0 ? 'pe-neg' : ''}>{ec(r.avgProfit7, true)}</span> }, { key: 'c', header: 'Cash', align: 'end', render: (r) => ec(r.cash) }, { key: 'u', header: 'Arrears', align: 'end', render: (r) => ec(r.unpaid) }]} />
      </section>

      <section aria-labelledby="tk-t"><h2 id="tk-t" className="pe-h2">Tick processing</h2>
        <DataTable caption="Recent economic ticks" rowKey={(r) => String(r.tick)} rows={d.ticks}
          columns={[{ key: 't', header: 'Day', render: (r) => `Day ${r.tick}` }, { key: 's', header: 'Status', render: (r) => <StatusLabel tone={r.status === 'complete' ? 'positive' : 'negative'}>{r.status}</StatusLabel> }, { key: 'd', header: 'Duration', align: 'end', render: (r) => (r.durationMs === null ? '—' : `${r.durationMs} ms`) }, { key: 'tr', header: 'Trades', align: 'end', render: (r) => r.trades ?? '—' }, { key: 'i', header: 'Issued', align: 'end', render: (r) => (r.issued === null ? '—' : ec(r.issued)) }, { key: 'de', header: 'Destroyed', align: 'end', render: (r) => (r.destroyed === null ? '—' : ec(r.destroyed)) }, { key: 'ci', header: 'Circulating', align: 'end', render: (r) => (r.circulating === null ? '—' : ec(r.circulating)) }, { key: 'f', header: 'Failures', align: 'end', render: (r) => r.failures ?? '—' }]} />
        <p className="pe-hint">Config: 1 tick = 1 in-game day = {d.config.realMsPerTick / 1000}s real time; offline catch-up capped at {d.config.maxCatchupTicks} ticks; exchange fee {pct(d.config.exchangeFeeBps)} (seller pays, destroyed); insolvency after {d.config.insolvencyAfterTicks} unpaid days.</p>
      </section>

      <section aria-labelledby="er-t"><h2 id="er-t" className="pe-h2">Errors and failed transactions</h2>
        <p className={d.errors.failedTicks || d.errors.failedTransactions.length ? 'pe-neg' : 'pe-dev-ok'}>{d.errors.failedTicks} failed ticks · {d.errors.failedTransactions.length} recent failed transactions</p>
        <DataTable caption="Failed transactions" rowKey={(r) => String(r.id)} rows={d.errors.failedTransactions} empty={<p className="pe-hint">No failed transactions.</p>}
          columns={[{ key: 't', header: 'Day', render: (r) => r.tick }, { key: 'k', header: 'Kind', render: (r) => r.kind }, { key: 'r', header: 'Reason', render: (r) => r.reason }, { key: 'key', header: 'Key', render: (r) => r.key ?? '—' }]} />
        <DataTable caption="Warnings and errors" rowKey={(r) => String(r.id)} rows={d.errors.events} empty={<p className="pe-hint">No warnings.</p>}
          columns={[{ key: 't', header: 'Day', render: (r) => r.tick }, { key: 'sv', header: 'Severity', render: (r) => <StatusLabel tone={r.severity === 'error' ? 'negative' : 'warning'}>{r.severity}</StatusLabel> }, { key: 'k', header: 'Kind', render: (r) => r.kind }, { key: 'm', header: 'Message', render: (r) => r.message }]} />
      </section>
    </div>
  );
}
