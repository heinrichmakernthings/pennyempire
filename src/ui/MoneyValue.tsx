import type { Money } from '@/contracts/game-state';
import { formatMoney } from '@/domain/money';

/** The only place money is turned into text. Always shows the currency; signed values get a text sign as well as colour. */
export function MoneyValue({ value, signed = false, fixed = false, tone = 'auto', className = '' }: { value: Money; signed?: boolean; fixed?: boolean; tone?: 'auto' | 'neutral'; className?: string }) {
  const cls = tone === 'auto' && signed ? (value.minor > 0 ? 'pe-pos' : value.minor < 0 ? 'pe-neg' : '') : '';
  return <span className={`pe-financial-number ${cls} ${className}`}>{formatMoney(value, { signed, fixed })}</span>;
}
