/**
 * "Sign in with Google" — two modes.
 *
 * live: Google Identity Services returns an ID token (`credential`). We verify
 *       its RS256 signature against Google's published JWKS, then check
 *       iss/aud/exp/nonce and the email_verified claim.
 * demo: no OAuth client configured (or offline sandbox). A Google-styled
 *       account chooser posts { email, passcode } and we verify the passcode
 *       against a scrypt hash stored in the DB. Same session machinery, same
 *       response shape — the UI is identical in both modes.
 */
import crypto from 'node:crypto';
import { config } from './config.mjs';
import { getDb, nowIso, publicUser, tx } from './db.mjs';
import { hashPassword, verifyPassword } from './crypto.mjs';

const b64urlJson = (segment) => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));

let jwksCache = { keys: [], fetchedAt: 0 };

async function getGoogleKeys() {
  if (jwksCache.keys.length && Date.now() - jwksCache.fetchedAt < 10 * 60_000) return jwksCache.keys;
  const response = await fetch(config.google.jwksUrl, { headers: { accept: 'application/json' } });
  if (!response.ok) throw Object.assign(new Error('Unable to fetch Google signing keys.'), { statusCode: 502 });
  const { keys } = await response.json();
  jwksCache = { keys: keys || [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

export async function verifyGoogleIdToken(credential, expectedNonce) {
  if (typeof credential !== 'string') throw Object.assign(new Error('Missing Google credential.'), { statusCode: 400 });
  const [headerB64, payloadB64, signatureB64] = credential.split('.');
  if (!headerB64 || !payloadB64 || !signatureB64) throw Object.assign(new Error('Malformed Google credential.'), { statusCode: 400 });

  const header = b64urlJson(headerB64);
  if (header.alg !== 'RS256') throw Object.assign(new Error('Unsupported Google token algorithm.'), { statusCode: 400 });

  const keys = await getGoogleKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw Object.assign(new Error('Unknown Google signing key.'), { statusCode: 401 });

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signingInput = `${headerB64}.${payloadB64}`;
  const signatureOk = crypto.verify('sha256', Buffer.from(signingInput), publicKey, Buffer.from(signatureB64, 'base64url'));
  if (!signatureOk) throw Object.assign(new Error('Invalid Google credential signature.'), { statusCode: 401 });

  const payload = b64urlJson(payloadB64);
  const skew = config.google.clockSkewSeconds * 1000;
  const now = Date.now();
  if (!config.google.issuers.includes(payload.iss)) throw Object.assign(new Error('Unexpected token issuer.'), { statusCode: 401 });
  if (payload.aud !== config.google.clientId) throw Object.assign(new Error('Token audience mismatch.'), { statusCode: 401 });
  if (payload.exp * 1000 + skew < now) throw Object.assign(new Error('Google credential expired.'), { statusCode: 401 });
  if (payload.nbf && payload.nbf * 1000 - skew > now) throw Object.assign(new Error('Google credential not yet valid.'), { statusCode: 401 });
  if (expectedNonce && payload.nonce && payload.nonce !== expectedNonce) throw Object.assign(new Error('Nonce mismatch.'), { statusCode: 401 });
  if (!payload.email_verified) throw Object.assign(new Error('Google account email is not verified.'), { statusCode: 403 });

  return {
    sub: payload.sub,
    email: String(payload.email || '').toLowerCase(),
    name: payload.name || String(payload.email || '').split('@')[0],
    picture: payload.picture || null,
  };
}

/* ------------------------------------------------------------------ *
 * Shared: find-or-create the user behind a verified Google identity
 * ------------------------------------------------------------------ */
export function upsertGoogleUser({ sub, email, name, picture }) {
  const db = getDb();
  const row = tx((handle) => {
    const bySub = sub ? handle.prepare('SELECT * FROM users WHERE google_sub = ?').get(sub) : null;
    if (bySub) {
      handle.prepare('UPDATE users SET name = COALESCE(?, name), avatar_url = COALESCE(?, avatar_url) WHERE id = ?').run(name ?? null, picture ?? null, bySub.id);
      return handle.prepare('SELECT * FROM users WHERE id = ?').get(bySub.id);
    }
    const byEmail = handle.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (byEmail) {
      if (byEmail.provider === 'password' && byEmail.password_hash) {
        throw Object.assign(
          new Error('That email already has a password account. Log in with your password to link Google.'),
          { statusCode: 409, code: 'EMAIL_TAKEN' }
        );
      }
      handle.prepare('UPDATE users SET provider = ?, google_sub = COALESCE(?, google_sub), avatar_url = COALESCE(?, avatar_url) WHERE id = ?').run(
        'google',
        sub ?? null,
        picture ?? null,
        byEmail.id
      );
      return handle.prepare('SELECT * FROM users WHERE id = ?').get(byEmail.id);
    }
    const created = handle
      .prepare(`INSERT INTO users (email, name, avatar_url, provider, google_sub, created_at) VALUES (?, ?, ?, 'google', ?, ?)`)
      .run(email, name || email.split('@')[0], picture ?? null, sub ?? null, nowIso());
    return handle.prepare('SELECT * FROM users WHERE id = ?').get(Number(created.lastInsertRowid));
  });
  return publicUser(row);
}

/* ------------------------------------------------------------------ *
 * Demo provider
 * ------------------------------------------------------------------ */
export function isDemoAccount(email) {
  const db = getDb();
  const row = db.prepare('SELECT demo_code_hash FROM users WHERE email = ? AND provider = ?').get(email, 'google');
  return Boolean(row?.demo_code_hash);
}

export function verifyDemoGoogleAccount(email, passcode) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE email = ? AND provider = ?').get(String(email || '').toLowerCase(), 'google');
  if (!row || !row.demo_code_hash) {
    throw Object.assign(new Error('Not a demo Google account.'), { statusCode: 401, code: 'DEMO_ACCOUNT_UNKNOWN' });
  }
  if (!verifyPassword(passcode, row.demo_code_hash)) {
    throw Object.assign(new Error('Demo passcode is not correct.'), { statusCode: 401, code: 'DEMO_PASSCODE_INVALID' });
  }
  return { sub: `demo-${row.id}`, email: row.email, name: row.name, picture: row.avatar_url };
}

/** Seed helper: (re)arm a demo account with the shared demo passcode. */
export function setDemoPasscode(userId, passcode) {
  getDb().prepare('UPDATE users SET demo_code_hash = ? WHERE id = ?').run(hashPassword(passcode), userId);
}
