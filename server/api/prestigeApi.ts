import { actingPlayer, actingWallet } from '../engine/actor';
import type { Sql } from '../db/sql';
import { activeBoosts } from '../engine/boosts';
import { BOOST_OFFERS, MAX_BOOST_BPS } from '../engine/boosts';
import { balance } from '../engine/ledger';
import { catalogue, inventory, leaderboard, openListings, prestigeOf, tradeHistory, TRADE_FEE_BPS, HOLD_TICKS_FOR_PRESTIGE } from '../engine/prestige';
import { membershipView } from '../engine/membership';
import { AD_REWARDS, adRewardHistory, programs, rewardAvailability } from '../engine/rewards';
import { lotteryView } from '../engine/lottery';
import { walletView } from '../engine/gbpWallet';
import { ensureWallet } from '../engine/gbpLedger';


const tickOf = (db: Sql) => db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;

export function prestigeScreen(db: Sql) {
  const tick = tickOf(db); const m = membershipView(db, actingPlayer(), tick);
  return {
    tick, coinsMinor: balance(db, actingWallet()), items: catalogue(db, actingPlayer()), inventory: inventory(db, actingPlayer(), tick), score: prestigeOf(db, actingPlayer(), tick), holdTicks: HOLD_TICKS_FOR_PRESTIGE,
    boosts: { offers: BOOST_OFFERS, active: activeBoosts(db, actingPlayer(), tick), capBps: MAX_BOOST_BPS, note: 'Boosts are small, temporary and never stack: the strongest active boost of a kind applies, capped at 10%. They change real production and marketing calculations and nothing else.' },
    premium: { active: m.active, status: m.status },
    boards: { city: leaderboard(db, actingPlayer(), 'city'), global: leaderboard(db, actingPlayer(), 'global') },
    disclosures: ['Prestige items are fictional and bought with Empire Coins. The price is destroyed (a currency sink); items cannot be turned back into coins at the shop price.', 'Empire Coins are not money and cannot be withdrawn. GBP_TEST is a separate simulated wallet.'],
  };
}
export function marketScreen(db: Sql) {
  const tick = tickOf(db);
  return { tick, feeBps: TRADE_FEE_BPS, coinsMinor: balance(db, actingWallet()), listings: openListings(db, actingPlayer()), history: tradeHistory(db, 30), mine: inventory(db, actingPlayer(), tick).filter((i) => i.tradeable), note: 'Collectibles trade for Empire Coins only. Each sale burns a 5% fee. Real-money resale is not possible.' };
}
export function rewardsScreen(db: Sql, nowMs: number) {
  const tick = tickOf(db); const ctx = { tick, gameDate: '', actor: actingPlayer() };
  return {
    tick, nowMs, ads: { catalogue: rewardAvailability(db, ctx, nowMs, actingPlayer()), history: adRewardHistory(db, actingPlayer()), provider: 'SIMULATED provider: no real advertisement is shown and no real advertiser pays.', rewards: AD_REWARDS.length },
    lotteries: lotteryView(db, actingPlayer(), tick),
    draws: db.all('SELECT d.id, d.name, d.closes_tick closesTick, d.status, d.winner_id winnerId, (SELECT COUNT(*) FROM prize_draw_entries e WHERE e.draw_id = d.id) entries, EXISTS(SELECT 1 FROM prize_draw_entries e WHERE e.draw_id = d.id AND e.player_id = ?) entered, p.award_pence prizePence FROM prize_draws d JOIN reward_programs p ON p.id = d.program_id ORDER BY d.closes_tick DESC LIMIT 6', actingPlayer()),
    programs: programs(db),
    notice: 'Cash-style rewards are SIMULATED GBP_TEST paid from a reserved test treasury. Coin lotteries use fictional Empire Coins only and never pay cash.',
  };
}
export function walletScreen(db: Sql) {
  ensureWallet(db, actingPlayer());
  return { ...walletView(db, actingPlayer()), notice: 'SIMULATED. GBP_TEST is test money: no real deposit, card, bank or payout is involved and nothing here can be converted to or from Empire Coins.', coinsMinor: balance(db, actingWallet()) };
}
