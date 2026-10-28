import type { Sql } from '../db/sql';
import { DEFAULT_CONFIG, gameDate, loadConfig, saveConfig, validateConfig, type EngineConfig } from '../engine/config';
import { applySeedPatches } from './patches';
import { addStock } from '../engine/inventory';
import { ownerInvestor, registerCapital } from '../engine/capital';
import { BURN, ISSUANCE, createAccount, issue, type TickCtx } from '../engine/ledger';
import { MAP_BLOCKS, mapTiles } from '../../src/shared/bristolMap';

/* ───────────────────────── Static economic definitions ───────────────────────── */
export const CITY_ID = 'city-bristol';
export const PLAYER_ID = 'player-demo';
export const HOUSEHOLDS = 'acct:households:bristol';
export const TREASURY = 'acct:state:bristol-treasury';
export const EXCHANGE_ACCOUNT = 'acct:state:penny-exchange';
export const PLAYER_WALLET = 'acct:player:demo';
export const companyAccount = (id: string) => `acct:co:${id}`;
export const SEED_VERSION = 1;

const INDUSTRIES = [
  ['farm', 'Farm', 'primary'], ['mill', 'Flour mill', 'manufacturing'], ['dairy', 'Dairy', 'manufacturing'], ['pizza', 'Pizza restaurant', 'retail'], ['cafe', 'Café', 'retail'], ['timber', 'Timber yard', 'primary'],
  ['utility', 'Energy utility', 'utility'], ['property', 'Estates', 'property'], ['media', 'Advertising', 'media'], ['wholesale', 'State provisioner', 'wholesale'],
] as const;
/** [id, name, unit, reference price (minor)] */
const COMMODITIES = [
  ['wheat', 'Wheat', 'sack', 50], ['milk', 'Milk', 'crate', 70], ['flour', 'Flour', 'sack', 220], ['cheese', 'Cheese', 'wheel', 320], ['timber', 'Timber', 'stack', 310],
  ['pizza', 'Pizza', 'box', 1000], ['cafe-drink', 'Café drinks', 'cup', 350], ['energy', 'Energy', 'MWh', 90],
] as const;
/** Per docs/ECONOMY.md: mill 2 wheat→1 flour; pizza 1 flour + 1 cheese → 1 pizza. Batch sizes are nominal. */
const RECIPES = [
  { id: 'recipe-wheat', industry: 'farm', out: ['wheat', 40], energy: 3, inputs: [] as [string, number][] },
  { id: 'recipe-milk', industry: 'farm', out: ['milk', 40], energy: 3, inputs: [] },
  { id: 'recipe-flour', industry: 'mill', out: ['flour', 20], energy: 4, inputs: [['wheat', 40]] },
  { id: 'recipe-cheese', industry: 'dairy', out: ['cheese', 20], energy: 4, inputs: [['milk', 40]] },
  { id: 'recipe-pizza', industry: 'pizza', out: ['pizza', 10], energy: 3, inputs: [['flour', 10], ['cheese', 10]] },
  { id: 'recipe-coffee', industry: 'cafe', out: ['cafe-drink', 20], energy: 2, inputs: [['milk', 10]] },
  { id: 'recipe-timber', industry: 'timber', out: ['timber', 25], energy: 4, inputs: [] },
] as const;

const DISTRICTS = [['dist-harbourside', 'Harbourside', 13_000], ['dist-redcliffe', 'Redcliffe', 10_000], ['dist-clifton', 'Clifton Village', 12_000]] as const;

interface CoSeed {
  id: string; name: string; industry: string; owner: ['player' | 'npc' | 'state', string]; plot: string | null; district: string; cash: number; // EC units
  price: number; min: number; max: number; quality: 'basic' | 'standard' | 'premium'; employees: number; maxEmployees: number; wage: number; capacity: number; storage: number;
  property: number; marketing: number; reputation: number; retail?: string; lines: [string, number][]; stock?: [string, number, number][]; level?: number;
}
const WAGE = 2_000; // 20 EC per employee per tick
/** Minor units throughout except where noted (cash is in whole EC). */
const COMPANIES: CoSeed[] = [
  { id: 'co-mad-slices', name: 'Mad Slices', industry: 'pizza', owner: ['player', PLAYER_ID], plot: 'plot-pizza', district: 'dist-harbourside', cash: 6_000, price: 1000, min: 600, max: 1600, quality: 'standard', employees: 4, maxEmployees: 5, wage: WAGE, capacity: 12, storage: 300, property: 8_000, marketing: 2_000, reputation: 6000, retail: 'pizza', lines: [['recipe-pizza', 9]], stock: [['flour', 60, 220], ['cheese', 60, 320]], level: 2 },
  { id: 'co-harbour-bean', name: 'Harbour Bean', industry: 'cafe', owner: ['player', PLAYER_ID], plot: 'plot-cafe', district: 'dist-clifton', cash: 2_500, price: 350, min: 200, max: 700, quality: 'basic', employees: 2, maxEmployees: 3, wage: WAGE, capacity: 6, storage: 300, property: 4_500, marketing: 0, reputation: 5500, retail: 'cafe-drink', lines: [['recipe-coffee', 5]], stock: [['milk', 30, 70]] },
  { id: 'co-clifton-slice', name: 'Clifton Slice', industry: 'pizza', owner: ['npc', 'npc-clifton-slice'], plot: 'plot-pizza-2', district: 'dist-clifton', cash: 6_000, price: 1000, min: 600, max: 1600, quality: 'standard', employees: 4, maxEmployees: 5, wage: WAGE, capacity: 12, storage: 300, property: 7_000, marketing: 2_000, reputation: 6000, retail: 'pizza', lines: [['recipe-pizza', 9]], stock: [['flour', 60, 220], ['cheese', 60, 320]] },
  { id: 'co-bean-there', name: 'Bean There', industry: 'cafe', owner: ['npc', 'npc-bean-there'], plot: 'plot-cafe-2', district: 'dist-harbourside', cash: 2_500, price: 360, min: 200, max: 700, quality: 'standard', employees: 2, maxEmployees: 3, wage: WAGE, capacity: 6, storage: 300, property: 6_000, marketing: 1_000, reputation: 5500, retail: 'cafe-drink', lines: [['recipe-coffee', 5]], stock: [['milk', 30, 70]] },
  { id: 'co-severn-farm', name: 'Severn Valley Farm', industry: 'farm', owner: ['npc', 'npc-severn'], plot: 'plot-farm', district: 'dist-clifton', cash: 8_000, price: 50, min: 25, max: 100, quality: 'standard', employees: 8, maxEmployees: 8, wage: WAGE, capacity: 24, storage: 1_500, property: 4_000, marketing: 0, reputation: 7000, lines: [['recipe-wheat', 9], ['recipe-milk', 12]], stock: [['wheat', 200, 50], ['milk', 200, 70]], level: 2 },
  { id: 'co-brunel-mill', name: 'Brunel Milling', industry: 'mill', owner: ['npc', 'npc-brunel'], plot: 'plot-mill', district: 'dist-redcliffe', cash: 8_000, price: 220, min: 110, max: 440, quality: 'standard', employees: 4, maxEmployees: 5, wage: WAGE, capacity: 12, storage: 1_000, property: 4_500, marketing: 0, reputation: 8000, lines: [['recipe-flour', 9]], stock: [['wheat', 200, 50], ['flour', 80, 220]], level: 3 },
  { id: 'co-clifton-dairy', name: 'Clifton Creamery', industry: 'dairy', owner: ['npc', 'npc-clifton'], plot: 'plot-dairy', district: 'dist-harbourside', cash: 8_000, price: 320, min: 200, max: 640, quality: 'premium', employees: 5, maxEmployees: 6, wage: WAGE, capacity: 12, storage: 1_000, property: 5_500, marketing: 0, reputation: 8600, lines: [['recipe-cheese', 9]], stock: [['milk', 200, 70], ['cheese', 80, 320]], level: 2 },
  { id: 'co-avon-timber', name: 'Avon Timber & Joinery', industry: 'timber', owner: ['npc', 'npc-avon'], plot: 'plot-timber', district: 'dist-clifton', cash: 3_000, price: 310, min: 150, max: 620, quality: 'basic', employees: 3, maxEmployees: 4, wage: WAGE, capacity: 8, storage: 800, property: 3_500, marketing: 0, reputation: 6000, retail: 'timber', lines: [['recipe-timber', 7]], stock: [['timber', 100, 310]] },
  // State enterprises (non-selectable scenery in the current UI, but real accounts and real cash flows)
  { id: 'co-bristol-energy', name: 'Bristol Energy', industry: 'utility', owner: ['state', 'state-bristol'], plot: 'plot-utility', district: 'dist-redcliffe', cash: 5_000, price: 90, min: 90, max: 90, quality: 'standard', employees: 4, maxEmployees: 6, wage: WAGE, capacity: 0, storage: 1, property: 0, marketing: 0, reputation: 9000, lines: [] },
  { id: 'co-bristol-estates', name: 'Bristol Estates', industry: 'property', owner: ['state', 'state-bristol'], plot: null, district: 'dist-redcliffe', cash: 2_000, price: 100, min: 100, max: 100, quality: 'standard', employees: 3, maxEmployees: 4, wage: WAGE, capacity: 0, storage: 1, property: 0, marketing: 0, reputation: 9000, lines: [] },
  { id: 'co-bristol-media', name: 'Bristol Media', industry: 'media', owner: ['state', 'state-bristol'], plot: null, district: 'dist-redcliffe', cash: 1_000, price: 100, min: 100, max: 100, quality: 'standard', employees: 1, maxEmployees: 2, wage: WAGE, capacity: 0, storage: 1, property: 0, marketing: 0, reputation: 9000, lines: [] },
  { id: 'co-bristol-provisions', name: 'Bristol Provisions', industry: 'wholesale', owner: ['state', 'state-bristol'], plot: 'plot-warehouse', district: 'dist-redcliffe', cash: 4_000, price: 100, min: 1, max: 100_000, quality: 'standard', employees: 0, maxEmployees: 0, wage: WAGE, capacity: 0, storage: 400, property: 0, marketing: 0, reputation: 9000, lines: [] },
];

export const STATE_COMPANIES = { energy: 'co-bristol-energy', estates: 'co-bristol-estates', media: 'co-bristol-media', provisions: 'co-bristol-provisions' } as const;

/** Funded demand. pool_share = bps of the funder's balance at tick start; fixed = amount (minor), capped by the funder's balance. */
const DEMAND_RULES = [
  { id: 'dem-pizza', commodity: 'pizza', label: 'Households: eating out', funder: HOUSEHOLDS, mode: 'fixed', amount: 180_000, payment: 'consumer_sale', goods: 'consumer_purchase', sens: 2 },
  { id: 'dem-coffee', commodity: 'cafe-drink', label: 'Households: coffee', funder: HOUSEHOLDS, mode: 'fixed', amount: 50_000, payment: 'consumer_sale', goods: 'consumer_purchase', sens: 2 },
  { id: 'dem-works', commodity: 'timber', label: 'Council public works (state-funded)', funder: TREASURY, mode: 'fixed', amount: 30_000, payment: 'state_payment', goods: 'public_works', sens: 1 },
] as const;

/** Creates the whole fictional Bristol economy. Idempotent: does nothing if this database is already seeded. */
export type StartingProfile = 'demo' | 'new';
/**
 * Creates the fictional Bristol economy. `demo` (default; used by tests) gives the player two running companies. `new` is the real new-game start:
 * the player owns no company and holds 20,000 EC; the two shops become NPC-owned competitors.
 */
export function seedBristol(db: Sql, overrides: Partial<EngineConfig> = {}, profile: StartingProfile = 'demo'): { seeded: boolean; issuedMinor: number } {
  if (db.get("SELECT 1 FROM meta WHERE key = 'seed_version'")) {
    // Existing world: bring it up to the current data patches (idempotent, each runs once).
    const lastTick = db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
    const extra = applySeedPatches(db, { tick: lastTick, gameDate: gameDate(loadConfig(db), lastTick), actor: 'seed-patch' });
    return { seeded: false, issuedMinor: extra };
  }
  const cfg: EngineConfig = { ...DEFAULT_CONFIG, ...overrides };
  const errs = validateConfig(cfg); if (errs.length) throw new Error(`Invalid config: ${errs.join('; ')}`);
  return db.transaction(() => {
    saveConfig(db, cfg);  // (supply target is filled in below once the genesis issuance is known)
    db.run('INSERT INTO engine_state (id, last_tick, clock_anchor_ms) VALUES (1, 0, NULL)');
    const ctx: TickCtx = { tick: 0, gameDate: gameDate(cfg, 0), actor: 'seed' };
    let issued = 0;
    const grant = (key: string, to: string, ec: number, memo: string) => { issue(db, ctx, `seed:${key}`, to, ec * 100, memo); issued += ec * 100; };

    createAccount(db, ISSUANCE, 'issuance', 'Mint (total ever issued, negative)'); createAccount(db, BURN, 'destroyed', 'Burn (total ever destroyed)');
    createAccount(db, HOUSEHOLDS, 'households', 'Bristol households (NPC consumers)'); createAccount(db, TREASURY, 'state_treasury', 'Bristol state treasury');
    createAccount(db, PLAYER_WALLET, 'player', 'Demo trader wallet');
    for (const [id, name, kind] of INDUSTRIES) db.run('INSERT INTO industries (id, name, kind) VALUES (?,?,?)', id, name, kind);
    for (const [id, name, unit, price] of COMMODITIES) db.run('INSERT INTO commodities (id, name, unit_label, reference_price_minor) VALUES (?,?,?,?)', id, name, unit, price);
    for (const r of RECIPES) {
      db.run('INSERT INTO recipes (id, industry_id, output_commodity_id, output_units, energy_units) VALUES (?,?,?,?,?)', r.id, r.industry, r.out[0], r.out[1], r.energy);
      for (const [c, u] of r.inputs) db.run('INSERT INTO recipe_inputs (recipe_id, commodity_id, units) VALUES (?,?,?)', r.id, c, u);
    }
    db.run('INSERT INTO cities (id, name, population, households_account_id, treasury_account_id) VALUES (?,?,?,?,?)', CITY_ID, 'Bristol', 50_000, HOUSEHOLDS, TREASURY);
    for (const [id, name, idx] of DISTRICTS) db.run('INSERT INTO districts (id, city_id, name, property_index_bps) VALUES (?,?,?,?)', id, CITY_ID, name, idx);
    const ownerNames: Record<string, string> = { [PLAYER_ID]: 'You (demo trader)', 'npc-clifton-slice': 'Clifton Slice Ltd', 'npc-bean-there': 'Bean There Coffee Co', 'npc-severn': 'Severn Valley Growers', 'npc-mad-slices': 'Mad Slices Ltd', 'npc-harbour-bean': 'Harbour Bean Ltd', 'npc-brunel': 'Brunel Milling Ltd', 'npc-clifton': 'Clifton Creamery Co-op', 'npc-avon': 'Avon Timber & Joinery', 'state-bristol': 'Bristol City (state)' };
    for (const c of COMPANIES) if (!db.get('SELECT 1 FROM owners WHERE id = ?', c.owner[1])) db.run('INSERT INTO owners (id, kind, name) VALUES (?,?,?)', c.owner[1], c.owner[0], ownerNames[c.owner[1]] ?? c.owner[1]);
    db.run('INSERT INTO players (id, display_name, city_id, wallet_account_id) VALUES (?,?,?,?)', PLAYER_ID, 'Demo Trader', CITY_ID, PLAYER_WALLET);

    for (const t of mapTiles()) db.run('INSERT INTO plots (id, city_id, district_id, col, row, width, depth, terrain, road_mask, quay_mask, asset_id, company_id) VALUES (?,?,NULL,?,?,1,1,?,?,?,NULL,NULL)', `tile-${t.column}-${t.row}`, CITY_ID, t.column, t.row, t.terrain, t.roadMask, t.quayMask);
    // The 'new' profile has no starter shops: the two demo player shops are vacant plots a real player can claim.
    const STARTER_SHOPS = new Set(['co-mad-slices', 'co-harbour-bean']);
    const vacantStarter = (b: { companyId: string | null }) => profile === 'new' && b.companyId !== null && STARTER_SHOPS.has(b.companyId);
    for (const b of MAP_BLOCKS) db.run('INSERT INTO plots (id, city_id, district_id, col, row, width, depth, terrain, road_mask, quay_mask, asset_id, company_id) VALUES (?,?,?,?,?,?,?,?,0,0,?,?)', b.plotId, CITY_ID, b.district, b.column, b.row, b.width, b.depth, 'paving', vacantStarter(b) ? null : b.assetId, vacantStarter(b) ? null : b.companyId);

    // Opening money: every coin is a recorded issuance with a reason.
    grant('households', HOUSEHOLDS, 6_000, 'opening NPC household savings');
    grant('treasury', TREASURY, 20_000, 'opening state treasury');
    grant('player', PLAYER_WALLET, profile === 'new' ? 20_000 : 15_000, profile === 'new' ? 'new player starting capital' : 'demo player starting capital');

    for (const company of COMPANIES) {
      if (profile === 'new' && STARTER_SHOPS.has(company.id)) continue;
      const c: CoSeed = company;
      const acct = companyAccount(c.id);
      createAccount(db, acct, 'company', `${c.name} treasury`);
      const dist = DISTRICTS.find((d) => d[0] === c.district)!;
      const property = Math.floor((c.property * dist[2]) / 10_000);
      db.run(`INSERT INTO companies (id, name, city_id, district_id, plot_id, industry_id, asset_id, owner_kind, owner_id, treasury_account_id, level, status, retail_commodity_id, price_minor, min_price_minor, max_price_minor, quality, employees, max_employees, wage_minor, capacity_batches, storage_cap_units, property_minor, marketing_minor, reputation_bps, created_tick)
        VALUES (?,?,?,?,?,?,?,?,?,?,?, 'operating', ?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
        c.id, c.name, CITY_ID, c.district, c.plot, c.industry, MAP_BLOCKS.find((b) => b.plotId === c.plot)?.assetId ?? null, c.owner[0], c.owner[1], acct, c.level ?? 1,
        c.retail ?? null, c.price, c.min, c.max, c.quality, c.employees, c.maxEmployees, c.wage, c.capacity, c.storage, property, c.marketing, c.reputation);
      registerCapital(db, ctx, c.id, ownerInvestor(db, c.owner[1], c.owner[0] as 'player' | 'npc' | 'state'), 0, 'genesis cap table');
      for (const [recipe, planned] of c.lines) {
        const out = RECIPES.find((r) => r.id === recipe)!.out[0];
        db.run('INSERT INTO production_lines (company_id, recipe_id, planned_batches, ask_price_minor) VALUES (?,?,?,?)', c.id, recipe, planned, COMMODITIES.find((x) => x[0] === out)![3]);
      }
      grant(`co:${c.id}`, acct, c.cash, `opening capital: ${c.name}`);
      for (const [commodity, qty, unitCost] of c.stock ?? []) addStock(db, ctx, c.id, commodity, qty, qty * unitCost, 'seed', 'opening stock');
    }
    for (const r of DEMAND_RULES) db.run('INSERT INTO demand_rules (id, city_id, commodity_id, label, funder_account_id, mode, amount, payment_kind, goods_reason, price_sensitivity) VALUES (?,?,?,?,?,?,?,?,?,?)', r.id, CITY_ID, r.commodity, r.label, r.funder, r.mode, r.amount, r.payment, r.goods, r.sens);

    issued += applySeedPatches(db, ctx);
    if (cfg.supplyTargetMinor === 0) saveConfig(db, { ...cfg, supplyTargetMinor: issued });  // default target = genesis supply
    db.run("INSERT INTO meta (key, value) VALUES ('seed_version', ?)", String(SEED_VERSION));
    db.run('INSERT INTO ticks (tick, status, game_date, started_at, finished_at, duration_ms, summary_json) VALUES (0, ?, ?, ?, ?, 0, ?)', 'complete', ctx.gameDate, 'seed', 'seed', JSON.stringify({ seed: true, issued_minor: issued }));
    db.run("INSERT INTO supply_snapshots (tick, issued_total_minor, destroyed_total_minor, circulating_minor, issued_tick_minor, destroyed_tick_minor, households_minor, state_minor, companies_minor, players_minor, goods_value_minor) VALUES (0, ?, 0, ?, ?, 0, 0, 0, 0, 0, 0)", issued, issued, issued);
    db.run("INSERT INTO economic_events (tick, kind, severity, subject, message) VALUES (0, 'seeded', 'info', ?, ?)", CITY_ID, `Bristol seeded: ${COMPANIES.length} companies, ${issued / 100} EC issued at genesis`);
    return { seeded: true, issuedMinor: issued };
  });
}
