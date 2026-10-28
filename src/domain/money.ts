import type { Money } from '@/contracts/game-state';

/** All arithmetic is on safe integers in minor units. 100 minor = 1 unit. Never use floats for balances. */
export const MINOR_PER_UNIT = 100;

export const isSafeMinor = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);

export function money(currency: Money['currency'], minor: number): Money {
  if (!isSafeMinor(minor)) throw new RangeError(`Money minor must be a safe integer, got ${String(minor)}`);
  return { currency, minor };
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.currency, a.minor + b.minor);
}

export function subMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.currency, a.minor - b.minor);
}

function assertSameCurrency(a: Money, b: Money) {
  if (a.currency !== b.currency) throw new TypeError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
}

/** Integer fee in basis points, rounded half-up. */
export function feeFromBps(subtotalMinor: number, bps: number): number {
  if (!isSafeMinor(subtotalMinor) || !isSafeMinor(bps) || bps < 0 || bps > 10_000) throw new RangeError('Invalid fee inputs');
  return Math.floor((subtotalMinor * bps + 5_000) / 10_000);
}

/** Splits minor units into whole + fractional parts using integer maths only. */
function splitMinor(minor: number) {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return { sign, whole: Math.floor(abs / MINOR_PER_UNIT), frac: abs % MINOR_PER_UNIT };
}

const group = (n: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(n);

/** "24,850 EC" / "12.50 EC" / "£5.00 GBP_TEST". Always names the currency so EC and test GBP cannot be conflated. */
export function formatMoney(m: Money, opts: { signed?: boolean; fixed?: boolean } = {}): string {
  const { sign, whole, frac } = splitMinor(m.minor);
  const plus = opts.signed && m.minor > 0 ? '+' : '';
  const fracStr = frac === 0 && m.currency === 'EC' && !opts.fixed ? '' : `.${String(frac).padStart(2, '0')}`;
  if (m.currency === 'GBP_TEST') return `${sign}${plus}£${group(whole)}${fracStr} GBP_TEST`;
  return `${sign}${plus}${group(whole)}${fracStr} EC`;
}

export const formatUnits = (n: number) => group(n);
export const formatBps = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
export const formatSignedBps = (bps: number) => `${bps > 0 ? '+' : ''}${formatBps(bps)}`;

/** Parses a user-typed decimal string like "5", "5.5", "5.50" to pence/minor without floats. Returns null if invalid. */
export function parseDecimalToMinor(input: string): number | null {
  const m = /^\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  const frac = (m[2] ?? '').padEnd(2, '0');
  return Number(m[1]) * MINOR_PER_UNIT + Number(frac || '0');
}
