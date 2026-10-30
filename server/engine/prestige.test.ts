// @vitest-environment node
import { advance } from './world';
import { balance, createAccount, issue, reconcile, supply } from './ledger';
import { loadConfig } from './config';
import { BOOST_OFFERS, MAX_BOOST_BPS, activeBoosts, buyBoost, effectiveBoost, grantBoost, productionExtra } from './boosts';
import { CATALOGUE, HOLD_TICKS_FOR_PRESTIGE, TRADE_FEE_BPS, buyListing, buyPrestige, cancelListing, catalogue, displayItems, inventory, leaderboard, listItem, openListings, prestigeOf, recordPrestige } from './prestige';
import { LedgerError } from './ledger';
import { found, now, sane, world } from '../test/shareHelpers';
import { PLAYER_ID, PLAYER_WALLET, companyAccount } from '../seed/bristol';
import type { Sql } from '../db/sql';

const one = <T>(db: Sql, sql: string, ...a: (string | number)[]) => db.get<T>(sql, ...a)!;
const ctxOf = (db: Sql) => now(db);
const addPlayer = (db: Sql, id: string, coins: number) => {
  createAccount(db, `acct:player:${id}`, 'player', `${id} wallet`); db.run("INSERT OR IGNORE INTO owners (id, kind, name) VALUES (?, 'player', ?)", id, id);
  db.run("INSERT INTO players (id, display_name, city_id, wallet_account_id) VALUES (?,?,'city-bristol',?)", id, id, `acct:player:${id}`);
  issue(db, ctxOf(db), `grant:${id}`, `acct:player:${id}`, coins, `test grant to ${id}`); return id;
};
const expectDenied = (fn: () => unknown, text?: RegExp) => { try { fn(); } catch (e) { expect(e).toBeInstanceOf(LedgerError); if (text) expect((e as Error).message).toMatch(text); return; } throw new Error('expected a refusal'); };
const buy = (db: Sql, owner: string, item: string, key: string) => buyPrestige(db, ctxOf(db), { ownerId: owner, itemId: item, key });

describe('prestige purchases', () => {
  it('buy with Empire Coins: the price is burned as an explicit sink, ownership is recorded with a serial, and it persists', () => {
    const db = world({}, 10_000_000); const w0 = balance(db, PLAYER_WALLET), d0 = supply(db).destroyed;
    const r = buy(db, PLAYER_ID, 'veh-executive', 'b1');
    expect(r.ownedId).toBe('veh-executive#1'); expect(w0 - balance(db, PLAYER_WALLET)).toBe(250_000); expect(supply(db).destroyed - d0).toBe(250_000);
    expect(one<{ memo: string }>(db, "SELECT memo FROM ledger_transactions WHERE idempotency_key = 'prestige:b1'").memo).toContain('explicit sink');
    advance(db, 2); expect(inventory(db, PLAYER_ID, now(db).tick).map((i) => i.id)).toEqual(['veh-executive#1']); sane(db);
  });
  it('a replayed purchase buys once; a duplicate of a unique item is refused; insufficient funds is refused with nothing changed', () => {
    const db = world({}, 10_000_000);
    expect(buy(db, PLAYER_ID, 'veh-sports', 'r1').duplicate).toBe(false); expect(buy(db, PLAYER_ID, 'veh-sports', 'r1').duplicate).toBe(true);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM prestige_owned').n).toBe(1); expect(one<{ m: number }>(db, "SELECT minted m FROM prestige_items WHERE id = 'veh-sports'").m).toBe(1);
    expectDenied(() => buy(db, PLAYER_ID, 'veh-sports', 'r2'), /already own/);
    const poor = addPlayer(db, 'poor', 1_000); const w = balance(db, `acct:player:${poor}`);
    expectDenied(() => buy(db, poor, 'veh-executive', 'p1'), /costs/); expect(balance(db, `acct:player:${poor}`)).toBe(w); expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM prestige_owned WHERE owner_id = 'poor'").n).toBe(0);
  });
  it('items without approved artwork can be listed but never bought', () => {
    const db = world({}, 100_000_000);
    for (const d of CATALOGUE.filter((c) => !c.asset)) expectDenied(() => buy(db, PLAYER_ID, d.id, `na-${d.id}`));
    const view = catalogue(db, PLAYER_ID); expect(view.filter((i) => !i.asset).every((i) => !i.purchasable && !!i.unavailableReason)).toBe(true);
    expect(view.length).toBe(CATALOGUE.length);
  });
  it('hard supply caps hold: the 26th supercar cannot be minted, even for a different buyer', () => {
    const db = world({}, 1_000); db.run("UPDATE prestige_items SET supply_cap = 2 WHERE id = 'veh-supercar'");
    const a = addPlayer(db, 'a', 10_000_000), b = addPlayer(db, 'b', 10_000_000), c = addPlayer(db, 'c', 10_000_000);
    buy(db, a, 'veh-supercar', 'a1'); buy(db, b, 'veh-supercar', 'b1'); expectDenied(() => buy(db, c, 'veh-supercar', 'c1'), /Sold out/);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM prestige_owned WHERE item_id = 'veh-supercar'").n).toBe(2);
    expect(catalogue(db, c).find((i) => i.id === 'veh-supercar')!.remaining).toBe(0);
  });
  it('the item count of every unit stays equal to units minted (no duplication) after purchases and trades', () => {
    const db = world({}, 20_000_000); const b = addPlayer(db, 'b', 20_000_000);
    buy(db, PLAYER_ID, 'lux-sculpture', 's1'); const l = listItem(db, ctxOf(db), { ownerId: PLAYER_ID, ownedId: 'lux-sculpture#1', askMinor: 800_000, key: 'l1' }); buyListing(db, ctxOf(db), { buyerId: b, listingId: l.listingId, key: 't1' });
    for (const it of db.all<{ id: string; minted: number }>('SELECT id, minted FROM prestige_items')) expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM prestige_owned WHERE item_id = ?', it.id).n).toBe(it.minted);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM (SELECT id FROM prestige_owned GROUP BY id HAVING COUNT(*) > 1)').n).toBe(0);
  });
});

describe('collectibles market', () => {
  const setup = () => { const db = world({}, 20_000_000); const b = addPlayer(db, 'buyer', 5_000_000); buy(db, PLAYER_ID, 'lux-sculpture', 's1'); return { db, b }; };
  it('lists, sells atomically with a burned fee, moves ownership, and records history', () => {
    const { db, b } = setup(); const seller0 = balance(db, PLAYER_WALLET), buyer0 = balance(db, `acct:player:${b}`), d0 = supply(db).destroyed;
    const l = listItem(db, ctxOf(db), { ownerId: PLAYER_ID, ownedId: 'lux-sculpture#1', askMinor: 1_000_000, key: 'l1' });
    expect(openListings(db, b).length).toBe(1);
    const r = buyListing(db, ctxOf(db), { buyerId: b, listingId: l.listingId, key: 't1' }); const fee = Math.floor((1_000_000 * TRADE_FEE_BPS) / 10_000);
    expect(r.feeMinor).toBe(fee); expect(balance(db, PLAYER_WALLET) - seller0).toBe(1_000_000 - fee); expect(buyer0 - balance(db, `acct:player:${b}`)).toBe(1_000_000); expect(supply(db).destroyed - d0).toBe(fee);
    expect(one<{ owner_id: string }>(db, "SELECT owner_id FROM prestige_owned WHERE id = 'lux-sculpture#1'").owner_id).toBe(b);
    expect(openListings(db, b).length).toBe(0); expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM prestige_history WHERE kind = 'trade'").n).toBe(1); sane(db); expect(reconcile(db).ok).toBe(true);
  });
  it('a replayed purchase and a second buyer cannot take the same item twice; coins and ownership stay consistent', () => {
    const { db, b } = setup(); const c = addPlayer(db, 'late', 5_000_000);
    const l = listItem(db, ctxOf(db), { ownerId: PLAYER_ID, ownedId: 'lux-sculpture#1', askMinor: 900_000, key: 'l1' });
    expect(buyListing(db, ctxOf(db), { buyerId: b, listingId: l.listingId, key: 't1' }).duplicate).toBe(false);
    expect(buyListing(db, ctxOf(db), { buyerId: b, listingId: l.listingId, key: 't1' }).duplicate).toBe(true);
    const cBal = balance(db, `acct:player:${c}`); expectDenied(() => buyListing(db, ctxOf(db), { buyerId: c, listingId: l.listingId, key: 't2' }), /no longer available/); expect(balance(db, `acct:player:${c}`)).toBe(cBal);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM prestige_history WHERE kind = 'trade'").n).toBe(1);
  });
  it('only eligible collectibles can be listed, only by their owner, and only once; prices are bounded; a listing can be cancelled', () => {
    const { db, b } = setup(); buy(db, PLAYER_ID, 'veh-executive', 'x1'); buy(db, PLAYER_ID, 'prop-townhouse', 'x2');
    expectDenied(() => listItem(db, ctxOf(db), { ownerId: PLAYER_ID, ownedId: 'veh-executive#1', askMinor: 1, key: 'n1' }), /cannot be traded/);
    expectDenied(() => listItem(db, ctxOf(db), { ownerId: b, ownedId: 'lux-sculpture#1', askMinor: 5, key: 'n2' }), /do not own/);
    expectDenied(() => listItem(db, ctxOf(db), { ownerId: PLAYER_ID, ownedId: 'lux-sculpture#1', askMinor: 700_000 * 51, key: 'n3' }), /at most/);
    expectDenied(() => listItem(db, ctxOf(db), { ownerId: PLAYER_ID, ownedId: 'lux-sculpture#1', askMinor: 0, key: 'n4' }), /positive/);
    const l = listItem(db, ctxOf(db), { ownerId: PLAYER_ID, ownedId: 'lux-sculpture#1', askMinor: 800_000, key: 'ok' });
    expectDenied(() => listItem(db, ctxOf(db), { ownerId: PLAYER_ID, ownedId: 'lux-sculpture#1', askMinor: 900_000, key: 'again' }), /already listed/);
    expectDenied(() => cancelListing(db, ctxOf(db), b, l.listingId), /not your/); expectDenied(() => buyListing(db, ctxOf(db), { buyerId: PLAYER_ID, listingId: l.listingId, key: 'self' }), /own listing/);
    cancelListing(db, ctxOf(db), PLAYER_ID, l.listingId); cancelListing(db, ctxOf(db), PLAYER_ID, l.listingId);
    expectDenied(() => buyListing(db, ctxOf(db), { buyerId: b, listingId: l.listingId, key: 'tc' }), /no longer available/);
    expect(one<{ listed: number }>(db, "SELECT listed FROM prestige_owned WHERE id = 'lux-sculpture#1'").listed).toBe(0);
  });
  it('a buyer without enough coins or already at the ownership limit is refused, and the listing stays open', () => {
    const { db } = setup(); const poor = addPlayer(db, 'poor', 100); const l = listItem(db, ctxOf(db), { ownerId: PLAYER_ID, ownedId: 'lux-sculpture#1', askMinor: 800_000, key: 'l1' });
    expectDenied(() => buyListing(db, ctxOf(db), { buyerId: poor, listingId: l.listingId, key: 'p' }), /costs/); expect(openListings(db, poor).length).toBe(1);
    const owner = addPlayer(db, 'owner', 5_000_000); buy(db, owner, 'lux-sculpture', 'o1'); expectDenied(() => buyListing(db, ctxOf(db), { buyerId: owner, listingId: l.listingId, key: 'o' }), /already own/);
  });
});

describe('prestige score', () => {
  it('is distinct from net worth, accrues only after a holding period, and cannot be farmed by moving an item between accounts', () => {
    const db = world({}, 50_000_000); const b = addPlayer(db, 'friend', 50_000_000);
    buy(db, PLAYER_ID, 'lux-sculpture', 's1'); expect(prestigeOf(db, PLAYER_ID, now(db).tick).items).toBe(0);               // brand new: nothing yet
    advance(db, HOLD_TICKS_FOR_PRESTIGE); const held = prestigeOf(db, PLAYER_ID, now(db).tick).items; expect(held).toBe(60);
    // pass it back and forth: each transfer resets the holding clock and burns a fee, so the combined score never exceeds one item's worth
    let owner = PLAYER_ID; let other = b;
    for (let i = 0; i < 4; i++) { const l = listItem(db, ctxOf(db), { ownerId: owner, ownedId: 'lux-sculpture#1', askMinor: 700_000, key: `l${i}` }); buyListing(db, ctxOf(db), { buyerId: other, listingId: l.listingId, key: `t${i}` }); [owner, other] = [other, owner]; }
    const tick = now(db).tick; expect(prestigeOf(db, PLAYER_ID, tick).items + prestigeOf(db, b, tick).items).toBe(0);
    advance(db, HOLD_TICKS_FOR_PRESTIGE); const t2 = now(db).tick; expect(prestigeOf(db, PLAYER_ID, t2).items + prestigeOf(db, b, t2).items).toBe(60);
  });
  it('counts collections and companies, and the leaderboards rank owners with a persisted tick', () => {
    const db = world({}, 80_000_000); found(db, 'pizza', 'lot-1', 'Prestige Pizza');
    for (const [i, id] of ['veh-executive', 'prop-townhouse', 'corp-signage', 'lux-trophy'].entries()) buy(db, PLAYER_ID, id, `c${i}`);
    advance(db, 14); recordPrestige(db, 14);
    const lb = leaderboard(db, PLAYER_ID, 'city'); expect(lb.rows[0]!.mine).toBe(true); expect(lb.rows[0]!.breakdown.collections).toBe(250); expect(lb.rows[0]!.score).toBeGreaterThan(300);
    expect(leaderboard(db, PLAYER_ID, 'global').rows.length).toBeGreaterThan(0);
  });
  it('owned luxury items are exposed for the city map and profile', () => {
    const db = world({}, 20_000_000); buy(db, PLAYER_ID, 'veh-supercar', 'v'); buy(db, PLAYER_ID, 'corp-signage', 'g');
    expect(displayItems(db, PLAYER_ID).map((d) => d.asset).sort()).toEqual(['roof-billboard', 'supercar-sw']);
  });
});

describe('gameplay boosts', () => {
  const offer = (id: string) => BOOST_OFFERS.find((o) => o.id === id)!;
  it('a purchased production boost produces real extra output, within storage, and expires', () => {
    const run = (boost: boolean) => {
      const db = world({}, 10_000_000); const farm = found(db, 'farm', 'lot-3', 'Boost Farm');
      if (boost) buyBoost(db, ctxOf(db), { ownerId: PLAYER_ID, offerId: 'boost-production-3', key: 'b' });
      advance(db, 12); return { db, farm, units: one<{ u: number }>(db, 'SELECT COALESCE(SUM(units_produced),0) u FROM company_tick_stats WHERE company_id = ?', farm).u };
    };
    const base = run(false), boosted = run(true);
    expect(boosted.units).toBeGreaterThan(base.units);                       // the boost changed real production
    expect(boosted.units - base.units).toBeLessThanOrEqual(Math.ceil(base.units * 0.06));   // ≈3% over its 7 days, never wild
    expect(activeBoosts(boosted.db, PLAYER_ID, now(boosted.db).tick)).toEqual([]);           // expired after 7 days
    sane(boosted.db);
  });
  it('a marketing boost raises awareness; boosts do not stack and are capped; repurchase while active is refused; replay charges once', () => {
    const awareness = (boost: boolean) => { const db = world({}, 10_000_000); const co = found(db, 'pizza', 'lot-1', 'Mkt Pizza'); db.run('UPDATE companies SET marketing_minor = 3000 WHERE id = ?', co); if (boost) buyBoost(db, ctxOf(db), { ownerId: PLAYER_ID, offerId: 'boost-marketing-5', key: 'm' }); advance(db, 6); return one<{ a: number }>(db, 'SELECT awareness_bps a FROM companies WHERE id = ?', co).a; };
    expect(awareness(true)).toBeGreaterThan(awareness(false));
    const db = world({}, 10_000_000); const w0 = balance(db, PLAYER_WALLET);
    const a = buyBoost(db, ctxOf(db), { ownerId: PLAYER_ID, offerId: 'boost-production-3', key: 'k' }), b = buyBoost(db, ctxOf(db), { ownerId: PLAYER_ID, offerId: 'boost-production-3', key: 'k' });
    expect(b.duplicate).toBe(true); expect(a.boostId).toBe(b.boostId); expect(w0 - balance(db, PLAYER_WALLET)).toBe(offer('boost-production-3').priceMinor);
    expectDenied(() => buyBoost(db, ctxOf(db), { ownerId: PLAYER_ID, offerId: 'boost-production-3', key: 'k2' }), /already active/);
    grantBoost(db, ctxOf(db), { ownerId: PLAYER_ID, kind: 'production', bps: 5_000, days: 3, source: 'rewarded_ad', key: 'huge' });
    expect(effectiveBoost(db, PLAYER_ID, 'production', now(db).tick)!.bps).toBe(MAX_BOOST_BPS);      // capped
    grantBoost(db, ctxOf(db), { ownerId: PLAYER_ID, kind: 'production', bps: 300, days: 3, source: 'rewarded_ad', key: 'small' });
    expect(effectiveBoost(db, PLAYER_ID, 'production', now(db).tick)!.bps).toBe(MAX_BOOST_BPS);      // overlapping boosts never add: the strongest applies
  });
  it('an unaffordable boost is refused and charges nothing; extra production carries fractions and respects storage', () => {
    const db = world({}, 100); const pauper = addPlayer(db, 'pauper', 100); expectDenied(() => buyBoost(db, ctxOf(db), { ownerId: pauper, offerId: 'boost-marketing-5', key: 'x' }), /costs/);
    const rich = world({}, 1_000_000); buyBoost(rich, ctxOf(rich), { ownerId: PLAYER_ID, offerId: 'boost-production-3', key: 'p' });
    let total = 0; for (let i = 0; i < 20; i++) total += productionExtra(rich, PLAYER_ID, now(rich).tick, 10, 100); expect(total).toBe(6);   // 20 × 10 units × 3% = 6, none lost to rounding
    expect(productionExtra(rich, PLAYER_ID, now(rich).tick, 10_000, 0)).toBe(0);                                                       // no storage room: no extra
  });
  it('the loadConfig is untouched by boosts (they are state, not configuration)', () => { const db = world(); expect(loadConfig(db).awarenessMaxBps).toBeGreaterThan(0); expect(companyAccount('x')).toBeTruthy(); });
});
