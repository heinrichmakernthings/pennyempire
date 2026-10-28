import type { Sql } from '../db/sql';
import { loadConfig } from './config';
import { runCommand, type CommandErr, type CommandResponse } from './commands';
import { available, destroy, transfer, createAccount, type TickCtx } from './ledger';
import { logEvent } from './stats';
import { ownerInvestor, registerCapital } from './capital';
import { procureInputs, refPriceOf, type CompanyRow } from './operations';
import type { StartupLine, StartupQuote } from '../../src/shared/management';
import { PLAYER_ID, companyAccount } from '../seed/bristol';

const err = (code: CommandErr['error']['code'], message: string, fieldErrors?: Record<string, string>): CommandErr => ({ ok: false, error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } });
const stateAccount = (db: Sql, industry: string) => db.get<{ a: string }>("SELECT treasury_account_id a FROM companies WHERE owner_kind = 'state' AND industry_id = ? LIMIT 1", industry)?.a;

export interface Spec { industry_id: string; label: string; tagline: string; plot_width: number; plot_depth: number; primary_recipe_id: string; retail_commodity_id: string | null; licence_fee_minor: number; equipment_minor: number; equipment_label: string; wage_minor: number; default_price_minor: number; min_price_minor: number; max_price_minor: number; default_staff: number; default_batches: number; working_capital_minor: number; base_rent_minor: number; sells: 'consumers' | 'state' | 'businesses' }
export interface Tier { industry_id: string; tier: number; name: string; fitout_minor: number; rent_bps: number; capacity_batches: number; max_employees: number; storage_cap_units: number; asset_id: string }
export const specOf = (db: Sql, industry: string) => db.get<Spec>('SELECT * FROM industry_specs WHERE industry_id = ? AND startable = 1', industry);
export const tierOf = (db: Sql, industry: string, tier: number) => db.get<Tier>('SELECT * FROM industry_tiers WHERE industry_id = ? AND tier = ?', industry, tier);
/** Daily rent: industry base × district index × premises-tier multiplier. */
export const rentFor = (db: Sql, spec: Spec, tier: Tier, district: string | null) => {
  const idx = (district && db.get<{ i: number }>('SELECT property_index_bps i FROM districts WHERE id = ?', district)?.i) || 10_000;
  return Math.floor((Math.floor((spec.base_rent_minor * idx) / 10_000) * tier.rent_bps) / 10_000);
};

export interface StartupInput { industry: string; plotId: string; tier: number; workingCapitalMinor?: number; name?: string }
/** Staff needed to run the default production plan at full equipment condition: hiring beyond this buys no output. */
export const defaultStaff = (spec: Spec, tier: Tier) => Math.max(1, Math.min(tier.max_employees, Math.ceil((Math.min(spec.default_batches, tier.capacity_batches) * tier.max_employees) / tier.capacity_batches)));
/** Plots a player can build on: the numbered lots, plus the two starter-shop plots once vacated (or built on by a player company). */
export const LOT_SQL = "(p.id LIKE 'lot-%' OR (p.id IN ('plot-pizza','plot-cafe') AND (p.company_id IS NULL OR p.company_id LIKE 'co-pl-%')))";
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 '&.,-]{2,31}$/;

/** Itemised startup cost and every reason it could be refused. Pure read; `createCompany` re-runs it inside the transaction, so the client never sets a price. */
export interface Founder { kind: 'player' | 'npc'; ownerId: string; fundingAccount: string; idPrefix: string; limited: boolean }
export const playerFounder = (db: Sql): Founder => ({ kind: 'player', ownerId: PLAYER_ID, fundingAccount: db.get<{ w: string }>('SELECT wallet_account_id w FROM players WHERE id = ?', PLAYER_ID)!.w, idPrefix: 'co-pl', limited: true });
export function startupQuote(db: Sql, input: StartupInput, founder: Founder = playerFounder(db)): StartupQuote {
  const cfg = loadConfig(db);
  const issues: { field: string; message: string }[] = [];
  const spec = specOf(db, input.industry);
  const tier = spec && [1, 2].includes(input.tier) ? tierOf(db, input.industry, input.tier) : undefined;
  const plot = db.get<{ id: string; width: number; depth: number; district_id: string | null; company_id: string | null; asset_id: string | null }>(`SELECT p.id, p.width, p.depth, p.district_id, p.company_id, p.asset_id FROM plots p WHERE p.id = ? AND ${LOT_SQL}`, input.plotId);
  if (!spec) issues.push({ field: 'industry', message: 'Unknown or unavailable industry.' });
  if (spec && !tier) issues.push({ field: 'tier', message: 'Choose standard or refurbished premises.' });
  if (!plot) issues.push({ field: 'plotId', message: 'That location does not exist.' });
  else if (plot.company_id || plot.asset_id) issues.push({ field: 'plotId', message: 'That location is already taken.' });
  else if (spec && (plot.width !== spec.plot_width || plot.depth !== spec.plot_depth)) issues.push({ field: 'plotId', message: `${spec.label} needs a ${spec.plot_width}×${spec.plot_depth} plot; this one is ${plot.width}×${plot.depth}.` });
  const owned = founder.limited ? db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE owner_kind = ? AND owner_id = ? AND bankrupt_tick IS NULL", founder.kind, founder.ownerId)!.n : 0;
  if (founder.limited && owned >= cfg.maxCompaniesPerPlayer) issues.push({ field: 'industry', message: `You already own ${owned} companies (the limit is ${cfg.maxCompaniesPerPlayer}).` });
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!NAME_RE.test(name)) issues.push({ field: 'name', message: 'Use 3–32 letters, numbers or . , & \' - and start with a letter or number.' });
    else if (db.get('SELECT 1 FROM companies WHERE lower(name) = lower(?)', name)) issues.push({ field: 'name', message: 'A company with that name already exists in Bristol.' });
  }
  const walletAvail = available(db, founder.fundingAccount);
  const staff = spec && tier ? defaultStaff(spec, tier) : 0;
  const rent = spec && tier ? rentFor(db, spec, tier, plot?.district_id ?? null) : 0;
  const dailyFixed = spec ? staff * spec.wage_minor + rent : 0;
  const wcMin = Math.max(dailyFixed * 3, spec ? Math.floor(spec.working_capital_minor / 3) : 0), wcDefault = spec?.working_capital_minor ?? 0;
  const wc = input.workingCapitalMinor ?? wcDefault;
  if (spec && (!Number.isSafeInteger(wc) || wc < wcMin)) issues.push({ field: 'workingCapital', message: `Keep at least ${wcMin / 100} EC as working capital (three days of wages and rent).` });
  const lines: StartupLine[] = spec && tier ? [
    { kind: 'licence', label: 'Incorporation licence', amountMinor: spec.licence_fee_minor, paidTo: 'Destroyed (state licence fee)', note: 'A licence fee is a coin sink: it leaves the economy.' },
    { kind: 'premises', label: `${tier.name} fit-out`, amountMinor: tier.fitout_minor, paidTo: 'Bristol Estates', note: 'Refurbishing the premises. Paid to the state property company, so it stays in circulation.' },
    { kind: 'equipment', label: spec.equipment_label, amountMinor: spec.equipment_minor, paidTo: 'Bristol Works', note: 'Your initial equipment. It wears with use and can be serviced.' },
    { kind: 'working_capital', label: 'Working capital', amountMinor: Number.isSafeInteger(wc) && wc > 0 ? wc : 0, paidTo: 'Your new company’s cash', note: 'Stays yours: it pays wages, rent and supplies until sales arrive.' },
  ] : [];
  const total = lines.reduce((a, l) => a + l.amountMinor, 0);
  if (spec && tier && total > walletAvail) issues.push({ field: 'total', message: `You need ${(total - walletAvail) / 100} EC more (the total is ${total / 100} EC).` });
  return {
    ok: issues.length === 0, industry: input.industry, plotId: input.plotId, tier: input.tier, lines, totalMinor: total, walletAvailableMinor: walletAvail, shortfallMinor: Math.max(0, total - walletAvail),
    workingCapitalMinMinor: wcMin, workingCapitalDefaultMinor: wcDefault, issues,
    running: { rentPerDayMinor: rent, wagesPerDayMinor: staff * (spec?.wage_minor ?? 0), staff, maxStaff: tier?.max_employees ?? 0, capacityBatches: tier?.capacity_batches ?? 0, storageUnits: tier?.storage_cap_units ?? 0, assetId: tier?.asset_id ?? '' },
  };
}

export interface CreateInput extends StartupInput { name: string; expectedTotalMinor: number }
/**
 * Atomic incorporation, shared by players and NPC entrepreneurs (same prices, same ledger path, same lot rules). One transaction: re-quote → check funds, lot, name, limits →
 * licence (destroyed), fit-out and equipment (transfers to state companies), working capital (into the new treasury) → company, ownership, production line, lot assignment.
 * Any failure throws/returns without side effects (the caller's transaction rolls back).
 */
export function foundCompany(db: Sql, ctx: TickCtx, key: string, input: StartupInput & { name: string }, founder: Founder, expectedTotalMinor?: number): { ok: true; companyId: string; totalMinor: number } | { ok: false; error: CommandErr['error'] } {
  const q = startupQuote(db, input, founder);
  if (!q.ok) { const first = q.issues[0]!; return { ok: false, error: { code: first.field === 'total' ? 'INSUFFICIENT_FUNDS' : 'VALIDATION', message: first.message, fieldErrors: Object.fromEntries(q.issues.map((i) => [i.field, i.message])) } }; }
  if (expectedTotalMinor !== undefined && q.totalMinor !== expectedTotalMinor) return { ok: false, error: { code: 'QUOTE_EXPIRED', message: `Prices changed: the total is now ${q.totalMinor / 100} EC. Review the quote and confirm again.` } };
  const spec = specOf(db, input.industry)!, tier = tierOf(db, input.industry, input.tier)!;
  const plot = db.get<{ district_id: string | null }>('SELECT district_id FROM plots WHERE id = ?', input.plotId)!;
  const name = input.name.trim();
  const seq = (db.get<{ n: number }>('SELECT COUNT(*) n FROM companies WHERE id LIKE ?', `${founder.idPrefix}-%`)!.n) + 1;
  const id = `${founder.idPrefix}-${input.industry}-${seq}`, acct = companyAccount(id);
  // 1. claim the lot first: a concurrent claim changes 0 rows and the whole transaction fails
  const claimed = db.run('UPDATE plots SET company_id = ?, asset_id = ? WHERE id = ? AND company_id IS NULL AND asset_id IS NULL', id, tier.asset_id, input.plotId).changes;
  if (claimed !== 1) return { ok: false, error: { code: 'VALIDATION', message: 'That location was just taken.' } };
  createAccount(db, acct, 'company', `${name} treasury`);
  const rent = rentFor(db, spec, tier, plot.district_id), staff = defaultStaff(spec, tier);
  const batches = Math.min(spec.default_batches, tier.capacity_batches);
  db.run(`INSERT INTO companies (id, name, city_id, district_id, plot_id, industry_id, asset_id, owner_kind, owner_id, treasury_account_id, level, status, retail_commodity_id, price_minor, min_price_minor, max_price_minor, quality, employees, max_employees, wage_minor, capacity_batches, storage_cap_units, property_minor, marketing_minor, reputation_bps, created_tick, premises_tier, equipment_cost_minor)
    VALUES (?,?,?,?,?,?,?, ?, ?, ?, ?, 'operating', ?,?,?,?, 'standard', ?,?,?,?,?,?, 0, 5000, ?, ?, ?)`,
    id, name, 'city-bristol', plot.district_id, input.plotId, input.industry, tier.asset_id, founder.kind, founder.ownerId, acct, input.tier, spec.retail_commodity_id, spec.default_price_minor, spec.min_price_minor, spec.max_price_minor,
    staff, tier.max_employees, spec.wage_minor, tier.capacity_batches, tier.storage_cap_units, rent, ctx.tick, input.tier, spec.equipment_minor);
  registerCapital(db, ctx, id, ownerInvestor(db, founder.ownerId, founder.kind, undefined, founder.fundingAccount), q.totalMinor, `founded by ${founder.ownerId}; startup cost ${q.totalMinor} minor`);
  db.run('INSERT INTO production_lines (company_id, recipe_id, planned_batches, ask_price_minor) VALUES (?,?,?,?)', id, spec.primary_recipe_id, batches, spec.default_price_minor);
  // 2. money, all through the ledger
  const estates = stateAccount(db, 'property')!, works = stateAccount(db, 'works')!;
  const [lic, fit, eq, wc] = q.lines.map((l) => l.amountMinor) as [number, number, number, number];
  if (lic > 0) destroy(db, ctx, `${key}:licence`, founder.fundingAccount, lic, `incorporation licence: ${name}`, 'sink');
  if (fit > 0) transfer(db, ctx, `${key}:premises`, founder.fundingAccount, estates, fit, 'state_payment', `premises fit-out: ${name}`);
  if (eq > 0) transfer(db, ctx, `${key}:equipment`, founder.fundingAccount, works, eq, 'state_payment', `equipment: ${name}`);
  if (wc > 0) transfer(db, ctx, `${key}:capital`, founder.fundingAccount, acct, wc, 'capital_injection', `working capital: ${name}`);
  logEvent(db, ctx.tick, founder.kind === 'player' ? 'company_created' : 'company_opened', 'info', id, founder.kind === 'player' ? `You founded ${name} (${spec.label}) for ${q.totalMinor / 100} EC` : `${name} opened in Bristol as a new ${spec.label.toLowerCase()}`, { industry: input.industry, plot: input.plotId, tier: input.tier, owner: founder.kind, startupMinor: q.totalMinor });
  return { ok: true, companyId: id, totalMinor: q.totalMinor };
}

export function createCompany(db: Sql, key: string, input: CreateInput): CommandResponse<{ companyId: string }> {
  return runCommand(db, key, 'company.create', (ctx) => {
    const r = foundCompany(db, ctx, `cmd:${key}`, input, playerFounder(db), input.expectedTotalMinor);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, revision: 1, transactionId: r.companyId, refreshScreens: ['city', 'companies', 'commodities'], data: { companyId: r.companyId } };
  }) as CommandResponse<{ companyId: string }>;
}

const own = (db: Sql, companyId: string): CompanyRow | CommandErr => {
  const c = db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', companyId);
  if (!c) return err('VALIDATION', `Unknown company ${companyId}`);
  if (c.owner_kind !== 'player' || c.owner_id !== PLAYER_ID) return err('FORBIDDEN', 'You do not own this company.');
  return c;
};
const bad = (x: unknown): x is CommandErr => typeof x === 'object' && x !== null && (x as CommandErr).ok === false;
const active = (c: CompanyRow): CommandErr | null => c.bankrupt_tick !== null ? err('FORBIDDEN', 'This company is bankrupt and closed.') : c.status === 'insolvent' ? err('FORBIDDEN', 'An insolvent company cannot be changed; reopen it first.') : null;

/** Recomputes a company's operating parameters from its premises tier plus every upgrade it owns, so effects always trace to a purchase. */
export function recomputeOperating(db: Sql, companyId: string) {
  const c = db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', companyId)!;
  const spec = specOf(db, c.industry_id), tier = tierOf(db, c.industry_id, c.premises_tier);
  if (!spec || !tier) return;
  const ups = db.all<{ d_capacity_batches: number; d_storage: number; d_productivity_bps: number; d_energy_saving_bps: number }>('SELECT u.* FROM company_upgrades cu JOIN upgrade_catalog u ON u.id = cu.upgrade_id WHERE cu.company_id = ?', companyId);
  const sum = (k: 'd_capacity_batches' | 'd_storage' | 'd_productivity_bps' | 'd_energy_saving_bps') => ups.reduce((a, u) => a + u[k], 0);
  const district = db.get<{ district_id: string | null }>('SELECT district_id FROM companies WHERE id = ?', companyId)!.district_id;
  db.run('UPDATE companies SET capacity_batches = ?, max_employees = ?, storage_cap_units = ?, productivity_bps = ?, energy_saving_bps = ?, property_minor = ?, asset_id = ? WHERE id = ?',
    tier.capacity_batches + sum('d_capacity_batches'), tier.max_employees, tier.storage_cap_units + sum('d_storage'), Math.min(10_000, sum('d_productivity_bps')), Math.min(8_000, sum('d_energy_saving_bps')), rentFor(db, spec, tier, district), tier.asset_id, companyId);
  if (c.plot_id) db.run('UPDATE plots SET asset_id = ? WHERE id = ? AND company_id = ?', tier.asset_id, c.plot_id, companyId);
}

export interface UpgradeRow { id: string; industry_id: string; name: string; description: string; kind: string; cost_minor: number; requires_tier: number; d_capacity_batches: number; d_storage: number; d_productivity_bps: number; d_energy_saving_bps: number; to_tier: number | null; sort: number }
/** Why an upgrade can or cannot be bought right now (null = available). Used by the UI and re-checked at purchase. */
export function upgradeBlocker(db: Sql, c: CompanyRow, u: UpgradeRow, owned: Set<string>): string | null {
  if (owned.has(u.id)) return 'Already installed.';
  if (u.kind === 'tier' ? c.premises_tier + 1 !== u.to_tier : c.premises_tier < u.requires_tier) return u.kind === 'tier' ? (c.premises_tier >= (u.to_tier ?? 0) ? 'Already installed.' : `Needs the ${db.get<{ name: string }>('SELECT name FROM industry_tiers WHERE industry_id = ? AND tier = ?', c.industry_id, (u.to_tier ?? 2) - 1)?.name ?? 'previous premises'} first.`) : `Needs premises tier ${u.requires_tier}.`;
  if (c.bankrupt_tick !== null || c.status === 'insolvent') return 'Company is not trading.';
  return null;
}

/** Buys and installs one upgrade for a company (player or NPC): pays Bristol Works from the company's own cash, records it, recomputes parameters. Throws LedgerError if unaffordable. */
export function installUpgrade(db: Sql, ctx: TickCtx, c: CompanyRow, u: UpgradeRow, key: string): number {
  const works = stateAccount(db, 'works')!;
  const tx = transfer(db, ctx, key, c.treasury_account_id, works, u.cost_minor, 'state_payment', `upgrade "${u.name}" for ${c.name}`);
  db.run('INSERT INTO company_upgrades (company_id, upgrade_id, purchased_tick, cost_minor) VALUES (?,?,?,?)', c.id, u.id, ctx.tick, u.cost_minor);
  if (u.kind === 'tier') db.run('UPDATE companies SET premises_tier = ?, level = ? WHERE id = ?', u.to_tier, u.to_tier, c.id);
  db.run('UPDATE companies SET equipment_cost_minor = equipment_cost_minor + ?, revision = revision + 1 WHERE id = ?', u.cost_minor, c.id);
  recomputeOperating(db, c.id);
  logEvent(db, ctx.tick, 'company_upgraded', 'info', c.id, `${c.name} installed "${u.name}" for ${u.cost_minor / 100} EC`, { upgrade: u.id, kind: u.kind, costMinor: u.cost_minor, toTier: u.to_tier });
  return tx.txId;
}

export function upgradeCompany(db: Sql, key: string, companyId: string, upgradeId: string): CommandResponse {
  return runCommand(db, key, 'company.upgrade', (ctx) => {
    const c = own(db, companyId); if (bad(c)) return c; const a = active(c); if (a) return a;
    const u = db.get<UpgradeRow>('SELECT * FROM upgrade_catalog WHERE id = ? AND industry_id = ?', upgradeId, c.industry_id);
    if (!u) return err('VALIDATION', 'That upgrade does not exist for this industry.');
    const owned = new Set(db.all<{ upgrade_id: string }>('SELECT upgrade_id FROM company_upgrades WHERE company_id = ?', companyId).map((r) => r.upgrade_id));
    const blocker = upgradeBlocker(db, c, u, owned); if (blocker) return err('VALIDATION', blocker);
    if (available(db, c.treasury_account_id) < u.cost_minor) return err('INSUFFICIENT_FUNDS', `This upgrade costs ${u.cost_minor / 100} EC; the company has ${available(db, c.treasury_account_id) / 100} EC. Move cash in from your wallet first.`);
    const tx = installUpgrade(db, ctx, c, u, `cmd:${key}`);
    return { ok: true, revision: c.revision + 1, transactionId: String(tx), refreshScreens: ['city', 'companies'] };
  });
}

/** Cost to restore a company's equipment to 100%. */
export const serviceCost = (cfg: { serviceCostBps: number }, c: Pick<CompanyRow, 'equipment_cost_minor' | 'condition_bps'>) => Math.ceil((c.equipment_cost_minor * (10_000 - c.condition_bps) * cfg.serviceCostBps) / 100_000_000);
/** Services equipment (player or NPC): paid to Bristol Works now, recognised as maintenance in the next day's profit. Returns the cost, or 0 if nothing to do. Throws if unaffordable. */
export function applyService(db: Sql, ctx: TickCtx, cfg: { serviceCostBps: number }, c: CompanyRow, key: string): number {
  const cost = serviceCost(cfg, c); if (cost <= 0) return 0;
  transfer(db, ctx, key, c.treasury_account_id, stateAccount(db, 'works')!, cost, 'operating_cost', `equipment service for ${c.name}`);
  db.run('UPDATE companies SET condition_bps = 10000, pending_maintenance_minor = pending_maintenance_minor + ?, revision = revision + 1 WHERE id = ?', cost, c.id);
  return cost;
}

/** Equipment service: cost scales with the wear being repaired; paid to Bristol Works now, recognised as a maintenance expense in the next day's profit. */
export function serviceEquipment(db: Sql, key: string, companyId: string): CommandResponse {
  return runCommand(db, key, 'company.service', (ctx) => {
    const c = own(db, companyId); if (bad(c)) return c; const a = active(c); if (a) return a;
    const cfg = loadConfig(db);
    const cost = serviceCost(cfg, c);
    if (cost <= 0) return err('VALIDATION', 'The equipment is already in perfect condition.');
    if (available(db, c.treasury_account_id) < cost) return err('INSUFFICIENT_FUNDS', `Servicing costs ${cost / 100} EC; the company has ${available(db, c.treasury_account_id) / 100} EC.`);
    applyService(db, ctx, cfg, c, `cmd:${key}`);
    return { ok: true, revision: c.revision + 1, transactionId: key, refreshScreens: ['companies'] };
  });
}

/** "Buy supplies now": the same procurement code the daily tick uses, run on demand for N batches of the company's production plan. */
export function procureNow(db: Sql, key: string, companyId: string, batches: number): CommandResponse<{ purchases: { commodity: string; qty: number; cost: number }[]; batches: number; limit: string | null }> {
  return runCommand(db, key, 'company.procure', (ctx) => {
    const c = own(db, companyId); if (bad(c)) return c; const a = active(c); if (a) return a;
    if (!Number.isSafeInteger(batches) || batches <= 0 || batches > 100) return err('VALIDATION', 'Choose how many batches of ingredients to buy (1–100).');
    const cfg = loadConfig(db);
    const r = procureInputs(db, ctx, cfg, c, available(db, c.treasury_account_id), refPriceOf(db, cfg.energyCommodityId), undefined, batches);
    if (r.purchases.length === 0 && r.limit) return err(r.limit === 'cash' ? 'INSUFFICIENT_FUNDS' : 'INSUFFICIENT_STOCK', r.limit === 'cash' ? 'The company cannot afford those ingredients.' : 'Nobody is selling enough of those ingredients right now.');
    return { ok: true, revision: c.revision, transactionId: key, refreshScreens: ['companies', 'commodities'], data: { purchases: r.purchases, batches: r.batches, limit: r.limit } };
  }) as CommandResponse<{ purchases: { commodity: string; qty: number; cost: number }[]; batches: number; limit: string | null }>;
}


export type { StartupLine, StartupQuote };
