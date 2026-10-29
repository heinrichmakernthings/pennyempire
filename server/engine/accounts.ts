/**
 * Private-alpha accounts: invite-only registration, sessions, roles, admin-issued password resets and attempt-based rate limiting.
 * Every player is a real `players` row with its own coin wallet (starting capital is a recorded issuance) and its own GBP_TEST wallet.
 * Callers pass already-computed password hashes (hashing is async WebCrypto, see server/auth/crypto.ts), so everything here is synchronous
 * and runs inside one SQLite transaction.
 */
import type { Sql } from '../db/sql';
import { digest, randomSecret } from '../auth/crypto';
import { createAccount, issue } from './ledger';
import { gameDate, loadConfig } from './config';
import { ensureWallet } from './gbpLedger';
import { CITY_ID } from '../seed/bristol';

export type Role = 'player' | 'admin';
export interface SessionUser { userId: string; username: string; displayName: string; role: Role; playerId: string; wallet: string; settings: UserSettings }
export interface UserSettings { reducedMotion?: boolean; notifications?: boolean; compactNumbers?: boolean; hideOnboarding?: boolean }
export class AuthError extends Error { constructor(public code: 'VALIDATION' | 'FORBIDDEN' | 'RATE_LIMITED' | 'CONFLICT', message: string) { super(message); } }

export const STARTING_CAPITAL_MINOR = 2_000_000;           // 20,000 EC, the same as the single-player 'new' profile
export const SESSION_TTL_MS = 30 * 24 * 3_600_000;
const INVITE_TTL_MS = 14 * 24 * 3_600_000, RESET_TTL_MS = 24 * 3_600_000;
const WINDOW_MS = 15 * 60_000;
export const LIMITS = { userFailures: 5, ipFailures: 20, ipRegistrations: 10 };

const USERNAME = /^[a-z0-9_]{3,20}$/;
export function validateUsername(u: unknown): string { const s = String(u ?? '').trim().toLowerCase(); if (!USERNAME.test(s)) throw new AuthError('VALIDATION', 'Usernames are 3–20 characters: lowercase letters, digits and underscores.'); return s; }
export function validatePassword(p: unknown): string { const s = String(p ?? ''); if (s.length < 10 || s.length > 200) throw new AuthError('VALIDATION', 'Passwords must be 10–200 characters.'); return s; }
export function validateDisplayName(n: unknown): string {
  const s = String(n ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 32) throw new AuthError('VALIDATION', 'Display names are 2–32 characters.');
  return s;
}
const cleanSettings = (s: unknown): UserSettings => { const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>; const out: UserSettings = {}; for (const k of ['reducedMotion', 'notifications', 'compactNumbers', 'hideOnboarding'] as const) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean; return out; };

// ───────── rate limiting (persistent, so it survives restarts and Durable Object evictions) ─────────
const failures = (db: Sql, bucket: string, now: number) => db.get<{ n: number }>('SELECT COUNT(*) n FROM auth_attempts WHERE bucket = ? AND ok = 0 AND ms > ? AND ms > COALESCE((SELECT MAX(ms) FROM auth_attempts WHERE bucket = ? AND ok = 1), 0)', bucket, now - WINDOW_MS, bucket)!.n;
export function checkRate(db: Sql, now: number, buckets: Array<[string, number]>) { for (const [b, max] of buckets) if (failures(db, b, now) >= max) throw new AuthError('RATE_LIMITED', 'Too many attempts. Wait 15 minutes and try again.'); }
export function recordAttempt(db: Sql, now: number, bucket: string, ok: boolean) {
  db.run('INSERT INTO auth_attempts (bucket, ms, ok) VALUES (?,?,?)', bucket, now, ok ? 1 : 0);
  db.run('DELETE FROM auth_attempts WHERE ms < ?', now - 24 * 3_600_000);
}

// ───────── invites ─────────
export function createInvite(db: Sql, now: number, by: string, role: Role, note = '', ttlMs = INVITE_TTL_MS): { code: string; expiresMs: number } {
  if (role !== 'player' && role !== 'admin') throw new AuthError('VALIDATION', 'Unknown role.');
  const code = `inv-${randomSecret(12)}`;
  db.run('INSERT INTO invites (code_hash, role, note, created_by, created_ms, expires_ms) VALUES (?,?,?,?,?,?)', digest(code), role, String(note).slice(0, 80), by, now, now + ttlMs);
  return { code, expiresMs: now + ttlMs };
}
export const inviteStatus = (db: Sql, code: string, now: number) => {
  const i = db.get<{ role: Role; expires_ms: number; used_by: string | null; revoked: number }>('SELECT role, expires_ms, used_by, revoked FROM invites WHERE code_hash = ?', digest(String(code ?? '')));
  return !i || i.revoked || i.used_by || i.expires_ms <= now ? null : i;
};

// ───────── registration ─────────
export function registerUser(db: Sql, now: number, a: { invite: string; username: string; displayName: string; hash: string; salt: string; iterations: number }): SessionUser {
  return db.transaction(() => {
    const inv = inviteStatus(db, a.invite, now);
    if (!inv) throw new AuthError('FORBIDDEN', 'That invite code is invalid, expired or already used.');
    if (db.get('SELECT 1 FROM users WHERE username = ?', a.username)) throw new AuthError('CONFLICT', 'That username is taken.');
    const suffix = randomSecret(6);
    const userId = `usr-${suffix}`, playerId = `pl-${suffix}`, wallet = `acct:player:${playerId}`;
    createAccount(db, wallet, 'player', `Wallet of ${a.displayName}`);
    db.run('INSERT INTO owners (id, kind, name) VALUES (?,?,?)', playerId, 'player', a.displayName);
    db.run('INSERT INTO players (id, display_name, city_id, wallet_account_id) VALUES (?,?,?,?)', playerId, a.displayName, CITY_ID, wallet);
    const t = db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
    issue(db, { tick: t, gameDate: gameDate(loadConfig(db), t), actor: `register:${playerId}` }, `register:${playerId}`, wallet, STARTING_CAPITAL_MINOR, 'new player starting capital');
    ensureWallet(db, playerId);
    db.run('INSERT INTO users (id, username, player_id, role, password_hash, password_salt, password_iters, created_ms) VALUES (?,?,?,?,?,?,?,?)', userId, a.username, playerId, inv.role, a.hash, a.salt, a.iterations, now);
    db.run('UPDATE invites SET used_by = ?, used_ms = ? WHERE code_hash = ?', userId, now, digest(a.invite));
    return loadUser(db, userId)!;
  });
}

// ───────── users and sessions ─────────
interface UserRow { id: string; username: string; player_id: string; role: Role; password_hash: string; password_salt: string; password_iters: number; disabled: number; settings_json: string }
export const credentials = (db: Sql, username: string) => db.get<UserRow>('SELECT * FROM users WHERE username = ?', username);
export function loadUser(db: Sql, userId: string): SessionUser | null {
  const u = db.get<UserRow & { display_name: string; wallet: string }>('SELECT u.*, p.display_name, p.wallet_account_id wallet FROM users u JOIN players p ON p.id = u.player_id WHERE u.id = ?', userId);
  if (!u || u.disabled) return null;
  return { userId: u.id, username: u.username, displayName: u.display_name, role: u.role, playerId: u.player_id, wallet: u.wallet, settings: cleanSettings(JSON.parse(u.settings_json)) };
}
export function createSession(db: Sql, userId: string, now: number): { token: string; expiresMs: number } {
  const token = randomSecret(32);
  db.run('INSERT INTO sessions (token_hash, user_id, created_ms, expires_ms, last_seen_ms) VALUES (?,?,?,?,?)', digest(token), userId, now, now + SESSION_TTL_MS, now);
  db.run('UPDATE users SET last_login_ms = ? WHERE id = ?', now, userId);
  db.run('DELETE FROM sessions WHERE expires_ms < ? OR (revoked = 1 AND last_seen_ms < ?)', now, now - SESSION_TTL_MS);
  return { token, expiresMs: now + SESSION_TTL_MS };
}
export function sessionUser(db: Sql, token: string | undefined, now: number): SessionUser | null {
  if (!token || token.length !== 64) return null;
  const s = db.get<{ user_id: string; expires_ms: number; revoked: number; last_seen_ms: number }>('SELECT user_id, expires_ms, revoked, last_seen_ms FROM sessions WHERE token_hash = ?', digest(token));
  if (!s || s.revoked || s.expires_ms <= now) return null;
  const u = loadUser(db, s.user_id); if (!u) return null;
  if (now - s.last_seen_ms > 60_000) db.run('UPDATE sessions SET last_seen_ms = ? WHERE token_hash = ?', now, digest(token));
  return u;
}
export const revokeSession = (db: Sql, token: string) => db.run('UPDATE sessions SET revoked = 1 WHERE token_hash = ?', digest(token));
export const revokeAllSessions = (db: Sql, userId: string) => db.run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', userId);

export function setPassword(db: Sql, userId: string, h: { hash: string; salt: string; iterations: number }) {
  db.transaction(() => { db.run('UPDATE users SET password_hash = ?, password_salt = ?, password_iters = ? WHERE id = ?', h.hash, h.salt, h.iterations, userId); revokeAllSessions(db, userId); });
}
export function updateProfile(db: Sql, u: SessionUser, p: { displayName?: unknown; settings?: unknown }): SessionUser {
  return db.transaction(() => {
    if (p.displayName !== undefined) { const n = validateDisplayName(p.displayName); db.run('UPDATE players SET display_name = ? WHERE id = ?', n, u.playerId); db.run('UPDATE owners SET name = ? WHERE id = ?', n, u.playerId); db.run('UPDATE investors SET name = ? WHERE id = ?', n, u.playerId); }
    if (p.settings !== undefined) db.run('UPDATE users SET settings_json = ? WHERE id = ?', JSON.stringify({ ...u.settings, ...cleanSettings(p.settings) }), u.userId);
    return loadUser(db, u.userId)!;
  });
}

// ───────── recovery: an administrator issues a single-use code out of band; there is no email in the alpha ─────────
export function createResetCode(db: Sql, now: number, by: string, userId: string): { code: string; expiresMs: number } {
  if (!db.get('SELECT 1 FROM users WHERE id = ?', userId)) throw new AuthError('VALIDATION', 'Unknown user.');
  const code = `rst-${randomSecret(12)}`;
  db.run('UPDATE password_resets SET used_ms = ? WHERE user_id = ? AND used_ms IS NULL', now, userId);   // only the newest code works
  db.run('INSERT INTO password_resets (code_hash, user_id, created_by, created_ms, expires_ms) VALUES (?,?,?,?,?)', digest(code), userId, by, now, now + RESET_TTL_MS);
  return { code, expiresMs: now + RESET_TTL_MS };
}
export function resetTarget(db: Sql, username: string, code: string, now: number): string | null {
  const r = db.get<{ user_id: string }>('SELECT r.user_id FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.code_hash = ? AND u.username = ? AND r.used_ms IS NULL AND r.expires_ms > ?', digest(String(code ?? '')), username, now);
  return r?.user_id ?? null;
}
export const consumeReset = (db: Sql, code: string, now: number) => db.run('UPDATE password_resets SET used_ms = ? WHERE code_hash = ?', now, digest(code));

// ───────── administration views: never include hashes, salts or secrets ─────────
export function listUsers(db: Sql, now: number) {
  return db.all<{ id: string; username: string; displayName: string; role: Role; playerId: string; createdMs: number; lastLoginMs: number | null; disabled: number; walletMinor: number; companies: number; sessions: number }>(
    `SELECT u.id, u.username, p.display_name displayName, u.role, u.player_id playerId, u.created_ms createdMs, u.last_login_ms lastLoginMs, u.disabled,
       a.balance_minor walletMinor, (SELECT COUNT(*) FROM companies c WHERE c.owner_kind = 'player' AND c.owner_id = u.player_id AND c.bankrupt_tick IS NULL) companies,
       (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked = 0 AND s.expires_ms > ?) sessions
     FROM users u JOIN players p ON p.id = u.player_id JOIN accounts a ON a.id = p.wallet_account_id ORDER BY u.created_ms`, now);
}
export const listInvites = (db: Sql, now: number) => db.all<{ role: Role; note: string; createdBy: string; createdMs: number; expiresMs: number; usedBy: string | null; status: string }>(
  "SELECT role, note, created_by createdBy, created_ms createdMs, expires_ms expiresMs, used_by usedBy, CASE WHEN revoked = 1 THEN 'revoked' WHEN used_by IS NOT NULL THEN 'used' WHEN expires_ms <= ? THEN 'expired' ELSE 'open' END status FROM invites ORDER BY created_ms DESC LIMIT 100", now);
export function setDisabled(db: Sql, userId: string, disabled: boolean) { db.run('UPDATE users SET disabled = ? WHERE id = ?', disabled ? 1 : 0, userId); if (disabled) revokeAllSessions(db, userId); }
