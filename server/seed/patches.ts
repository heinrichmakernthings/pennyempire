import type { Sql } from '../db/sql';
import { loadConfig, saveConfig } from '../engine/config';
import { createAccount, issue, type TickCtx } from '../engine/ledger';
import { VACANT_LOTS, mapTiles } from '../../src/shared/bristolMap';
import { INDUSTRY_SEEDS } from './industries';
import { ownerInvestor, registerCapital } from '../engine/capital';
import { ensureStateCompanies } from '../engine/stateCompanies';
import { LISTED_AT_OPENING, seedNpcInvestors } from '../engine/securitiesTick';
import { createProfile, type Strategy } from '../engine/npc';
import { CITY_ID, EXCHANGE_ACCOUNT, companyAccount } from './bristol';

/** One-off, versioned data patches applied after the base seed (new worlds) or on open (existing worlds). Each runs exactly once per database. */
interface Patch { id: string; run(db: Sql, ctx: TickCtx): number /* coins issued, minor */ }
const E = (ec: number) => Math.round(ec * 100);

const companyManagement: Patch = {
  id: 'company-management-v1',
  run(db, ctx) {
    let issued = 0;
    db.run("INSERT OR IGNORE INTO industries (id, name, kind) VALUES ('works', 'State works & equipment supply', 'service')");
    // Bristol Works: the state supplier of fit-outs, equipment, upgrades and servicing. Coins paid to it are transfers (not sinks).
    const works = 'co-bristol-works', acct = companyAccount(works);
    if (!db.get('SELECT 1 FROM companies WHERE id = ?', works)) {
      createAccount(db, acct, 'company', 'Bristol Works treasury');
      db.run(`INSERT INTO companies (id, name, city_id, district_id, plot_id, industry_id, asset_id, owner_kind, owner_id, treasury_account_id, level, status, retail_commodity_id, price_minor, min_price_minor, max_price_minor, quality, employees, max_employees, wage_minor, capacity_batches, storage_cap_units, property_minor, marketing_minor, reputation_bps, created_tick)
        VALUES (?,?,?,?,NULL,'works',NULL,'state','state-bristol',?,1,'operating',NULL,100,100,100,'standard',0,0,0,0,1,0,0,9000,0)`, works, 'Bristol Works', CITY_ID, 'dist-redcliffe', acct);
      if (!db.get('SELECT 1 FROM securities WHERE company_id = ?', works)) registerCapital(db, ctx, works, ownerInvestor(db, 'state-bristol', 'state'), 0, 'genesis cap table');
      issue(db, ctx, `seed:co:${works}`, acct, E(3_000), 'opening capital: Bristol Works'); issued += E(3_000);
    }
    // Industry catalogue (shared by all six industries)
    for (const s of INDUSTRY_SEEDS) {
      db.run(`INSERT OR REPLACE INTO industry_specs (industry_id, startable, label, tagline, plot_width, plot_depth, primary_recipe_id, retail_commodity_id, licence_fee_minor, equipment_minor, equipment_label, wage_minor, default_price_minor, min_price_minor, max_price_minor, default_staff, default_batches, working_capital_minor, base_rent_minor, sells)
        VALUES (?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, s.id, s.label, s.tagline, s.plot[0], s.plot[1], s.recipe, s.retail, E(s.licence), E(s.equipment), s.equipmentLabel, E(s.wage), E(s.price), E(s.min), E(s.max), s.staff, s.batches, E(s.workingCapital), E(s.rent), s.sells);
      s.tiers.forEach((t, i) => db.run('INSERT OR REPLACE INTO industry_tiers (industry_id, tier, name, fitout_minor, rent_bps, capacity_batches, max_employees, storage_cap_units, asset_id) VALUES (?,?,?,?,?,?,?,?,?)', s.id, i + 1, t.name, E(t.fitout), t.rentBps, t.capacity, t.employees, t.storage, t.asset));
      const [t1, t2, t3] = s.tiers; const up = (slug: string) => s.upgrades.find((u) => u.slug === slug)!;
      const row = (id: string, name: string, desc: string, kind: string, cost: number, req: number, dCap: number, dStore: number, dProd: number, dEn: number, toTier: number | null, sort: number) =>
        db.run('INSERT OR REPLACE INTO upgrade_catalog (id, industry_id, name, description, kind, cost_minor, requires_tier, d_capacity_batches, d_storage, d_productivity_bps, d_energy_saving_bps, to_tier, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', id, s.id, name, desc, kind, E(cost), req, dCap, dStore, dProd, dEn, toTier, sort);
      row(`up-${s.id}-tier2`, t2.name, `Refurbish the premises to a ${t2.name}: more capacity, more workstations and storage, a better building — and higher rent.`, 'tier', t2.fitout - t1.fitout, 1, 0, 0, 0, 0, 2, 1);
      row(`up-${s.id}-tier3`, t3.name, `Fit out a ${t3.name}: the largest premises, the highest rent.`, 'tier', t3.fitout - t2.fitout, 2, 0, 0, 0, 0, 3, 2);
      row(`up-${s.id}-capacity`, up('capacity').name, up('capacity').description, 'capacity', Math.round(s.equipment * 0.35), 1, Math.max(1, Math.ceil(t1.capacity * 0.25)), 0, 0, 0, null, 3);
      row(`up-${s.id}-storage`, up('storage').name, up('storage').description, 'storage', Math.round(s.equipment * 0.2), 1, 0, Math.round(t1.storage * 0.5), 0, 0, null, 4);
      row(`up-${s.id}-productivity`, up('productivity').name, up('productivity').description, 'productivity', Math.round(s.equipment * 0.15), 1, 0, 0, 1_500, 0, null, 5);
      row(`up-${s.id}-efficiency`, up('efficiency').name, up('efficiency').description, 'efficiency', Math.round(s.equipment * 0.3), 1, 0, 0, 0, 2_500, null, 6);
      row(`up-${s.id}-automation`, up('automation').name, up('automation').description, 'productivity', Math.round(s.equipment * 0.7), 2, 0, 0, 2_500, 0, null, 7);
      db.run('UPDATE companies SET equipment_cost_minor = ? WHERE industry_id = ? AND owner_kind <> ? AND equipment_cost_minor = 0', E(s.equipment), s.id, 'player');
    }
    db.run("UPDATE companies SET quality = 'standard' WHERE id = 'co-clifton-dairy'");   // premium would raise its milk use; NPC calibration assumes standard
    // Map: terrain re-laid for the larger district, and vacant lots a player can lease
    db.run('DELETE FROM plots WHERE asset_id IS NULL AND company_id IS NULL AND width = 1 AND depth = 1');
    for (const t of mapTiles()) db.run('INSERT OR IGNORE INTO plots (id, city_id, district_id, col, row, width, depth, terrain, road_mask, quay_mask, asset_id, company_id) VALUES (?,?,NULL,?,?,1,1,?,?,?,NULL,NULL)', `tile-${t.column}-${t.row}`, CITY_ID, t.column, t.row, t.terrain, t.roadMask, t.quayMask);
    for (const l of VACANT_LOTS) db.run("INSERT OR IGNORE INTO plots (id, city_id, district_id, col, row, width, depth, terrain, road_mask, quay_mask, asset_id, company_id) VALUES (?,?,?,?,?,?,?,'paving',0,0,NULL,NULL)", l.id, CITY_ID, l.district, l.column, l.row, l.width, l.depth);
    return issued;
  },
};

/** The Penny Exchange: a state-owned account that receives trading fees. Fees are transferred to it; only an explicit per-tick burn destroys coins. */
const exchangeV1: Patch = {
  id: 'exchange-v1',
  run(db) {
    if (!db.get('SELECT 1 FROM accounts WHERE id = ?', EXCHANGE_ACCOUNT)) createAccount(db, EXCHANGE_ACCOUNT, 'state_treasury', 'Penny Exchange fee account');
    // The two supplies named in docs/ECONOMY.md ("milk + supplies" for cafés; boxes for takeaway pizza). No producer industry exists yet: the state provisioner
    // imports a bounded amount at a premium (see STATE_SUPPLIED), so they are real, finite, priced inputs rather than free ones.
    db.run("INSERT OR IGNORE INTO commodities (id, name, unit_label, reference_price_minor) VALUES ('coffee', 'Coffee beans', 'sack', 100), ('packaging', 'Packaging', 'bundle', 40)");
    db.run("INSERT OR IGNORE INTO recipe_inputs (recipe_id, commodity_id, units) VALUES ('recipe-coffee', 'coffee', 4), ('recipe-pizza', 'packaging', 2)");
    return 0;
  },
};

/** Neighbourhood consumer segments and per-capita household budgets. The budgets reproduce the earlier fixed spending at 100% confidence and an average season. */
const consumersV1: Patch = {
  id: 'consumers-v1',
  run(db) {
    const segs: [string, string, string, number, number, number, number, number, number, number][] = [
      ['seg-clifton-professionals', 'dist-clifton', 'Clifton professionals', 2_000, 13_000, -1, 8_000, 5_000, 1, 12],
      ['seg-clifton-families', 'dist-clifton', 'Clifton families', 1_500, 10_000, 0, 5_000, 7_000, 1, 12],
      ['seg-redcliffe-workers', 'dist-redcliffe', 'Redcliffe workers', 2_500, 8_500, 1, 3_000, 4_000, 6, 12],
      ['seg-redcliffe-students', 'dist-redcliffe', 'Redcliffe students', 1_500, 6_500, 2, 2_000, 2_000, 6, 12],
      ['seg-harbour-commuters', 'dist-harbourside', 'Harbourside commuters', 1_500, 10_500, 0, 5_000, 3_000, 11, 9],
      ['seg-harbour-creatives', 'dist-harbourside', 'Harbourside creatives', 1_000, 11_500, -1, 7_000, 4_500, 11, 9],
    ];
    for (const [id, d, name, pop, inc, delta, qp, loy, col, row] of segs) db.run('INSERT OR IGNORE INTO consumer_segments (id, city_id, district_id, name, population_bps, income_bps, price_sens_delta, quality_pref_bps, loyalty_trait_bps, center_col, center_row) VALUES (?,?,?,?,?,?,?,?,?,?,?)', id, CITY_ID, d, name, pop, inc, delta, qp, loy, col, row);
    // pizza leans summer, coffee leans winter; both average 100% over the year
    db.run("UPDATE demand_rules SET per_thousand_minor = 3600, confidence_exposure_bps = 10000, segmented = 1, seasonality = '[9500,9500,9800,10000,10300,10500,10700,10600,10200,10000,9800,10100]' WHERE id = 'dem-pizza'");
    db.run("UPDATE demand_rules SET per_thousand_minor = 1000, confidence_exposure_bps = 10000, segmented = 1, seasonality = '[11500,11000,10500,10000,9500,9000,8800,8900,9500,10200,10800,11300]' WHERE id = 'dem-coffee'");
    return 0;
  },
};

/** Gives every NPC-owned operating company a named strategy. Starting markup stays at the long-calibrated 105%; reviews then move it within the strategy's band. */
const npcV1: Patch = {
  id: 'npc-v1',
  run(db, ctx) {
    const plan: Record<string, Strategy> = { 'co-clifton-slice': 'premium', 'co-bean-there': 'budget', 'co-severn-farm': 'conservative', 'co-brunel-mill': 'growth', 'co-clifton-dairy': 'opportunistic', 'co-avon-timber': 'budget', 'co-mad-slices': 'budget', 'co-harbour-bean': 'conservative' };
    const every = loadConfig(db).npcDecisionEveryTicks;
    for (const c of db.all<{ id: string }>("SELECT id FROM companies WHERE owner_kind = 'npc' AND bankrupt_tick IS NULL ORDER BY id")) createProfile(db, ctx.tick, c.id, plan[c.id] ?? 'budget', every);
    return 0;
  },
};


/**
 * Penny Exchange opens with its first listings: the established NPC firms (each a real operating business) and the three state enterprises that earn real revenue.
 * Their founding holders (the NPC shareholders and the state) keep a majority and offer a float; six NPC investors arrive with finite, recorded seed capital.
 */
const securitiesV1: Patch = {
  id: 'securities-v1',
  run(db, ctx) {
    // Investors arrive now; the opening listings are made on `exchangeOpensTick`, once a week of real trading gives each company an earnings record to be valued on.
    const issued = seedNpcInvestors(db, ctx, loadConfig(db));
    for (const [company, ticker] of Object.entries(LISTED_AT_OPENING)) db.run("UPDATE securities SET ticker = ? WHERE company_id = ? AND status = 'unlisted'", ticker, company);
    return issued;
  },
};

/** Six state enterprises, the central bank and the lease register (Prompt 8). */
const stateEconomyV1: Patch = { id: 'state-economy-v1', run(db, ctx) { return ensureStateCompanies(db, ctx, loadConfig(db)); } };

export const PATCHES: Patch[] = [companyManagement, exchangeV1, consumersV1, npcV1, securitiesV1, stateEconomyV1];

/** Applies any patch this database has not seen. Returns the coins issued (minor) so the caller can keep the supply target in step. */
export function applySeedPatches(db: Sql, ctx: TickCtx): number {
  let total = 0;
  for (const p of PATCHES) {
    if (db.get('SELECT 1 FROM meta WHERE key = ?', `seed_patch:${p.id}`)) continue;
    db.transaction(() => { total += p.run(db, ctx); db.run('INSERT INTO meta (key, value) VALUES (?, ?)', `seed_patch:${p.id}`, String(ctx.tick)); });
  }
  if (total > 0) { const cfg = loadConfig(db); if (cfg.supplyTargetMinor > 0) saveConfig(db, { ...cfg, supplyTargetMinor: cfg.supplyTargetMinor + total }); }
  return total;
}
