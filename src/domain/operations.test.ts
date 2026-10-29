import { validateOperations } from './operations';

const limits = { minPrice: { currency: 'EC' as const, minor: 600 }, maxPrice: { currency: 'EC' as const, minor: 1_600 }, maxEmployees: 5, capacityPerTick: 20 };
const ok = { price: '10.00', employees: '4', quality: 'standard' as const, planned: '16', marketing: '0.20' };

describe('operations draft validation', () => {
  it('converts a valid draft to integer minor units', () => {
    expect(validateOperations(ok, limits)).toMatchObject({ ok: true, value: { priceMinor: 1_000, employees: 4, plannedUnitsPerTick: 16, marketingMinorPerTick: 20 } });
  });
  it('enforces price range, staffing and capacity', () => {
    expect(validateOperations({ ...ok, price: '5' }, limits)).toMatchObject({ ok: false, errors: { price: expect.any(String) } });
    expect(validateOperations({ ...ok, employees: '6' }, limits).ok).toBe(false);
    expect(validateOperations({ ...ok, planned: '21' }, limits).ok).toBe(false);
    expect(validateOperations({ ...ok, employees: '1.5' }, limits).ok).toBe(false);
  });
});
