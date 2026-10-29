import '@/design/phase10.css';
import type { Company, Recipe } from '@/contracts/game-state';
import type { Management } from '@/shared/management';
import { artUrl } from '@/assets/artAssets';
import { commodityLabel } from '@/domain/labels';
import { formatMoney, formatUnits } from '@/domain/money';
import { Button } from '@/ui/Button';

const WORKERS: Record<Company['industry'], string> = { farm: 'farm-worker', mill: 'mill-worker', dairy: 'dairy-worker', pizza: 'pizza-chef', cafe: 'barista', timber: 'timber-worker' };
export function WorkerPortrait({ industry }: { industry: Company['industry'] }) {
  return <img className="pe-worker-portrait pe-pixel-art" src={artUrl(`assets/art/phase8/runtime/${WORKERS[industry]}-idle-sw.png`)} width={48} height={80} alt="" loading="lazy" />;
}

/** Recommendations describe current server facts. No forecast, payout or progression is invented. */
export function BusinessBrief({ c, m, recipe, onTab }: { c: Company; m: Management; recipe?: Recipe; onTab: (tab: string) => void }) {
  const last = m.production.log.reduce<Management['production']['log'][number] | null>((a, b) => !a || b.tick > a.tick ? b : a, null);
  const short = m.supplyChain.filter(s => s.inStock < s.perBatch * m.production.plannedBatches);
  const limited = last?.limitedBy ?? m.production.limitedBy;
  const needsStaff = m.staff.employees < m.staff.needed;
  const action = m.closed ? null : c.status === 'insolvent' ? { tab: 'controls', label: 'Review cash and arrears' }
    : limited === 'cash' ? { tab: 'controls', label: 'Review company funding' }
    : short.length ? { tab: 'operations', label: 'Compare suppliers' }
    : needsStaff ? { tab: 'controls', label: 'Review staffing' }
    : limited === 'storage' ? { tab: 'controls', label: 'Review price and output' }
    : m.equipment.conditionBps < 5000 ? { tab: 'operations', label: 'Review equipment' }
    : { tab: 'controls', label: 'Set your production plan' };
  return <section className="pe-business-brief" aria-label="Your next business decision">
    <div className="pe-business-brief-head"><WorkerPortrait industry={c.industry} /><div><h3 className="pe-h3">{recipe ? `Your business makes ${commodityLabel(recipe.output.commodityId).toLowerCase()}` : 'Your trading day'}</h3>
      <p>{last ? `Day ${last.tick}: ${formatUnits(last.outputUnits)} units produced.` : 'Your first production result appears after the next game day.'} Production and ordinary sales run automatically; there is nothing to collect by clicking.</p>
    </div></div>
    <div className="pe-business-facts"><p><strong>Company cash</strong><span>{formatMoney(c.cash)}</span><small>Pays this business's costs; separate from your personal coins.</small></p>
      <p><strong>Latest daily result</strong><span className={c.dailyProfit.minor > 0 ? 'pe-pos' : c.dailyProfit.minor < 0 ? 'pe-neg' : ''}>{formatMoney(c.dailyProfit, { signed: true })}</span><small>{c.dailyRevenue.minor > 0 ? `${formatMoney(c.dailyRevenue)} revenue less ${formatMoney(c.dailyExpenses)} expenses.` : 'No sales revenue recorded for this day yet.'}</small></p></div>
    {short.length > 0 && <p className="pe-hint">Below your next production target: <strong>{short.map(s => commodityLabel(s.commodityId)).join(', ')}</strong>. {m.autoProcure ? 'Auto-purchasing is on, but still needs cash and available suppliers.' : 'Auto-purchasing is off; compare suppliers before the next day.'}</p>}
    {needsStaff && <p className="pe-hint">Your target needs about {m.staff.needed} staff; you currently employ {m.staff.employees}.</p>}
    <div className="pe-row">{action && <Button variant="primary" onClick={() => onTab(action.tab)}>{action.label}</Button>}<Button onClick={() => onTab('financials')}>Review daily results</Button>{!m.closed && <Button onClick={() => onTab('upgrades')}>Explore upgrades</Button>}</div>
  </section>;
}
