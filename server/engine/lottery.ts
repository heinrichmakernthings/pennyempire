import type { Sql } from '../db/sql';
import { LedgerError, available, createAccount, destroy, transfer, type TickCtx } from './ledger';
import { secureRandomInt, sha256 } from './sha256';

/**
 * Fictional coin lotteries. Tickets cost Empire Coins; prizes are Empire Coins; coins are NOT redeemable for GBP, cash or anything withdrawable, and no GBP_TEST is involved
 * anywhere in this file. Odds are published before you buy (exact, from the tickets sold so far). A fixed share of the pool (the rake) is burned as an explicit sink; the rest is
 * paid out. Draws use the platform's secure random generator, pick DISTINCT tickets, and are recorded with a hash commitment. A lottery with too few tickets is cancelled and
 * every ticket refunded in full.
 */
export const LOTTERY = { ticketPriceMinor: 10_000, maxPerPlayer: 10, rakeBps: 1_000, prizeSharesBps: [6_000, 2_500, 1_500], minTickets: 4, periodTicks: 7 } as const;
export interface LotteryRow { id: string; name: string; ticket_price_minor: number; draw_tick: number; status: 'open' | 'drawn' | 'cancelled'; pool_account: string; max_per_player: number; rake_bps: number; prizes_json: string; tickets_sold: number; drawn_tick: number | null; draw_commit: string | null }

/** The weekly draws exist as a pure function of the tick (the next one is always scheduled), so replaying or catching up creates exactly the same rows. Idempotent. */
export function ensureLotteries(db: Sql, ctx: TickCtx) {
  const draw = (Math.floor(ctx.tick / LOTTERY.periodTicks) + 1) * LOTTERY.periodTicks, id = `lot-${draw}`;
  if (db.get('SELECT 1 FROM lotteries WHERE id = ?', id)) return;
  const pool = `acct:lottery:${id}`; createAccount(db, pool, 'state_treasury', `Lottery pool ${id}`);
  db.run("INSERT INTO lotteries (id, name, ticket_price_minor, draw_tick, status, pool_account, max_per_player, rake_bps, prizes_json) VALUES (?,?,?,?,'open',?,?,?,?)", id, `Bristol Weekly Draw (day ${draw})`, LOTTERY.ticketPriceMinor, draw, pool, LOTTERY.maxPerPlayer, LOTTERY.rakeBps, JSON.stringify(LOTTERY.prizeSharesBps));
}

/** Exact published odds for `held` tickets out of `sold` (hypergeometric for "any prize"). */
export function publishedOdds(sold: number, held: number, prizes: number): { firstPrize: number; anyPrize: number; ticketsSold: number } {
  if (sold <= 0 || held <= 0) return { firstPrize: 0, anyPrize: 0, ticketsSold: sold };
  const k = Math.min(prizes, sold); let none = 1; for (let i = 0; i < k; i++) none *= Math.max(0, (sold - held - i) / (sold - i));
  return { firstPrize: Math.min(1, held / sold), anyPrize: Math.min(1, 1 - none), ticketsSold: sold };
}

export function buyTickets(db: Sql, ctx: TickCtx, a: { playerId: string; lotteryId: string; count: number; key: string }): { numbers: number[]; duplicate: boolean } {
  return db.transaction(() => {
    const prior = db.all<{ number: number }>('SELECT number FROM lottery_tickets WHERE idempotency_key LIKE ? ORDER BY number', `${a.key}#%`);
    if (prior.length) return { numbers: prior.map((p) => p.number), duplicate: true };
    const l = db.get<LotteryRow>('SELECT * FROM lotteries WHERE id = ?', a.lotteryId);
    if (!l || l.status !== 'open' || ctx.tick >= l.draw_tick) throw new LedgerError('FORBIDDEN', 'That lottery is closed.');
    if (!Number.isInteger(a.count) || a.count < 1) throw new LedgerError('INVALID_AMOUNT', 'Choose at least one ticket.');
    const held = db.get<{ n: number }>('SELECT COUNT(*) n FROM lottery_tickets WHERE lottery_id = ? AND owner_id = ?', l.id, a.playerId)!.n;
    if (held + a.count > l.max_per_player) throw new LedgerError('FORBIDDEN', `At most ${l.max_per_player} tickets per player (you hold ${held}).`);
    const wallet = db.get<{ w: string }>('SELECT wallet_account_id w FROM players WHERE id = ?', a.playerId)?.w; if (!wallet) throw new LedgerError('FORBIDDEN', 'Unknown player.');
    const cost = l.ticket_price_minor * a.count;
    if (available(db, wallet) < cost) throw new LedgerError('INSUFFICIENT_FUNDS', `${a.count} ticket(s) cost ${(cost / 100).toLocaleString('en-GB')} EC.`);
    const tx = transfer(db, ctx, `lottery:${a.key}`, wallet, l.pool_account, cost, 'transfer', `lottery tickets ${l.id} ×${a.count}`);
    const numbers: number[] = [];
    for (let i = 0; i < a.count; i++) { const n = l.tickets_sold + i + 1; db.run('INSERT INTO lottery_tickets (lottery_id, owner_id, number, ledger_tx_id, idempotency_key) VALUES (?,?,?,?,?)', l.id, a.playerId, n, tx.txId, `${a.key}#${i}`); numbers.push(n); }
    db.run('UPDATE lotteries SET tickets_sold = tickets_sold + ? WHERE id = ?', a.count, l.id);
    return { numbers, duplicate: false };
  });
}

/** Draws every due lottery. `rng` is injectable for tests; production uses the secure generator. */
export function drawDueLotteries(db: Sql, now: TickCtx, rng: (n: number) => number = secureRandomInt): { drawn: string[]; cancelled: string[] } {
  const out = { drawn: [] as string[], cancelled: [] as string[] };
  for (const l of db.all<LotteryRow>("SELECT * FROM lotteries WHERE status = 'open' AND draw_tick <= ? ORDER BY draw_tick", now.tick)) {
    const ctx: TickCtx = { ...now, tick: l.draw_tick };   // recorded at the scheduled draw tick, so the books are the same however late the scheduler runs
    db.transaction(() => {
      const tickets = db.all<{ number: number; owner_id: string; ledger_tx_id: number }>('SELECT number, owner_id, ledger_tx_id FROM lottery_tickets WHERE lottery_id = ? ORDER BY number', l.id);
      if (tickets.length < LOTTERY.minTickets) {
        for (const [owner, n] of Object.entries(tickets.reduce<Record<string, number>>((m, t) => { m[t.owner_id] = (m[t.owner_id] ?? 0) + 1; return m; }, {}))) {
          const wallet = db.get<{ w: string }>('SELECT wallet_account_id w FROM players WHERE id = ?', owner)!.w; transfer(db, ctx, `lottery:${l.id}:refund:${owner}`, l.pool_account, wallet, n * l.ticket_price_minor, 'transfer', `lottery ${l.id} cancelled: refund`);
        }
        db.run("UPDATE lotteries SET status = 'cancelled', drawn_tick = ? WHERE id = ?", ctx.tick, l.id); out.cancelled.push(l.id); return;
      }
      const pool = tickets.length * l.ticket_price_minor, rake = Math.floor((pool * l.rake_bps) / 10_000), prizePool = pool - rake;
      const shares = JSON.parse(l.prizes_json) as number[]; const places = Math.min(shares.length, tickets.length);
      const totalShare = shares.slice(0, places).reduce((a, b) => a + b, 0);
      const picked: number[] = []; const remaining = tickets.map((t) => t.number);
      for (let p = 0; p < places; p++) picked.push(remaining.splice(rng(remaining.length), 1)[0]!);     // distinct tickets: nobody can win twice from one pick
      const prizes = shares.slice(0, places).map((s) => Math.floor((prizePool * s) / totalShare)); prizes[0] = prizes[0]! + (prizePool - prizes.reduce((a, b) => a + b, 0));
      if (rake > 0) destroy(db, ctx, `lottery:${l.id}:rake`, l.pool_account, rake, `lottery rake ${l.id} (explicit sink)`, 'sink_fee');
      picked.forEach((num, i) => {
        const t = tickets.find((x) => x.number === num)!; const wallet = db.get<{ w: string }>('SELECT wallet_account_id w FROM players WHERE id = ?', t.owner_id)!.w;
        const tx = transfer(db, ctx, `lottery:${l.id}:prize:${i + 1}`, l.pool_account, wallet, prizes[i]!, 'transfer', `lottery ${l.id} prize ${i + 1}`);
        db.run('INSERT INTO lottery_results (lottery_id, place, ticket_number, owner_id, prize_minor, ledger_tx_id) VALUES (?,?,?,?,?,?)', l.id, i + 1, num, t.owner_id, prizes[i]!, tx.txId);
      });
      db.run("UPDATE lotteries SET status = 'drawn', drawn_tick = ?, draw_commit = ? WHERE id = ?", ctx.tick, sha256(`${l.id}|${tickets.length}|${picked.join(',')}`), l.id); out.drawn.push(l.id);
    });
  }
  return out;
}

export function lotteryView(db: Sql, playerId: string, tick: number) {
  const lots = db.all<LotteryRow>('SELECT * FROM lotteries WHERE draw_tick <= ? + 14 ORDER BY draw_tick DESC LIMIT 6', tick);
  return lots.map((l) => {
    const mine = db.all<{ number: number }>('SELECT number FROM lottery_tickets WHERE lottery_id = ? AND owner_id = ? ORDER BY number', l.id, playerId).map((t) => t.number);
    const prizes = JSON.parse(l.prizes_json) as number[]; const pool = l.tickets_sold * l.ticket_price_minor;
    return {
      id: l.id, name: l.name, status: l.status, drawTick: l.draw_tick, daysLeft: Math.max(0, l.draw_tick - tick), ticketPriceMinor: l.ticket_price_minor, ticketsSold: l.tickets_sold, maxPerPlayer: l.max_per_player, rakeBps: l.rake_bps,
      poolMinor: l.status === 'open' ? pool : pool, prizePoolMinor: pool - Math.floor((pool * l.rake_bps) / 10_000), prizeSharesBps: prizes, minTickets: LOTTERY.minTickets, myTickets: mine, odds: publishedOdds(l.tickets_sold, mine.length, prizes.length),
      oddsIfYouBuyOne: publishedOdds(l.tickets_sold + 1, mine.length + 1, prizes.length),
      results: db.all('SELECT place, ticket_number ticketNumber, owner_id ownerId, prize_minor prizeMinor FROM lottery_results WHERE lottery_id = ? ORDER BY place', l.id), commit: l.draw_commit,
      notice: 'Fictional Empire Coins only. Coins cannot be withdrawn or exchanged for money. Odds are exact for the tickets sold so far and change as more are sold.',
    };
  });
}
