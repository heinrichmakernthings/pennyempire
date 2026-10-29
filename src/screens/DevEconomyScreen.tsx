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

      <ExchangeSection x={d.exchange} />
      <StateEconomySection />
      <ShareMarketSection m={d.market} />

      <section aria-labelledby="co-t"><h2 id="co-t" className="pe-h2">Companies and profitability</h2>
        <p className="pe-hint">{d.companies.count} companies · {d.companies.operating} operating · {d.companies.paused} paused · <span className={d.companies.insolvent ? 'pe-neg' : ''}>{d.companies.insolvent} insolvent</span> · {d.companies.profitable} profitable (7-day average)</p>
        <DataTable caption="Company profitability" rowKey={(r) => r.id} rows={d.companies.list}
          columns={[{ key: 'n', header: 'Company', render: (r) => r.name }, { key: 'o', header: 'Owner', render: (r) => r.owner }, { key: 'i', header: 'Industry', render: (r) => r.industry }, { key: 'st', header: 'Status', render: (r) => <StatusLabel tone={r.status === 'operating' ? 'positive' : r.status === 'insolvent' ? 'negative' : 'warning'}>{r.status}</StatusLabel> },
            { key: 'rev', header: 'Revenue (7d avg)', align: 'end', render: (r) => ec(r.avgRevenue7) }, { key: 'p', header: 'Profit (7d avg)', align: 'end', render: (r) => <span className={r.avgProfit7 > 0 ? 'pe-pos' : r.avgProfit7 < 0 ? 'pe-neg' : ''}>{ec(r.avgProfit7, true)}</span> }, { key: 'c', header: 'Cash', align: 'end', render: (r) => ec(r.cash) }, { key: 'u', header: 'Arrears', align: 'end', render: (r) => ec(r.unpaid) }]} />
      </section>

      <section aria-labelledby="tk-t"><h2 id="tk-t" className="pe-h2">Tick processing</h2>
        <DataTable caption="Recent economic ticks" rowKey={(r) => String(r.tick)} rows={d.ticks}
          columns={[{ key: 't', header: 'Day', render: (r) => `Day ${r.tick}` }, { key: 's', header: 'Status', render: (r) => <StatusLabel tone={r.status === 'complete' ? 'positive' : 'negative'}>{r.status}</StatusLabel> }, { key: 'd', header: 'Duration', align: 'end', render: (r) => (r.durationMs === null ? '—' : `${r.durationMs} ms`) }, { key: 'tr', header: 'Trades', align: 'end', render: (r) => r.trades ?? '—' }, { key: 'i', header: 'Issued', align: 'end', render: (r) => (r.issued === null ? '—' : ec(r.issued)) }, { key: 'de', header: 'Destroyed', align: 'end', render: (r) => (r.destroyed === null ? '—' : ec(r.destroyed)) }, { key: 'ci', header: 'Circulating', align: 'end', render: (r) => (r.circulating === null ? '—' : ec(r.circulating)) }, { key: 'f', header: 'Failures', align: 'end', render: (r) => r.failures ?? '—' }]} />
        <p className="pe-hint">Config: 1 tick = 1 in-game day = {d.config.realMsPerTick / 1000}s real time; offline catch-up capped at {d.config.maxCatchupTicks} ticks; exchange fee {pct(d.config.exchangeFeeBps)} (seller pays; transferred to the Penny Exchange, {pct(d.config.exchangeBurnBps)} of its income burned each day); insolvency after {d.config.insolvencyAfterTicks} unpaid days.</p>
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

function ExchangeSection({ x }: { x: EconomyDashboard['exchange'] }) {
  return (
    <section aria-labelledby="ex-t"><h2 id="ex-t" className="pe-h2">Penny Exchange</h2>
      <dl className="pe-stats pe-stats--wide">
        <div><dt>Fee income held (now)</dt><dd>{ec(x.fees.balance)}</dd></div>
        <div><dt>Fees collected (7d)</dt><dd>{ec(x.fees.collected7d)}</dd></div>
        <div><dt>Fees burned (total)</dt><dd>{ec(x.fees.burnedTotal)}</dd></div>
        <div><dt>Fees swept to treasury (none: retained as exchange revenue)</dt><dd>{ec(x.fees.sweptTotal)}</dd></div>
        <div><dt>Trades / value (7d)</dt><dd>{x.trades.count7d} · {ec(x.trades.value7d)}</dd></div>
        <div><dt>Open orders (buy / sell)</dt><dd>{x.orders.open} ({x.orders.openBuy} / {x.orders.openSell})</dd></div>
        <div><dt>Reserved funds / units</dt><dd>{ec(x.orders.reservedFunds)} / {x.orders.reservedUnits}</dd></div>
        <div><dt>Reservations consistent</dt><dd><StatusLabel tone={x.reservations.consistent ? 'positive' : 'negative'}>{x.reservations.consistent ? 'Yes' : 'MISMATCH'}</StatusLabel></dd></div>
        <div><dt>Contracts (active / pending)</dt><dd>{x.contracts.active} / {x.contracts.pending}</dd></div>
        <div><dt>Deliveries 7d (ok / missed)</dt><dd>{x.contracts.delivered7d} / {x.contracts.missed7d}</dd></div>
      </dl>
      <DataTable caption="Commodity markets" rowKey={(r) => r.id} rows={x.commodities}
        columns={[{ key: 'c', header: 'Commodity', render: (r) => r.id }, { key: 'l', header: 'Last', align: 'end', render: (r) => (r.lastPrice === null ? '—' : ec(r.lastPrice)) }, { key: 'v', header: 'VWAP 7d', align: 'end', render: (r) => (r.vwap7d === null ? '—' : ec(r.vwap7d)) }, { key: 'ref', header: 'Reference', align: 'end', render: (r) => ec(r.reference) },
          { key: 'bid', header: 'Best bid', align: 'end', render: (r) => (r.bestBid === null ? '—' : ec(r.bestBid)) }, { key: 'ask', header: 'Best ask', align: 'end', render: (r) => (r.bestAsk === null ? '—' : ec(r.bestAsk)) }, { key: 'sp', header: 'Spread', align: 'end', render: (r) => (r.spreadBps === null ? '—' : pct(r.spreadBps)) },
          { key: 'vol', header: 'Vol today / 7d', align: 'end', render: (r) => `${r.volumeToday} / ${r.volume7d}` }, { key: 'lst', header: 'Listed', align: 'end', render: (r) => r.listed }, { key: 'dem', header: 'Demand/day', align: 'end', render: (r) => r.demand },
          { key: 'st', header: 'Status', render: (r) => <StatusLabel tone={r.status === 'shortage' ? 'negative' : r.status === 'surplus' ? 'warning' : 'neutral'}>{r.status}</StatusLabel> }]} />
      <div className="pe-forms">
        <DataTable caption="Who trades with whom (7d)" rowKey={(r) => r.pair} rows={x.trades.byPair} empty={<p className="pe-hint">No trades yet.</p>} columns={[{ key: 'p', header: 'Pair', render: (r) => r.pair }, { key: 'n', header: 'Trades', align: 'end', render: (r) => r.trades }, { key: 'v', header: 'Value', align: 'end', render: (r) => ec(r.value) }]} />
        <DataTable caption="NPC and state trading activity (7d)" rowKey={(r) => r.company} rows={x.npcActivity} empty={<p className="pe-hint">None.</p>} columns={[{ key: 'n', header: 'Company', render: (r) => r.name }, { key: 'b', header: 'Bought', align: 'end', render: (r) => `${r.boughtUnits} · ${ec(r.boughtValue)}` }, { key: 's', header: 'Sold', align: 'end', render: (r) => `${r.soldUnits} · ${ec(r.soldValue)}` }]} />
      </div>
      <DataTable caption="Failed settlements and refusals (30d)" rowKey={(r) => r.kind} rows={x.failedSettlements} empty={<p className="pe-hint">No failed settlements.</p>} columns={[{ key: 'k', header: 'Kind', render: (r) => r.kind }, { key: 'n', header: 'Count', align: 'end', render: (r) => r.n }, { key: 'r', header: 'Latest reason', render: (r) => r.lastReason ?? '—' }]} />
      <DataTable caption="Anomalies and market alerts" rowKey={(r) => r.kind + r.detail} rows={x.anomalies} empty={<p className="pe-dev-ok">No anomalies detected.</p>} columns={[{ key: 's', header: 'Severity', render: (r) => <StatusLabel tone={r.severity === 'error' ? 'negative' : 'warning'}>{r.severity}</StatusLabel> }, { key: 'k', header: 'Kind', render: (r) => r.kind }, { key: 'd', header: 'Detail', render: (r) => r.detail }]} />
    </section>
  );
}

function ShareMarketSection({ m }: { m: EconomyDashboard['market'] }) {
  const p = (v: number | null) => (v === null ? '—' : ec(v));
  return (
    <section aria-labelledby="sm-t" data-testid="share-market-dashboard"><h2 id="sm-t" className="pe-h2">Share market</h2>
      <dl className="pe-stats pe-stats--wide">
        <div><dt>Share register consistent</dt><dd><StatusLabel tone={m.integrity.ok ? 'positive' : 'negative'}>{m.integrity.ok ? 'Yes' : `${m.integrity.problems.length} problem(s)`}</StatusLabel></dd></div>
        <div><dt>Listed companies</dt><dd>{m.totals.listedCount}</dd></div><div><dt>Total market value</dt><dd>{ec(m.totals.marketCapMinor)}</dd></div>
        <div><dt>Volume / value (7d)</dt><dd>{m.totals.volume7d} · {ec(m.totals.value7d)}</dd></div><div><dt>Fees collected (all time)</dt><dd>{ec(m.totals.feesCollected)}</dd></div>
        <div><dt>Dividends declared / paid</dt><dd>{ec(m.totals.dividendsDeclared)} / {ec(m.totals.dividendsPaid)}</dd></div>
        <div><dt>Shares issued / cancelled</dt><dd>{m.totals.sharesIssued} / {m.totals.sharesCancelled}</dd></div><div><dt>IPOs</dt><dd>{m.totals.ipos}</dd></div>
      </dl>
      {m.integrity.problems.map((x) => <p key={x} className="pe-neg">{x}</p>)}
      <DataTable caption="Listed companies" rowKey={(r) => r.ticker} rows={m.listed}
        columns={[{ key: 't', header: 'Ticker', render: (r) => `${r.ticker}${r.status === 'suspended' ? ' (suspended)' : ''}` }, { key: 'o', header: 'Outstanding / issued', align: 'end', render: (r) => `${r.outstanding} / ${r.issued}` }, { key: 'p', header: 'Last', align: 'end', render: (r) => p(r.lastPrice) }, { key: 'f', header: 'Estimate', align: 'end', render: (r) => p(r.fair) },
          { key: 'c', header: 'Market cap', align: 'end', render: (r) => p(r.marketCap) }, { key: 'v', header: 'Vol 7d', align: 'end', render: (r) => r.volume7d }, { key: 's', header: 'Spread', align: 'end', render: (r) => (r.spreadBps === null ? '—' : pct(r.spreadBps)) }, { key: 'd', header: 'Depth bid/ask', align: 'end', render: (r) => `${r.depthBid} / ${r.depthAsk}` },
          { key: 'h', header: 'Top holder / HHI', align: 'end', render: (r) => `${pct(r.top1Bps)} / ${r.hhiBps}` }, { key: 'vol', header: 'Volatility', align: 'end', render: (r) => pct(r.volatilityBps) }]} />
      <div className="pe-forms">
        <DataTable caption="Participation by holder type (7d)" rowKey={(r) => r.kind} rows={m.participation} empty={<p className="pe-hint">No trades.</p>} columns={[{ key: 'k', header: 'Type', render: (r) => r.kind }, { key: 'b', header: 'Bought', align: 'end', render: (r) => `${r.buyShares} · ${ec(r.buyValue)}` }, { key: 's', header: 'Sold', align: 'end', render: (r) => `${r.sellShares} · ${ec(r.sellValue)}` }]} />
        <DataTable caption="NPC investors" rowKey={(r) => r.id} rows={m.investors} columns={[{ key: 'n', header: 'Investor', render: (r) => `${r.name} (${r.strategy ?? '—'})` }, { key: 'c', header: 'Cash', align: 'end', render: (r) => ec(r.cashMinor) }, { key: 'p', header: 'Positions', align: 'end', render: (r) => r.positions }, { key: 'd', header: 'Last decision', render: (r) => r.lastDecisions[0] ? `${r.lastDecisions[0].action}: ${r.lastDecisions[0].reason}` : '—' }]} />
      </div>
      <DataTable caption="Suspicious trading and alerts" rowKey={(r) => r.kind + r.detail} rows={m.suspicious} empty={<p className="pe-dev-ok">Nothing suspicious detected.</p>} columns={[{ key: 's', header: 'Severity', render: (r) => <StatusLabel tone={r.severity === 'error' ? 'negative' : r.severity === 'warning' ? 'warning' : 'neutral'}>{r.severity}</StatusLabel> }, { key: 'k', header: 'Kind', render: (r) => r.kind }, { key: 'd', header: 'Detail', render: (r) => r.detail }]} />
      <DataTable caption="Share audit trail: issuances, cancellations and recent transfers" rowKey={(r) => String(r.id)} rows={m.audit.journal} columns={[{ key: 'i', header: '#', render: (r) => r.id }, { key: 't', header: 'Day', render: (r) => r.tick }, { key: 'k', header: 'Kind', render: (r) => r.kind }, { key: 'c', header: 'Company', render: (r) => r.company }, { key: 'f', header: 'From → to', render: (r) => `${r.from ?? '—'} → ${r.to ?? '—'}` }, { key: 'q', header: 'Shares', align: 'end', render: (r) => r.qty }, { key: 'p', header: 'Price', align: 'end', render: (r) => (r.price ? ec(r.price) : '—') }]} />
      <DataTable caption="Dividend audit trail" rowKey={(r) => String(r.id)} rows={m.audit.dividends} empty={<p className="pe-hint">No dividends.</p>} columns={[{ key: 'i', header: '#', render: (r) => r.id }, { key: 'c', header: 'Company', render: (r) => r.company }, { key: 'p', header: 'Per share', align: 'end', render: (r) => ec(r.perShare) }, { key: 't', header: 'Total', align: 'end', render: (r) => ec(r.total) }, { key: 's', header: 'Status', render: (r) => r.status }, { key: 'b', header: 'Declared by', render: (r) => r.declaredBy }]} />
    </section>
  );
}

type StateDash = ReturnType<typeof import('../../server/api/stateDashboard').stateDashboard>;
/** State economy: currency creation/transfers/destruction, inflation, the central bank, state-company books, credit, energy, logistics, events and stability — all read from the books. */
function StateEconomySection() {
  const [d, setD] = useState<StateDash | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const load = async () => { try { const r = await fetch('/api/dev/state'); const j = await r.json(); if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`); setD(j.dashboard as StateDash); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } };
    void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 3_000); return () => clearInterval(t);
  }, []);
  if (err) return <ErrorState title="State economy unavailable" message={err} />;
  if (!d) return <Skeleton lines={4} label="Loading state economy" />;
  return (
    <section aria-labelledby="se-t" data-testid="dev-state-economy"><h2 id="se-t" className="pe-h2">State economy &amp; monetary policy</h2>
      <p className={d.ledger.reconciles ? 'pe-dev-ok' : 'pe-neg'}>Ledger reconciles: <strong>{String(d.ledger.reconciles)}</strong></p>
      <dl className="pe-stats pe-stats--wide">
        <div><dt>Coins in circulation</dt><dd>{ec(d.currency.circulatingMinor)}</dd></div>
        <div><dt>Issued / destroyed (total)</dt><dd>{ec(d.currency.issuedTotalMinor)} / {ec(d.currency.destroyedTotalMinor)}</dd></div>
        <div><dt>Issued / destroyed (30d)</dt><dd>{ec(d.currency.issued30Minor)} / {ec(d.currency.destroyed30Minor)}</dd></div>
        <div><dt>Transferred (30d, never a sink)</dt><dd>{ec(d.currency.transferred30Minor)}</dd></div>
        <div><dt>Basket inflation (30d) vs target</dt><dd>{pct(d.inflation.change30dBps)} vs {pct(d.inflation.targetBps)}</dd></div>
        <div><dt>Base rate · stance</dt><dd>{pct(d.centralBank.baseRateBps)} · {d.centralBank.stance}{d.centralBank.ruleEnabled ? '' : ' (rule paused)'}</dd></div>
        <div><dt>State treasury</dt><dd>{ec(d.stateCompanies.stateTreasuryMinor)}</dd></div>
        <div><dt>Loans / deposits</dt><dd>{ec(d.banking.loansOutstandingMinor)} / {ec(d.banking.depositsMinor)}</dd></div>
        <div><dt>Defaulted loans · write-offs (30d)</dt><dd>{d.banking.defaulted} · {ec(d.banking.writeOffs30Minor)}</dd></div>
        <div><dt>Energy: tariff · shortage</dt><dd>{ec(d.energy.tariffMinor)} · {d.energy.shortageUnits} units</dd></div>
        <div><dt>Advertising spend (7d / 30d)</dt><dd>{ec(d.advertising.spend7Minor)} / {ec(d.advertising.spend30Minor)}</dd></div>
        <div><dt>Logistics: shipments (7d) · delayed</dt><dd>{d.logistics.shipments7} · {d.logistics.delayedNow}</dd></div>
        <div><dt>Property revenue (30d) · leases / owned</dt><dd>{ec(d.property.revenue30Minor)} · {d.property.activeLeases} / {d.property.owned}</dd></div>
        <div><dt>Bankruptcies (30d / total)</dt><dd>{d.stability.bankruptcies30} / {d.stability.bankruptciesTotal}</dd></div>
        <div><dt>Active events</dt><dd>{d.events.active.length ? d.events.active.map((e: { type: string; severity: number }) => `${e.type} (${e.severity})`).join(', ') : 'none'}</dd></div>
      </dl>
      <DataTable caption="State company treasuries and 30-day service revenue" rowKey={(r) => r.id} rows={d.stateCompanies.treasuries} empty={null}
        columns={[{ key: 'n', header: 'Company', render: (r) => r.name }, { key: 'b', header: 'Treasury', render: (r) => ec(r.balanceMinor) }]} />
      <p className="pe-hint">Administrative changes (base rate, whitelisted parameters, events) go through <code>/api/admin/*</code> with an administrator token and are written to the admin log. Balances cannot be edited.</p>
    </section>
  );
}
