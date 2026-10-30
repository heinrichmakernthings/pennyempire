import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Company, Recipe } from '@/contracts/game-state';
import { useCompany, useDataSource, useScreen } from '@/data/store';
import { fetchManagement, useQuery, type Management } from '@/data/managementApi';
import { newIdempotencyKey, useCommand } from '@/data/useCommand';
import { commodityLabel, companyStatusTone, industryLabel } from '@/domain/labels';
import { formatBps, formatMoney, formatUnits, parseDecimalToMinor } from '@/domain/money';
import { validateOperations, type OperationsDraft } from '@/domain/operations';
import { Button } from '@/ui/Button';
import { DataTable } from '@/ui/DataTable';
import { Field } from '@/ui/Field';
import { FinancialChart } from '@/ui/FinancialChart';
import { MoneyValue } from '@/ui/MoneyValue';
import { ScreenData } from '@/ui/ScreenData';
import { EmptyState, ErrorState, Skeleton } from '@/ui/States';
import { StatusLabel } from '@/ui/StatusLabel';
import { Sparkline } from '@/ui/Sparkline';
import { Tabs } from '@/ui/Tabs';
import { OperatingStatement } from './OperatingStatement';
import { ActivityBadges, Diagnosis, EquipmentPanel, Meter, ProductionPanel, Rankings, StaffPanel, SupplyChainPanel, Tip, UpgradesPanel } from './company/panels';

export function CompaniesScreen() {
  return (
    <ScreenData screen="companies" title="My Companies">
      {(data, loaded) => <CompaniesView companies={data.companies.items} recipes={data.recipes} illustrative={loaded.authority !== 'server'} />}
    </ScreenData>
  );
}

function CompaniesView({ companies, recipes, illustrative }: { companies: Company[]; recipes: Recipe[]; illustrative: boolean }) {
  const [params, setParams] = useSearchParams();
  const wanted = params.get('company');
  const selectedId = companies.find((c) => c.id === wanted)?.id ?? companies[0]?.id ?? null;
  const [tab, setTab] = useState('overview');
  if (companies.length === 0) return <EmptyState title="You don't own a company yet" action={<span className="pe-row"><Link className="pe-btn pe-btn--primary" to="/opportunities" data-testid="find-opportunity">Find an opportunity</Link><Link className="pe-btn pe-btn--secondary" to="/start">Start a company</Link></span>}>Pick an industry with real unmet demand, choose a plot, review the bill and open for business. Every cost goes through the ledger.</EmptyState>;
  return (
    <div className="pe-split">
      <nav aria-label="Your companies" className="pe-split-list">
        <Link className="pe-btn pe-btn--secondary pe-btn--block" to="/start" data-testid="new-company">+ Start another company</Link>
        <ul className="pe-company-list">
          {companies.map((c) => (
            <li key={c.id}>
              <button type="button" className="pe-company-btn" aria-pressed={c.id === selectedId} onClick={() => { setParams({ company: c.id }, { replace: true }); setTab('overview'); }}>
                <span><strong>{c.name}</strong><small>{industryLabel(c.industry)} · Lvl {c.level}</small></span>
                <MoneyValue value={c.dailyProfit} signed className="pe-small" />
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="pe-split-detail">{selectedId && <CompanyDetail key={selectedId} id={selectedId} tab={tab} onTab={setTab} recipes={recipes} illustrative={illustrative} />}</div>
    </div>
  );
}

function CompanyDetail({ id, tab, onTab, recipes, illustrative }: { id: string; tab: string; onTab: (t: string) => void; recipes: Recipe[]; illustrative: boolean }) {
  const { entry, retry } = useCompany(id);
  const source = useDataSource();
  const c = entry?.status === 'ready' ? entry.loaded.envelope.data : null;
  const mq = useQuery((sig) => fetchManagement(id, sig), [id, c?.revision, c?.cash.minor, c?.dailyProfit.minor], false);
  if (!entry || entry.status === 'loading') return <Skeleton lines={8} label="Loading company" />;
  if (entry.status === 'error' || !c) return <ErrorState title="Couldn't load company" message={entry.status === 'error' ? entry.error : undefined} onRetry={retry} />;
  const m: Management | null = source.authority === 'server' && mq.status === 'ready' ? mq.data.management : null;
  const recipe = recipes.find((r) => r.id === c.recipeId);
  const canAct = c.permissions.manage && !m?.closed;
  const tabs = [{ id: 'overview', label: 'Overview' }, ...(m ? [{ id: 'operations', label: 'Operations' }] : []), { id: 'controls', label: m ? 'Controls' : 'Operations' }, ...(m ? [{ id: 'upgrades', label: 'Upgrades' }] : []), { id: 'financials', label: 'Financials' }];
  const active = tabs.some((t) => t.id === tab) ? tab : 'overview';
  return (
    <section aria-labelledby="co-title" data-testid="company-detail">
      <header className="pe-detail-head">
        <div><h2 id="co-title">{c.name}</h2><p className="pe-hint">{industryLabel(c.industry)} · {m?.tierName ?? `Level ${c.level}`} · Owner: {c.owner.name}</p></div>
        <div className="pe-insp-tags"><StatusLabel tone={m?.closed ? 'negative' : c.status === 'operating' ? 'positive' : 'warning'}>{m?.closed ? 'Bankrupt' : companyStatusTone(c.status)}</StatusLabel>{illustrative && <StatusLabel>Illustrative data</StatusLabel>}</div>
      </header>
      {m && <ActivityBadges c={c} m={m} />}
      {c.status === 'insolvent' && !m?.closed && <ReopenPanel company={c} />}
      {m?.closed && <p className="pe-callout" role="status">This company was liquidated by the state administrator: stock sold at a discount, arrears paid first, {formatMoney({ currency: 'EC', minor: m.closed.writtenOffMinor })} written off, any cash left returned to you. History is kept; the plot is free again.</p>}
      <Tabs label="Company views" value={active} onChange={onTab} tabs={tabs}>
        {active === 'overview' && <CompanyOverview company={c} recipe={recipe} management={m} />}
        {active === 'operations' && m && <OperationsTab company={c} m={m} canAct={canAct} onChanged={mq.reload} />}
        {active === 'controls' && <><OperationsForm company={c} recipe={recipe} management={m} />{m && canAct && <CashPanel company={c} />}</>}
        {active === 'upgrades' && m && <UpgradesPanel c={c} m={m} canAct={canAct} />}
        {active === 'financials' && <CompanyFinancials company={c} asOf={entry.loaded.envelope.asOf} />}
      </Tabs>
    </section>
  );
}

function OperationsTab({ company: c, m, canAct, onChanged }: { company: Company; m: Management; canAct: boolean; onChanged: () => void }) {
  return (
    <div className="pe-stack">
      <h3 className="pe-h3">Production</h3><ProductionPanel c={c} m={m} />
      <h3 className="pe-h3">Ingredients and suppliers</h3><SupplyChainPanel c={c} m={m} canAct={canAct} onChanged={onChanged} />
      <h3 className="pe-h3">Staff</h3><StaffPanel m={m} />
      <h3 className="pe-h3">Equipment</h3><EquipmentPanel c={c} m={m} canAct={canAct} />
      <h3 className="pe-h3">Advertising <Tip>Spending on advertising builds awareness, which lifts your share of customers. Returns diminish: the first coins help most, and awareness fades 5% a day.</Tip></h3>
      <Meter label="Customer awareness" valueText={`${(m.advertising.awarenessBps / 100).toFixed(1)}% of ${(m.advertising.maxAwarenessBps / 100).toFixed(0)}% max`} pct={m.advertising.maxAwarenessBps ? (m.advertising.awarenessBps / m.advertising.maxAwarenessBps) * 100 : 0} />
      <p className="pe-hint">Current advertising spend: {formatMoney({ currency: 'EC', minor: m.advertising.spendPerDayMinor })} per day, paid to Bristol Media.</p>
    </div>
  );
}

function ReopenPanel({ company: c }: { company: Company }) {
  const { send, pending } = useCommand();
  const [key] = useState(newIdempotencyKey);
  return (
    <div className="pe-callout" role="alert"><div>
      <p><strong>This company is insolvent.</strong> It cannot pay its bills. Move cash in from your wallet (Controls tab) and reopen it, or it will be liquidated and closed. There is no bailout.</p>
      <Button variant="primary" pending={pending} onClick={() => void send({ type: 'company.reopen', companyId: c.id }, { idempotencyKey: key, expectedRevision: c.revision }, { success: 'Company reopened', failure: 'Could not reopen' })}>Settle arrears and reopen</Button>
    </div></div>
  );
}

function CashPanel({ company: c }: { company: Company }) {
  const { send, pending } = useCommand();
  const [amount, setAmount] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);
  const minor = parseDecimalToMinor(amount);
  const go = async (kind: 'company.fund' | 'company.withdraw') => {
    if (minor === null || minor <= 0) return;
    const r = await send({ type: kind, companyId: c.id, amountMinor: minor }, { idempotencyKey: key, expectedRevision: c.revision }, { success: kind === 'company.fund' ? 'Cash added to company' : 'Cash withdrawn', failure: 'Cash not moved' });
    if (r) { setKey(newIdempotencyKey()); if (r.ok) setAmount(''); }
  };
  return (
    <div className="pe-stack"><h3 className="pe-h3">Company cash <Tip>Moving coins between your wallet and the company is a transfer: nothing is created or destroyed. A company must keep a day of costs and cannot pay you while it owes arrears.</Tip></h3>
      <p className="pe-hint">Company cash: <MoneyValue value={c.cash} tone="neutral" />.</p>
      <div className="pe-row">
        <Field label="Amount (EC)"><input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setKey(newIdempotencyKey()); }} data-testid="cash-amount" /></Field>
        <Button variant="primary" pending={pending} disabled={minor === null || minor <= 0} onClick={() => void go('company.fund')}>Add from wallet</Button>
        <Button pending={pending} disabled={minor === null || minor <= 0} onClick={() => void go('company.withdraw')}>Take to wallet</Button>
      </div>
    </div>
  );
}

function CompanyOverview({ company: c, recipe, management: m }: { company: Company; recipe?: Recipe; management: Management | null }) {
  return (
    <div className="pe-stack">
      {m && <><h3 className="pe-h3">How is it going?</h3><Diagnosis m={m} /></>}
      <dl className="pe-stats pe-stats--wide">
        <div><dt>Revenue / day</dt><dd><MoneyValue value={c.dailyRevenue} tone="neutral" /></dd></div>
        <div><dt>Expenses / day</dt><dd><MoneyValue value={c.dailyExpenses} tone="neutral" /></dd></div>
        <div><dt>Profit / day</dt><dd><MoneyValue value={c.dailyProfit} signed /></dd></div>
        <div><dt>Customers today</dt><dd className="pe-financial-number">{formatUnits(c.customersToday)}</dd></div>
        <div><dt>Market share</dt><dd className="pe-financial-number">{formatBps(c.marketShareBps)}</dd></div>
        <div><dt>Reputation</dt><dd className="pe-financial-number">{formatBps(c.reputationBps)}</dd></div>
      </dl>
      {m?.rank && <><h3 className="pe-h3">Local ranking: {m.rank.label}s in Bristol</h3><Rankings industry={c.industry} companyId={c.id} deps={[c.id, c.revision, c.dailyRevenue.minor]} /></>}
      <div><h3 className="pe-h3">Profit, last 7 days (EC)</h3><Sparkline history={c.profitHistory} label={`${c.name} profit per day`} width={240} height={48} /></div>
      {!c.permissions.manage && <p className="pe-callout" role="note">You can view this company but not change it. It belongs to {c.owner.name}.</p>}
      <div>
        <h3 className="pe-h3">Inventory</h3>
        <DataTable caption={`${c.name} inventory`} rowKey={(l) => l.commodityId} rows={c.inventory} empty={<EmptyState title="No inventory">This company holds no stock.</EmptyState>}
          columns={[
            { key: 'c', header: 'Commodity', render: (l) => commodityLabel(l.commodityId) },
            { key: 'a', header: 'Available', align: 'end', render: (l) => formatUnits(l.availableUnits) },
            { key: 'r', header: 'Reserved', align: 'end', render: (l) => formatUnits(l.reservedUnits) },
            { key: 'cap', header: 'Capacity', align: 'end', render: (l) => formatUnits(l.capacityUnits) },
            { key: 'h', header: 'Hours left', align: 'end', render: (l) => (l.estimatedHoursRemaining === null ? '—' : <span className={l.estimatedHoursRemaining <= 6 ? 'pe-neg' : ''}>{l.estimatedHoursRemaining}{l.estimatedHoursRemaining <= 6 ? ' (low)' : ''}</span>) },
          ]} />
        {c.permissions.buySupplies && <p><Link className="pe-btn pe-btn--primary" to={`/commodities?company=${encodeURIComponent(c.id)}`}>Trade on the exchange</Link></p>}
      </div>
      {recipe && <p className="pe-hint">Recipe: {recipe.inputs.length ? recipe.inputs.map((i) => `${i.units} ${commodityLabel(i.commodityId)}`).join(' + ') : 'no inputs'} → {recipe.output.units} {commodityLabel(recipe.output.commodityId)} every {recipe.durationSeconds / 60} min (needs {recipe.energyUnits} energy).</p>}
    </div>
  );
}

function OperationsForm({ company: c, recipe, management: m }: { company: Company; recipe?: Recipe; management: Management | null }) {
  const initial: OperationsDraft = useMemo(() => ({ price: (c.price.minor / 100).toFixed(2), employees: String(c.employees), quality: c.quality, planned: String(c.plannedUnitsPerTick), marketing: (c.marketingPerTick.minor / 100).toFixed(2) }), [c]);
  const [draft, setDraft] = useState(initial);
  const [key, setKey] = useState(newIdempotencyKey);
  const { send, pending } = useCommand();
  const { refresh } = useScreen('companies');
  const result = validateOperations(draft, c);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const readOnly = !c.permissions.manage;
  useEffect(() => { setKey(newIdempotencyKey()); }, [draft]); // a changed intent gets a new idempotency key
  const set = <K extends keyof OperationsDraft>(k: K, v: OperationsDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async () => {
    if (!result.ok) return;
    const res = await send({ type: 'company.configure', companyId: c.id, ...result.value }, { idempotencyKey: key, expectedRevision: c.revision }, { success: 'Settings saved', failure: 'Settings not saved' });
    if (res?.ok) refresh();
  };
  return (
    <form className="pe-stack" onSubmit={(e) => { e.preventDefault(); void save(); }} aria-label="Operations">
      {readOnly && <p className="pe-callout" role="note">Read-only: you don't have permission to manage this company.</p>}
      <p className="pe-hint">Draft changes stay on this device until saved. {dirty ? <strong>You have unsaved changes.</strong> : 'No unsaved changes.'}</p>
      <fieldset className="pe-fields" disabled={readOnly || pending}>
        <legend className="pe-sr">Operating settings</legend>
        <Field label={`Price per unit (EC) — allowed ${formatMoney(c.minPrice)} to ${formatMoney(c.maxPrice)}`} error={result.errors.price}><input inputMode="decimal" value={draft.price} onChange={(e) => set('price', e.target.value)} /></Field>
        <Field label={`Staff (0–${c.maxEmployees})`} error={result.errors.employees} hint={m ? `Hiring or dismissing costs one day’s wage each (${formatMoney({ currency: 'EC', minor: m.staff.changeFeeMinor })}); today you can hire ${m.staff.changesLeftToday.hire} and dismiss ${m.staff.changesLeftToday.dismiss} more. About ${m.staff.needed} staff run your current target.` : undefined}><input type="number" inputMode="numeric" min={0} max={c.maxEmployees} step={1} value={draft.employees} onChange={(e) => set('employees', e.target.value)} /></Field>
        <Field label="Input quality" error={result.errors.quality} hint={draft.quality === 'premium' ? 'Premium uses 25% more ingredients per unit — raise your price to match, or most of each sale goes on ingredients.' : undefined}><select value={draft.quality} onChange={(e) => set('quality', e.target.value as Company['quality'])}><option value="basic">Basic</option><option value="standard">Standard</option><option value="premium">Premium</option></select></Field>
        <Field label={`Planned units per tick (max ${c.capacityPerTick})`} error={result.errors.planned} hint={recipe ? `Each unit uses ${recipe.inputs.map((i) => `${i.units} ${commodityLabel(i.commodityId)}`).join(' + ') || 'no inputs'} per batch.` : undefined}><input type="number" inputMode="numeric" min={0} max={c.capacityPerTick} step={1} value={draft.planned} onChange={(e) => set('planned', e.target.value)} /></Field>
        <Field label="Marketing per tick (EC)" error={result.errors.marketing}><input inputMode="decimal" value={draft.marketing} onChange={(e) => set('marketing', e.target.value)} /></Field>
      </fieldset>
      {m && (<>
        <label className="pe-row"><input type="checkbox" checked={m.autoProcure} disabled={readOnly || pending} data-testid="auto-procure" onChange={async (e) => { await send({ type: 'company.configure', companyId: c.id, autoProcure: e.target.checked }, { idempotencyKey: newIdempotencyKey(), expectedRevision: c.revision }, { success: e.target.checked ? 'Auto-purchasing on' : 'Auto-purchasing off', failure: 'Setting not saved' }); }} /> Buy ingredients automatically each day <Tip>When on, the company buys what tomorrow's production target needs. When off, it only uses stock you buy yourself.</Tip></label>
        <label className="pe-row"><input type="checkbox" checked={m.ownerCover} disabled={readOnly || pending} data-testid="owner-cover" onChange={async (e) => { await send({ type: 'company.configure', companyId: c.id, ownerCover: e.target.checked }, { idempotencyKey: newIdempotencyKey(), expectedRevision: c.revision }, { success: e.target.checked ? 'Wallet cover on' : 'Wallet cover off', failure: 'Setting not saved' }); }} /> Cover shortfalls from my wallet <Tip>When the company cannot pay a day's wages and bills, your wallet pays the gap instead of the company falling into arrears and insolvency. You get a warning when it happens.</Tip></label>
      </>)}
      <div className="pe-row">
        <Button type="submit" variant="primary" pending={pending} disabled={readOnly || !dirty || !result.ok}>Save changes</Button>
        <Button onClick={() => setDraft(initial)} disabled={!dirty || pending}>Cancel</Button>
      </div>
    </form>
  );
}

function CompanyFinancials({ company: c, asOf }: { company: Company; asOf: string }) {
  return (
    <div className="pe-stack">
      <FinancialChart title={`${c.name} — revenue, expenses and profit`} periodLabel="Last 7 days, daily" series={[
        { key: 'rev', label: 'Revenue', history: c.revenueHistory, style: 'revenue' }, { key: 'exp', label: 'Expenses', history: c.expenseHistory, style: 'expense' }, { key: 'pro', label: 'Profit', history: c.profitHistory, style: 'profit' },
      ]} />
      <dl className="pe-stats pe-stats--wide">
        <div><dt>Valuation</dt><dd><MoneyValue value={c.valuation} tone="neutral" /></dd></div>
        <div><dt>Cash</dt><dd><MoneyValue value={c.cash} tone="neutral" /></dd></div>
      </dl>
      <OperatingStatement companyId={c.id} asOf={asOf} />
      <h3 className="pe-h3">Ownership</h3>
      <DataTable caption="Ownership" rowKey={(o) => o.owner.id} rows={c.ownership} columns={[{ key: 'o', header: 'Owner', render: (o) => o.owner.name }, { key: 's', header: 'Shares', align: 'end', render: (o) => formatUnits(o.shares) }, { key: 'b', header: 'Stake', align: 'end', render: (o) => formatBps(o.ownershipBps) }]} />
    </div>
  );
}

