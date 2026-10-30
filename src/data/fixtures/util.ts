import type { History, Money } from '@/contracts/game-state';

/** Fixed clock so fixture output is deterministic. */
export const FIXTURE_NOW = '2026-10-28T16:32:00.000Z';
export const FIXTURE_NEXT_TICK = '2026-10-28T16:33:00.000Z';

export const ec = (units: number, minor = 0): Money => ({ currency: 'EC', minor: units * 100 + minor });
export const gbp = (pence: number): Money => ({ currency: 'GBP_TEST', minor: pence });

const DAY = 86_400_000;
/** Builds a daily history ending on FIXTURE_NOW's day. `null` entries are *missing observations* (gaps), not zeros. */
export function dailySeries(currency: Money['currency'], valuesMinor: (number | null)[]): History {
  const end = Date.parse('2026-10-28T00:00:00.000Z');
  const points = valuesMinor.flatMap((v, i) => (v === null ? [] : [{ at: new Date(end - (valuesMinor.length - 1 - i) * DAY).toISOString(), valueMinor: v }]));
  return { currency, interval: 'day', points, complete: !valuesMinor.includes(null) };
}

export const ecDays = (unitsPerDay: (number | null)[]) => dailySeries('EC', unitsPerDay.map((u) => (u === null ? null : Math.round(u * 100))));
