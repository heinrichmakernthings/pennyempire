import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { currentMods } from './economyState';

/**
 * The city's electricity grid. Capacity is the sum of active generation sources (Penny Energy's grid today; a player-owned producer is just another row), scaled by
 * any active event. Production draws energy units from what is left that day; when the grid runs short, the shortage is recorded and the affected lines are limited
 * by 'energy' (or 'disruption' when an event, not growth, caused it). The tariff follows YESTERDAY's load, so there is no feedback loop inside a tick.
 */
export interface EnergyDay { baseCapacity: number; capacity: number; left: number; demand: number; tariff: number; baseTariff: number; loadBps: number }

export const gridCapacity = (db: Sql) => db.get<{ c: number }>('SELECT COALESCE(SUM(capacity_units),0) c FROM energy_sources WHERE active = 1')!.c;

/** Surcharge on the base price once the grid is heavily loaded: 0 below the start load, up to the maximum at 100% load. */
export const tariffSurchargeBps = (cfg: EngineConfig, loadBps: number) => loadBps <= cfg.energyTariffLoadStartBps ? 0 : Math.min(cfg.energyTariffMaxSurchargeBps, Math.floor(((loadBps - cfg.energyTariffLoadStartBps) * cfg.energyTariffMaxSurchargeBps) / Math.max(1, 10_000 - cfg.energyTariffLoadStartBps)));

export function startEnergyDay(db: Sql, cfg: EngineConfig, baseTariff: number): EnergyDay {
  const mods = currentMods(db);
  const baseCapacity = gridCapacity(db), capacity = Math.floor((baseCapacity * mods.energyCapacityBps) / 10_000);
  const y = db.get<{ demand_units: number; capacity_units: number }>('SELECT demand_units, capacity_units FROM energy_daily ORDER BY tick DESC LIMIT 1');
  const loadBps = y && y.capacity_units > 0 ? Math.floor((y.demand_units * 10_000) / y.capacity_units) : 0;
  const tariff = Math.max(1, Math.ceil((baseTariff * (10_000 + tariffSurchargeBps(cfg, loadBps)) / 10_000 * mods.energyPriceBps) / 10_000));
  return { baseCapacity, capacity, left: capacity, demand: 0, tariff, baseTariff, loadBps };
}

/** Takes up to `units` from today's grid. Returns what was supplied; the rest is shortage. */
export function drawEnergy(day: EnergyDay, units: number): number { day.demand += units; const got = Math.max(0, Math.min(units, day.left)); day.left -= got; return got; }

export function closeEnergyDay(db: Sql, tick: number, day: EnergyDay) {
  const supplied = day.capacity - day.left, shortage = Math.max(0, day.demand - supplied);
  db.run('INSERT OR REPLACE INTO energy_daily (tick, capacity_units, demand_units, supplied_units, utilisation_bps, tariff_minor, shortage_units) VALUES (?,?,?,?,?,?,?)', tick, day.capacity, day.demand, supplied, day.capacity > 0 ? Math.floor((supplied * 10_000) / day.capacity) : 0, day.tariff, shortage);
}

export interface EnergyReport { capacityUnits: number; baseCapacityUnits: number; demandUnits: number; suppliedUnits: number; shortageUnits: number; utilisationBps: number; tariffMinor: number; baseTariffMinor: number; surchargeBps: number; history: { tick: number; capacity: number; demand: number; shortage: number; tariff: number }[]; sources: { id: string; name: string; capacityUnits: number; companyId: string }[] }
export function energyReport(db: Sql, cfg: EngineConfig, baseTariff: number): EnergyReport {
  const last = db.get<{ capacity_units: number; demand_units: number; supplied_units: number; shortage_units: number; utilisation_bps: number; tariff_minor: number }>('SELECT * FROM energy_daily ORDER BY tick DESC LIMIT 1');
  const base = gridCapacity(db), mods = currentMods(db);
  const load = last && last.capacity_units > 0 ? Math.floor((last.demand_units * 10_000) / last.capacity_units) : 0;
  return {
    capacityUnits: Math.floor((base * mods.energyCapacityBps) / 10_000), baseCapacityUnits: base, demandUnits: last?.demand_units ?? 0, suppliedUnits: last?.supplied_units ?? 0, shortageUnits: last?.shortage_units ?? 0, utilisationBps: last?.utilisation_bps ?? 0,
    tariffMinor: last?.tariff_minor ?? baseTariff, baseTariffMinor: baseTariff, surchargeBps: tariffSurchargeBps(cfg, load),
    history: db.all<{ tick: number; capacity_units: number; demand_units: number; shortage_units: number; tariff_minor: number }>('SELECT * FROM energy_daily ORDER BY tick DESC LIMIT 30').reverse().map((r) => ({ tick: r.tick, capacity: r.capacity_units, demand: r.demand_units, shortage: r.shortage_units, tariff: r.tariff_minor })),
    sources: db.all<{ id: string; name: string; capacity_units: number; company_id: string }>('SELECT * FROM energy_sources WHERE active = 1 ORDER BY id').map((s) => ({ id: s.id, name: s.name, capacityUnits: s.capacity_units, companyId: s.company_id })),
  };
}
