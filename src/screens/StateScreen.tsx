import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCompanyServices, fetchLoanQuote, fetchStateOverview, useStateCommand, type StateOverview } from '@/data/stateClient';
import { useQuery } from '@/data/managementApi';
import { phase5Url, STATE_SPRITE } from '@/assets/artAssets';
import { formatMoney } from '@/domain/money';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { EmptyState, ErrorState, Skeleton } from '@/ui/States';
import { StatusLabel } from '@/ui/StatusLabel';
import { Tabs } from '@/ui/Tabs';

const ec = (m: number | null | undefined, signed = false) => (m === null || m === undefined ? '—' : formatMoney({ currency: 'EC', minor: Math.round(m) }, { signed }));
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const TABS = [{ id: 'overview', label: 'State companies' }, { id: 'economy', label: 'Economy' }, { id: 'energy', label: 'Energy' }, { id: 'ads', label: 'Advertising' }, { id: 'bank', label: 'Bank' }, { id: 'premises', label: 'Premises' }];
const SEV = ['mild', 'serious', 'severe'];

/** State services: the six state companies, the central bank and the economy, and what your own companies buy from them. Every figure comes from the server's books. */
export function StateScreen() {
  const [tab, setTab] = useState('overview');
  const q = useQuery(() => fetchStateOverview(), [], true);
  return (
    <div className="pe-screen" data-testid="state-screen">
      <div className="pe-screen-head"><h1 className="pe-h1">State services &amp; economy</h1></div>
      <p className="pe-hint">Six state-owned companies sell the city its electricity, advertising, deliveries, premises, banking and exchange services. They pay wages, hold real treasuries and have shares on the Stock Exchange. Penny Central Bank sets the base rate by a published rule.</p>
      {q.status === 'loading' ? <Skeleton lines={6} label="Loading state services" /> : q.status === 'error' ? <ErrorState title="Couldn’t load state services" message={q.error} onRetry={q.reload} /> : (
        <Tabs tabs={TABS} value={tab} onChange={setTab} label="State service sections">
          {tab === 'overview' ? <Overview o={q.data} /> : tab === 'economy' ? <Economy o={q.data} /> : tab === 'energy' ? <Energy o={q.data} /> : <CompanyTab o={q.data} kind={tab} />}
        </Tabs>
      )}
    </div>
  );
}

function Overview({ o }: { o: StateOverview }) {
  return (
    <div className="pe-stack">
      <div className="pe-cards">{o.providers.map((p) => (
        <section key={p.id} className="pe-card" aria-label={p.name} data-testid={`provider-${p.service}`}>
          {STATE_SPRITE[p.id] && phase5Url(STATE_SPRITE[p.id]!) ? <img src={phase5Url(STATE_SPRITE[p.id]!)} alt="" width={96} style={{ imageRendering: 'pixelated' }} /> : null}
          <h2 className="pe-h3">{p.name}</h2><p className="pe-hint">{p.label}</p>
          <dl className="pe-stats pe-stats--wide">
            <div><dt>Treasury</dt><dd className="pe-financial-number">{ec(p.treasuryMinor)}</dd></div>
            <div><dt>Revenue (7 days)</dt><dd className="pe-financial-number">{ec(p.revenue7Minor)}</dd></div>
            <div><dt>Customers (7 days)</dt><dd className="pe-financial-number">{p.customers7}</dd></div>
            <div><dt>Profit (7 days)</dt><dd className={`pe-financial-number ${p.profit7Minor < 0 ? 'pe-neg' : 'pe-pos'}`}>{ec(p.profit7Minor, true)}</dd></div>
          </dl>
        </section>))}</div>
      <p className="pe-hint">Payments to state companies are <strong>transfers</strong>, not destroyed coins. Coins leave the economy only through explicit, labelled burns (a small share of the Penny Exchange’s fees and infrastructure wear). <Link to="/stocks">Buy shares in state companies on the Stock Exchange.</Link></p>
    </div>
  );
}

function Economy({ o }: { o: StateOverview }) {
  const cb = o.centralBank, inf = o.inflation, m = o.money;
  return (
    <div className="pe-stack" data-testid="economy-tab">
      <dl className="pe-stats pe-stats--wide">
        <div><dt>Base interest rate</dt><dd className="pe-financial-number" data-testid="base-rate">{pct(cb.baseRateBps)}</dd><small className="pe-hint">{cb.stance} · next review day {cb.nextReviewTick}{cb.ruleEnabled ? '' : ' (rule paused)'}</small></div>
        <div><dt>Basket inflation (30 days)</dt><dd className={`pe-financial-number ${inf.change30dBps > 200 ? 'pe-neg' : ''}`} data-testid="inflation">{pct(inf.change30dBps)}</dd><small className="pe-hint">target {pct(cb.inflationTargetBps)}</small></div>
        <div><dt>Price index</dt><dd className="pe-financial-number">{(inf.indexBps / 100).toFixed(1)}</dd><small className="pe-hint">start = 100</small></div>
        <div><dt>Coins in circulation</dt><dd className="pe-financial-number">{ec(m.latest?.circulating_minor)}</dd></div>
        <div><dt>Loans outstanding</dt><dd className="pe-financial-number">{ec(m.loansOutstandingMinor)}</dd></div>
        <div><dt>Issued / destroyed (total)</dt><dd className="pe-financial-number">{ec(m.issuedTotalMinor)} / {ec(m.destroyedTotalMinor)}</dd></div>
      </dl>
      <p className="pe-hint">{inf.method}</p>
      <section className="pe-card" aria-labelledby="ev-h"><h2 id="ev-h" className="pe-h3">Economic events</h2>
        {o.events.list.length === 0 ? <p className="pe-hint">No events yet. Events start after day 30 under published, seeded rules; they change real fundamentals (energy, deliveries, rents, credit, demand), never prices directly.</p> : (
          <ul className="pe-list">{o.events.list.slice(0, 8).map((e: any) => (
            <li key={e.id}><StatusLabel tone={e.status === 'active' ? 'warning' : 'neutral'}>{e.status}</StatusLabel> <strong>{e.headline}</strong><br /><small className="pe-hint">days {e.startTick}–{e.endTick} · {SEV[e.severity - 1]} · {e.effects.join('; ')} · {e.trigger === 'random' ? `random roll ${e.roll}` : e.trigger}</small></li>))}</ul>)}
      </section>
      <section className="pe-card" aria-labelledby="pl-h"><h2 id="pl-h" className="pe-h3">Central bank decisions</h2>
        <table className="pe-table pe-small"><caption className="pe-sr">Central bank policy log</caption><thead><tr><th scope="col">Day</th><th scope="col">Decision</th><th scope="col" className="pe-num">Rate</th><th scope="col">Reason</th></tr></thead>
          <tbody>{cb.policyLog.slice(0, 10).map((p: any, i: number) => <tr key={i}><td>{p.tick}</td><td>{p.kind === 'base_rate' ? 'Rate change' : p.kind.replace('_', ' ')}{p.actor !== 'rule' ? ` (${p.actor})` : ''}</td><td className="pe-num">{p.newValue !== null && p.kind.includes('rate') ? pct(p.newValue) : '—'}</td><td>{p.reason}</td></tr>)}</tbody></table>
      </section>
      <p className="pe-hint">Read the story in <Link to="/bristol">The Penny Post</Link>.</p>
    </div>
  );
}

function Energy({ o }: { o: StateOverview }) {
  const e = o.energy; const load = e.capacityUnits ? Math.round((e.demandUnits * 100) / e.capacityUnits) : 0;
  return (
    <div className="pe-stack" data-testid="energy-tab">
      <dl className="pe-stats pe-stats--wide">
        <div><dt>Grid capacity</dt><dd className="pe-financial-number">{e.capacityUnits} units</dd><small className="pe-hint">{e.capacityUnits < e.baseCapacityUnits ? `reduced from ${e.baseCapacityUnits} by an event` : 'normal'}</small></div>
        <div><dt>Demand yesterday</dt><dd className="pe-financial-number">{e.demandUnits} units ({load}%)</dd></div>
        <div><dt>Shortage yesterday</dt><dd className={`pe-financial-number ${e.shortageUnits > 0 ? 'pe-neg' : ''}`}>{e.shortageUnits} units</dd></div>
        <div><dt>Tariff</dt><dd className="pe-financial-number">{ec(e.tariffMinor)} / unit</dd><small className="pe-hint">base {ec(e.baseTariffMinor)}; surcharge {pct(e.surchargeBps)} when the grid is loaded</small></div>
      </dl>
      <p className="pe-hint">Production needs electricity. When the grid cannot supply everyone, lines are cut back and the production log says why. Logistics: {o.logistics.shipments7} shipments in 7 days, {o.logistics.delayedNow} delayed now, average fee {ec(o.logistics.avgFeeMinor)}.</p>
    </div>
  );
}

function CompanyTab({ o, kind }: { o: StateOverview; kind: string }) {
  const [id, setId] = useState(o.myCompanies[0]?.id ?? '');
  if (o.myCompanies.length === 0) return <EmptyState title="You have no companies yet" action={<Link className="pe-btn pe-btn--primary" to="/start">Start a company</Link>}>Advertising, loans and premises belong to companies you own.</EmptyState>;
  return (
    <div className="pe-stack">
      <Field label="Company"><select value={id} onChange={(e) => setId(e.target.value)}>{o.myCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <CompanyServices key={id + kind} id={id} kind={kind} o={o} />
    </div>
  );
}

function CompanyServices({ id, kind, o }: { id: string; kind: string; o: StateOverview }) {
  const q = useQuery(() => fetchCompanyServices(id), [id], true);
  if (q.status === 'loading') return <Skeleton lines={5} label="Loading" />;
  if (q.status === 'error') return <ErrorState title="Couldn’t load" message={q.error} onRetry={q.reload} />;
  const s = q.data.services;
  const spend = (k: Record<string, number>) => Object.entries(k).map(([a, b]) => `${a} ${ec(b)}`).join(' · ') || 'nothing yet';
  return (
    <div className="pe-stack">
      <p className="pe-hint" data-testid="service-spend">Paid to state companies — last 7 days: {spend(s.spend7)}. Last 30 days: {spend(s.spend30)}.</p>
      {kind === 'ads' ? <Ads s={s} id={id} onDone={q.reload} /> : kind === 'bank' ? <Bank s={s} id={id} onDone={q.reload} /> : <Premises s={s} id={id} onDone={q.reload} />}
      {o.tick < 0 ? null : null}
    </div>
  );
}

function Ads({ s, id, onDone }: { s: Record<string, any>; id: string; onDone: () => void }) {
  const a = s.advertising; const { send, pending } = useStateCommand(); const [kind, setKind] = useState('local'); const [tier, setTier] = useState(1); const [days, setDays] = useState(7);
  const offer = a.menu.find((m: any) => m.kind === kind);
  return (
    <div className="pe-stack" data-testid="ads-tab">
      <dl className="pe-stats pe-stats--wide">
        <div><dt>Awareness</dt><dd className="pe-financial-number">{pct(a.awarenessBps)}</dd><small className="pe-hint">hard ceiling {pct(a.maxAwarenessBps)}; fades 5% a day</small></div>
        <div><dt>Uplift from campaigns</dt><dd className="pe-financial-number">{pct(a.upliftBps)}</dd></div>
        <div><dt>Spend (7 / 30 days)</dt><dd className="pe-financial-number">{ec(a.spend7Minor)} / {ec(a.spend30Minor)}</dd></div>
      </dl>
      <section className="pe-card"><h2 className="pe-h3">Buy a campaign</h2>
        <div className="pe-row">
          <Field label="Type"><select value={kind} onChange={(e) => { setKind(e.target.value); setDays(Math.max(days, a.menu.find((m: any) => m.kind === e.target.value).minDays)); }}>{a.menu.map((m: any) => <option key={m.kind} value={m.kind}>{m.label}</option>)}</select></Field>
          <Field label="Tier"><select value={tier} onChange={(e) => setTier(Number(e.target.value))}>{[1, 2, 3].map((t) => <option key={t} value={t}>Tier {t}</option>)}</select></Field>
          <Field label={`Days (${offer.minDays}–${offer.maxDays})`}><input type="number" min={offer.minDays} max={offer.maxDays} value={days} onChange={(e) => setDays(Number(e.target.value))} /></Field>
        </div>
        <p className="pe-hint">{offer.description} Costs {ec(offer.priceByTier[tier - 1])} a day, billed daily. Returns diminish as you spend more, rivals in your industry dilute your message, and awareness is capped.</p>
        <Button variant="primary" pending={pending} onClick={() => send({ type: 'ad.start', companyId: id, kind, tier, days }, { success: 'Campaign started', failure: 'Couldn’t start the campaign' }, onDone)}>Start campaign</Button>
      </section>
      <section className="pe-card"><h2 className="pe-h3">Campaign history</h2>
        {a.campaigns.length === 0 ? <p className="pe-hint">No campaigns yet.</p> : (
          <table className="pe-table pe-small"><caption className="pe-sr">Campaign history</caption><thead><tr><th scope="col">Type</th><th scope="col">Days</th><th scope="col">Status</th><th scope="col" className="pe-num">Paid</th><th scope="col" className="pe-num">Dilution (7d)</th><th scope="col" /></tr></thead>
            <tbody>{a.campaigns.map((c: any) => <tr key={c.id}><td>{c.kind} T{c.tier}</td><td>{c.start_tick}–{c.end_tick}</td><td>{c.status}</td><td className="pe-num">{ec(c.total_paid_minor)}</td><td className="pe-num">{pct(c.avgDilutionBps)}</td><td>{c.status === 'active' ? <Button variant="ghost" onClick={() => send({ type: 'ad.cancel', companyId: id, campaignId: c.id }, { success: 'Campaign cancelled', failure: 'Couldn’t cancel' }, onDone)}>Cancel</Button> : null}</td></tr>)}</tbody></table>)}
      </section>
    </div>
  );
}

function Bank({ s, id, onDone }: { s: Record<string, any>; id: string; onDone: () => void }) {
  const c = s.credit, p = c.profile; const { send, pending } = useStateCommand(); const [amount, setAmount] = useState(500); const [term, setTerm] = useState(30); const [dep, setDep] = useState(100);
  const quote = useQuery(() => fetchLoanQuote(id, Math.round(amount * 100), term), [id, amount, term], false);
  return (
    <div className="pe-stack" data-testid="bank-tab">
      <dl className="pe-stats pe-stats--wide">
        <div><dt>Credit grade</dt><dd className="pe-financial-number">{p.grade}</dd><small className="pe-hint">{p.reasons.join(' ')}</small></div>
        <div><dt>You can borrow up to</dt><dd className="pe-financial-number">{ec(p.availableMinor)}</dd><small className="pe-hint">limit {ec(p.limitMinor)} from {ec(p.meanProfitMinor)} average daily profit</small></div>
        <div><dt>Your loan rate</dt><dd className="pe-financial-number">{pct(p.rateBps)}</dd><small className="pe-hint">base rate + credit spread; moves when the central bank moves</small></div>
        <div><dt>Savings</dt><dd className="pe-financial-number">{ec(c.deposit.balanceMinor)}</dd><small className="pe-hint">earns {pct(c.depositRateBps)}</small></div>
      </dl>
      <section className="pe-card"><h2 className="pe-h3">Borrow</h2>
        <div className="pe-row">
          <Field label="Amount (EC)"><input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
          <Field label="Term (days)"><input type="number" min={7} value={term} onChange={(e) => setTerm(Number(e.target.value))} /></Field>
        </div>
        {quote.status === 'ready' ? (quote.data.quote.refusal ? <p className="pe-hint" role="status">{quote.data.quote.refusal}</p> : <p className="pe-hint">Repay about {ec(quote.data.quote.dailyPrincipalMinor)} principal plus interest each day (first day {ec(quote.data.quote.firstDayInterestMinor)}). Origination fee {ec(quote.data.quote.originationFeeMinor)}. Interest is floating: it rises if the base rate rises.</p>) : null}
        <Button variant="primary" pending={pending} disabled={quote.status === 'ready' && !!quote.data.quote.refusal} onClick={() => send({ type: 'loan.take', companyId: id, amountMinor: Math.round(amount * 100), termDays: term }, { success: 'Loan paid out', failure: 'Loan refused' }, onDone)}>Take loan</Button>
      </section>
      <section className="pe-card"><h2 className="pe-h3">Your loans</h2>
        {c.loans.length === 0 ? <p className="pe-hint">No loans.</p> : (
          <table className="pe-table pe-small"><caption className="pe-sr">Loans</caption><thead><tr><th scope="col">Loan</th><th scope="col">Status</th><th scope="col" className="pe-num">Owed</th><th scope="col" className="pe-num">Rate</th><th scope="col" className="pe-num">Interest paid</th><th scope="col" /></tr></thead>
            <tbody>{c.loans.map((l: any) => <tr key={l.id}><td>{l.id}</td><td>{l.status}{l.missed ? ` (${l.missed} missed)` : ''}</td><td className="pe-num">{ec(l.outstanding_minor)}</td><td className="pe-num">{l.status === 'repaid' ? '—' : pct(l.effectiveRateBps)}</td><td className="pe-num">{ec(l.interest_paid_minor)}</td><td>{l.status !== 'repaid' ? <Button variant="ghost" onClick={() => send({ type: 'loan.repay', companyId: id, loanId: l.id, amountMinor: l.outstanding_minor }, { success: 'Loan repaid', failure: 'Couldn’t repay' }, onDone)}>Repay in full</Button> : null}</td></tr>)}</tbody></table>)}
        {c.payments.length ? <details><summary>Recent payments (principal and interest are separate)</summary><ul className="pe-list pe-small">{c.payments.slice(0, 8).map((p2: any, i: number) => <li key={i}>Day {p2.tick}: {p2.status} · principal {ec(p2.principalMinor)} · interest {ec(p2.interestMinor)}{p2.feeMinor ? ` · late fee ${ec(p2.feeMinor)}` : ''}</li>)}</ul></details> : null}
      </section>
      <section className="pe-card"><h2 className="pe-h3">Savings</h2>
        <Field label="Amount (EC)"><input type="number" min={1} value={dep} onChange={(e) => setDep(Number(e.target.value))} /></Field>
        <div className="pe-row"><Button pending={pending} onClick={() => send({ type: 'bank.deposit', companyId: id, amountMinor: Math.round(dep * 100) }, { success: 'Deposited', failure: 'Couldn’t deposit' }, onDone)}>Deposit</Button><Button pending={pending} onClick={() => send({ type: 'bank.withdraw', companyId: id, amountMinor: Math.round(dep * 100) }, { success: 'Withdrawn', failure: 'Couldn’t withdraw' }, onDone)}>Withdraw</Button></div>
        <p className="pe-hint">A simulated game product with Empire Coins only. It is not a real deposit.</p>
      </section>
    </div>
  );
}

function Premises({ s, id, onDone }: { s: Record<string, any>; id: string; onDone: () => void }) {
  const p = s.premises; const { send, pending } = useStateCommand();
  return (
    <div className="pe-stack" data-testid="premises-tab">
      <dl className="pe-stats pe-stats--wide">
        <div><dt>Arrangement</dt><dd className="pe-financial-number">{p.lease?.kind === 'owned' ? 'Owned' : 'Leased'}</dd></div>
        <div><dt>Daily cost</dt><dd className="pe-financial-number">{ec(p.rent.totalMinor)}</dd><small className="pe-hint">{p.rent.kind === 'owned' ? 'rates only' : `rent ${ec(p.rent.rentMinor)} + service charge ${ec(p.rent.serviceMinor)}`}</small></div>
        {p.purchasePriceMinor ? <div><dt>Price to buy</dt><dd className="pe-financial-number">{ec(p.purchasePriceMinor)}</dd></div> : null}
      </dl>
      {p.purchasePriceMinor ? <Button variant="primary" pending={pending} onClick={() => send({ type: 'property.buy', companyId: id }, { success: 'Premises bought', failure: 'Couldn’t buy' }, onDone)}>Buy the premises from Central Property</Button> : null}
      <p className="pe-hint">Companies that existed before leases were introduced kept their rent with no service charge and no retroactive fees. Premium locations cost more; owners pay rates only.</p>
      <table className="pe-table pe-small"><caption className="pe-sr">Lease history</caption><thead><tr><th scope="col">From</th><th scope="col">Type</th><th scope="col" className="pe-num">Base rent</th><th scope="col">Note</th></tr></thead>
        <tbody>{p.history.map((h: any) => <tr key={h.id}><td>day {h.startTick}{h.endTick !== null ? `–${h.endTick}` : ''}</td><td>{h.kind}</td><td className="pe-num">{ec(h.baseRentMinor)}</td><td>{h.note ?? ''}</td></tr>)}</tbody></table>
    </div>
  );
}
