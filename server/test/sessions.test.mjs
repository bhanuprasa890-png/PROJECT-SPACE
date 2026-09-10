import './env.mjs';
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resetDbForTests, getDb, nowIso } from '../src/db.mjs';
import { config } from '../src/config.mjs';
import { hashToken } from '../src/crypto.mjs';
import { createSession, parseSessionCookie, readSession, revokeSession, sessionCount } from '../src/sessions.mjs';

function makeUser(email = 'sessions-user@example.com') {
  const info = getDb()
    .prepare(`INSERT INTO users (email, name, provider, password_hash, created_at) VALUES (?, 'Session Tester', 'password', 'x', ?)`)
    .run(email, nowIso());
  return Number(info.lastInsertRowid);
}

describe('sessions', () => {
  before(() => resetDbForTests(':memory:'));

  test('cookie value splits into token + session id', () => {
    const { accessToken, sessionId } = createSession(makeUser(), { userAgent: 'node-test', ip: '127.0.0.1' });
    const parsed = parseSessionCookie(serialize(accessToken, sessionId));
    assert.equal(parsed.sessionId, sessionId);
    assert.equal(parsed.accessToken, accessToken);
  });

  test('a valid cookie resolves to the user', () => {
    const userId = makeUser('valid-cookie@example.com');
    const session = createSession(userId);
    const read = readSession(serialize(session.accessToken, session.sessionId));
    assert.equal(read.user.id, userId);
    assert.ok(read.csrfToken);
  });

  test('tampering with the token part invalidates the session', () => {
    const session = createSession(makeUser('tamper@example.com'));
    const forged = serialize('A'.repeat(accessTokenLength()), session.sessionId);
    assert.equal(readSession(forged), null);
  });

  test('an unknown session id is rejected', () => {
    const session = createSession(makeUser('unknown-sid@example.com'));
    assert.equal(readSession(serialize(session.accessToken, 'doesnotexist01')), null);
  });

  test('garbage cookie strings never reach the DB layer', () => {
    for (const junk of ['', 'abc', '.', 'a.b.c', `${'x'.repeat(40)}.`, '!!!!.@@@@']) {
      assert.equal(readSession(junk), null, junk);
    }
  });

  test('only a hash of the token is persisted', () => {
    const session = createSession(makeUser('hash-only@example.com'));
    const row = getDb().prepare('SELECT token_hash FROM sessions WHERE id = ?').get(session.sessionId);
    assert.notEqual(row.token_hash, session.accessToken);
    assert.equal(row.token_hash, hashToken(session.accessToken));
  });

  test('expired sessions are dropped and rejected', () => {
    const session = createSession(makeUser('expired@example.com'));
    getDb().prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), session.sessionId);
    assert.equal(readSession(serialize(session.accessToken, session.sessionId)), null);
    assert.equal(getDb().prepare('SELECT COUNT(*) n FROM sessions WHERE id = ?').get(session.sessionId).n, 0);
  });

  test('logout revokes the row so the cookie dies immediately', () => {
    const session = createSession(makeUser('logout@example.com'));
    const cookie = serialize(session.accessToken, session.sessionId);
    assert.ok(readSession(cookie));
    revokeSession(session.sessionId);
    assert.equal(readSession(cookie), null);
  });

  test('concurrent sessions are capped at 5 per user', () => {
    const userId = makeUser('cap@example.com');
    for (let i = 0; i < 8; i += 1) createSession(userId);
    assert.equal(sessionCount(userId), 5);
  });

  test('ttl matches configuration', () => {
    const session = createSession(makeUser('ttl@example.com'));
    const ttl = new Date(session.expiresAt).getTime() - Date.now();
    assert.ok(Math.abs(ttl - config.sessionTtlMs) < 5000);
  });
});

const serialize = (token, sessionId) => `${token}.${sessionId}`;
const accessTokenLength = () => 43; // base64url of 32 random bytes
