/**
 * Server-side sessions.
 *
 * The browser gets `token.sessionId` in an httpOnly cookie. The DB stores only
 * sha256(token) — a database dump therefore never yields a usable cookie.
 * Sessions slide (last_seen_at) and are rotated on every login / logout.
 */
import crypto from 'node:crypto';
import { config } from './config.mjs';
import { getDb, nowIso, publicUser, tx } from './db.mjs';
import { hashToken, makeCsrfToken, randomToken } from './crypto.mjs';

const SESSION_ID = /^[A-Za-z0-9_-]{10,64}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

/** "abc.def" cookie format: opaque session id (for lookups) + secret part. */
export function serializeSessionCookie(accessToken, sessionId) {
  return `${accessToken}.${sessionId}`;
}

export function parseSessionCookie(raw) {
  if (typeof raw !== 'string') return null;
  const idx = raw.lastIndexOf('.');
  if (idx <= 0) return null;
  const accessToken = raw.slice(0, idx);
  const sessionId = raw.slice(idx + 1);
  if (!TOKEN.test(accessToken) || !SESSION_ID.test(sessionId)) return null;
  return { accessToken, sessionId };
}

export function createSession(userId, meta = {}) {
  const accessToken = randomToken(32);
  const sessionId = randomToken(12);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + config.sessionTtlMs).toISOString();
  tx((db) => {
    db.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, user_agent, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(sessionId, userId, hashToken(accessToken), createdAt, createdAt, expiresAt, meta.userAgent ?? null, meta.ip ?? null);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(createdAt, userId);
    // Hygiene: drop anything already expired, and cap concurrent sessions per user.
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(createdAt);
    db.prepare(
      `DELETE FROM sessions WHERE user_id = ? AND id NOT IN (
         SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5
       )`
    ).run(userId, userId);
    return null;
  });
  return { accessToken, sessionId, csrfToken: makeCsrfToken(sessionId), expiresAt };
}

export function readSession(cookieValue, { touch = true } = {}) {
  const parsed = parseSessionCookie(cookieValue);
  if (!parsed) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.token_hash, s.expires_at, s.last_seen_at, s.user_id,
              u.id, u.email, u.name, u.avatar_url, u.provider, u.created_at, u.last_login_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`
    )
    .get(parsed.sessionId);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(parsed.sessionId);
    return null;
  }
  // Compare sha256(token) in constant time.
  const expected = Buffer.from(hashToken(parsed.accessToken), 'hex');
  const actual = Buffer.from(row.token_hash, 'hex');
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (!ok) return null;
  if (touch) db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), parsed.sessionId);
  return {
    sessionId: row.session_id,
    csrfToken: makeCsrfToken(row.session_id),
    expiresAt: row.expires_at,
    user: publicUser({
      id: row.id,
      email: row.email,
      name: row.name,
      avatar_url: row.avatar_url,
      provider: row.provider,
      created_at: row.created_at,
      last_login_at: row.last_login_at,
    }),
  };
}

export function revokeSession(sessionId) {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function revokeAllSessions(userId) {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function sessionCount(userId) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?').get(userId, nowIso()).n;
}
