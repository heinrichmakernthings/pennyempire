import type { Company } from '@/contracts/game-state';
import { parseDecimalToMinor } from './money';

export interface OperationsDraft { price: string; employees: string; quality: Company['quality']; planned: string; marketing: string }
export interface OperationsValue { priceMinor: number; employees: number; quality: Company['quality']; plannedUnitsPerTick: number; marketingMinorPerTick: number }
type Limits = Pick<Company, 'minPrice' | 'maxPrice' | 'maxEmployees' | 'capacityPerTick'>;
export type OperationsResult = { ok: true; value: OperationsValue; errors: Record<string, string | undefined> } | { ok: false; errors: Record<string, string | undefined> };

const wholeNumber = (s: string) => (/^\d{1,9}$/.test(s.trim()) ? Number(s) : null);

/** Client-side convenience validation only; the server re-validates every bound. All outputs are integers. */
export function validateOperations(d: OperationsDraft, l: Limits): OperationsResult {
  const errors: Record<string, string | undefined> = {};
  const price = parseDecimalToMinor(d.price);
  if (price === null) errors.price = 'Enter a price such as 10 or 10.50.';
  else if (price < l.minPrice.minor || price > l.maxPrice.minor) errors.price = 'Price is outside the allowed range.';
  const employees = wholeNumber(d.employees);
  if (employees === null) errors.employees = 'Enter a whole number.'; else if (employees > l.maxEmployees) errors.employees = `At most ${l.maxEmployees} staff.`;
  const planned = wholeNumber(d.planned);
  if (planned === null) errors.planned = 'Enter a whole number.'; else if (planned > l.capacityPerTick) errors.planned = `Capacity is ${l.capacityPerTick} per tick.`;
  const marketing = parseDecimalToMinor(d.marketing);
  if (marketing === null) errors.marketing = 'Enter an amount such as 0 or 0.20.';
  if (price === null || employees === null || planned === null || marketing === null || Object.values(errors).some(Boolean)) return { ok: false, errors };
  return { ok: true, errors, value: { priceMinor: price, employees, quality: d.quality, plannedUnitsPerTick: planned, marketingMinorPerTick: marketing } };
}
