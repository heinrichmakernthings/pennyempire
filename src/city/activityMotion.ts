import type { CompanyActivity } from '@/shared/living';
import type { ActorPose, Direction } from './actorRig';

export const MAX_ACTIVITY_AGE_MS = 20_000;
export const MAX_ACTORS = 7;
export const WORKER_BY_INDUSTRY: Record<string, string> = { farm: 'farm-worker', mill: 'mill-worker', dairy: 'dairy-worker', pizza: 'pizza-chef', cafe: 'barista', timber: 'timber-worker' };
export function activityIsFresh(receivedAt: number | undefined, now: number): boolean {
  return receivedAt !== undefined && Number.isFinite(receivedAt) && now >= receivedAt && now - receivedAt <= MAX_ACTIVITY_AGE_MS;
}
export function activityCounts(a: CompanyActivity | undefined, fresh: boolean) {
  const count = (v: number, max: number) => Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0;
  if (!fresh || !a || a.state === 'closed' || a.state === 'construction') return { customers: 0, workers: 0, vans: 0, working: false };
  return { customers: count(a.customers, 4), workers: count(a.workers, 3), vans: count(a.vans, 2), working: a.productionActive === true };
}
/** A bounded pavement stroll representing recorded footfall, not an individual purchase simulation. */
export function customerMotion(index: number, elapsed: number, reduced: boolean): { dx: number; dy: number; direction: Direction; pose: ActorPose; frame: number } {
  if (reduced) return { dx: index * 14 - 24, dy: 8 + index * 3, direction: 'sw', pose: 'idle', frame: 0 };
  const t = ((elapsed + index * 1400) % 9600 + 9600) % 9600;
  const outbound = t < 4000, waiting = t >= 4000 && t < 4800 || t >= 8800;
  const progress = outbound ? t / 4000 : t < 4800 ? 1 : t < 8800 ? 1 - (t - 4800) / 4000 : 0;
  return { dx: -48 + progress * 64, dy: 8 + progress * 32 + index * 3, direction: outbound ? 'se' : 'nw', pose: waiting ? 'idle' : 'walk', frame: Math.floor(t / 160) % 4 };
}

/** One replay per new server day. Initial history and reconnect backlogs are deliberately not animated. */
export class DeliveryReplay {
  private tick: number | null = null;
  private started = new Map<string, number>();
  accept(tick: number, items: Map<string, CompanyActivity>, now: number) {
    if (!Number.isSafeInteger(tick) || tick < 0) return;
    if (this.tick === null || tick < this.tick) { this.tick = tick; this.started.clear(); return; }
    if (tick === this.tick) return;
    const contiguous = tick === this.tick + 1;
    this.tick = tick; this.started.clear();
    if (contiguous) for (const [id, a] of items) if (a.vans > 0 && a.state !== 'closed' && a.state !== 'construction') this.started.set(id, now);
  }
  sample(id: string, now: number) {
    const start = this.started.get(id); if (start === undefined) return null;
    const elapsed = Math.max(0, now - start);
    if (elapsed >= 6000) { this.started.delete(id); return null; }
    return { stage: elapsed < 1800 ? 'arrive' : elapsed < 4200 ? 'unload' : 'depart', elapsed,
      dx: elapsed < 1800 ? 100 * (1 - elapsed / 1800) : elapsed < 4200 ? 0 : -100 * ((elapsed - 4200) / 1800) };
  }
}
