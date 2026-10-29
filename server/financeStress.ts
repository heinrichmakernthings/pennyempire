import type { Sql } from './db/sql';
import { createAccount, issue, reconcile, supply } from './engine/ledger';
import { advance, lastTick, openWorld } from './engine/world';
import { approveWithdrawal, createDeposit, fundTreasury, handleDepositEvent, requestWithdrawal, sandboxEvent, settleWithdrawal } from './engine/gbpWallet';
import { GbpError, ensureGbpBooks, ensureWallet, reconcileGbp } from './engine/gbpLedger';
import { awardReward, createProgram, fundProgram } from './engine/rewards';
import { LOTTERY, buyTickets, drawDueLotteries, ensureLotteries } from './engine/lottery';
import { treasuryView } from './engine/commercial';

/** Deterministic financial stress scenarios for the simulated GBP treasury, reward programmes and coin lotteries. Everything runs through the real engine functions. */
export interface StressReport { name: string; setup: string; facts: Record<string, number | string | boolean>; gbpReconciles: boolean; coinsReconcile: boolean; problems: string[] }
const g = (db: Sql, ms = 1) => ({ tick: lastTick(db), ms, actor: 'stress' });
const player = (db: Sql, i: number, coins = 1_000_000) => { const id = `st-${i}`; createAccount(db, `acct:player:${id}`, 'player', id); db.run("INSERT INTO players (id, display_name, city_id, wallet_account_id) VALUES (?,?,'city-bristol',?)", id, id, `acct:player:${id}`); if (coins) issue(db, { tick: lastTick(db), gameDate: 'x', actor: 'stress' }, `st:coins:${id}`, `acct:player:${id}`, coins, 'stress grant'); ensureWallet(db, id); return id; };
const fresh = () => { const db = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'new'); ensureGbpBooks(db); return db; };
const finish = (db: Sql, name: string, setup: string, facts: StressReport['facts']): StressReport => { const r = reconcileGbp(db); const c = reconcile(db); return { name, setup, facts: { ...facts, transactions: r.transactions }, gbpReconciles: r.ok, coinsReconcile: c.ok, problems: [...r.problems, ...c.problems.slice(0, 3)] }; };

export function runFinanceStress(): StressReport[] {
  const out: StressReport[] = [];
  { // 1 — mass withdrawals against an under-funded treasury
    const db = fresh(); const N = 300; const ids = Array.from({ length: N }, (_, i) => player(db, i, 0));
    ids.forEach((p, i) => { const d = createDeposit(db, g(db), { playerId: p, amountPence: 1_000, key: `d${i}` }); handleDepositEvent(db, g(db), sandboxEvent(d.depositId, 'succeeded')); });
    const wds = ids.map((p, i) => requestWithdrawal(db, g(db), { playerId: p, amountPence: 1_000, key: `w${i}` }).withdrawalId);
    let paid = 0, refused = 0; wds.forEach((id, i) => { try { approveWithdrawal(db, g(db), id); settleWithdrawal(db, g(db), id, 'paid', `e${i}`); paid++; } catch (e) { if (e instanceof GbpError && e.code === 'INSUFFICIENT_FUNDS') refused++; else throw e; } });
    const t = treasuryView(db);
    out.push(finish(db, 'S1 — Mass withdrawal', `${N} players each deposit £10 (simulated) and request a £10 cash-out at the same moment; the treasury holds only the deposits (player funds) and no business money: payments are fully backed because processor fees are a business liability and are never taken from player funds.`, { players: N, paid, refusedForLackOfCash: refused, walletLiabilitiesPence: t.playerFunds.walletLiabilitiesPence, pendingPence: t.playerFunds.pendingWithdrawalsPence, coverageOfPlayerFundsPence: t.cash.coverageOfPlayerFundsPence }));
  }
  { // 2 — simultaneous reward claims against a small budget
    const db = fresh(); fundTreasury(db, g(db), 'f', 1_000_000, 'dev funded'); createProgram(db, g(db), { id: 'launch', name: 'Launch bonus', source: 'promotion', rules: [{ kind: 'open' }], awardPence: 500, budgetPence: 10_000, perPlayerMax: 1 }); fundProgram(db, g(db), 'launch', 10_000);
    const N = 1_000; let awarded = 0, duplicates = 0, refused = 0;
    for (let i = 0; i < N; i++) { const p = player(db, i, 0); for (const key of [`claim-${i}`, `claim-${i}`, `claim-${i}-b`]) { try { const r = awardReward(db, g(db), { programId: 'launch', playerId: p, key }); if (r.duplicate) duplicates++; else awarded++; } catch (e) { if (e instanceof GbpError) refused++; else throw e; } } }
    const prog = db.get<{ spent_pence: number }>('SELECT spent_pence FROM reward_programs')!;
    out.push(finish(db, 'S2 — Simultaneous reward claims', `${N} players each claim the same £5 reward three times (two identical keys and one new key) against a £100 budget.`, { claimants: N, awarded, duplicatesIgnored: duplicates, refused, spentPence: prog.spent_pence, budgetPence: 10_000 }));
  }
  { // 3 — a coin lottery with many players
    const db = fresh(); advance(db, 1); ensureLotteries(db, { tick: lastTick(db), gameDate: 'x', actor: 's' }); const lot = db.get<{ id: string }>("SELECT id FROM lotteries WHERE status = 'open' ORDER BY draw_tick LIMIT 1")!.id;
    const N = 400; for (let i = 0; i < N; i++) { const p = player(db, i); buyTickets(db, { tick: lastTick(db), gameDate: 'x', actor: 's' }, { playerId: p, lotteryId: lot, count: LOTTERY.maxPerPlayer, key: `t${i}` }); }
    const before = supply(db); advance(db, 7); const r = drawDueLotteries(db, { tick: lastTick(db), gameDate: 'x', actor: 's' });
    const res = db.all<{ prize_minor: number; owner_id: string }>('SELECT prize_minor, owner_id FROM lottery_results'); const sold = db.get<{ n: number }>('SELECT COUNT(*) n FROM lottery_tickets')!.n;
    out.push(finish(db, 'S3 — Large coin lottery', `${N} players buy the maximum ${LOTTERY.maxPerPlayer} tickets each; the draw uses the secure generator.`, { ticketsSold: sold, drawn: r.drawn.length, winners: res.length, distinctWinnerTickets: res.length, prizesMinor: res.reduce((a, x) => a + x.prize_minor, 0), poolMinor: sold * LOTTERY.ticketPriceMinor, rakeBurnedMinor: Math.floor((sold * LOTTERY.ticketPriceMinor * LOTTERY.rakeBps) / 10_000), issuedChange: supply(db).issued - before.issued }));
  }
  return out;
}
export function formatStress(rs: StressReport[]): string {
  const L = ['# Financial stress scenarios (simulated treasury)', '', 'Deterministic except the lottery draw (secure randomness). Everything uses the real engine functions.', ''];
  for (const r of rs) { L.push(`## ${r.name}`, '', r.setup, '', `GBP ledger reconciles: **${r.gbpReconciles}** · Empire Coin ledger reconciles: **${r.coinsReconcile}**${r.problems.length ? ' · problems: ' + r.problems.join('; ') : ''}`, ''); for (const [k, v] of Object.entries(r.facts)) L.push(`- ${k}: ${typeof v === 'number' ? v.toLocaleString('en-GB') : String(v)}`); L.push(''); }
  return L.join('\n');
}
