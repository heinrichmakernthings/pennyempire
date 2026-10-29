/** Test client for the session layer: a cookie jar per player, real invites, real password hashing. */
import type { Sql } from '../db/sql';
import { createInvite } from '../engine/accounts';
import { handleRequest, SESSION_COOKIE, type HttpOptions } from '../api/session';
import type { ApiResponse } from '../api/router';

export const ADMIN_TOKEN = 'alpha-admin-token-for-tests';
export interface Client { name: string; cookie: string; call(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<ApiResponse & { body: any }>; get(path: string): Promise<any>; cmd(body: Record<string, unknown>, key?: string): Promise<ApiResponse & { body: any }> }
let seq = 0;
export function client(db: Sql, name: string, opts: Partial<HttpOptions> = {}): Client {
  const c: Client = {
    name, cookie: '',
    async call(method, path, body, extra = {}) {
      const [p, qs] = path.split('?');
      const out = await handleRequest(db, { method, path: p!, query: Object.fromEntries(new URLSearchParams(qs ?? '')), body, headers: { host: 'alpha.test', ...(c.cookie ? { cookie: `${SESSION_COOKIE}=${c.cookie}` } : {}), ...extra } }, { devEndpoints: false, requireAuth: true, adminToken: ADMIN_TOKEN, ...opts });
      const set = out.headers?.['set-cookie']; if (set) { const m = /pe_session=([^;]*)/.exec(set); c.cookie = m?.[1] ?? ''; }
      return out as ApiResponse & { body: any };
    },
    async get(path) { return (await c.call('GET', path)).body; },
    cmd(body, key = `${name}-${seq++}`) { return c.call('POST', '/api/command', { idempotencyKey: key, expectedRevision: 0, ...body }); },
  };
  return c;
}
/** Registers a player through the real invite flow and returns a signed-in client. */
export async function player(db: Sql, username: string, role: 'player' | 'admin' = 'player', opts: Partial<HttpOptions> = {}): Promise<Client> {
  const invite = createInvite(db, Date.now(), 'test', role).code;
  const c = client(db, username, opts);
  const r = await c.call('POST', '/api/auth/register', { invite, username, password: `${username}-long-password`, displayName: username[0]!.toUpperCase() + username.slice(1) });
  if (r.status !== 200) throw new Error(`register ${username}: ${JSON.stringify(r.body)}`);
  return c;
}
