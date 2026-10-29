import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { addStock, removeStock } from './inventory';
import { available, balance, transfer, type TickCtx } from './ledger';
import { cancelOrder } from './market';
import { logEvent } from './stats';
import { cancelShares, companyInvestorId, security } from './capital';
import { cancelAllOrders } from './shareMarket';
import { cancelOpenDividends } from './dividends';
import { refPriceOf, type CompanyRow } from './operations';
import { recallDepositsAtLiquidation, settleLoansAtLiquidation } from './bank';
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
    cancelOpenDividends(db, c.id);   // an earmarked dividend must not block the creditors
    for (const o of db.all<{ id: number }>("SELECT id FROM orders WHERE company_id = ? AND status = 'open'", c.id)) cancelOrder(db, o.id);
    recallDepositsAtLiquidation(db, ctx, c.id, acct);   // savings held at the National Bank are the company's asset: they go to its creditors and owners, not the bank
    const provisions = db.get<{ id: string }>("SELECT id FROM companies WHERE industry_id = 'wholesale' AND owner_kind = 'state' LIMIT 1");
    let proceeds = 0, units = 0;
    for (const inv of db.all<{ commodity_id: string; qty: number; value_minor: number }>('SELECT commodity_id, qty, value_minor FROM inventory WHERE company_id = ? AND qty > 0', c.id)) {
      // Stock is valued at the LOWER of its cost basis and its market reference value: a cost basis inflated by buying from a sister company at an
      // owner-chosen price must not turn into a claim on the state treasury.
      const fair = Math.min(inv.value_minor, inv.qty * refPriceOf(db, inv.commodity_id));
      const want = Math.floor((fair * cfg.liquidationBps) / 10_000);
      const pay = Math.min(want, Math.max(0, available(db, TREASURY)));
      if (pay > 0) transfer(db, ctx, `liq:${c.id}:${inv.commodity_id}`, TREASURY, acct, pay, 'state_payment', `administrator buys stock of ${c.name}`);
      removeStock(db, ctx, c.id, inv.commodity_id, inv.qty, 'trade_out', `liquidation:${c.id}`, { fromReserved: false });
      if (provisions) addStock(db, ctx, provisions.id, inv.commodity_id, inv.qty, pay, 'trade_in', `liquidation:${c.id}`);
      proceeds += pay; units += inv.qty;
    }
    settleLoansAtLiquidation(db, ctx, c.id, acct);   // the National Bank is a senior creditor
    const arrearsPaid = Math.min(c.unpaid_minor, Math.max(0, balance(db, acct) - 0));
    if (arrearsPaid > 0) transfer(db, ctx, `liq:${c.id}:arrears`, acct, TREASURY, arrearsPaid, 'state_payment', `administrator: arrears of ${c.name}`);
    const writtenOff = c.unpaid_minor - arrearsPaid;
    const residual = balance(db, acct);
    // Shareholders are paid LAST, pro rata, from whatever is left after stock sales and arrears (creditor priority). Then every share is cancelled and the security delisted.
    const sec = security(db, c.id);
    if (sec) {
      cancelAllOrders(db, c.id, 'delisted');
      const own = companyInvestorId(c.id);
      const holders = db.all<{ investor_id: string; shares: number; cost_basis_minor: number; account_id: string }>('SELECT h.investor_id, h.shares, h.cost_basis_minor, i.account_id FROM share_holdings h JOIN investors i ON i.id = h.investor_id WHERE h.company_id = ? AND h.shares > 0 AND h.investor_id <> ? ORDER BY h.shares DESC, h.investor_id', c.id, own);
      const total = holders.reduce((a, h) => a + h.shares, 0);
      let left = residual;
      holders.forEach((h, i) => {
        const part = i === holders.length - 1 ? left : Math.min(left, Math.floor((residual * h.shares) / total));
        left -= part;
        if (part > 0) transfer(db, ctx, `liq:${c.id}:holder:${h.investor_id}`, acct, h.account_id, part, 'transfer', `liquidation distribution of ${c.name} to ${h.investor_id}`);
        db.run("INSERT INTO share_pnl (tick, investor_id, company_id, qty, proceeds_minor, cost_minor, pnl_minor, kind, ref) VALUES (?,?,?,?,?,?,?, 'liquidation', ?)", ctx.tick, h.investor_id, c.id, h.shares, part, h.cost_basis_minor, part - h.cost_basis_minor, `liq:${c.id}`);
      });
      for (const h of db.all<{ investor_id: string; shares: number }>('SELECT investor_id, shares FROM share_holdings WHERE company_id = ? AND shares > 0', c.id)) cancelShares(db, ctx, c.id, h.investor_id, h.shares, `liq:${c.id}`, 'liquidation', 'cancelled on liquidation');
      db.run("UPDATE securities SET status = 'delisted', delisted_tick = ?, suspended_reason = 'company liquidated' WHERE company_id = ?", ctx.tick, c.id);
      logEvent(db, ctx.tick, 'delisted', 'error', c.id, `${c.name} was delisted: its shares were cancelled and ${(residual / 100).toFixed(2)} EC was distributed to shareholders`, { distributedMinor: residual, holders: holders.length });
    } else if (residual > 0) transfer(db, ctx, `liq:${c.id}:owner`, acct, c.owner_kind === 'player' ? (db.get<{ w: string }>('SELECT wallet_account_id w FROM players WHERE id = ?', c.owner_id)?.w ?? PLAYER_WALLET) : 'acct:households:bristol', residual, c.owner_kind === 'player' ? 'owner_withdrawal' : 'transfer', `residual cash of ${c.name} to its owner`);
    db.run('UPDATE production_lines SET planned_batches = 0 WHERE company_id = ?', c.id);
    db.run("UPDATE companies SET status = 'insolvent', bankrupt_tick = ?, unpaid_minor = 0, written_off_minor = ?, employees = 0, property_minor = 0, marketing_minor = 0, revision = revision + 1 WHERE id = ?", ctx.tick, writtenOff, c.id);   // closed: no more wages, rent or advertising accrue
    if (c.plot_id) db.run('UPDATE plots SET company_id = NULL, asset_id = NULL WHERE id = ? AND company_id = ?', c.lot_id ?? c.plot_id, c.id);
    logEvent(db, ctx.tick, 'bankruptcy', 'error', c.id, `${c.name} went bankrupt: stock sold for ${proceeds / 100} EC, ${arrearsPaid / 100} EC of arrears paid, ${writtenOff / 100} EC written off, ${residual / 100} EC returned to the owner`, { proceeds, arrearsPaid, writtenOff, residual });
    return { stockProceedsMinor: proceeds, arrearsPaidMinor: arrearsPaid, writtenOffMinor: writtenOff, returnedToOwnerMinor: residual, unitsSold: units };
  });
}
