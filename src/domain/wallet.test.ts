import { checkTestDeposit, checkTestWithdrawal, MIN_TEST_WITHDRAWAL_MINOR } from './wallet';
import { addMoney } from './money';

const wallet = { balanceMinor: 1_250, reservedMinor: 0 };

describe('simulated GBP_TEST wallet rules', () => {
  it('£5 minimum withdrawal threshold', () => {
    expect(MIN_TEST_WITHDRAWAL_MINOR).toBe(500);
    expect(checkTestWithdrawal('4.99', wallet)).toMatchObject({ ok: false });
    expect(checkTestWithdrawal('5', wallet)).toEqual({ ok: true, minor: 500 });
  });
  it('cannot withdraw more than available (reserved funds excluded)', () => {
    expect(checkTestWithdrawal('12.50', wallet)).toEqual({ ok: true, minor: 1_250 });
    expect(checkTestWithdrawal('12.51', wallet)).toMatchObject({ ok: false });
    expect(checkTestWithdrawal('10', { balanceMinor: 1_250, reservedMinor: 500 })).toMatchObject({ ok: false });
  });
  it('50p minimum deposit, pence precision only', () => {
    expect(checkTestDeposit('0.49')).toMatchObject({ ok: false });
    expect(checkTestDeposit('0.50')).toEqual({ ok: true, minor: 50 });
    expect(checkTestDeposit('0.505')).toMatchObject({ ok: false });
  });
  it('GBP_TEST can never be added to Empire Coins', () => {
    expect(() => addMoney({ currency: 'GBP_TEST', minor: 500 }, { currency: 'EC', minor: 500 })).toThrow();
  });
});
