import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { addStock, removeStock } from './inventory';
import { available, balance, transfer, type TickCtx } from './ledger';
import { cancelOrder } from './market';
import { logEvent } from './stats';
import type { CompanyRow } from './operations';
import { PLAYER_WALLET, TREASURY } from '../seed/bristol';

export interface LiquidationResult { stockProceedsMinor: number; arrearsPaidMinor: number; writtenOffMinor: number; returnedToOwnerMinor: number; unitsSold: number }

/**
 * Bankruptcy: the state administrator closes an insolvent company, in a fixed, recorded order — and no coin is invented.
 *  1. open orders are cancelled; 2. stock is sold to the state provisioner at `liquidationBps` of cost basis, paid from the state treasury;
 *  3. cash pays the arrears owed (to the treasury); 4. whatever arrears remain are WRITTEN OFF and recorded on the company (limited liability — the owner
 *  loses what they invested, nothing more); 5. any cash left goes back to the owner; 6. ownership passes to the state shell; 7. the lot is freed for a new entrepreneur.
 * Financial history, tick statistics and ledger entries are kept untouched.
 */
export function liquidateCompany(db: Sql, ctx: TickCtx, cfg: EngineConfig, c: CompanyRow): LiquidationResult {
  return db.transaction(() => {
    const acct = c.treasury_account_id;
    for (const o of db.all<{ id: number }>("SELECT id FROM orders WHERE company_id = ? AND status = 'open'", c.id)) cancelOrder(db, o.id);
    const provisions = db.get<{ id: string }>("SELECT id FROM companies WHERE industry_id = 'wholesale' AND owner_kind = 'state' LIMIT 1");
    let proceeds = 0, units = 0;
    for (const inv of db.all<{ commodity_id: string; qty: number; value_minor: number }>('SELECT commodity_id, qty, value_minor FROM inventory WHERE company_id = ? AND qty > 0', c.id)) {
      const want = Math.floor((inv.value_minor * cfg.liquidationBps) / 10_000);
      const pay = Math.min(want, Math.max(0, available(db, TREASURY)));
      if (pay > 0) transfer(db, ctx, `liq:${c.id}:${inv.commodity_id}`, TREASURY, acct, pay, 'state_payment', `administrator buys stock of ${c.name}`);
      removeStock(db, ctx, c.id, inv.commodity_id, inv.qty, 'trade_out', `liquidation:${c.id}`, { fromReserved: false });
      if (provisions) addStock(db, ctx, provisions.id, inv.commodity_id, inv.qty, pay, 'trade_in', `liquidation:${c.id}`);
      proceeds += pay; units += inv.qty;
    }
    const arrearsPaid = Math.min(c.unpaid_minor, Math.max(0, balance(db, acct) - 0));
    if (arrearsPaid > 0) transfer(db, ctx, `liq:${c.id}:arrears`, acct, TREASURY, arrearsPaid, 'state_payment', `administrator: arrears of ${c.name}`);
    const writtenOff = c.unpaid_minor - arrearsPaid;
    const residual = balance(db, acct);
    if (residual > 0) {
      if (c.owner_kind === 'player') transfer(db, ctx, `liq:${c.id}:owner`, acct, PLAYER_WALLET, residual, 'owner_withdrawal', `residual cash returned to owner of ${c.name}`);
      else transfer(db, ctx, `liq:${c.id}:owner`, acct, 'acct:households:bristol', residual, 'transfer', `residual cash of ${c.name} to its shareholders`);
    }
    db.run("DELETE FROM ownership WHERE company_id = ?", c.id);
    db.run("INSERT INTO ownership (company_id, holder_kind, holder_id, shares) VALUES (?, 'state', 'state-bristol', 10000)", c.id);
    db.run('UPDATE production_lines SET planned_batches = 0 WHERE company_id = ?', c.id);
    db.run('UPDATE companies SET bankrupt_tick = ?, unpaid_minor = 0, written_off_minor = ?, employees = 0, revision = revision + 1 WHERE id = ?', ctx.tick, writtenOff, c.id);
    if (c.plot_id) db.run('UPDATE plots SET company_id = NULL, asset_id = NULL WHERE id = ? AND company_id = ?', c.lot_id ?? c.plot_id, c.id);
    logEvent(db, ctx.tick, 'bankruptcy', 'error', c.id, `${c.name} went bankrupt: stock sold for ${proceeds / 100} EC, ${arrearsPaid / 100} EC of arrears paid, ${writtenOff / 100} EC written off, ${residual / 100} EC returned to the owner`, { proceeds, arrearsPaid, writtenOff, residual });
    return { stockProceedsMinor: proceeds, arrearsPaidMinor: arrearsPaid, writtenOffMinor: writtenOff, returnedToOwnerMinor: residual, unitsSold: units };
  });
}
