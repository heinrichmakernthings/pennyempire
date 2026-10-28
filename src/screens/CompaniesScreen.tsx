import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Company, Recipe } from '@/contracts/game-state';
import { useCompany, useScreen } from '@/data/store';
import { newIdempotencyKey, useCommand } from '@/data/useCommand';
import { commodityLabel, companyStatusTone, industryLabel } from '@/domain/labels';
import { formatBps, formatMoney, formatUnits } from '@/domain/money';
import { validateOperations, type OperationsDraft } from '@/domain/operations';
import { Button } from '@/ui/Button';
import { DataTable } from '@/ui/DataTable';
import { Field } from '@/ui/Field';
import { FinancialChart } from '@/ui/FinancialChart';
import { MoneyValue } from '@/ui/MoneyValue';
import { ResponsiveSheet } from '@/ui/ResponsiveSheet';
import { ScreenData } from '@/ui/ScreenData';
import { EmptyState, ErrorState, Skeleton } from '@/ui/States';
import { StatusLabel } from '@/ui/StatusLabel';
import { Sparkline } from '@/ui/Sparkline';
import { Tabs } from '@/ui/Tabs';

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
  if (companies.length === 0) return <EmptyState title="You don't own a company yet" action={<Link className="pe-btn pe-btn--primary" to="/city">Find a plot in the city</Link>}>Company creation arrives with the economic engine. Browse the city to see where demand is unmet.</EmptyState>;
  return (
    <div className="pe-split">
      <nav aria-label="Your companies" className="pe-split-list">
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
  if (!entry || entry.status === 'loading') return <Skeleton lines={8} label="Loading company" />;
  if (entry.status === 'error') return <ErrorState title="Couldn't load company" message={entry.error} onRetry={retry} />;
  const c = entry.loaded.envelope.data;
  const recipe = recipes.find((r) => r.id === c.recipeId);
  return (
    <section aria-labelledby="co-title">
      <header className="pe-detail-head">
        <div><h2 id="co-title">{c.name}</h2><p className="pe-hint">{industryLabel(c.industry)} · Level {c.level} · Owner: {c.owner.name}</p></div>
        <div className="pe-insp-tags"><StatusLabel tone={c.status === 'operating' ? 'positive' : 'warning'}>{companyStatusTone(c.status)}</StatusLabel>{illustrative && <StatusLabel>Illustrative data</StatusLabel>}</div>
      </header>
      <Tabs label="Company views" value={tab} onChange={onTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'operations', label: 'Operations' }, { id: 'financials', label: 'Financials' }]}>
        {tab === 'overview' && <CompanyOverview company={c} recipe={recipe} />}
        {tab === 'operations' && <OperationsForm company={c} recipe={recipe} />}
        {tab === 'financials' && <CompanyFinancials company={c} />}
      </Tabs>
    </section>
  );
}

function CompanyOverview({ company: c, recipe }: { company: Company; recipe?: Recipe }) {
  return (
    <div className="pe-stack">
      <dl className="pe-stats pe-stats--wide">
        <div><dt>Revenue / day</dt><dd><MoneyValue value={c.dailyRevenue} tone="neutral" /></dd></div>
        <div><dt>Expenses / day</dt><dd><MoneyValue value={c.dailyExpenses} tone="neutral" /></dd></div>
        <div><dt>Profit / day</dt><dd><MoneyValue value={c.dailyProfit} signed /></dd></div>
        <div><dt>Customers today</dt><dd className="pe-financial-number">{formatUnits(c.customersToday)}</dd></div>
        <div><dt>Market share</dt><dd className="pe-financial-number">{formatBps(c.marketShareBps)}</dd></div>
        <div><dt>Reputation</dt><dd className="pe-financial-number">{formatBps(c.reputationBps)}</dd></div>
      </dl>
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
        {c.permissions.buySupplies && <p><Link className="pe-btn pe-btn--primary" to={`/commodities?company=${encodeURIComponent(c.id)}`}>Buy supplies</Link></p>}
      </div>
      {recipe && <p className="pe-hint">Recipe: {recipe.inputs.length ? recipe.inputs.map((i) => `${i.units} ${commodityLabel(i.commodityId)}`).join(' + ') : 'no inputs'} → {recipe.output.units} {commodityLabel(recipe.output.commodityId)} every {recipe.durationSeconds / 60} min (needs {recipe.energyUnits} energy).</p>}
    </div>
  );
}

function OperationsForm({ company: c, recipe }: { company: Company; recipe?: Recipe }) {
  const initial: OperationsDraft = useMemo(() => ({ price: (c.price.minor / 100).toFixed(2), employees: String(c.employees), quality: c.quality, planned: String(c.plannedUnitsPerTick), marketing: (c.marketingPerTick.minor / 100).toFixed(2) }), [c]);
  const [draft, setDraft] = useState(initial);
  const [key, setKey] = useState(newIdempotencyKey);
  const [upgradeId, setUpgradeId] = useState<string | null>(null);
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
  const upgrade = c.upgrades.find((u) => u.id === upgradeId);
  return (
    <form className="pe-stack" onSubmit={(e) => { e.preventDefault(); void save(); }} aria-label="Operations">
      {readOnly && <p className="pe-callout" role="note">Read-only: you don't have permission to manage this company.</p>}
      <p className="pe-hint">Draft changes stay on this device until saved. {dirty ? <strong>You have unsaved changes.</strong> : 'No unsaved changes.'}</p>
      <fieldset className="pe-fields" disabled={readOnly || pending}>
        <legend className="pe-sr">Operating settings</legend>
        <Field label={`Price per unit (EC) — allowed ${formatMoney(c.minPrice)} to ${formatMoney(c.maxPrice)}`} error={result.errors.price}><input inputMode="decimal" value={draft.price} onChange={(e) => set('price', e.target.value)} /></Field>
        <Field label={`Staff (0–${c.maxEmployees})`} error={result.errors.employees}><input type="number" inputMode="numeric" min={0} max={c.maxEmployees} step={1} value={draft.employees} onChange={(e) => set('employees', e.target.value)} /></Field>
        <Field label="Input quality" error={result.errors.quality}><select value={draft.quality} onChange={(e) => set('quality', e.target.value as Company['quality'])}><option value="basic">Basic</option><option value="standard">Standard</option><option value="premium">Premium</option></select></Field>
        <Field label={`Planned units per tick (max ${c.capacityPerTick})`} error={result.errors.planned} hint={recipe ? `Each unit uses ${recipe.inputs.map((i) => `${i.units} ${commodityLabel(i.commodityId)}`).join(' + ') || 'no inputs'} per batch.` : undefined}><input type="number" inputMode="numeric" min={0} max={c.capacityPerTick} step={1} value={draft.planned} onChange={(e) => set('planned', e.target.value)} /></Field>
        <Field label="Marketing per tick (EC)" error={result.errors.marketing}><input inputMode="decimal" value={draft.marketing} onChange={(e) => set('marketing', e.target.value)} /></Field>
      </fieldset>
      <div className="pe-row">
        <Button type="submit" variant="primary" pending={pending} disabled={readOnly || !dirty || !result.ok}>Save changes</Button>
        <Button onClick={() => setDraft(initial)} disabled={!dirty || pending}>Cancel</Button>
      </div>
      <h3 className="pe-h3">Upgrades</h3>
      {c.upgrades.length === 0 ? <p className="pe-hint">No upgrades available.</p> : (
        <ul className="pe-list">{c.upgrades.map((u) => (
          <li key={u.id} className="pe-list-row"><div><strong>{u.name}</strong><p className="pe-hint">Cost <MoneyValue value={u.cost} tone="neutral" /> · Requires: {u.requirements.join(', ')}</p></div>
            <Button disabled={!u.available || !c.permissions.upgrade} onClick={() => setUpgradeId(u.id)}>{u.available && c.permissions.upgrade ? 'Review upgrade' : 'Unavailable'}</Button></li>
        ))}</ul>
      )}
      <ResponsiveSheet open={!!upgrade} onClose={() => setUpgradeId(null)} title="Confirm upgrade">
        {upgrade && (
          <div className="pe-stack">
            <p>{upgrade.name}</p>
            <p>Cost: <MoneyValue value={upgrade.cost} tone="neutral" /> from this company's cash (<MoneyValue value={c.cash} tone="neutral" />).</p>
            <p className="pe-hint">Requirements: {upgrade.requirements.join(', ')}.</p>
            <div className="pe-row"><Button variant="primary" pending={pending} data-autofocus onClick={async () => { await send({ type: 'company.upgrade', companyId: c.id, upgradeId: upgrade.id }, { idempotencyKey: key, expectedRevision: c.revision }, { success: 'Upgrade purchased', failure: 'Upgrade not purchased' }); setUpgradeId(null); }}>Confirm purchase</Button><Button onClick={() => setUpgradeId(null)}>Cancel</Button></div>
          </div>
        )}
      </ResponsiveSheet>
    </form>
  );
}

function CompanyFinancials({ company: c }: { company: Company }) {
  return (
    <div className="pe-stack">
      <FinancialChart title={`${c.name} — revenue, expenses and profit`} periodLabel="Last 7 days, daily" series={[
        { key: 'rev', label: 'Revenue', history: c.revenueHistory, style: 'revenue' }, { key: 'exp', label: 'Expenses', history: c.expenseHistory, style: 'expense' }, { key: 'pro', label: 'Profit', history: c.profitHistory, style: 'profit' },
      ]} />
      <dl className="pe-stats pe-stats--wide">
        <div><dt>Valuation</dt><dd><MoneyValue value={c.valuation} tone="neutral" /></dd></div>
        <div><dt>Cash</dt><dd><MoneyValue value={c.cash} tone="neutral" /></dd></div>
      </dl>
      <h3 className="pe-h3">Ownership</h3>
      <DataTable caption="Ownership" rowKey={(o) => o.owner.id} rows={c.ownership} columns={[{ key: 'o', header: 'Owner', render: (o) => o.owner.name }, { key: 's', header: 'Shares', align: 'end', render: (o) => formatUnits(o.shares) }, { key: 'b', header: 'Stake', align: 'end', render: (o) => formatBps(o.ownershipBps) }]} />
    </div>
  );
}

