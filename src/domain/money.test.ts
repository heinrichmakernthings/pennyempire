import { addMoney, feeFromBps, formatMoney, formatBps, parseDecimalToMinor, subMoney } from './money';

describe('money', () => {
  it('formats EC and test GBP, always naming the currency', () => {
    expect(formatMoney({ currency: 'EC', minor: 2_485_000 })).toBe('24,850 EC');
    expect(formatMoney({ currency: 'EC', minor: 1_250 })).toBe('12.50 EC');
    expect(formatMoney({ currency: 'EC', minor: 240 }, { fixed: true })).toBe('2.40 EC');
    expect(formatMoney({ currency: 'EC', minor: 42_000 }, { signed: true })).toBe('+420 EC');
    expect(formatMoney({ currency: 'EC', minor: -500 }, { signed: true })).toBe('-5 EC');
    expect(formatMoney({ currency: 'GBP_TEST', minor: 500 })).toBe('£5.00 GBP_TEST');
  });
  it('never mixes currencies', () => {
    expect(() => addMoney({ currency: 'EC', minor: 1 }, { currency: 'GBP_TEST', minor: 1 })).toThrow(TypeError);
    expect(() => subMoney({ currency: 'GBP_TEST', minor: 1 }, { currency: 'EC', minor: 1 })).toThrow(TypeError);
  });
  it('rejects non-integer minor units', () => {
    expect(() => addMoney({ currency: 'EC', minor: 0.1 }, { currency: 'EC', minor: 0.2 })).toThrow(RangeError);
  });
  it('computes fees in integer basis points, rounding half-up', () => {
    expect(feeFromBps(10_000, 200)).toBe(200);
    expect(feeFromBps(125, 200)).toBe(3); // 2.5 → 3
    expect(feeFromBps(0, 200)).toBe(0);
    expect(() => feeFromBps(100, 10_001)).toThrow(RangeError);
  });
  it('parses decimal input without floats', () => {
    expect(parseDecimalToMinor('5')).toBe(500);
    expect(parseDecimalToMinor('0.1')).toBe(10);
    expect(parseDecimalToMinor('12.34')).toBe(1_234);
    expect(parseDecimalToMinor('1.999')).toBeNull();
    expect(parseDecimalToMinor('-1')).toBeNull();
    expect(parseDecimalToMinor('abc')).toBeNull();
    expect(parseDecimalToMinor('')).toBeNull();
  });
  it('formats basis points', () => { expect(formatBps(2_150)).toBe('21.50%'); expect(formatBps(7_400)).toBe('74%'); });
});
