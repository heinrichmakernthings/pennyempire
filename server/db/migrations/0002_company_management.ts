/** Migration 0002 — company lifecycle: industry catalogue, premises tiers, upgrades, equipment condition, awareness, production log, bankruptcy. Additive only (no table rebuilds), so it upgrades live worlds in place. */
export default `
CREATE TABLE industry_specs (
  industry_id TEXT PRIMARY KEY REFERENCES industries(id),
  startable INTEGER NOT NULL CHECK (startable IN (0,1)),
  label TEXT NOT NULL, tagline TEXT NOT NULL, plot_width INTEGER NOT NULL, plot_depth INTEGER NOT NULL,
  primary_recipe_id TEXT REFERENCES recipes(id), retail_commodity_id TEXT REFERENCES commodities(id),
  licence_fee_minor INTEGER NOT NULL CHECK (licence_fee_minor >= 0), equipment_minor INTEGER NOT NULL CHECK (equipment_minor >= 0), equipment_label TEXT NOT NULL,
  wage_minor INTEGER NOT NULL CHECK (wage_minor >= 0), default_price_minor INTEGER NOT NULL CHECK (default_price_minor > 0), min_price_minor INTEGER NOT NULL CHECK (min_price_minor > 0), max_price_minor INTEGER NOT NULL,
  default_staff INTEGER NOT NULL, default_batches INTEGER NOT NULL, working_capital_minor INTEGER NOT NULL CHECK (working_capital_minor >= 0),
  base_rent_minor INTEGER NOT NULL CHECK (base_rent_minor >= 0), sells TEXT NOT NULL CHECK (sells IN ('consumers','state','businesses'))
);
CREATE TABLE industry_tiers (
  industry_id TEXT NOT NULL REFERENCES industries(id), tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 3), name TEXT NOT NULL,
  fitout_minor INTEGER NOT NULL CHECK (fitout_minor >= 0), rent_bps INTEGER NOT NULL CHECK (rent_bps > 0),
  capacity_batches INTEGER NOT NULL CHECK (capacity_batches > 0), max_employees INTEGER NOT NULL CHECK (max_employees > 0), storage_cap_units INTEGER NOT NULL CHECK (storage_cap_units > 0), asset_id TEXT NOT NULL,
  PRIMARY KEY (industry_id, tier)
);
CREATE TABLE upgrade_catalog (
  id TEXT PRIMARY KEY, industry_id TEXT NOT NULL REFERENCES industries(id), name TEXT NOT NULL, description TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('tier','capacity','storage','productivity','efficiency')), cost_minor INTEGER NOT NULL CHECK (cost_minor > 0), requires_tier INTEGER NOT NULL DEFAULT 1,
  d_capacity_batches INTEGER NOT NULL DEFAULT 0, d_storage INTEGER NOT NULL DEFAULT 0, d_productivity_bps INTEGER NOT NULL DEFAULT 0, d_energy_saving_bps INTEGER NOT NULL DEFAULT 0, to_tier INTEGER, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE company_upgrades (company_id TEXT NOT NULL REFERENCES companies(id), upgrade_id TEXT NOT NULL REFERENCES upgrade_catalog(id), purchased_tick INTEGER NOT NULL, cost_minor INTEGER NOT NULL, PRIMARY KEY (company_id, upgrade_id));
CREATE TABLE production_log (
  tick INTEGER NOT NULL, company_id TEXT NOT NULL, recipe_id TEXT NOT NULL, planned_batches INTEGER NOT NULL, produced_batches INTEGER NOT NULL,
  limited_by TEXT NOT NULL CHECK (limited_by IN ('plan','staff','storage','inputs','cash','supply','condition','closed')), output_units INTEGER NOT NULL, inputs_json TEXT NOT NULL,
  PRIMARY KEY (tick, company_id, recipe_id)
);
ALTER TABLE companies ADD COLUMN premises_tier INTEGER NOT NULL DEFAULT 1;
ALTER TABLE companies ADD COLUMN productivity_bps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN energy_saving_bps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN condition_bps INTEGER NOT NULL DEFAULT 10000 CHECK (condition_bps BETWEEN 0 AND 10000);
ALTER TABLE companies ADD COLUMN awareness_bps INTEGER NOT NULL DEFAULT 0 CHECK (awareness_bps BETWEEN 0 AND 10000);
ALTER TABLE companies ADD COLUMN equipment_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (equipment_cost_minor >= 0);
ALTER TABLE companies ADD COLUMN pending_labour_minor INTEGER NOT NULL DEFAULT 0 CHECK (pending_labour_minor >= 0);
ALTER TABLE companies ADD COLUMN pending_maintenance_minor INTEGER NOT NULL DEFAULT 0 CHECK (pending_maintenance_minor >= 0);
ALTER TABLE companies ADD COLUMN staff_change_tick INTEGER NOT NULL DEFAULT -1;
ALTER TABLE companies ADD COLUMN hires_in_tick INTEGER NOT NULL DEFAULT 0 CHECK (hires_in_tick >= 0);
ALTER TABLE companies ADD COLUMN dismissals_in_tick INTEGER NOT NULL DEFAULT 0 CHECK (dismissals_in_tick >= 0);
ALTER TABLE companies ADD COLUMN auto_procure INTEGER NOT NULL DEFAULT 1 CHECK (auto_procure IN (0,1));
ALTER TABLE companies ADD COLUMN insolvent_tick INTEGER;
ALTER TABLE companies ADD COLUMN bankrupt_tick INTEGER;
ALTER TABLE companies ADD COLUMN written_off_minor INTEGER NOT NULL DEFAULT 0 CHECK (written_off_minor >= 0);
ALTER TABLE companies ADD COLUMN lot_id TEXT;
ALTER TABLE company_tick_stats ADD COLUMN maintenance_minor INTEGER NOT NULL DEFAULT 0;
`;
