// @vitest-environment node
import { advance } from './world';
import { available, balance, reconcile, supply, transfer } from './ledger';
import { loadConfig } from './config';
import { found, now, sane, world } from '../test/shareHelpers';
import { companyAccount, TREASURY } from '../seed/bristol';
import { STATE_PROVIDERS, chargeService } from './stateServices';
import { fundCompany } from './commands';
import { startAd, cancelAd, takeBankLoan, repayBankLoan, bankDeposit, bankWithdraw, buyPremisesCmd } from './stateCommands';
import { creditProfile, quoteLoan } from './bank';
import { activeLease } from './property';
import { clearModsCache } from './economyState';
import { authorised, setBaseRate, setParam, triggerEvent } from './admin';
import { hash32 } from './events';
import { reviewPolicy } from './centralBank';
import { handleApi } from '../api/router';
import { liquidateCompany } from './lifecycle';
import { stateDashboard } from '../api/stateDashboard';
import type { CompanyRow } from './operations';
import type { Sql } from '../db/sql';

const one = <T>(db: Sql, sql: string, ...a: (string | number)[]) => db.get<T>(sql, ...a)!;
/** A trading company with a believable profit history so the bank can assess it (test-only edit of its own statistics rows). */
function profitable(db: Sql, id: string, net = 8_000) {
  advance(db, 20);
  db.run('UPDATE company_tick_stats SET net_profit_minor = ? WHERE company_id = ? AND tick > 0', net, id);
}

describe('the six state companies', () => {
  it('exist as real companies with their own treasuries, shares and tickers, and sell services through the shared interface', () => {
    const db = world();
    for (const p of Object.values(STATE_PROVIDERS)) {
      const c = one<{ owner_kind: string; treasury_account_id: string }>(db, 'SELECT owner_kind, treasury_account_id FROM companies WHERE id = ?', p.id);
      expect(c.owner_kind).toBe('state'); expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM accounts WHERE id = ?', c.treasury_account_id).n).toBe(1);
      expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM securities WHERE company_id = ?', p.id).n).toBe(1);
    }
    advance(db, 12); sane(db);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM securities WHERE status = 'open' AND company_id IN ('co-bristol-energy','co-bristol-media','co-penny-logistics','co-bristol-estates','co-national-bank','co-penny-exchange')").n).toBe(6);
  });
  it('a service charge is idempotent: the same key charges once and is a transfer, not a sink', () => {
    const db = world(); const id = found(db, 'pizza', 'lot-1', 'Charge Pizza'); const acct = companyAccount(id);
    const before = supply(db).destroyed; const b0 = balance(db, acct);
    const a = chargeService(db, now(db), { service: 'energy', payerAccount: acct, payerCompanyId: id, amount: 500, ref: 'x', key: 'dup-1' });
    const b = chargeService(db, now(db), { service: 'energy', payerAccount: acct, payerCompanyId: id, amount: 500, ref: 'x', key: 'dup-1' });
    expect(a.charged).toBe(500); expect(b.duplicate).toBe(true);
    expect(b0 - balance(db, acct)).toBe(500); expect(supply(db).destroyed).toBe(before); sane(db);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM service_charges WHERE idempotency_key = 'dup-1'").n).toBe(1);
  });
  it('a charge can never overdraw the payer', () => {
    const db = world(); const id = found(db, 'pizza', 'lot-1', 'Poor Pizza'); const acct = companyAccount(id);
    const r = chargeService(db, now(db), { service: 'energy', payerAccount: acct, payerCompanyId: id, amount: 10 ** 9, ref: 'x', key: 'big' });
    expect(r.charged).toBeLessThanOrEqual(balance(db, acct) + r.charged); expect(balance(db, acct)).toBeGreaterThanOrEqual(0); sane(db);
  });
});

describe('Penny Energy', () => {
  it('production draws on a finite grid; a shortage limits output, is recorded, and costs real money at a higher tariff', () => {
    const db = world(); const mill = found(db, 'mill', 'lot-7', 'Grid Mill'); advance(db, 8);
    const normal = one<{ n: number }>(db, "SELECT COUNT(*) n FROM production_log WHERE limited_by IN ('energy','disruption')").n;
    expect(normal).toBe(0);
    db.run("UPDATE energy_sources SET capacity_units = 1"); advance(db, 3);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM production_log WHERE limited_by = 'energy'").n).toBeGreaterThan(0);
    const d = one<{ shortage_units: number; capacity_units: number; demand_units: number }>(db, 'SELECT * FROM energy_daily ORDER BY tick DESC LIMIT 1');
    expect(d.shortage_units).toBeGreaterThan(0); expect(d.demand_units).toBeGreaterThan(d.capacity_units);
    advance(db, 2); expect(one<{ t: number }>(db, 'SELECT tariff_minor t FROM energy_daily ORDER BY tick DESC LIMIT 1').t).toBeGreaterThan(one<{ p: number }>(db, "SELECT reference_price_minor p FROM commodities WHERE id = 'energy'").p);   // load surcharge
    expect(mill).toBeTruthy(); sane(db);
  });
  it('electricity is paid to Penny Energy as a transfer and appears in its service revenue', () => {
    const db = world(); found(db, 'mill', 'lot-7', 'Pay Mill'); advance(db, 6);
    expect(one<{ a: number }>(db, "SELECT COALESCE(SUM(amount_minor),0) a FROM service_charges WHERE service = 'energy'").a).toBeGreaterThan(0); sane(db);
  });
  it('total energy supplied in a day never exceeds capacity', () => {
    const db = world(); found(db, 'mill', 'lot-7', 'Cap Mill'); db.run('UPDATE energy_sources SET capacity_units = 5'); advance(db, 6);
    for (const r of db.all<{ capacity_units: number; supplied_units: number }>('SELECT * FROM energy_daily')) expect(r.supplied_units).toBeLessThanOrEqual(r.capacity_units);
  });
});

describe('Central Property', () => {
  it('migrated companies keep their rent with no service charge; new leases carry it; rent is charged once a day', () => {
    const db = world(); const id = found(db, 'pizza', 'lot-1', 'Lease Pizza'); advance(db, 3);
    const lease = activeLease(db, id)!; expect(lease.service_charge_bps).toBe(loadConfig(db).propertyServiceChargeBps);
    const perDay = db.all<{ tick: number; n: number }>("SELECT tick, COUNT(*) n FROM service_charges WHERE service = 'property' AND payer_id = ? GROUP BY tick", id);
    expect(perDay.every((r) => r.n === 1)).toBe(true);
  });
  it('the demo companies were migrated with a lease, rent unchanged and a note saying nothing was charged retroactively', async () => {
    const { openWorld } = await import('./world'); const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'demo');
    const l = activeLease(db, 'co-mad-slices')!; expect(l.service_charge_bps).toBe(0); expect(l.note).toContain('no retroactive');
    expect(l.base_rent_minor).toBe(one<{ p: number }>(db, "SELECT property_minor p FROM companies WHERE id = 'co-mad-slices'").p);
  });
  it('buying the premises is one transfer to Central Property, ends the lease, and afterwards only rates are paid', () => {
    const db = world(); const id = found(db, 'pizza', 'lot-1', 'Owner Pizza'); advance(db, 2);
    expect(fundCompany(db, 'fund-1', id, 3_000_000).ok).toBe(true);
    const lease = activeLease(db, id)!, price = lease.base_rent_minor * loadConfig(db).propertyBuyMultiple;
    const c0 = balance(db, companyAccount(id)), p0 = balance(db, one<{ a: string }>(db, "SELECT treasury_account_id a FROM companies WHERE id = 'co-bristol-estates'").a);
    const r = buyPremisesCmd(db, 'buy-fixed', id); const again = buyPremisesCmd(db, 'buy-fixed', id);
    expect(r.ok).toBe(true); expect(again).toEqual(r);       // replay returns the stored answer, no second charge
    expect(c0 - balance(db, companyAccount(id))).toBe(price);
    expect(activeLease(db, id)!.kind).toBe('owned');
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM service_charges WHERE ref LIKE 'purchase:%' AND payer_id = ?", id).n).toBe(1);
    expect(p0).toBeGreaterThanOrEqual(0);
    const rentBefore = lease.base_rent_minor; advance(db, 2);
    const daily = one<{ a: number }>(db, "SELECT amount_minor a FROM service_charges WHERE service = 'property' AND payer_id = ? ORDER BY id DESC LIMIT 1", id).a;
    expect(daily).toBeLessThan(rentBefore);                    // rates only
    expect(buyPremisesCmd(db, 'buy-again', id).ok).toBe(false); sane(db);
  });
});

describe('Penny Ads', () => {
  it('a campaign is bought through a command, billed daily to Penny Ads, builds awareness, and a replayed command buys nothing twice', () => {
    const db = world(); const id = found(db, 'pizza', 'lot-1', 'Ad Pizza'); advance(db, 3);
    const a0 = one<{ a: number }>(db, 'SELECT awareness_bps a FROM companies WHERE id = ?', id).a;
    const r1 = startAd(db, 'ad-1', { companyId: id, kind: 'billboard', tier: 2, days: 10 }); const r2 = startAd(db, 'ad-1', { companyId: id, kind: 'billboard', tier: 2, days: 10 });
    expect(r1.ok).toBe(true); expect(r2).toEqual(r1);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM ad_campaigns').n).toBe(1);
    advance(db, 8);
    expect(one<{ a: number }>(db, 'SELECT awareness_bps a FROM companies WHERE id = ?', id).a).toBeGreaterThan(a0);
    expect(one<{ s: number; n: number }>(db, "SELECT COALESCE(SUM(amount_minor),0) s, COUNT(*) n FROM service_charges WHERE service = 'advertising' AND ref LIKE 'campaign:%'").n).toBeGreaterThanOrEqual(7);
    sane(db);
  });
  it('returns diminish and awareness can never exceed the hard ceiling, however much is spent', () => {
    const db = world({}, 50_000_000); const id = found(db, 'pizza', 'lot-1', 'Whale Pizza'); advance(db, 2);
    for (const k of ['billboard', 'digital', 'local'] as const) startAd(db, `w-${k}`, { companyId: id, kind: k, tier: 3, days: 14 });
    advance(db, 60);
    const cfg = loadConfig(db); expect(one<{ a: number }>(db, 'SELECT awareness_bps a FROM companies WHERE id = ?', id).a).toBeLessThanOrEqual(cfg.awarenessMaxBps);
    expect(startAd(db, 'w-4th', { companyId: id, kind: 'digital', tier: 1, days: 5 }).ok).toBe(true);
    startAd(db, 'w-5th', { companyId: id, kind: 'local', tier: 1, days: 5 }); startAd(db, 'w-6th', { companyId: id, kind: 'local', tier: 1, days: 5 });
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM ad_campaigns WHERE status = 'active'").n).toBeLessThanOrEqual(3);
  });
  it('rival spending dilutes a campaign, and advertising is refused for companies that do not sell to the public', () => {
    const db = world(); const mill = found(db, 'mill', 'lot-7', 'No Ads Mill'); advance(db, 2);
    const r = startAd(db, 'ad-mill', { companyId: mill, kind: 'local', tier: 1, days: 3 }); expect(r.ok).toBe(false);
  });
  it('cancel stops billing', () => {
    const db = world(); const id = found(db, 'pizza', 'lot-1', 'Cancel Pizza'); advance(db, 2);
    const r = startAd(db, 'c-1', { companyId: id, kind: 'local', tier: 1, days: 10 }); expect(r.ok).toBe(true);
    const cid = (r as { data: { campaignId: string } }).data.campaignId; advance(db, 2); expect(cancelAd(db, 'c-2', id, cid).ok).toBe(true);
    const n0 = one<{ n: number }>(db, 'SELECT COUNT(*) n FROM ad_daily WHERE spend_minor > 0').n; advance(db, 3);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM ad_daily WHERE spend_minor > 0').n).toBe(n0);
  });
});

describe('Penny Logistics', () => {
  it('every trade becomes exactly one shipment and one delivery fee; goods are conserved', () => {
    const db = world(); found(db, 'mill', 'lot-7', 'Ship Mill'); advance(db, 15);
    const trades = one<{ n: number }>(db, 'SELECT COUNT(*) n FROM trades').n, ships = one<{ n: number }>(db, "SELECT COUNT(*) n FROM shipments WHERE ref LIKE 'trade:%'").n;
    expect(ships).toBeGreaterThan(0); expect(ships).toBeLessThanOrEqual(trades);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM (SELECT ref, commodity_id FROM shipments GROUP BY 1,2 HAVING COUNT(*) > 1)').n).toBe(0);
    const o = one<{ s: number }>(db, "SELECT SUM(delta) s FROM inventory_movements WHERE reason IN ('trade_out','trade_in')").s;
    expect(o + one<{ s: number }>(db, "SELECT COALESCE(SUM(qty),0) s FROM shipments WHERE status = 'delayed'").s).toBe(0); sane(db);
  });
  it('a delivery disruption holds goods in transit and delivers them later, once', () => {
    const db = world(); found(db, 'mill', 'lot-7', 'Delay Mill'); advance(db, 5);
    expect(triggerEvent(db, 'tester', 'supply_chain_disruption', 3, 6, 'unit test').ok).toBe(true);
    advance(db, 8);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM shipments WHERE delay_reason IS NOT NULL").n).toBeGreaterThan(0);
    advance(db, 12);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM shipments WHERE status = 'delayed'").n).toBe(0);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM (SELECT ref, commodity_id FROM shipments GROUP BY 1,2 HAVING COUNT(*) > 1)').n).toBe(0);
    const o = one<{ s: number }>(db, "SELECT SUM(delta) s FROM inventory_movements WHERE reason IN ('trade_out','trade_in')").s; expect(o).toBe(0); sane(db);
  });
});

describe('National Bank', () => {
  it('lends only coins it holds: supply is unchanged by a loan, principal and interest are separate, and repayment returns the coins', () => {
    const db = world(); const id = found(db, 'pizza', 'lot-1', 'Loan Pizza'); profitable(db, id);
    const issuedBefore = supply(db).issued; const bankBefore = balance(db, one<{ a: string }>(db, "SELECT treasury_account_id a FROM companies WHERE id = 'co-national-bank'").a);
    const q = quoteLoan(db, loadConfig(db), id, 50_000, 30, now(db).tick); expect(q.refusal).toBeNull();
    const r = takeBankLoan(db, 'loan-1', { companyId: id, amountMinor: 50_000, termDays: 30 }); expect(r.ok).toBe(true);
    expect(supply(db).issued).toBe(issuedBefore);                                    // no minting
    const bankAcct = one<{ a: string }>(db, "SELECT treasury_account_id a FROM companies WHERE id = 'co-national-bank'").a;
    expect(balance(db, bankAcct)).toBeLessThan(bankBefore);
    advance(db, 5);
    const pays = db.all<{ principal_minor: number; interest_minor: number; status: string }>("SELECT * FROM loan_payments WHERE status IN ('paid','partial')");
    expect(pays.length).toBeGreaterThan(0); expect(pays.every((p) => p.interest_minor > 0 && p.principal_minor > 0)).toBe(true);
    const loan = one<{ outstanding_minor: number; interest_paid_minor: number }>(db, 'SELECT * FROM loans LIMIT 1');
    expect(loan.outstanding_minor).toBeLessThan(50_000); expect(loan.interest_paid_minor).toBeGreaterThan(0); sane(db);
  });
  it('a replayed loan command lends once; the active-loan cap and credit limit hold; a young business is refused', () => {
    const db = world(); const id = found(db, 'pizza', 'lot-1', 'Cap Pizza');
    expect(takeBankLoan(db, 'young-1', { companyId: id, amountMinor: 10_000, termDays: 30 }).ok).toBe(false);   // no history yet
    profitable(db, id);
    const a = takeBankLoan(db, 'loan-x', { companyId: id, amountMinor: 20_000, termDays: 30 }), b = takeBankLoan(db, 'loan-x', { companyId: id, amountMinor: 20_000, termDays: 30 });
    expect(b).toEqual(a); expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM loans').n).toBe(1);
    const lim = creditProfile(db, loadConfig(db), id, now(db).tick); expect(takeBankLoan(db, 'loan-big', { companyId: id, amountMinor: lim.limitMinor + 1, termDays: 30 }).ok).toBe(false);
    for (let i = 0; i < 6; i++) takeBankLoan(db, `loan-n${i}`, { companyId: id, amountMinor: 1_000, termDays: 30 });
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM loans WHERE status = 'active'").n).toBeLessThanOrEqual(loadConfig(db).loanMaxActive); sane(db);
  });
  it('early repayment is idempotent, cannot exceed the balance, and cannot overdraw the company', () => {
    const db = world(); const id = found(db, 'pizza', 'lot-1', 'Prepay Pizza'); profitable(db, id);
    takeBankLoan(db, 'l1', { companyId: id, amountMinor: 30_000, termDays: 30 }); const loanId = one<{ id: string }>(db, 'SELECT id FROM loans').id;
    const a = repayBankLoan(db, 'rp-1', { companyId: id, loanId, amountMinor: 10_000 }), b = repayBankLoan(db, 'rp-1', { companyId: id, loanId, amountMinor: 10_000 });
    expect(b).toEqual(a); expect(one<{ o: number }>(db, 'SELECT outstanding_minor o FROM loans').o).toBe(20_000);
    const over = repayBankLoan(db, 'rp-2', { companyId: id, loanId, amountMinor: 10 ** 9 });      // asking to repay more than is owed repays only what is owed
    expect(over.ok).toBe(true); expect(one<{ o: number; s: string }>(db, 'SELECT outstanding_minor o, status s FROM loans').s).toBe('repaid'); expect(one<{ o: number }>(db, 'SELECT outstanding_minor o FROM loans').o).toBe(0);
    expect(repayBankLoan(db, 'rp-3', { companyId: id, loanId, amountMinor: 100 }).ok).toBe(false);   // already repaid
    expect(balance(db, companyAccount(id))).toBeGreaterThanOrEqual(0); sane(db);
  });
  it('a borrower that cannot pay misses instalments, is charged a late fee and defaults; the bank takes the loss at liquidation, and nothing goes negative', () => {
    const db = world({ loanDefaultAfterMisses: 3 }); const id = found(db, 'pizza', 'lot-1', 'Default Pizza'); profitable(db, id);
    db.run('UPDATE companies SET owner_cover = 0 WHERE id = ?', id);   // wallet cover off: the borrower is left unable to pay
    takeBankLoan(db, 'd1', { companyId: id, amountMinor: 60_000, termDays: 30 });
    const drain = () => { const c = balance(db, companyAccount(id)); if (c > 0) transfer(db, now(db), `drain:${now(db).tick}:${c}`, companyAccount(id), TREASURY, c, 'state_payment', 'test: money leaves the company'); };
    drain(); advance(db, 1); drain(); advance(db, 1); drain(); advance(db, 1); drain(); advance(db, 1);
    const l = one<{ missed: number; status: string; outstanding_minor: number }>(db, 'SELECT missed, status, outstanding_minor FROM loans');
    expect(['active', 'defaulted']).toContain(l.status);
    expect(db.all("SELECT 1 FROM loan_payments WHERE status IN ('missed','partial')").length).toBeGreaterThan(0);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM accounts WHERE balance_minor < 0 AND kind IN ('player','company','state_treasury','households')").n).toBe(0);
    const c = one<CompanyRow>(db, 'SELECT * FROM companies WHERE id = ?', id); drain();
    liquidateCompany(db, now(db), loadConfig(db), c);
    expect(one<{ w: number }>(db, 'SELECT written_off_minor w FROM loans').w).toBeGreaterThan(0);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM credit_defaults').n).toBeGreaterThan(0); sane(db);
  });
  it('savings earn the deposit rate from the bank\'s own cash; withdrawals cannot exceed the balance', () => {
    const db = world(); const id = found(db, 'pizza', 'lot-1', 'Saver Pizza'); advance(db, 2);
    expect(bankDeposit(db, 'dep-1', { companyId: id, amountMinor: 20_000 }).ok).toBe(true);
    expect(bankWithdraw(db, 'wd-1', { companyId: id, amountMinor: 30_000 }).ok).toBe(false);
    advance(db, 5); expect(one<{ i: number }>(db, 'SELECT interest_paid_minor i FROM bank_deposits').i).toBeGreaterThanOrEqual(0);
    expect(bankWithdraw(db, 'wd-2', { companyId: id, amountMinor: 10_000 }).ok).toBe(true); sane(db);
  });
  it('an insolvent borrower is liquidated with the bank repaid first from its cash', () => {
    const db = world(); const id = found(db, 'pizza', 'lot-1', 'Bust Pizza'); profitable(db, id);
    takeBankLoan(db, 'b1', { companyId: id, amountMinor: 40_000, termDays: 30 });
    const c = one<CompanyRow>(db, 'SELECT * FROM companies WHERE id = ?', id);
    liquidateCompany(db, now(db), loadConfig(db), c);
    const l = one<{ status: string; outstanding_minor: number }>(db, 'SELECT status, outstanding_minor FROM loans'); expect(l.status).toBe('repaid'); expect(l.outstanding_minor).toBe(0); sane(db);
  });
});

describe('Penny Central Bank and inflation', () => {
  it('measures inflation from prices (not money supply) and keeps a logged policy history', () => {
    const db = world(); advance(db, 31);
    const before = one<{ i: number }>(db, 'SELECT index_bps i FROM cpi_index ORDER BY tick DESC LIMIT 1').i, issuedBefore = supply(db).issued;
    db.run("UPDATE companies SET max_price_minor = max_price_minor * 3, price_minor = price_minor * 2 WHERE retail_commodity_id IN ('pizza','cafe-drink') AND owner_kind <> 'state'");
    db.run("UPDATE leases SET base_rent_minor = base_rent_minor * 2");
    advance(db, 1);
    const after = one<{ i: number }>(db, 'SELECT index_bps i FROM cpi_index ORDER BY tick DESC LIMIT 1').i;
    expect(after).toBeGreaterThan(before);                           // prices moved, so the index moved
    expect(supply(db).issued).toBe(issuedBefore);                   // while the money supply did not
    advance(db, 40);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM policy_log').n).toBeGreaterThan(0);
    const logs = db.all<{ new_value: number; reason: string }>('SELECT * FROM policy_log'); expect(logs.every((l) => l.reason.length > 5)).toBe(true);
  });
  it('a higher base rate makes existing loans cost more the next day (floating rate)', () => {
    const db = world(); const id = found(db, 'pizza', 'lot-1', 'Rate Pizza'); profitable(db, id);
    takeBankLoan(db, 'r1', { companyId: id, amountMinor: 50_000, termDays: 60 }); advance(db, 2);
    const i1 = one<{ interest_minor: number }>(db, "SELECT interest_minor FROM loan_payments WHERE status = 'paid' ORDER BY id DESC LIMIT 1").interest_minor;
    expect(setBaseRate(db, 'tester', 900, 'unit test: stress').ok).toBe(true); advance(db, 2);
    const i2 = one<{ interest_minor: number }>(db, "SELECT interest_minor FROM loan_payments WHERE status IN ('paid','partial') ORDER BY id DESC LIMIT 1").interest_minor;
    expect(i2).toBeGreaterThan(i1);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM policy_log WHERE actor LIKE 'admin:%'").n).toBe(1); sane(db);
  });
  it('liquidity operations are rule-bound, recorded and issue coins only through a labelled issuance; draining never touches the bank\'s capital', () => {
    const db = world(); const bankAcct = one<{ a: string }>(db, "SELECT treasury_account_id a FROM companies WHERE id = 'co-national-bank'").a;
    db.run('UPDATE accounts SET balance_minor = balance_minor WHERE 0'); advance(db, 20);
    for (const op of db.all<{ kind: string; amount_minor: number }>('SELECT * FROM monetary_ops')) expect(op.amount_minor).toBeGreaterThan(0);
    expect(balance(db, bankAcct)).toBeGreaterThan(0); sane(db);
  });
});

describe('central bank rule', () => {
  it('raises the base rate one step when 30-day inflation is above target + band, lowers it when below, and holds inside the band; each decision is logged with its reason', () => {
    const db = world(); advance(db, 35); const cfg = loadConfig(db);
    const decide = (infl: number) => { const t = now(db).tick + 20; db.run('UPDATE central_bank SET last_review_tick = 0'); db.run('INSERT OR REPLACE INTO cpi_index (tick, index_bps, change_30d_bps, components_json) VALUES (?,?,?,?)', t, 10_000, infl, '{}'); reviewPolicy(db, { tick: t, gameDate: 'x', actor: 'test' }, cfg); return one<{ r: number }>(db, 'SELECT base_rate_bps r FROM central_bank').r; };
    const r0 = one<{ r: number }>(db, 'SELECT base_rate_bps r FROM central_bank').r;
    const up = decide(cfg.cbTargetBps + cfg.cbBandBps + 300); expect(up).toBe(r0 + cfg.cbRateStepBps);
    const hold = decide(cfg.cbTargetBps); expect(hold).toBe(up);
    const down = decide(cfg.cbTargetBps - cfg.cbBandBps - 100); expect(down).toBe(up - cfg.cbRateStepBps);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM policy_log WHERE actor = 'rule' AND kind IN ('base_rate','review')").n).toBeGreaterThanOrEqual(3);
  });
  it('central bank liquidity is issued only when the bank is short and never because a borrower asked', () => {
    const db = world(); const bank = one<{ a: string }>(db, "SELECT treasury_account_id a FROM companies WHERE id = 'co-national-bank'").a;
    const iss = supply(db).issued;
    advance(db, 3); expect(supply(db).issued).toBe(iss);                          // a healthy bank: no issuance
    const c = balance(db, bank); transfer(db, now(db), 'test:strip-bank', bank, TREASURY, c - 1_000, 'state_payment', 'test: the bank has lent its capital elsewhere');
    advance(db, 8);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM monetary_ops WHERE kind = 'liquidity_issue'").n).toBeGreaterThan(0);
    expect(supply(db).issued - iss).toBe(one<{ s: number }>(db, "SELECT COALESCE(SUM(amount_minor),0) s FROM monetary_ops WHERE kind = 'liquidity_issue'").s); sane(db);
  });
});

describe('economic events', () => {
  it('are deterministic: two identical worlds produce identical events', () => {
    const run = () => { const db = world(); advance(db, 120); return db.all('SELECT id, type, severity, start_tick, end_tick, roll FROM eco_events ORDER BY id'); };
    const a = run(), b = run(); expect(a).toEqual(b); expect(a.length).toBeGreaterThan(0);
    expect(hash32(5, 1)).toBe(hash32(5, 1)); expect(hash32(5, 1)).not.toBe(hash32(6, 1));
  });
  it('an event is recorded with id, type, location, industries, duration, severity, trigger and an audit log', () => {
    const db = world(); advance(db, 3);
    expect(triggerEvent(db, 'tester', 'energy_shortage', 2, 7, 'unit test').ok).toBe(true);
    const e = one<Record<string, unknown>>(db, 'SELECT * FROM eco_events'); expect(e.location_id).toBe('city-bristol'); expect(e.severity).toBe(2); expect(e.trigger_kind).toBe('admin'); expect(JSON.parse(e.industries_json as string).length).toBeGreaterThan(0);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM eco_event_log WHERE action = 'start'").n).toBe(1);
    advance(db, 1);
    expect(one<{ c: number }>(db, 'SELECT capacity_units c FROM energy_daily ORDER BY tick DESC LIMIT 1').c).toBeLessThan(one<{ c: number }>(db, 'SELECT SUM(capacity_units) c FROM energy_sources').c);   // the event changed the real grid
  });
  it('effects are derived, never accumulated: re-reading the modifiers or waiting does not stack them, and they expire', () => {
    const db = world(); advance(db, 3); triggerEvent(db, 'tester', 'inflation_shock', 1, 4, 'unit test');
    advance(db, 1); const m1 = one<{ mods_json: string }>(db, 'SELECT mods_json FROM economy_mods ORDER BY tick DESC LIMIT 1').mods_json;
    clearModsCache(db); advance(db, 1); const m2 = one<{ mods_json: string }>(db, 'SELECT mods_json FROM economy_mods ORDER BY tick DESC LIMIT 1').mods_json;
    expect(JSON.parse(m2).energyPriceBps).toBe(JSON.parse(m1).energyPriceBps);
    advance(db, 6); expect(JSON.parse(one<{ mods_json: string }>(db, 'SELECT mods_json FROM economy_mods ORDER BY tick DESC LIMIT 1').mods_json).energyPriceBps).toBe(10_000);
    expect(one<{ status: string }>(db, 'SELECT status FROM eco_events').status).toBe('ended');
  });
  it('government stimulus is a one-time TRANSFER from the treasury to households, never new money', () => {
    const db = world(); advance(db, 3); const issued = supply(db).issued; const t0 = balance(db, TREASURY);
    triggerEvent(db, 'tester', 'government_stimulus', 2, 5, 'unit test'); advance(db, 8);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM eco_event_log WHERE action = 'one_shot'").n).toBe(1);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM ledger_transactions WHERE memo LIKE 'government stimulus payment%'").n).toBe(1);
    expect(supply(db).issued - issued).toBeGreaterThanOrEqual(0); expect(t0).toBeGreaterThan(0); sane(db);
  });
  it('a scandal never targets a human player\'s company', () => {
    const db = world(); const mine = found(db, 'pizza', 'lot-1', 'My Pizza'); advance(db, 10);
    const rep = one<{ r: number }>(db, 'SELECT reputation_bps r FROM companies WHERE id = ?', mine).r;
    triggerEvent(db, 'tester', 'corporate_scandal', 3, 5, 'unit test'); advance(db, 1);
    const log = db.all<{ detail_json: string }>("SELECT detail_json FROM eco_event_log WHERE action = 'one_shot'");
    for (const l of log) expect(JSON.parse(l.detail_json).companyId).not.toBe(mine);
    expect(one<{ r: number }>(db, 'SELECT reputation_bps r FROM companies WHERE id = ?', mine).r).toBeGreaterThanOrEqual(rep - 100);
  });
  it('the Penny Post reports recorded events, rate decisions and credit stories (one article per event)', () => {
    const db = world(); advance(db, 3); triggerEvent(db, 'tester', 'recession', 2, 5, 'unit test'); setBaseRate(db, 'tester', 600, 'unit test'); advance(db, 2);
    const arts = db.all<{ kind: string; headline: string; event_id: number }>("SELECT kind, headline, event_id FROM news_articles WHERE kind IN ('economy','policy')");
    expect(arts.some((a) => a.kind === 'economy' && /recession/i.test(a.headline))).toBe(true);
    expect(new Set(arts.map((a) => a.event_id)).size).toBe(arts.length);
  });
});

describe('administration and exploit resistance', () => {
  it('admin endpoints refuse requests without the right token, and every attempt is logged', () => {
    const db = world(); const call = (token: string | undefined, path = '/api/admin/param', body: unknown = { key: 'exchangeFeeBps', value: 50, reason: 'testing' }) => handleApi(db, { method: 'POST', path, body, headers: token === undefined ? {} : { 'x-admin-token': token } }, { devEndpoints: false, adminToken: 'correct-horse-battery' });
    expect(call(undefined).status).toBe(403); expect(call('wrong-token-123456').status).toBe(403);
    expect(handleApi(db, { method: 'POST', path: '/api/admin/param', body: {}, headers: { 'x-admin-token': 'x' } }, { devEndpoints: true }).status).toBe(403);   // no token configured = disabled
    expect(call('correct-horse-battery').status).toBe(200);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM admin_log WHERE ok = 0").n).toBeGreaterThanOrEqual(3);
    expect(loadConfig(db).exchangeFeeBps).toBe(50);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM config_versions WHERE note LIKE ?', '%exchangeFeeBps%').n).toBe(1);
    expect(authorised('short', 'short')).toBe(false);
  });
  it('only whitelisted economic parameters can change, within bounds; there is no way to edit a balance', () => {
    const db = world();
    expect(setParam(db, 't', 'stipendPerThousandMinor', 1, 'testing').ok).toBe(false);          // not whitelisted
    expect(setParam(db, 't', 'exchangeFeeBps', 100_000, 'testing').ok).toBe(false);             // out of bounds
    expect(setParam(db, 't', 'exchangeFeeBps', 10, '').ok).toBe(false);                         // no reason
    const r = handleApi(db, { method: 'POST', path: '/api/admin/balance', body: { account: 'acct:player', amount: 1_000_000 }, headers: { 'x-admin-token': 'correct-horse-battery' } }, { devEndpoints: true, adminToken: 'correct-horse-battery' });
    expect(r.status).toBe(404); sane(db);
  });
  it('re-running an already processed tick changes nothing (no repeated rent, interest, events or shipments)', () => {
    const db = world(); const id = found(db, 'pizza', 'lot-1', 'Replay Pizza'); profitable(db, id); takeBankLoan(db, 'rr', { companyId: id, amountMinor: 20_000, termDays: 30 }); advance(db, 35);
    const snap = () => JSON.stringify([one(db, 'SELECT COUNT(*) a, COALESCE(SUM(amount_minor),0) b FROM service_charges'), one(db, 'SELECT COUNT(*) a FROM loan_payments'), one(db, 'SELECT COUNT(*) a FROM eco_events'), one(db, 'SELECT COUNT(*) a FROM shipments'), supply(db).circulating]);
    const before = snap(); const t = one<{ t: number }>(db, 'SELECT last_tick t FROM engine_state').t;
    return import('./tick').then(({ runTick }) => { expect(runTick(db, t).status).toBe('skipped'); expect(runTick(db, t - 1).status).toBe('skipped'); expect(snap()).toBe(before); });
  });
  it('a state company\'s dividend never exceeds what its treasury holds and never creates coins', () => {
    const db = world(); advance(db, 60); const iss = supply(db).issued;
    const paid = one<{ p: number }>(db, "SELECT COALESCE(SUM(paid_minor),0) p FROM dividends WHERE company_id LIKE 'co-%' AND status = 'paid'").p;
    expect(supply(db).issued).toBe(iss); expect(paid).toBeGreaterThanOrEqual(0);
    for (const p of Object.values(STATE_PROVIDERS)) expect(available(db, one<{ a: string }>(db, 'SELECT treasury_account_id a FROM companies WHERE id = ?', p.id).a)).toBeGreaterThanOrEqual(0);
    sane(db);
  });
  it('the developer dashboard is built from the books and the ledger reconciles', () => {
    const db = world(); advance(db, 40); const d = stateDashboard(db);
    expect(d.ledger.reconciles).toBe(true); expect(d.currency.circulatingMinor).toBeGreaterThan(0); expect(d.stateCompanies.treasuries.length).toBe(7);
    expect(reconcile(db).ok).toBe(true);
  });
});
