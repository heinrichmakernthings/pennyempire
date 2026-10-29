/**
 * The HTTP-facing entry point shared by the Node server and the Cloudflare Worker. It resolves the session cookie, serves the account
 * routes (some need async WebCrypto hashing), enforces authentication, CSRF and per-user rate limits, and then runs the synchronous
 * game router as the signed-in player. A request can only ever act as the player its session belongs to.
 */
import type { Sql } from '../db/sql';
import { withPlayer } from '../engine/actor';
import { authorised } from '../engine/admin';
import { AuthError, LIMITS, checkRate, consumeReset, createInvite, createResetCode, createSession, credentials, inviteStatus, listInvites, listUsers, recordAttempt, registerUser, resetTarget, revokeAllSessions, revokeSession, sessionUser, setDisabled, setPassword, updateProfile, validateDisplayName, validatePassword, validateUsername, SESSION_TTL_MS, type Role, type SessionUser } from '../engine/accounts';
import { hashPassword, PBKDF2_ITERATIONS } from '../auth/crypto';
import { handleApi, type ApiOptions, type ApiRequest, type ApiResponse } from './router';
import { notifications, markNotificationsRead } from './notifications';

export interface HttpOptions extends ApiOptions {
  /** Private alpha: every game route needs a signed-in account. Off only for the single-player local dev server and tests. */
  requireAuth: boolean;
  /** Set the Secure attribute on the session cookie (always on HTTPS). */
  secureCookies?: boolean;
}
export const SESSION_COOKIE = 'pe_session';
const COMMAND_WINDOW_MS = 10_000, COMMANDS_PER_WINDOW = 40;
const commandHits = new Map<string, number[]>();          // per-instance burst limiter; the world runs in one instance (DO / Node process)

const json = (status: number, body: unknown, headers?: Record<string, string>): ApiResponse => ({ status, body, ...(headers ? { headers } : {}) });
const fail = (status: number, code: string, message: string) => json(status, { ok: false, error: { code, message } });
const authFail = (e: unknown) => {
  if (e instanceof AuthError) return fail(e.code === 'RATE_LIMITED' ? 429 : e.code === 'FORBIDDEN' ? 403 : e.code === 'CONFLICT' ? 409 : 422, e.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : e.code === 'CONFLICT' ? 'VALIDATION' : e.code, e.message);
  throw e;
};
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
const cookie = (token: string, maxAgeS: number, secure: boolean) => `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure ? '; Secure' : ''}`;
const publicUser = (u: SessionUser) => ({ username: u.username, displayName: u.displayName, role: u.role, playerId: u.playerId, settings: u.settings });
const DUMMY_SALT = '00000000000000000000000000000000';

/** Cross-site request forgery guard for cookie-authenticated writes: the browser's Origin must match the host it is talking to. */
function sameOrigin(h: Record<string, string>): boolean {
  const origin = h.origin; if (!origin) return true;            // non-browser clients and same-origin GETs omit it; SameSite=Lax still applies
  try { return new URL(origin).host === h.host; } catch { return false; }
}

export async function handleRequest(db: Sql, req: ApiRequest, opts: HttpOptions): Promise<ApiResponse> {
  const now = opts.now?.() ?? Date.now();
  const h = req.headers ?? {};
  const token = parseCookies(h.cookie)[SESSION_COOKIE];
  const user = sessionUser(db, token, now);
  const seg = req.path.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const ip = h['cf-connecting-ip'] || h['x-real-ip'] || 'local';
  const secure = opts.secureCookies === true;
  if (req.method !== 'GET' && !sameOrigin(h)) return fail(403, 'FORBIDDEN', 'Cross-site request refused.');
  const body = (req.body ?? {}) as Record<string, unknown>;

  try {
    if (seg[0] === 'auth') {
      if (req.method === 'GET' && seg[1] === 'me') return json(200, { ok: true, authenticated: !!user, requireAuth: opts.requireAuth, user: user ? publicUser(user) : null });
      if (req.method === 'GET' && seg[1] === 'invite') return json(200, { ok: true, valid: !!inviteStatus(db, String(req.query?.code ?? ''), now) });
      if (req.method !== 'POST') return fail(404, 'UNAVAILABLE', 'No such account route.');
      switch (seg[1]) {
        case 'register': {
          checkRate(db, now, [[`reg:ip:${ip}`, LIMITS.ipRegistrations]]);
          const username = validateUsername(body.username), password = validatePassword(body.password), displayName = validateDisplayName(body.displayName ?? body.username);
          if (!inviteStatus(db, String(body.invite ?? ''), now)) { recordAttempt(db, now, `reg:ip:${ip}`, false); throw new AuthError('FORBIDDEN', 'That invite code is invalid, expired or already used.'); }
          const hashed = await hashPassword(password);
          const u = registerUser(db, now, { invite: String(body.invite), username, displayName, hash: hashed.hash, salt: hashed.salt, iterations: hashed.iterations });
          const s = createSession(db, u.userId, now);
          return json(200, { ok: true, user: publicUser(u) }, { 'set-cookie': cookie(s.token, SESSION_TTL_MS / 1000, secure) });
        }
        case 'login': {
          const username = String(body.username ?? '').trim().toLowerCase(), password = String(body.password ?? '');
          checkRate(db, now, [[`login:u:${username}`, LIMITS.userFailures], [`login:ip:${ip}`, LIMITS.ipFailures]]);
          const c = credentials(db, username);
          const hashed = await hashPassword(password.slice(0, 200), c?.password_salt ?? DUMMY_SALT, c?.password_iters ?? PBKDF2_ITERATIONS);   // same work whether or not the user exists
          const okPw = !!c && timingSafe(hashed.hash, c.password_hash) && !c.disabled;
          recordAttempt(db, now, `login:u:${username}`, okPw); recordAttempt(db, now, `login:ip:${ip}`, okPw);
          if (!okPw) return fail(401, 'UNAUTHENTICATED', 'Wrong username or password.');
          const s = createSession(db, c!.id, now);
          return json(200, { ok: true, user: publicUser(sessionUser(db, s.token, now)!) }, { 'set-cookie': cookie(s.token, SESSION_TTL_MS / 1000, secure) });
        }
        case 'logout': if (token) revokeSession(db, token); return json(200, { ok: true }, { 'set-cookie': cookie('', 0, secure) });
        case 'reset': {
          const username = validateUsername(body.username), password = validatePassword(body.newPassword), code = String(body.code ?? '');
          checkRate(db, now, [[`reset:u:${username}`, LIMITS.userFailures], [`login:ip:${ip}`, LIMITS.ipFailures]]);
          const target = resetTarget(db, username, code, now);
          recordAttempt(db, now, `reset:u:${username}`, !!target); if (!target) { recordAttempt(db, now, `login:ip:${ip}`, false); return fail(403, 'FORBIDDEN', 'That reset code is invalid or expired.'); }
          const hashed = await hashPassword(password);
          db.transaction(() => { setPassword(db, target, hashed); consumeReset(db, code, now); });
          return json(200, { ok: true, message: 'Password changed. Sign in with the new password.' });
        }
      }
      if (!user) return fail(401, 'UNAUTHENTICATED', 'Sign in first.');
      switch (seg[1]) {
        case 'logout-all': revokeAllSessions(db, user.userId); return json(200, { ok: true }, { 'set-cookie': cookie('', 0, secure) });
        case 'profile': return json(200, { ok: true, user: publicUser(updateProfile(db, user, { displayName: body.displayName, settings: body.settings })) });
        case 'password': {
          const c = credentials(db, user.username)!; const next = validatePassword(body.newPassword);
          checkRate(db, now, [[`login:u:${user.username}`, LIMITS.userFailures]]);
          const cur = await hashPassword(String(body.currentPassword ?? '').slice(0, 200), c.password_salt, c.password_iters);
          const okPw = timingSafe(cur.hash, c.password_hash); recordAttempt(db, now, `login:u:${user.username}`, okPw);
          if (!okPw) return fail(403, 'FORBIDDEN', 'Your current password is wrong.');
          setPassword(db, user.userId, await hashPassword(next));                 // signs out every session, including this one
          const s = createSession(db, user.userId, now);
          return json(200, { ok: true }, { 'set-cookie': cookie(s.token, SESSION_TTL_MS / 1000, secure) });
        }
      }
      return fail(404, 'UNAVAILABLE', 'No such account route.');
    }
  } catch (e) { return authFail(e); }

  if (opts.requireAuth && !user && !(seg[0] === 'health' && req.method === 'GET') && seg[0] !== 'admin') return fail(401, 'UNAUTHENTICATED', 'Sign in to play the private alpha.');

  const adminActor = user?.role === 'admin' ? `admin:${user.username}` : undefined;
  if (seg[0] === 'admin' && (seg[1] === 'users' || seg[1] === 'invites')) {
    const tokenActor = authorised(h['x-admin-token'], opts.adminToken) ? 'admin:token' : undefined;
    const actor = adminActor ?? tokenActor;
    if (!actor) { db.run('INSERT INTO admin_log (tick, actor, action, detail_json, ok) VALUES ((SELECT last_tick FROM engine_state WHERE id = 1),?,?,?,0)', user ? `user:${user.username}` : 'unauthenticated', `${req.method} ${req.path}`, '{}'); return fail(403, 'FORBIDDEN', 'Administrator permission required.'); }
    return adminAccounts(db, req, seg, body, actor, now);
  }

  if (req.method === 'POST' && user) {
    const hits = (commandHits.get(user.userId) ?? []).filter((t) => t > now - COMMAND_WINDOW_MS);
    if (hits.length >= COMMANDS_PER_WINDOW) return fail(429, 'RATE_LIMITED', 'Slow down: too many actions in a few seconds.');
    hits.push(now); commandHits.set(user.userId, hits);
  }
  if (user && seg[0] === 'notifications') {
    if (req.method === 'GET') return withPlayer({ id: user.playerId, wallet: user.wallet }, () => json(200, { ok: true, ...notifications(db, user.playerId, Number(req.query?.limit ?? 30)) }));
    if (req.method === 'POST' && seg[1] === 'read') { markNotificationsRead(db, user.playerId, Number(body.upTo ?? 0)); return json(200, { ok: true }); }
  }

  // Idempotency keys are namespaced per user so one player can never collide with, or read back, another player's command result.
  const scoped: ApiRequest = user && seg[0] === 'command' && body && typeof body.idempotencyKey === 'string' ? { ...req, body: { ...body, idempotencyKey: `${user.userId}:${body.idempotencyKey}` } } : req;
  const run = () => handleApi(db, scoped, { ...opts, adminActor });
  return user ? withPlayer({ id: user.playerId, wallet: user.wallet }, run) : run();
}

function adminAccounts(db: Sql, req: ApiRequest, seg: string[], b: Record<string, unknown>, actor: string, now: number): ApiResponse {
  const log = (action: string, detail: unknown) => db.run('INSERT INTO admin_log (tick, actor, action, detail_json, ok) VALUES ((SELECT last_tick FROM engine_state WHERE id = 1),?,?,?,1)', actor, action, JSON.stringify(detail));
  try {
    if (req.method === 'GET' && seg[1] === 'users') return json(200, { ok: true, users: listUsers(db, now), invites: listInvites(db, now) });
    if (req.method === 'POST' && seg[1] === 'invites') { const role: Role = b.role === 'admin' ? 'admin' : 'player'; const inv = createInvite(db, now, actor, role, String(b.note ?? '')); log('invite.create', { role, note: String(b.note ?? '').slice(0, 80) }); return json(200, { ok: true, invite: inv, note: 'Shown once. Send it to the player privately.' }); }
    if (req.method === 'POST' && seg[1] === 'users' && seg[2] && seg[3] === 'reset-code') { const r = createResetCode(db, now, actor, seg[2]); log('user.reset_code', { userId: seg[2] }); return json(200, { ok: true, reset: r, note: 'Shown once. Give it to the player privately; it expires in 24 hours.' }); }
    if (req.method === 'POST' && seg[1] === 'users' && seg[2] && seg[3] === 'disable') { if (!db.get('SELECT 1 FROM users WHERE id = ?', seg[2])) throw new AuthError('VALIDATION', 'Unknown user.'); setDisabled(db, seg[2], b.disabled !== false); log(b.disabled !== false ? 'user.disable' : 'user.enable', { userId: seg[2] }); return json(200, { ok: true }); }
    if (req.method === 'POST' && seg[1] === 'users' && seg[2] && seg[3] === 'sign-out') { revokeAllSessions(db, seg[2]); log('user.sign_out', { userId: seg[2] }); return json(200, { ok: true }); }
  } catch (e) { return authFail(e); }
  return fail(404, 'UNAVAILABLE', 'No such admin route.');
}

function timingSafe(a: string, b: string) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
