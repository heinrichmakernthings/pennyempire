// Literal copies of seed/bristol's PLAYER_ID / PLAYER_WALLET: importing them would create a module cycle (seed → engine → actor → seed).
const PLAYER_ID = 'player-demo', PLAYER_WALLET = 'acct:player:demo';

/**
 * The human player a request acts for. Every API request runs synchronously from start to finish (one Durable Object / one Node event-loop turn), so a request-scoped
 * value set by the router around the handler is safe: no other request can interleave. Outside a request (ticks, tests, scenarios) it is the seeded demo player.
 * Authorisation does NOT rely on this alone: the router sets it only from a verified session, and every command still checks ownership against it on the server.
 */
let current = { id: PLAYER_ID, wallet: PLAYER_WALLET };
export const actingPlayer = () => current.id;
export const actingWallet = () => current.wallet;
export function withPlayer<T>(p: { id: string; wallet: string }, fn: () => T): T {
  const prev = current; current = { id: p.id, wallet: p.wallet };
  try { return fn(); } finally { current = prev; }
}
