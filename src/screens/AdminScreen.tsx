import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Tabs } from '@/ui/Tabs';
import { errorText, request, useAuth } from '@/data/authClient';
import { useUi } from '@/state/ui';

const ec = (m: number) => `${(m / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EC`;
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/**
 * Administrator console. Every action goes through audited server routes; there is deliberately no control that edits a balance directly:
 * money only moves through the ledgers' own rules (events, rates and the SIMULATED treasury tools).
 */
export function AdminScreen() {
  const user = useAuth((s) => s.user);
  const [tab, setTab] = useState('health');
  if (user?.role !== 'admin') return <section className="pe-screen"><h1 className="pe-h">Administration</h1><p className="pe-field-error" role="alert">Administrator permission required.</p></section>;
  return (
    <section className="pe-screen pe-admin">
      <h1 className="pe-h">Administration</h1>
      <Tabs label="Administration" value={tab} onChange={setTab} tabs={[{ id: 'health', label: 'System health' }, { id: 'audit', label: 'Economy audit' }, { id: 'players', label: 'Players & invites' }, { id: 'economy', label: 'Economy controls' }, { id: 'log', label: 'Audit log' }]}>
        {tab === 'health' && <Health />}{tab === 'audit' && <Audit />}{tab === 'players' && <Players />}{tab === 'economy' && <Economy />}{tab === 'log' && <Log />}
      </Tabs>
    </section>
  );
}

function useAdmin<T>(path: string) {
  const [data, setData] = useState<T | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await request<T>(path); if (r.status === 200) { setData(r.body as T); setErr(null); } else setErr(errorText(r)); }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, err, load };
}

interface HealthBody { health: { tick: number; ticks: { failed: number | null; avgMs: number | null; maxMs: number | null }; coinLedger: { ok: boolean; problems: string[]; issued: number; destroyed: number; circulating: number }; gbpLedger: { ok: boolean; problems: string[]; totals: Record<string, number> }; players: number; companies: { kind: string; status: string; n: number }[]; openOrders: number; trades24: { n: number; v: number }; npcDecisions: number; activeEvents: { id: string; type: string; headline: string; endTick: number }[]; recentErrors: { tick: number; kind: string; reason: string }[]; rewardBudgets: Record<string, unknown> } }
function Health() {
  const { data, err, load } = useAdmin<HealthBody>('/api/admin/health');
  if (err) return <p className="pe-field-error" role="alert">{err}</p>;
  if (!data) return <p className="pe-hint">Loading…</p>;
  const h = data.health;
  return (
    <div className="pe-cards">
      <div className="pe-card"><h2>Simulation</h2><dl className="pe-kv">
        <dt>Day</dt><dd>{h.tick}</dd><dt>Failed ticks (last 50)</dt><dd className={h.ticks.failed ? 'pe-neg' : ''}>{h.ticks.failed ?? 0}</dd><dt>Tick time</dt><dd>{Math.round(h.ticks.avgMs ?? 0)} ms avg · {h.ticks.maxMs ?? 0} ms max</dd>
        <dt>Players</dt><dd>{h.players}</dd><dt>NPC decisions (7 days)</dt><dd>{h.npcDecisions}</dd><dt>Open orders</dt><dd>{h.openOrders}</dd><dt>Trades today</dt><dd>{h.trades24.n} · {ec(h.trades24.v)}</dd>
      </dl><Button onClick={() => void load()}>Refresh</Button></div>
      <div className="pe-card"><h2>Empire Coin ledger</h2><p className={h.coinLedger.ok ? 'pe-pos' : 'pe-neg'}>{h.coinLedger.ok ? 'Reconciles' : 'PROBLEMS FOUND'}</p>
        <dl className="pe-kv"><dt>Issued</dt><dd>{ec(h.coinLedger.issued)}</dd><dt>Destroyed</dt><dd>{ec(h.coinLedger.destroyed)}</dd><dt>Circulating</dt><dd>{ec(h.coinLedger.circulating)}</dd></dl>
        {h.coinLedger.problems.map((p) => <p key={p} className="pe-field-error">{p}</p>)}</div>
      <div className="pe-card"><h2>GBP_TEST ledger <span className="pe-pill">SIMULATED</span></h2><p className={h.gbpLedger.ok ? 'pe-pos' : 'pe-neg'}>{h.gbpLedger.ok ? 'Reconciles' : 'PROBLEMS FOUND'}</p>
        <dl className="pe-kv">{Object.entries(h.gbpLedger.totals).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>£{(Math.abs(v) / 100).toFixed(2)}</dd></div>)}</dl></div>
      <div className="pe-card"><h2>Companies</h2><table className="pe-table"><tbody>{h.companies.map((c) => <tr key={c.kind + c.status}><td>{c.kind}</td><td>{c.status}</td><td>{c.n}</td></tr>)}</tbody></table></div>
      <div className="pe-card"><h2>Active economic events</h2>{h.activeEvents.length ? <ul className="pe-list">{h.activeEvents.map((e) => <li key={e.id}>{e.headline} <span className="pe-hint">(until day {e.endTick})</span></li>)}</ul> : <p className="pe-hint">None.</p>}</div>
      <div className="pe-card"><h2>Recent rejected actions</h2>{h.recentErrors.length ? <ul className="pe-list">{h.recentErrors.map((e, i) => <li key={i}><span className="pe-hint">Day {e.tick} · {e.kind}</span> {e.reason}</li>)}</ul> : <p className="pe-hint">None.</p>}</div>
    </div>
  );
}

interface AuditBody { audit: { tick: number; elapsedMs: number; invariants: { ok: boolean; checks: number; findings: { id: string; severity: string; count: number; detail: string }[] }; money: { issued: number; destroyed: number; circulating: number; issuedByReason: Record<string, number>; destroyedByReason: Record<string, number> }; inflation: { cpiNowBps: number; cpi30dAgoBps: number | null; cpi90dAgoBps: number | null }; volumes30d: { commodityTrades: number; commodityValueMinor: number; shareTrades: number; shareValueMinor: number; consumerSpendMinor: number }; industries: { industry: string; companies: number; operating: number; failures: number; profit: number; revenue: number; cash: number }[]; npcFinances: { cash: number; operating: number; losing: number }; bankruptcies: { total: number; last30d: number }; credit: { active: number; outstanding: number; defaults: number; writtenOff: number }; stateTreasuries: { id: string; name: string; cash: number }[]; householdsMinor: number; walletLiabilitiesPence: number } }
const pct = (now: number, then: number | null) => (then ? `${(((now - then) / then) * 100).toFixed(1)}%` : '—');
/** Live economy audit: every invariant re-checked on demand, and the numbers that explain where money comes from and goes. */
function Audit() {
  const { data, err, load } = useAdmin<AuditBody>('/api/admin/audit');
  if (err) return <p className="pe-field-error" role="alert">{err}</p>;
  if (!data) return <p className="pe-hint">Running the audit…</p>;
  const a = data.audit; const reasons = (o: Record<string, number>) => Object.entries(o).sort((x, y) => y[1] - x[1]);
  return (
    <div className="pe-cards">
      <div className="pe-card pe-card--wide"><h2>Invariants <span className={a.invariants.ok ? 'pe-pos' : 'pe-neg'}>{a.invariants.ok ? `all ${a.invariants.checks} hold` : `${a.invariants.findings.length} FAILING`}</span></h2>
        <p className="pe-hint">Day {a.tick}: every trade, share trade and dividend matched to exactly one ledger transaction; production consumed its recipe inputs; reservations, supply caps and lottery pools consistent; every coin issued has a reason. Took {a.elapsedMs} ms.</p>
        {a.invariants.findings.map((f) => <p key={f.id} className="pe-field-error">{f.severity} {f.id}: {f.detail} ({f.count})</p>)}
        <Button onClick={() => void load()}>Run again</Button></div>
      <div className="pe-card"><h2>Money supply</h2><dl className="pe-kv"><dt>Circulating</dt><dd>{ec(a.money.circulating)}</dd><dt>Ever issued</dt><dd>{ec(a.money.issued)}</dd><dt>Ever destroyed</dt><dd>{ec(a.money.destroyed)}</dd><dt>Households hold</dt><dd>{ec(a.householdsMinor)}</dd></dl>
        <h3>Issued by reason</h3><dl className="pe-kv">{reasons(a.money.issuedByReason).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{ec(v)}</dd></div>)}</dl>
        <h3>Destroyed by reason</h3><dl className="pe-kv">{reasons(a.money.destroyedByReason).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{ec(v)}</dd></div>)}</dl></div>
      <div className="pe-card"><h2>Prices and activity</h2><dl className="pe-kv"><dt>CPI</dt><dd>{(a.inflation.cpiNowBps / 100).toFixed(1)}</dd><dt>Change 30 days</dt><dd>{pct(a.inflation.cpiNowBps, a.inflation.cpi30dAgoBps)}</dd><dt>Change 90 days</dt><dd>{pct(a.inflation.cpiNowBps, a.inflation.cpi90dAgoBps)}</dd>
        <dt>Consumer spending (30d)</dt><dd>{ec(a.volumes30d.consumerSpendMinor)}</dd><dt>Commodity trades (30d)</dt><dd>{a.volumes30d.commodityTrades} · {ec(a.volumes30d.commodityValueMinor)}</dd><dt>Share trades (30d)</dt><dd>{a.volumes30d.shareTrades} · {ec(a.volumes30d.shareValueMinor)}</dd></dl></div>
      <div className="pe-card pe-card--wide"><h2>Profitability by industry (30-day average per company)</h2><div className="pe-table-wrap"><table className="pe-table"><thead><tr><th>Industry</th><th>Companies</th><th>Operating</th><th>Failed</th><th>Revenue/day</th><th>Profit/day</th><th>Cash held</th></tr></thead><tbody>
        {a.industries.map((i) => <tr key={i.industry}><td>{i.industry}</td><td>{i.companies}</td><td>{i.operating}</td><td>{i.failures}</td><td>{ec(i.revenue)}</td><td className={i.profit >= 0 ? 'pe-pos' : 'pe-neg'}>{ec(i.profit)}</td><td>{ec(i.cash)}</td></tr>)}
      </tbody></table></div></div>
      <div className="pe-card"><h2>NPCs, failures and credit</h2><dl className="pe-kv"><dt>NPC cash</dt><dd>{ec(a.npcFinances.cash)}</dd><dt>NPC firms operating</dt><dd>{a.npcFinances.operating}</dd><dt>NPC firms struggling</dt><dd>{a.npcFinances.losing}</dd><dt>Bankruptcies</dt><dd>{a.bankruptcies.total} ({a.bankruptcies.last30d} in 30 days)</dd>
        <dt>Active loans</dt><dd>{a.credit.active} · {ec(a.credit.outstanding)} owed</dd><dt>Defaults</dt><dd>{a.credit.defaults} · {ec(a.credit.writtenOff)} written off</dd></dl></div>
      <div className="pe-card"><h2>State treasuries</h2><dl className="pe-kv">{a.stateTreasuries.map((t) => <div key={t.id} style={{ display: 'contents' }}><dt>{t.name}</dt><dd>{ec(t.cash)}</dd></div>)}</dl>
        <h3>Simulated wallets <span className="pe-pill">SIMULATED</span></h3><p>Owed to players: £{(a.walletLiabilitiesPence / 100).toFixed(2)}</p>
        <p className="pe-hint">Scenario and stress results: run <code>npm run audit:scenarios</code> (reports in docs/audit/).</p></div>
    </div>
  );
}

interface UsersBody { users: { id: string; username: string; displayName: string; role: string; createdMs: number; lastLoginMs: number | null; disabled: number; walletMinor: number; companies: number; sessions: number }[]; invites: { role: string; note: string; createdMs: number; expiresMs: number; status: string }[] }
function Players() {
  const { data, err, load } = useAdmin<UsersBody>('/api/admin/users');
  const notify = useUi((s) => s.notify);
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [note, setNote] = useState(''); const [role, setRole] = useState('player');
  const act = async (path: string, body: Record<string, unknown>, show?: (b: Record<string, any>) => { label: string; value: string }) => {
    const r = await request<Record<string, any>>(path, { method: 'POST', body });
    if (r.status !== 200) { notify({ tone: 'error', title: 'Refused', message: errorText(r) }); return; }
    if (show) setSecret(show(r.body)); else notify({ tone: 'success', title: 'Done' });
    void load();
  };
  if (err) return <p className="pe-field-error" role="alert">{err}</p>;
  if (!data) return <p className="pe-hint">Loading…</p>;
  return (
    <div className="pe-cards">
      {secret && <div className="pe-callout" role="status"><p><strong>{secret.label}</strong> (shown once — send it privately): <code className="pe-secret">{secret.value}</code></p><Button variant="ghost" onClick={() => setSecret(null)}>Hide</Button></div>}
      <form className="pe-card pe-form-card" onSubmit={(e) => { e.preventDefault(); void act('/api/admin/invites', { role, note }, (b) => ({ label: 'Invite code', value: `${b.invite.code}  ·  ${window.location.origin}/?invite=${b.invite.code}` })); }}>
        <h2>Invite a player</h2>
        <Field label="Note (who it is for)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} /></Field>
        <Field label="Role"><select value={role} onChange={(e) => setRole(e.target.value)}><option value="player">Player</option><option value="admin">Administrator</option></select></Field>
        <Button type="submit" variant="primary">Create invite</Button>
      </form>
      <div className="pe-card pe-card--wide"><h2>Players ({data.users.length})</h2>
        <div className="pe-table-wrap"><table className="pe-table"><thead><tr><th>Player</th><th>Role</th><th>Wallet</th><th>Companies</th><th>Last login</th><th>Actions</th></tr></thead><tbody>
          {data.users.map((u) => (
            <tr key={u.id} className={u.disabled ? 'is-disabled' : ''}><td><strong>{u.displayName}</strong><br /><span className="pe-hint">@{u.username}{u.disabled ? ' · disabled' : ''}</span></td><td>{u.role}</td><td>{ec(u.walletMinor)}</td><td>{u.companies}</td><td>{when(u.lastLoginMs)}<br /><span className="pe-hint">{u.sessions} session(s)</span></td>
              <td className="pe-actions"><Button onClick={() => void act(`/api/admin/users/${u.id}/reset-code`, {}, (b) => ({ label: `Reset code for @${u.username}`, value: b.reset.code }))}>Reset code</Button><Button onClick={() => void act(`/api/admin/users/${u.id}/sign-out`, {})}>Sign out</Button><Button variant="destructive" onClick={() => void act(`/api/admin/users/${u.id}/disable`, { disabled: !u.disabled })}>{u.disabled ? 'Enable' : 'Disable'}</Button></td></tr>
          ))}
        </tbody></table></div>
      </div>
      <div className="pe-card"><h2>Invites</h2><ul className="pe-list">{data.invites.map((i, n) => <li key={n}>{i.role} · {i.note || 'no note'} · <strong>{i.status}</strong> <span className="pe-hint">expires {when(i.expiresMs)}</span></li>)}</ul></div>
    </div>
  );
}

function Economy() {
  const notify = useUi((s) => s.notify);
  const [ev, setEv] = useState({ type: 'recession', severity: '1', days: '7', reason: '' });
  const [rate, setRate] = useState({ rateBps: '', reason: '' });
  const post = async (path: string, body: Record<string, unknown>) => { const r = await request(path, { method: 'POST', body }); notify(r.status === 200 ? { tone: 'success', title: 'Applied', message: String((r.body as { message?: string }).message ?? '') } : { tone: 'error', title: 'Refused', message: errorText(r) }); };
  return (
    <div className="pe-cards">
      <p className="pe-hint">Controls act through the simulation's own rules and are written to the audit log with your name and reason. There is no direct balance editing.</p>
      <form className="pe-card pe-form-card" onSubmit={(e) => { e.preventDefault(); void post('/api/admin/event', { type: ev.type, severity: Number(ev.severity), days: Number(ev.days), reason: ev.reason }); }}>
        <h2>Trigger an economic event</h2>
        <Field label="Type"><select value={ev.type} onChange={(e) => setEv({ ...ev, type: e.target.value })}>{['recession', 'consumer_boom', 'inflation_shock', 'energy_shortage', 'agricultural_disruption', 'construction_boom', 'supply_chain_disruption', 'tourism_surge', 'advertising_boom', 'credit_crunch', 'corporate_scandal', 'government_stimulus'].map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Severity (1–3)"><input type="number" min={1} max={3} value={ev.severity} onChange={(e) => setEv({ ...ev, severity: e.target.value })} /></Field>
        <Field label="Days"><input type="number" min={1} max={30} value={ev.days} onChange={(e) => setEv({ ...ev, days: e.target.value })} /></Field>
        <Field label="Reason (required)"><input value={ev.reason} onChange={(e) => setEv({ ...ev, reason: e.target.value })} /></Field>
        <Button type="submit" variant="primary">Trigger</Button>
      </form>
      <form className="pe-card pe-form-card" onSubmit={(e) => { e.preventDefault(); void post('/api/admin/base-rate', { rateBps: Number(rate.rateBps), reason: rate.reason }); }}>
        <h2>Central bank base rate</h2>
        <Field label="Rate (basis points)" hint="Bounded by the server."><input type="number" value={rate.rateBps} onChange={(e) => setRate({ ...rate, rateBps: e.target.value })} /></Field>
        <Field label="Reason (required)"><input value={rate.reason} onChange={(e) => setRate({ ...rate, reason: e.target.value })} /></Field>
        <Button type="submit">Set rate</Button>
      </form>
    </div>
  );
}

function Log() {
  const { data, err } = useAdmin<{ log: { id: number; tick: number; actor: string; action: string; ok: boolean; detail: unknown }[] }>('/api/admin/health');
  if (err) return <p className="pe-field-error" role="alert">{err}</p>;
  if (!data) return <p className="pe-hint">Loading…</p>;
  return <div className="pe-table-wrap"><table className="pe-table"><thead><tr><th>Day</th><th>Actor</th><th>Action</th><th>Result</th></tr></thead><tbody>{data.log.map((l) => <tr key={l.id}><td>{l.tick}</td><td>{l.actor}</td><td>{l.action}</td><td className={l.ok ? 'pe-pos' : 'pe-neg'}>{l.ok ? 'ok' : 'denied'}</td></tr>)}</tbody></table></div>;
}
