/**
 * Cloudflare deployment: one Durable Object (SQLite-backed) owns the whole world. A DO handles one request at a time and
 * `transactionSync` is atomic, so ticks, commands and market matching are serialised without any locking code.
 * NOTE: this entry point is type-checked but has NOT been executed under workerd in this milestone (see docs/ECONOMIC-ENGINE.md).
 */
import { DurableObject } from 'cloudflare:workers';
import { handleRequest } from './api/session';
import { advanceToNow, nextTickAtMs } from './engine/clock';
import { migrate } from './db/migrate';
import { durableObjectSql, type DoStorage } from './db/durableObjectSql';
import type { Sql } from './db/sql';
import { seedBristol } from './seed/bristol';

interface Env { ECONOMY: DurableObjectNamespace; DEV_ENDPOINTS?: string; ADMIN_TOKEN?: string; REQUIRE_AUTH?: string }

export class EconomyDO extends DurableObject<Env> {
  private db: Sql;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = durableObjectSql(ctx.storage as unknown as DoStorage);
    ctx.blockConcurrencyWhile(async () => { migrate(this.db); seedBristol(this.db, {}, 'new'); await this.schedule(); });
  }
  private async schedule() { await this.ctx.storage.setAlarm(Math.max(Date.now() + 1_000, nextTickAtMs(this.db))); }
  async alarm() { advanceToNow(this.db, Date.now()); await this.schedule(); }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let body: unknown; if (request.method !== 'GET') { try { body = await request.json(); } catch { body = undefined; } }
    const headers: Record<string, string> = {};
    for (const k of ['x-admin-token', 'cookie', 'origin', 'host', 'cf-connecting-ip']) { const v = request.headers.get(k); if (v) headers[k] = v; }
    // Accounts are required unless explicitly switched off: a deployed world is never an open single-player sandbox.
    const out = await handleRequest(this.db, { method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, headers }, { devEndpoints: this.env.DEV_ENDPOINTS === 'true', adminToken: this.env.ADMIN_TOKEN, requireAuth: this.env.REQUIRE_AUTH !== 'false', secureCookies: url.protocol === 'https:' });
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(out.headers ?? {}) } });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const stub = env.ECONOMY.get(env.ECONOMY.idFromName('bristol'));
    return stub.fetch(request);
  },
};
