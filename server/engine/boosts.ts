import type { Sql } from '../db/sql';
import { LedgerError, available, destroy, type TickCtx } from './ledger';

/**
 * Gameplay boosts: small, priced, disclosed and temporary. They change real calculations (production output in the tick, marketing effectiveness in the awareness
 * update). Rules that keep them fair: they expire; boosts of the same kind never ADD (the strongest active one applies) and are capped at `MAX_BOOST_BPS`; a purchased boost
 * cannot be re-bought while it is active; nothing here touches GBP, prizes or leaderboards that pay cash. Bought with Empire Coins (burned, an explicit sink).
 */
export type BoostKind = 'production' | 'marketing';
export const MAX_BOOST_BPS = 1_000;
export interface BoostOffer { id: string; kind: BoostKind; label: string; bps: number; days: number; priceMinor: number; description: string }
export const BOOST_OFFERS: BoostOffer[] = [
  { id: 'boost-production-3', kind: 'production', label: 'Production efficiency +3%', bps: 300, days: 7, priceMinor: 60_000, description: 'About 3% extra output from every production line of your companies for 7 game days (fractions accumulate, so a small shop gains a unit every few days). Needs staff, inputs and storage room like normal output.' },
  { id: 'boost-marketing-5', kind: 'marketing', label: 'Marketing effectiveness +5%', bps: 500, days: 7, priceMinor: 40_000, description: 'Your advertising counts 5% more towards awareness for 7 game days. Awareness still has its hard ceiling.' },
];
const offer = (id: string) => BOOST_OFFERS.find((o) => o.id === id);

export interface ActiveBoost { id: number; kind: BoostKind; bps: number; startTick: number; endTick: number; source: string; carry: number }
const rows = (db: Sql, owner: string, tick: number) => db.all<{ id: number; kind: BoostKind; bps: number; start_tick: number; end_tick: number; source: string; carry: number }>('SELECT * FROM boosts WHERE owner_id = ? AND start_tick <= ? AND end_tick > ? ORDER BY bps DESC, id', owner, tick, tick);
export function activeBoosts(db: Sql, owner: string, tick: number): ActiveBoost[] { return rows(db, owner, tick).map((b) => ({ id: b.id, kind: b.kind, bps: b.bps, startTick: b.start_tick, endTick: b.end_tick, source: b.source, carry: b.carry })); }
/** The boost that applies right now for a kind: the strongest one, capped. Overlapping boosts never add. */
export function effectiveBoost(db: Sql, owner: string, kind: BoostKind, tick: number): { id: number; bps: number; carry: number } | null {
  const b = rows(db, owner, tick).find((x) => x.kind === kind); return b ? { id: b.id, bps: Math.min(MAX_BOOST_BPS, b.bps), carry: b.carry } : null;
}

export function buyBoost(db: Sql, ctx: TickCtx, a: { ownerId: string; offerId: string; key: string }): { boostId: number; endTick: number; duplicate: boolean } {
  return db.transaction(() => {
    const dup = db.get<{ id: number; end_tick: number }>('SELECT id, end_tick FROM boosts WHERE idempotency_key = ?', a.key); if (dup) return { boostId: dup.id, endTick: dup.end_tick, duplicate: true };
    const o = offer(a.offerId); if (!o) throw new LedgerError('FORBIDDEN', 'Unknown boost.');
    const wallet = db.get<{ w: string }>('SELECT wallet_account_id w FROM players WHERE id = ?', a.ownerId)?.w; if (!wallet) throw new LedgerError('FORBIDDEN', 'Unknown player.');
    const live = db.get<{ end_tick: number }>("SELECT end_tick FROM boosts WHERE owner_id = ? AND kind = ? AND source = 'purchase' AND end_tick > ? ORDER BY end_tick DESC LIMIT 1", a.ownerId, o.kind, ctx.tick);
    if (live) throw new LedgerError('FORBIDDEN', `${o.label} is already active until day ${live.end_tick}. Boosts do not stack.`);
    if (available(db, wallet) < o.priceMinor) throw new LedgerError('INSUFFICIENT_FUNDS', `This costs ${(o.priceMinor / 100).toLocaleString('en-GB')} EC.`);
    destroy(db, ctx, `boost:${a.key}`, wallet, o.priceMinor, `${o.label} (explicit sink)`);
    const r = db.run("INSERT INTO boosts (owner_id, kind, bps, start_tick, end_tick, source, price_minor, idempotency_key) VALUES (?,?,?,?,?,'purchase',?,?)", a.ownerId, o.kind, o.bps, ctx.tick, ctx.tick + o.days, o.priceMinor, a.key);
    return { boostId: Number(r.lastInsertRowid), endTick: ctx.tick + o.days, duplicate: false };
  });
}
/** A boost earned (not bought), e.g. from a rewarded ad. Same non-stacking rule: a strictly stronger or longer window is needed to matter, and the cap still applies. */
export function grantBoost(db: Sql, ctx: TickCtx, a: { ownerId: string; kind: BoostKind; bps: number; days: number; source: 'rewarded_ad' | 'membership'; key: string }): number {
  const dup = db.get<{ id: number }>('SELECT id FROM boosts WHERE idempotency_key = ?', a.key); if (dup) return dup.id;
  const r = db.run('INSERT INTO boosts (owner_id, kind, bps, start_tick, end_tick, source, idempotency_key) VALUES (?,?,?,?,?,?,?)', a.ownerId, a.kind, Math.min(MAX_BOOST_BPS, a.bps), ctx.tick, ctx.tick + a.days, a.source, a.key);
  return Number(r.lastInsertRowid);
}
/** Production boost for one line today: whole extra units, with the fraction carried so small shops still benefit. Returns the extra units (bounded by free storage). */
export function productionExtra(db: Sql, owner: string, tick: number, outputUnits: number, freeRoom: number): number {
  const b = effectiveBoost(db, owner, 'production', tick); if (!b || outputUnits <= 0 || freeRoom <= 0) return 0;
  const raw = outputUnits * b.bps + b.carry; const extra = Math.min(Math.floor(raw / 10_000), freeRoom);
  db.run('UPDATE boosts SET carry = ? WHERE id = ?', raw - extra * 10_000, b.id);
  return extra;
}
export const marketingFactorBps = (db: Sql, owner: string, tick: number) => 10_000 + (effectiveBoost(db, owner, 'marketing', tick)?.bps ?? 0);
