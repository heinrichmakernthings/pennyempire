import type { Sql } from '../db/sql';
import { loadConfig, saveConfig } from '../engine/config';
import { createAccount, issue, type TickCtx } from '../engine/ledger';
import { VACANT_LOTS, mapTiles } from '../../src/shared/bristolMap';
import { INDUSTRY_SEEDS } from './industries';
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
      db.run("INSERT OR IGNORE INTO ownership (company_id, holder_kind, holder_id, shares) VALUES (?, 'state', 'state-bristol', 10000)", works);
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
    return 0;
  },
};

export const PATCHES: Patch[] = [companyManagement, exchangeV1];

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
