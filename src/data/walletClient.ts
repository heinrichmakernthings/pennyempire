import { newIdempotencyKey } from './useCommand';
export { useStateCommand as useGameCommand } from './stateClient';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  let body: unknown; try { body = await res.json(); } catch { throw new Error(`Server returned a non-JSON response (${res.status})`); }
  if (!res.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? `Server error ${res.status}`);
  return body as T;
}
type Rec = Record<string, any>;   // documented in docs/PRESTIGE-WALLET.md; screens read only what they show
export const fetchPrestige = () => get<Rec>('/api/prestige');
export const fetchMarket = () => get<Rec>('/api/prestige/market');
export const fetchRewards = () => get<Rec>('/api/rewards');
export const fetchWallet = () => get<Rec>('/api/wallet');
export const fetchMembership = () => get<{ membership: Rec }>('/api/membership');
export const fetchTreasury = () => get<Rec>('/api/dev/treasury');
export async function attestAd(sessionId: string): Promise<{ ok: boolean; token?: string; message?: string }> {
  const res = await fetch('/api/ads/attest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }) }); const j = await res.json();
  return res.ok ? { ok: true, token: j.token } : { ok: false, message: j.error?.message ?? 'Refused' };
}
export async function devTreasury(action: string, body: Record<string, unknown> = {}): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`/api/dev/treasury/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: newIdempotencyKey(), ...body }) }); const j = await res.json();
  return { ok: res.ok, message: j.message ?? j.error?.message ?? 'Done' };
}
export const gbp = (pence: number) => `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const ecm = (minor: number) => `${(minor / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })} EC`;
