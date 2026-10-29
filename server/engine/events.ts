import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { storeMods, type Mods } from './economyState';
import { inflationBps } from './inflation';
import { LedgerError, available, transfer, type TickCtx } from './ledger';
import { logEvent } from './stats';

/**
 * Economic event engine. Server-authoritative, deterministic and auditable:
 *  • EVENTS ARE RULES, NOT RIGGING. Each event changes a published fundamental (energy capacity or price, delivery delays, rents, credit spreads, a demand shift, an industry's output)
 *    for a fixed time. It never sets a price, never targets a player, never touches a balance. Prices still emerge from trading under the changed fundamentals.
 *  • DETERMINISTIC. Whether an event starts is a pure function of (tick, config seed): an integer hash, no clock, no Math.random. The same world replays the same events.
 *  • DERIVED, NEVER ACCUMULATED. Each day the modifiers are recomputed from the list of ACTIVE events' stored effects, so applying an event twice or re-running a tick cannot stack.
 *  • ONE-SHOT EFFECTS (government stimulus: a treasury payment to households; corporate scandal: a public reputation hit to one NPC-controlled company) happen exactly once
 *    (`one_shot_done`), are announced, and a scandal can never target a human player's company.
 */
export type EventType = 'consumer_boom' | 'recession' | 'inflation_shock' | 'energy_shortage' | 'agricultural_disruption' | 'construction_boom' | 'supply_chain_disruption' | 'tourism_surge' | 'advertising_boom' | 'credit_crunch' | 'corporate_scandal' | 'government_stimulus';
export interface EventDef {
  type: EventType; label: string; weight: number; baseDays: number; perSeverityDays: number; industries: string[];
  effects: (sev: number) => Partial<Mods>; headline: (sev: number) => string; what: (sev: number) => string[];
  allowed?: (db: Sql, active: ActiveEvent[]) => boolean;
}
export interface ActiveEvent { id: string; type: EventType; severity: number; start_tick: number; end_tick: number; location_id: string; industries_json: string; effects_json: string; headline: string; one_shot_done: number; trigger_kind: string; status: string }
const SEV = ['mild', 'serious', 'severe'];
const pct = (bps: number) => `${(bps / 100).toFixed(0)}%`;
const none = (active: ActiveEvent[], ...t: EventType[]) => !active.some((a) => t.includes(a.type));

export const EVENT_DEFS: EventDef[] = [
  { type: 'consumer_boom', label: 'Consumer spending boom', weight: 10, baseDays: 8, perSeverityDays: 4, industries: ['pizza', 'cafe'], effects: (s) => ({ demandShockBps: -300 * s }), headline: (s) => `Bristol shoppers open their wallets (${SEV[s - 1]} spending boom)`, what: (s) => [`Household spending budgets +${pct(300 * s)}`], allowed: (_d, a) => none(a, 'consumer_boom', 'recession') },
  { type: 'recession', label: 'Recession', weight: 8, baseDays: 18, perSeverityDays: 8, industries: ['pizza', 'cafe'], effects: (s) => ({ demandShockBps: 400 * s, creditSpreadBps: 40 * s }), headline: (s) => `Bristol slips into recession (${SEV[s - 1]})`, what: (s) => [`Household spending budgets −${pct(400 * s)}`, `Credit spreads +${40 * s / 100}%`], allowed: (_d, a) => none(a, 'recession', 'consumer_boom', 'tourism_surge') },
  { type: 'inflation_shock', label: 'Inflation shock', weight: 6, baseDays: 14, perSeverityDays: 6, industries: [], effects: (s) => ({ energyPriceBps: 10_000 + 600 * s, rentBps: 10_000 + 400 * s, logisticsFeeBps: 10_000 + 800 * s }), headline: (s) => `Prices jump across the city (${SEV[s - 1]} inflation shock)`, what: (s) => [`Electricity +${pct(600 * s)}`, `Commercial rents +${pct(400 * s)}`, `Delivery fees +${pct(800 * s)}`], allowed: (db, a) => none(a, 'inflation_shock') && inflationBps(db) < 400 },
  { type: 'energy_shortage', label: 'Energy shortage', weight: 7, baseDays: 8, perSeverityDays: 4, industries: ['mill', 'dairy', 'pizza', 'cafe', 'farm', 'timber'], effects: (s) => ({ energyCapacityBps: 10_000 - 1_500 * s - 1_000, energyPriceBps: 10_000 + 1_500 * s }), headline: (s) => `Energy crisis: Penny Energy cuts supply (${SEV[s - 1]})`, what: (s) => [`Grid capacity −${pct(1_500 * s + 1_000)}`, `Electricity tariff +${pct(1_500 * s)}`], allowed: (_d, a) => none(a, 'energy_shortage') },
  { type: 'agricultural_disruption', label: 'Agricultural disruption', weight: 6, baseDays: 8, perSeverityDays: 4, industries: ['farm', 'dairy'], effects: (s) => ({ productionByIndustry: { farm: 10_000 - 1_500 * s, dairy: 10_000 - 1_000 * s } }), headline: (s) => `Bad weather hits Bristol's farms (${SEV[s - 1]} disruption)`, what: (s) => [`Farm output −${pct(1_500 * s)}`, `Dairy output −${pct(1_000 * s)}`], allowed: (_d, a) => none(a, 'agricultural_disruption') },
  { type: 'construction_boom', label: 'Construction boom', weight: 6, baseDays: 12, perSeverityDays: 5, industries: ['timber'], effects: (s) => ({ demandByCommodity: { timber: 10_000 + 1_500 * s }, rentBps: 10_000 + 300 * s }), headline: (s) => `Cranes over Bristol: construction boom (${SEV[s - 1]})`, what: (s) => [`Timber demand +${pct(1_500 * s)}`, `Commercial rents +${pct(300 * s)}`], allowed: (_d, a) => none(a, 'construction_boom') },
  { type: 'supply_chain_disruption', label: 'Supply-chain disruption', weight: 7, baseDays: 7, perSeverityDays: 3, industries: [], effects: (s) => ({ logisticsDelayTicks: s >= 3 ? 2 : 1, logisticsCapacityBps: 10_000 - 1_500 * s, logisticsFeeBps: 10_000 + 1_000 * s }), headline: (s) => `Deliveries delayed across the city (${SEV[s - 1]} supply-chain disruption)`, what: (s) => [`Deliveries arrive ${s >= 3 ? 2 : 1} day(s) late`, `Logistics capacity −${pct(1_500 * s)}`, `Delivery fees +${pct(1_000 * s)}`], allowed: (_d, a) => none(a, 'supply_chain_disruption') },
  { type: 'tourism_surge', label: 'Tourism surge', weight: 7, baseDays: 8, perSeverityDays: 4, industries: ['pizza', 'cafe'], effects: (s) => ({ demandByCommodity: { pizza: 10_000 + 1_000 * s, 'cafe-drink': 10_000 + 1_500 * s } }), headline: (s) => `Visitors flood the harbourside (${SEV[s - 1]} tourism surge)`, what: (s) => [`Pizza demand +${pct(1_000 * s)}`, `Café-drink demand +${pct(1_500 * s)}`], allowed: (_d, a) => none(a, 'tourism_surge', 'recession') },
  { type: 'advertising_boom', label: 'Advertising boom', weight: 5, baseDays: 10, perSeverityDays: 4, industries: [], effects: (s) => ({ adCostBps: 10_000 + 1_000 * s, adReachBps: 10_000 + 1_000 * s }), headline: (s) => `Advertising boom: screens are busier, and dearer (${SEV[s - 1]})`, what: (s) => [`Campaign prices +${pct(1_000 * s)}`, `Campaign reach +${pct(1_000 * s)}`], allowed: (_d, a) => none(a, 'advertising_boom') },
  { type: 'credit_crunch', label: 'Banking credit crunch', weight: 5, baseDays: 14, perSeverityDays: 7, industries: [], effects: (s) => ({ creditSpreadBps: 100 * s, creditLimitBps: 10_000 - 2_000 * s }), headline: (s) => `Banks tighten lending (${SEV[s - 1]} credit crunch)`, what: (s) => [`Loan spreads +${s}%`, `Credit limits −${pct(2_000 * s)}`], allowed: (_d, a) => none(a, 'credit_crunch') },
  { type: 'corporate_scandal', label: 'Corporate scandal', weight: 4, baseDays: 10, perSeverityDays: 5, industries: [], effects: () => ({}), headline: (s) => `Scandal rocks a Bristol firm (${SEV[s - 1]})`, what: (s) => [`The named company's reputation −${pct(600 * s)} (public, once)`], allowed: (db) => scandalTarget(db) !== null },
  { type: 'government_stimulus', label: 'Government stimulus', weight: 4, baseDays: 6, perSeverityDays: 3, industries: [], effects: (s) => ({ demandShockBps: -200 * s }), headline: (s) => `Government stimulus: the Treasury pays households (${SEV[s - 1]})`, what: (s) => [`Treasury pays ${5 * s}% of its balance to households (a transfer, not new money)`, `Spending budgets +${pct(200 * s)}`], allowed: (_d, a) => none(a, 'government_stimulus') },
];
const defOf = (t: string) => EVENT_DEFS.find((d) => d.type === t)!;

/** Deterministic 32-bit mix (integer only). */
export function hash32(a: number, b: number): number {
  let h = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return h >>> 0;
}
const seedOf = (db: Sql) => Number(db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'event_seed'")?.value ?? 1);

/** A scandal may only hit an NPC-controlled, listed, operating company: never a human player's. Deterministic: the one with the highest recent revenue. */
function scandalTarget(db: Sql): { id: string; name: string } | null {
  return db.get<{ id: string; name: string }>("SELECT c.id, c.name FROM companies c LEFT JOIN company_tick_stats t ON t.company_id = c.id AND t.tick > (SELECT last_tick FROM engine_state) - 7 WHERE c.owner_kind = 'npc' AND c.status = 'operating' AND c.retail_commodity_id IS NOT NULL GROUP BY c.id ORDER BY SUM(COALESCE(t.revenue_minor,0)) DESC, c.id LIMIT 1") ?? null;
}

export function createEvent(db: Sql, ctx: TickCtx, def: EventDef, severity: number, days: number, kind: 'random' | 'admin' | 'scheduled', roll: number | null): string {
  const n = db.get<{ n: number }>('SELECT COUNT(*) n FROM eco_events')!.n + 1;
  const id = `evt-${ctx.tick}-${n}`;
  const effects = def.effects(severity);
  db.run("INSERT INTO eco_events (id, type, location_id, industries_json, severity, start_tick, end_tick, status, trigger_kind, roll, effects_json, headline, created_tick) VALUES (?,?,?,?,?,?,?,'active',?,?,?,?,?)",
    id, def.type, 'city-bristol', JSON.stringify(def.industries), severity, ctx.tick, ctx.tick + days, kind, roll, JSON.stringify(effects), def.headline(severity), ctx.tick);
  db.run("INSERT INTO eco_event_log (tick, event_id, action, detail_json) VALUES (?,?,'start',?)", ctx.tick, id, JSON.stringify({ type: def.type, severity, days, effects, what: def.what(severity), trigger: kind, roll }));
  logEvent(db, ctx.tick, 'eco_event_start', severity >= 3 ? 'error' : 'warning', null, `${def.headline(severity)}. ${def.what(severity).join('; ')}. Lasts ${days} days.`, { eventId: id, type: def.type, severity, days });
  return id;
}

/**
 * Start-of-day event step. Order: end expired events → maybe start a new one (checks only every `eventCheckEveryTicks` days, after `eventsStartTick`) → apply one-shots once →
 * derive today's modifiers from the active events.
 */
export function runEvents(db: Sql, ctx: TickCtx, cfg: EngineConfig): Mods {
  for (const e of db.all<ActiveEvent>("SELECT * FROM eco_events WHERE status = 'active' AND end_tick <= ? ORDER BY id", ctx.tick)) {
    db.run("UPDATE eco_events SET status = 'ended' WHERE id = ?", e.id);
    db.run("INSERT INTO eco_event_log (tick, event_id, action, detail_json) VALUES (?,?,'end','{}')", ctx.tick, e.id);
    logEvent(db, ctx.tick, 'eco_event_end', 'info', null, `Over: ${defOf(e.type).label.toLowerCase()} (${SEV[e.severity - 1]}) ended after ${e.end_tick - e.start_tick} days`, { eventId: e.id, type: e.type });
  }
  let active = db.all<ActiveEvent>("SELECT * FROM eco_events WHERE status = 'active' ORDER BY id");
  const created = db.get<{ n: number }>('SELECT COUNT(*) n FROM eco_events WHERE created_tick = ?', ctx.tick)!.n;
  if (cfg.eventsEnabled === 1 && ctx.tick >= cfg.eventsStartTick && ctx.tick % cfg.eventCheckEveryTicks === 0 && active.length < cfg.eventMaxActive && created === 0) {
    const h = hash32(ctx.tick, seedOf(db));
    const roll = h % 10_000;
    if (roll < Math.floor((1_800 * cfg.eventProbabilityScaleBps) / 10_000)) {
      const eligible = EVENT_DEFS.filter((d) => (d.allowed?.(db, active) ?? true) && !db.get('SELECT 1 FROM eco_events WHERE type = ? AND end_tick > ?', d.type, ctx.tick - cfg.eventCooldownTicks));
      const total = eligible.reduce((a, d) => a + d.weight, 0);
      if (total > 0) {
        let pick = hash32(h, 7) % total, def = eligible[0]!;
        for (const d of eligible) { if (pick < d.weight) { def = d; break; } pick -= d.weight; }
        const sr = hash32(h, 13) % 100, severity = sr < 60 ? 1 : sr < 90 ? 2 : 3;
        createEvent(db, ctx, def, severity, def.baseDays + def.perSeverityDays * severity, 'random', roll);
        active = db.all<ActiveEvent>("SELECT * FROM eco_events WHERE status = 'active' ORDER BY id");
      }
    }
  }
  for (const e of active) if (!e.one_shot_done) { applyOneShot(db, ctx, e); db.run('UPDATE eco_events SET one_shot_done = 1 WHERE id = ? AND one_shot_done = 0', e.id); }
  const parts = active.filter((e) => e.start_tick <= ctx.tick).map((e) => JSON.parse(e.effects_json) as Partial<Mods>);
  return storeMods(db, ctx.tick, parts, active.map((e) => ({ id: e.id, type: e.type, severity: e.severity, endTick: e.end_tick })));
}

function applyOneShot(db: Sql, ctx: TickCtx, e: ActiveEvent) {
  if (e.type === 'government_stimulus') {
    const city = db.get<{ treasury_account_id: string; households_account_id: string }>('SELECT treasury_account_id, households_account_id FROM cities LIMIT 1')!;
    const amt = Math.floor((available(db, city.treasury_account_id) * 5 * e.severity) / 100);
    if (amt > 0) {
      const tx = transfer(db, ctx, `event:${e.id}:stimulus`, city.treasury_account_id, city.households_account_id, amt, 'state_payment', `government stimulus payment to households (${e.id})`);
      db.run("INSERT INTO eco_event_log (tick, event_id, action, detail_json, ledger_tx_id) VALUES (?,?,'one_shot',?,?)", ctx.tick, e.id, JSON.stringify({ stimulusMinor: amt, kind: 'transfer' }), tx.txId);
      logEvent(db, ctx.tick, 'stimulus_paid', 'info', null, `The Treasury paid ${(amt / 100).toFixed(2)} EC to Bristol households as stimulus (a transfer from the treasury, no new money)`, { eventId: e.id, amountMinor: amt });
    }
  } else if (e.type === 'corporate_scandal') {
    const t = scandalTarget(db);
    if (t) {
      const hit = 600 * e.severity;
      db.run('UPDATE companies SET reputation_bps = MAX(1000, reputation_bps - ?) WHERE id = ?', hit, t.id);
      db.run("INSERT INTO eco_event_log (tick, event_id, action, detail_json) VALUES (?,?,'one_shot',?)", ctx.tick, e.id, JSON.stringify({ companyId: t.id, reputationHitBps: hit, rule: 'highest recent revenue among NPC-controlled shops; players are never targeted' }));
      db.run('UPDATE eco_events SET headline = ? WHERE id = ?', `Scandal at ${t.name}: customers lose trust (${SEV[e.severity - 1]})`, e.id);
      logEvent(db, ctx.tick, 'eco_scandal', 'warning', t.id, `Scandal at ${t.name}: its reputation falls by ${hit / 100} points`, { eventId: e.id, reputationHitBps: hit });
    }
  }
}

export function cancelEvent(db: Sql, ctx: TickCtx, eventId: string, actor: string) {
  const r = db.run("UPDATE eco_events SET status = 'cancelled', end_tick = ? WHERE id = ? AND status = 'active'", ctx.tick, eventId);
  if (r.changes !== 1) throw new LedgerError('FORBIDDEN', 'No active event with that id.');
  db.run("INSERT INTO eco_event_log (tick, event_id, action, detail_json) VALUES (?,?,'cancel',?)", ctx.tick, eventId, JSON.stringify({ actor }));
}

export interface EventView { id: string; type: string; label: string; severity: number; startTick: number; endTick: number; status: string; headline: string; industries: string[]; effects: string[]; trigger: string; roll: number | null }
export function listEvents(db: Sql, limit = 40): EventView[] {
  return db.all<{ id: string; type: string; severity: number; start_tick: number; end_tick: number; status: string; headline: string; industries_json: string; trigger_kind: string; roll: number | null }>('SELECT * FROM eco_events ORDER BY created_tick DESC, id DESC LIMIT ?', limit)
    .map((e) => ({ id: e.id, type: e.type, label: defOf(e.type).label, severity: e.severity, startTick: e.start_tick, endTick: e.end_tick, status: e.status, headline: e.headline, industries: JSON.parse(e.industries_json) as string[], effects: defOf(e.type).what(e.severity), trigger: e.trigger_kind, roll: e.roll }));
}
