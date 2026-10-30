import type { TestWallet } from '@/contracts/game-state';
import { parseDecimalToMinor } from './money';

export const MIN_TEST_WITHDRAWAL_MINOR = 500; // £5.00 GBP_TEST — UI rule only, not an entitlement to any payment.
export const MIN_TEST_DEPOSIT_MINOR = 50; // 50p

export type AmountCheck = { ok: true; minor: number } | { ok: false; message: string };

export function checkTestDeposit(input: string): AmountCheck {
  const minor = parseDecimalToMinor(input);
  if (minor === null) return { ok: false, message: 'Enter an amount in pounds and pence, for example 0.50.' };
  if (minor < MIN_TEST_DEPOSIT_MINOR) return { ok: false, message: 'Minimum simulated deposit is £0.50 GBP_TEST.' };
  return { ok: true, minor };
}

export function checkTestWithdrawal(input: string, wallet: Pick<TestWallet, 'balanceMinor' | 'reservedMinor'>): AmountCheck {
  const minor = parseDecimalToMinor(input);
  if (minor === null) return { ok: false, message: 'Enter an amount in pounds and pence, for example 5.00.' };
  if (minor < MIN_TEST_WITHDRAWAL_MINOR) return { ok: false, message: 'Minimum simulated withdrawal is £5.00 GBP_TEST.' };
  if (minor > wallet.balanceMinor - wallet.reservedMinor) return { ok: false, message: 'Amount exceeds your available GBP_TEST balance.' };
  return { ok: true, minor };
}
