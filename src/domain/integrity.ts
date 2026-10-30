/**
 * Structural integrity guard for every payload entering the client (fixture or, later, server).
 * TypeScript types are erased at runtime, so this walks the payload and rejects values that would break
 * the integer-money / basis-point / integer-quantity rules in docs/ECONOMY.md. It is NOT a full schema validator;
 * per-DTO schemas are added when real endpoints are connected.
 */
const CURRENCIES = new Set(['EC', 'GBP_TEST']);
const INT_KEY = /(Minor|Units|Shares|Quantity|Count|Today|PerTick|Level|Revision|revision|employees|maxEmployees|minimumWithdrawalMinor)$/;
const BPS_KEY = /Bps$/;

export class IntegrityError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'IntegrityError';
  }
}

export function assertWireIntegrity(value: unknown, path = '$'): void {
  if (Array.isArray(value)) return value.forEach((v, i) => assertWireIntegrity(v, `${path}[${i}]`));
  if (value === null || typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;
  if ('currency' in obj && 'minor' in obj) {
    if (typeof obj.currency !== 'string' || !CURRENCIES.has(obj.currency)) throw new IntegrityError(path, `unknown currency ${String(obj.currency)}`);
    if (!Number.isSafeInteger(obj.minor)) throw new IntegrityError(path, 'money.minor must be a safe integer');
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = `${path}.${k}`;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new IntegrityError(p, 'non-finite number');
      if (BPS_KEY.test(k) && !(Number.isInteger(v) && v >= -10_000 && v <= 10_000)) throw new IntegrityError(p, 'basis points must be an integer within ±10000');
      else if (INT_KEY.test(k) && !Number.isSafeInteger(v)) throw new IntegrityError(p, 'must be a safe integer');
    }
    assertWireIntegrity(v, p);
  }
}
