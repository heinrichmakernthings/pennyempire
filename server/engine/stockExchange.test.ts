// @vitest-environment node
import { advance } from './world';
import { balance, issue, supply } from './ledger';
import { loadConfig } from './config';
import { holding, outstanding, security, stakeBps, treasuryShares } from './capital';
import { listingQuote } from './listing';
import { declarePlayerDividend, listPlayerCompany, placePlayerShareOrder } from './shareCommands';
import { cancelShareOrder, placeShareOrder, priceBand } from './shareMarket';
import { shareCfg } from './listing';
import { PLAYER_ID, PLAYER_WALLET, companyAccount } from '../seed/bristol';
import { found, now, sane, world } from '../test/shareHelpers';

describe('essential gameplay: pizza restaurant → IPO → NPC investor → dividend → sale', () => {
  it('every coin, share and percentage reconciles', () => {
    const db = world(); const cfg = loadConfig(db);
    const pizza = found(db, 'pizza', 'lot-1', 'Quay Pizza');
    advance(db, 20);
    // 1. list part of the company
    const price = listingQuote(db, cfg, pizza, 3_000, 1, 20, { kind: 'player', id: PLAYER_ID }).priceRange.fairValueMinor;
    const q = listingQuote(db, cfg, pizza, 3_000, price, 20, { kind: 'player', id: PLAYER_ID });
    expect(q.eligible).toBe(true);
    const treasury0 = balance(db, companyAccount(pizza)); const s0 = supply(db);
    const r = listPlayerCompany(db, 'ipo-1', { companyId: pizza, newShares: 3_000, offerPriceMinor: price });
    expect(r.ok).toBe(true); sane(db);
    expect(security(db, pizza)!.status).toBe('open'); expect(security(db, pizza)!.issued_shares).toBe(13_000); expect(treasuryShares(db, pizza)).toBe(3_000); expect(outstanding(db, pizza)).toBe(10_000);
    expect(treasury0 - balance(db, companyAccount(pizza))).toBe(q.listingFeeMinor);
    expect(supply(db).circulating).toBe(s0.circulating);    // the listing fee is a transfer, not a sink
    // 2. an NPC investor buys 1,000 shares of the primary offering
    const npc = 'inv-npc-1'; issue(db, now(db), 'topup-1', 'acct:investor:1', 500_000, 'test: NPC investor top-up'); const cash0 = balance(db, 'acct:investor:1');
    const p = placeShareOrder(db, now(db), shareCfg(cfg), { company: pizza, investor: npc, side: 'buy', price, qty: 1_000, key: 'npc-buy' });
    expect(p.fills.reduce((a, f) => a + f.qty, 0)).toBe(1_000);
    expect(cash0 - balance(db, 'acct:investor:1')).toBe(price * 1_000);
    expect(balance(db, companyAccount(pizza)) - (treasury0 - q.listingFeeMinor)).toBe(price * 1_000);   // proceeds went into the COMPANY
    expect(stakeBps(db, pizza, npc)).toBe(Math.floor((1_000 * 10_000) / 11_000)); sane(db);
    expect(security(db, pizza)!.paid_in_minor).toBeGreaterThan(price * 1_000);
    // 3. the restaurant earns real profit; the player declares a dividend from its treasury
    advance(db, 10); sane(db);
    const per = 20; const walletBefore = balance(db, PLAYER_WALLET), npcBefore = balance(db, 'acct:investor:1');
    const d = declarePlayerDividend(db, 'div-1', pizza, per); expect(d.ok).toBe(true);
    const eligible = outstanding(db, pizza);
    advance(db, 2);
    const row = db.get<{ status: string; total_minor: number }>('SELECT status, total_minor FROM dividends WHERE company_id = ?', pizza)!;
    expect(row.status).toBe('paid'); expect(row.total_minor).toBe(per * eligible);
    const ent = db.get<{ shares: number; amount_minor: number }>("SELECT e.shares, e.amount_minor FROM dividend_entitlements e JOIN dividends d ON d.id = e.dividend_id WHERE d.company_id = ? AND e.investor_id = 'inv-npc-1'", pizza)!;
    expect(ent.amount_minor).toBe(per * ent.shares); expect(ent.shares).toBeGreaterThan(0); sane(db);
    expect(db.get<{ n: number }>('SELECT SUM(amount_minor) n FROM dividend_entitlements WHERE dividend_id = ?', row.status && 1)!.n).toBeGreaterThan(0);
    expect(balance(db, PLAYER_WALLET) - walletBefore).toBe(per * 10_000); void npcBefore;
    // 4. the NPC investor sells at a different price to the player
    const npcHeld = holding(db, pizza, npc).shares;
    expect(npcHeld).toBeGreaterThanOrEqual(400);
    const ref = priceBand(db, cfg, pizza, now(db).tick)!;
    const sellPx = Math.min(ref.high, ref.ref + 5);
    for (const o of db.all<{ id: number }>("SELECT id FROM share_orders WHERE company_id = ? AND status = 'open' AND side = 'sell' AND investor_id <> 'co:' || company_id AND price_minor <= ?", pizza, sellPx)) cancelShareOrder(db, o.id);
    placeShareOrder(db, now(db), shareCfg(cfg), { company: pizza, investor: npc, side: 'sell', price: sellPx, qty: 400, key: 'npc-sell' });
    const buy = placePlayerShareOrder(db, 'p-buy', { companyId: pizza, side: 'buy', quantity: 400, limitPriceMinor: sellPx });
    expect(buy.ok).toBe(true);
    const pnl = db.get<{ proceeds_minor: number; cost_minor: number; pnl_minor: number }>("SELECT * FROM share_pnl WHERE investor_id = 'inv-npc-1'")!;
    expect(pnl.proceeds_minor).toBeGreaterThan(0); expect(pnl.pnl_minor).toBe(pnl.proceeds_minor - pnl.cost_minor);
    expect(holding(db, pizza, npc).shares).toBe(npcHeld - 400); expect(holding(db, pizza, PLAYER_ID).shares).toBe(10_000 + 400);
    sane(db);
    // journal: every share that exists is accounted for
    const created = db.get<{ n: number }>("SELECT SUM(qty) n FROM share_journal WHERE company_id = ? AND kind IN ('founder','issue')", pizza)!.n;
    expect(created).toBe(13_000);
  });
});
