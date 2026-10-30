import { actingPlayer } from './actor';
import type { Sql } from '../db/sql';
import { runCommand, type CommandResponse } from './commands';
import { buyBoost } from './boosts';
import { buyListing, buyPrestige, cancelListing, listItem } from './prestige';
import { cancelMembership, subscribe } from './membership';
import { tryCompleteAdView, enterDraw, startAdView } from './rewards';
import { err } from './commands';
import { buyTickets } from './lottery';
import { createDeposit, handleDepositEvent, requestWithdrawal, cancelWithdrawal, sandboxEvent } from './gbpWallet';
import { ensureWallet, type GbpCtx } from './gbpLedger';


/** Player commands for the prestige, rewards, membership and (simulated) GBP wallet systems. Each is exactly-once through runCommand; none can touch another player's assets. */
const ok = (data: Record<string, unknown> = {}): CommandResponse => ({ ok: true, revision: 0, transactionId: '', refreshScreens: ['city', 'wallet', 'prestige'], data });
const g = (ctx: { tick: number }, nowMs: number): GbpCtx => ({ tick: ctx.tick, ms: nowMs, actor: actingPlayer() });
const num = (v: unknown) => Number(v);

export function walletCommand(db: Sql, nowMs: number, key: string, cmd: Record<string, unknown>): CommandResponse | null {
  const t = String(cmd.type);
  switch (t) {
    case 'prestige.buy': return runCommand(db, key, t, (ctx) => { const r = buyPrestige(db, ctx, { ownerId: actingPlayer(), itemId: String(cmd.itemId), key }); return ok({ ownedId: r.ownedId, serial: r.serial }); });
    case 'prestige.list': return runCommand(db, key, t, (ctx) => { const r = listItem(db, ctx, { ownerId: actingPlayer(), ownedId: String(cmd.ownedId), askMinor: num(cmd.askMinor), key }); return ok({ listingId: r.listingId }); });
    case 'prestige.unlist': return runCommand(db, key, t, (ctx) => { cancelListing(db, ctx, actingPlayer(), String(cmd.listingId)); return ok(); });
    case 'prestige.buyListing': return runCommand(db, key, t, (ctx) => { const r = buyListing(db, ctx, { buyerId: actingPlayer(), listingId: String(cmd.listingId), key }); return ok({ ownedId: r.ownedId, priceMinor: r.priceMinor, feeMinor: r.feeMinor }); });
    case 'boost.buy': return runCommand(db, key, t, (ctx) => { const r = buyBoost(db, ctx, { ownerId: actingPlayer(), offerId: String(cmd.offerId), key }); return ok({ boostId: r.boostId, endTick: r.endTick }); });
    case 'membership.subscribe': return runCommand(db, key, t, (ctx) => { const r = subscribe(db, ctx, g(ctx, nowMs), actingPlayer()); return ok({ status: r.status, periodEndTick: r.periodEndTick }); });
    case 'membership.cancel': return runCommand(db, key, t, (ctx) => { cancelMembership(db, ctx, g(ctx, nowMs), actingPlayer()); return ok(); });
    case 'ad.reward.start': return runCommand(db, key, t, (ctx) => { const r = startAdView(db, ctx, nowMs, { playerId: actingPlayer(), rewardId: String(cmd.rewardId) }); return ok({ sessionId: r.sessionId, minWatchMs: r.minWatchMs }); });
    case 'ad.reward.complete': return runCommand(db, key, t, (ctx) => { const r = tryCompleteAdView(db, ctx, nowMs, { playerId: actingPlayer(), sessionId: String(cmd.sessionId), token: String(cmd.token ?? '') }); if ('refused' in r) return err('FORBIDDEN', r.refused); return ok({ granted: r.granted, duplicate: r.duplicate }); });
    case 'lottery.buy': return runCommand(db, key, t, (ctx) => { const r = buyTickets(db, ctx, { playerId: actingPlayer(), lotteryId: String(cmd.lotteryId), count: num(cmd.count ?? 1), key }); return ok({ numbers: r.numbers }); });
    case 'draw.enter': return runCommand(db, key, t, (ctx) => { const r = enterDraw(db, ctx, nowMs, actingPlayer(), String(cmd.drawId)); return ok({ duplicate: r.duplicate }); });
    case 'wallet.testDeposit': return runCommand(db, key, t, (ctx) => {   // the local sandbox provider settles instantly; the developer can drive failures through the dev/admin controls
      ensureWallet(db, actingPlayer()); const d = createDeposit(db, g(ctx, nowMs), { playerId: actingPlayer(), amountPence: num(cmd.amountMinor), key });
      const e = handleDepositEvent(db, g(ctx, nowMs), sandboxEvent(d.depositId, 'succeeded')); return ok({ depositId: d.depositId, outcome: e.outcome });
    });
    case 'wallet.testWithdraw': return runCommand(db, key, t, (ctx) => { const r = requestWithdrawal(db, g(ctx, nowMs), { playerId: actingPlayer(), amountPence: num(cmd.amountMinor), key }); return ok({ withdrawalId: r.withdrawalId }); });
    case 'wallet.cancelWithdrawal': return runCommand(db, key, t, (ctx) => { cancelWithdrawal(db, g(ctx, nowMs), actingPlayer(), String(cmd.withdrawalId)); return ok(); });
    default: return null;
  }
}
