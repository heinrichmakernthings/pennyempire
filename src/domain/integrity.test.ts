import { assertWireIntegrity, IntegrityError } from './integrity';

describe('wire integrity guard', () => {
  it('accepts well-formed money', () => { expect(() => assertWireIntegrity({ a: { currency: 'EC', minor: 5 }, quantity: 3 })).not.toThrow(); });
  it('rejects float minor units', () => { expect(() => assertWireIntegrity({ price: { currency: 'EC', minor: 120.00000000000001 } })).toThrow(IntegrityError); });
  it('rejects unknown currencies', () => { expect(() => assertWireIntegrity({ price: { currency: 'USD', minor: 1 } })).toThrow(/unknown currency/); });
  it('rejects fractional quantities and out-of-range bps', () => {
    expect(() => assertWireIntegrity({ availableUnits: 1.5 })).toThrow();
    expect(() => assertWireIntegrity({ marketShareBps: 20_000 })).toThrow(/basis points/);
    expect(() => assertWireIntegrity({ changeBps: -120 })).not.toThrow();
  });
  it('rejects non-finite numbers and walks arrays', () => {
    expect(() => assertWireIntegrity({ x: [{ y: Infinity }] })).toThrow(/non-finite/);
    expect(() => assertWireIntegrity({ items: [{ price: { currency: 'EC', minor: 1.5 } }] })).toThrow(/items\[0\]/);
  });
});
