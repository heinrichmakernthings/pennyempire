import type { Sql } from '../db/sql';
import { loadConfig, saveConfig, validateConfig, type EngineConfig } from './config';
import { cancelEvent, createEvent, EVENT_DEFS } from './events';
import { logPolicy } from './centralBank';
import { logEvent } from './stats';
import { LedgerError, type TickCtx } from './ledger';

/**
 * Permission-controlled economic administration. Three layers, none optional:
 *  1. the HTTP layer only reaches this module when the request carries the server's admin token (unset token = administration disabled);
 *  2. only WHITELISTED economic parameters can be changed, each within hard bounds; there is deliberately no way to edit a balance, an inventory or a ledger entry;
 *  3. every attempt — allowed or refused — is written to `admin_log` with actor, action, detail and outcome, and config changes are versioned (`config_versions`).
 */
export const ADMIN_PARAMS: Partial<Record<keyof EngineConfig, [number, number]>> = {
  exchangeFeeBps: [0, 500], exchangeBurnBps: [0, 10_000], stateServiceBurnBps: [0, 1_000], shareFeeBps: [0, 500],
  energyCapacityPerThousandPop: [1, 40], energyTariffLoadStartBps: [3_000, 10_000], energyTariffMaxSurchargeBps: [0, 20_000],
  propertyServiceChargeBps: [0, 3_000], propertyOwnedRatesBps: [0, 10_000], logisticsBaseFeeMinor: [0, 1_000], logisticsRatePerUnitMinor: [0, 50], logisticsPerTileBps: [0, 2_000], logisticsCapacityUnits: [100, 100_000], logisticsMaxFeeBps: [0, 5_000],
  loanMaxMinor: [0, 5_000_000], loanOriginationFeeBps: [0, 1_000], loanLateFeeBps: [0, 1_000], loanDefaultAfterMisses: [2, 30], loanMaxActive: [1, 10], creditSpreadABps: [0, 1_000], creditSpreadBBps: [0, 1_500], creditSpreadCBps: [0, 2_500], depositSpreadBps: [0, 1_000],
  cbTargetBps: [0, 1_000], cbReviewEveryTicks: [3, 90], cbRateStepBps: [5, 200], cbRateMaxBps: [100, 5_000], cbBandBps: [10, 500], cbReserveReqBps: [0, 5_000], cbLiquidityStepMinor: [0, 1_000_000], cbDrainStepMinor: [0, 1_000_000],
  eventsEnabled: [0, 1], eventsStartTick: [0, 1_000], eventCheckEveryTicks: [1, 30], eventMaxActive: [0, 4], eventCooldownTicks: [0, 200], eventProbabilityScaleBps: [0, 30_000],
  stateBurnBps: [0, 2_000], corporationTaxBps: [0, 5_000], awarenessMaxBps: [0, 6_000],
};

export interface AdminResult { ok: boolean; message: string; detail?: unknown }
const timingSafeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
export function authorised(token: string | undefined, expected: string | undefined): boolean { return !!expected && expected.length >= 12 && !!token && timingSafeEqual(token, expected); }

const tickOf = (db: Sql) => db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
function logAdmin(db: Sql, actor: string, action: string, detail: unknown, ok: boolean) { db.run('INSERT INTO admin_log (tick, actor, action, detail_json, ok) VALUES (?,?,?,?,?)', tickOf(db), actor, action, JSON.stringify(detail), ok ? 1 : 0); }
export function logDenied(db: Sql, action: string, detail: unknown) { logAdmin(db, 'unauthenticated', action, detail, false); }

export function setParam(db: Sql, actor: string, key: string, value: number, reason: string): AdminResult {
  const bounds = ADMIN_PARAMS[key as keyof EngineConfig];
  const detail = { key, value, reason };
  if (!bounds) { logAdmin(db, actor, 'param.set', { ...detail, refused: 'not an adjustable economic parameter' }, false); return { ok: false, message: `${key} is not an adjustable economic parameter.` }; }
  if (!Number.isSafeInteger(value) || value < bounds[0] || value > bounds[1]) { logAdmin(db, actor, 'param.set', { ...detail, refused: `outside ${bounds[0]}..${bounds[1]}` }, false); return { ok: false, message: `${key} must be a whole number between ${bounds[0]} and ${bounds[1]}.` }; }
  if (!reason || reason.length < 5) { logAdmin(db, actor, 'param.set', { ...detail, refused: 'reason required' }, false); return { ok: false, message: 'A reason (5+ characters) is required.' }; }
  const cfg = loadConfig(db); const old = cfg[key as keyof EngineConfig];
  const next = { ...cfg, [key]: value } as EngineConfig; const errs = validateConfig(next);
  if (errs.length) { logAdmin(db, actor, 'param.set', { ...detail, refused: errs }, false); return { ok: false, message: errs.join('; ') }; }
  saveConfig(db, next, `admin ${actor}: ${key} ${String(old)} → ${value} (${reason})`);
  logAdmin(db, actor, 'param.set', { ...detail, old }, true);
  return { ok: true, message: `${key}: ${String(old)} → ${value}`, detail: { old, value } };
}

/** Manual base-rate change by an administrator: bounded, reasoned, and recorded in the central bank's own policy log next to the rule-based decisions. */
export function setBaseRate(db: Sql, actor: string, rateBps: number, reason: string): AdminResult {
  const cfg = loadConfig(db);
  if (!Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > cfg.cbRateMaxBps) { logAdmin(db, actor, 'cb.rate', { rateBps, refused: 'out of range' }, false); return { ok: false, message: `The base rate must be 0–${cfg.cbRateMaxBps} bps.` }; }
  if (!reason || reason.length < 5) { logAdmin(db, actor, 'cb.rate', { rateBps, refused: 'reason required' }, false); return { ok: false, message: 'A reason (5+ characters) is required.' }; }
  const old = db.get<{ r: number }>('SELECT base_rate_bps r FROM central_bank WHERE id = 1')!.r;
  db.run("UPDATE central_bank SET base_rate_bps = ?, stance = ? WHERE id = 1", rateBps, rateBps > old ? 'tightening' : rateBps < old ? 'easing' : 'neutral');
  logPolicy(db, tickOf(db), `admin:${actor}`, 'base_rate', old, rateBps, reason);
  logEvent(db, tickOf(db) + 1, 'rate_decision', 'info', null, `Penny Central Bank ${rateBps > old ? 'raised' : 'cut'} the base rate to ${(rateBps / 100).toFixed(2)}% from ${(old / 100).toFixed(2)}% (${reason}).`, { from: old, to: rateBps, actor: 'admin' });
  logAdmin(db, actor, 'cb.rate', { old, rateBps, reason }, true);
  return { ok: true, message: `Base rate ${old} → ${rateBps} bps`, detail: { old, rateBps } };
}

export function triggerEvent(db: Sql, actor: string, type: string, severity: number, days: number | undefined, reason: string): AdminResult {
  const def = EVENT_DEFS.find((d) => d.type === type);
  if (!def) { logAdmin(db, actor, 'event.trigger', { type, refused: 'unknown type' }, false); return { ok: false, message: `Unknown event type ${type}.` }; }
  if (![1, 2, 3].includes(severity)) { logAdmin(db, actor, 'event.trigger', { type, severity, refused: 'severity' }, false); return { ok: false, message: 'Severity must be 1, 2 or 3.' }; }
  const d = days ?? def.baseDays + def.perSeverityDays * severity;
  if (!Number.isSafeInteger(d) || d < 1 || d > 60) { logAdmin(db, actor, 'event.trigger', { type, days: d, refused: 'days' }, false); return { ok: false, message: 'Duration must be 1–60 days.' }; }
  if (!reason || reason.length < 5) { logAdmin(db, actor, 'event.trigger', { type, refused: 'reason required' }, false); return { ok: false, message: 'A reason (5+ characters) is required.' }; }
  const active = db.get<{ n: number }>("SELECT COUNT(*) n FROM eco_events WHERE status = 'active' AND type = ?", type)!.n;
  if (active) { logAdmin(db, actor, 'event.trigger', { type, refused: 'already active' }, false); return { ok: false, message: `${def.label} is already active.` }; }
  const tick = tickOf(db) + 1; const ctx: TickCtx = { tick, gameDate: 'admin', actor: `admin:${actor}` };   // takes effect (and is reported) with the NEXT tick
  const id = createEvent(db, ctx, def, severity, d, 'admin', null);
  logAdmin(db, actor, 'event.trigger', { id, type, severity, days: d, reason }, true);
  return { ok: true, message: `Started ${def.label} (${id}). Its effects apply from the next tick; the Penny Post reports it.`, detail: { id } };
}
export function cancelEventAdmin(db: Sql, actor: string, eventId: string, reason: string): AdminResult {
  try { cancelEvent(db, { tick: tickOf(db), gameDate: 'admin', actor: `admin:${actor}` }, eventId, actor); } catch (e) { if (e instanceof LedgerError) { logAdmin(db, actor, 'event.cancel', { eventId, refused: e.message }, false); return { ok: false, message: e.message }; } throw e; }
  logAdmin(db, actor, 'event.cancel', { eventId, reason }, true);
  return { ok: true, message: `Cancelled ${eventId}.` };
}
export function setCentralBankRule(db: Sql, actor: string, enabled: boolean, reason: string): AdminResult {
  if (!reason || reason.length < 5) { logAdmin(db, actor, 'cb.rule', { enabled, refused: 'reason required' }, false); return { ok: false, message: 'A reason (5+ characters) is required.' }; }
  db.run('UPDATE central_bank SET rule_enabled = ? WHERE id = 1', enabled ? 1 : 0);
  logPolicy(db, tickOf(db), `admin:${actor}`, 'rule_enabled', enabled ? 0 : 1, enabled ? 1 : 0, reason);
  logAdmin(db, actor, 'cb.rule', { enabled, reason }, true);
  return { ok: true, message: `Central bank rule ${enabled ? 'enabled' : 'disabled'}.` };
}
export const adminLog = (db: Sql, limit = 50) => db.all<{ id: number; tick: number; actor: string; action: string; detail_json: string; ok: number }>('SELECT * FROM admin_log ORDER BY id DESC LIMIT ?', limit).map((r) => ({ id: r.id, tick: r.tick, actor: r.actor, action: r.action, detail: JSON.parse(r.detail_json), ok: r.ok === 1 }));
