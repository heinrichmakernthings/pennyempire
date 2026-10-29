/**
 * Migration 0008 — Private-alpha accounts. Invite-only users bound 1:1 to a `players` row, hashed sessions, single-use invites and
 * admin-issued reset codes, and an attempt log for rate limiting. Secrets are never stored: passwords are PBKDF2-SHA-256 hashes,
 * session tokens, invite codes and reset codes are stored as SHA-256 digests only. Additive only.
 */
export default `
CREATE TABLE users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, player_id TEXT NOT NULL UNIQUE REFERENCES players(id),
  role TEXT NOT NULL CHECK (role IN ('player','admin')), password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, password_iters INTEGER NOT NULL CHECK (password_iters >= 10000),
  created_ms INTEGER NOT NULL, last_login_ms INTEGER, disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)), settings_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, last_seen_ms INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0,1))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE invites (
  code_hash TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('player','admin')), note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL, used_by TEXT REFERENCES users(id), used_ms INTEGER, revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0,1))
);
CREATE TABLE password_resets (
  code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_by TEXT NOT NULL, created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, used_ms INTEGER
);
CREATE TABLE auth_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, bucket TEXT NOT NULL, ms INTEGER NOT NULL, ok INTEGER NOT NULL CHECK (ok IN (0,1)));
CREATE INDEX idx_auth_attempts_bucket ON auth_attempts(bucket, ms);
CREATE TABLE notification_reads (player_id TEXT PRIMARY KEY REFERENCES players(id), last_seen_tick INTEGER NOT NULL DEFAULT -1);
`;
