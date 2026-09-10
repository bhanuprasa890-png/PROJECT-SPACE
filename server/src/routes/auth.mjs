/**
 * Auth routes — the whole credential surface of the app.
 *
 *   GET  /api/auth/config           UI capabilities (never credentials in prod)
 *   POST /api/auth/register         Create new account (email + password)
 *   POST /api/auth/login            Log in (email + password)
 *   POST /api/auth/logout           Log out (revokes the session row)
 *   GET  /api/auth/me               Who am I + CSRF token
 *   GET  /api/auth/nonce            GIS one-time nonce for live mode
 *   POST /api/auth/google/credential  Live: verify a Google ID token
 *   POST /api/auth/google/demo        Demo: verify a seeded demo Google account
 */
import crypto from 'node:crypto';
import express from 'express';
import { config } from '../config.mjs';
import { getDb, nowIso, publicUser, tx } from '../db.mjs';
import { hashPassword, normalizeEmail, passwordProblems, passwordStrength, verifyPassword } from '../crypto.mjs';
import { asyncRoute, clearSessionCookies, createRateLimiter, failures, getClientIp, requireAuth, setSessionCookies } from '../http.mjs';
import { createSession, revokeSession, sessionCount } from '../sessions.mjs';
import { upsertGoogleUser, verifyDemoGoogleAccount, verifyGoogleIdToken } from '../google.mjs';
import { DEMO_GOOGLE_ACCOUNTS, DEMO_PASSWORD_ACCOUNT } from '../seed.mjs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const NAME_RE = /^[\p{L}\p{M}'’.\- ]{2,60}$/u;
const limiter = createRateLimiter();

function audit(db, kind, email, ok, reason, req) {
  db.prepare('INSERT INTO auth_events (kind, email, ok, reason, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    kind,
    email ? String(email).slice(0, 200) : null,
    ok ? 1 : 0,
    reason ?? null,
    getClientIp(req),
    nowIso()
  );
}

function badRequest(res, message, extra = {}) {
  return res.status(400).json({ error: message, ...extra });
}

function startSession(req, res, user, kind) {
  const db = getDb();
  const session = createSession(user.id, { userAgent: String(req.headers['user-agent'] || '').slice(0, 200), ip: getClientIp(req) });
  setSessionCookies(res, session);
  audit(db, kind, user.email, true, null, req);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  return { user: publicUser(fresh), csrfToken: session.csrfToken, expiresAt: session.expiresAt };
}

export const authRouter = express.Router();

authRouter.get('/config', (_req, res) => {
  res.json({
    googleMode: config.google.mode,
    googleClientId: config.google.mode === 'live' ? config.google.clientId : null,
    passwordMinLength: config.password.minLength,
    passwordMaxLength: config.password.maxLength,
    sessionTtlDays: config.sessionTtlMs / 86_400_000,
    // Demo credentials only ever leave the server when explicitly enabled.
    demoAccounts: config.demo.showCredentials
      ? DEMO_GOOGLE_ACCOUNTS.map((a) => ({ email: a.email, name: a.name, role: a.role, passcode: config.demo.passcode }))
      : [],
    demoPasswordAccount: config.demo.showCredentials
      ? { email: DEMO_PASSWORD_ACCOUNT.email, password: DEMO_PASSWORD_ACCOUNT.password, label: 'Local demo account' }
      : null,
  });
});

authRouter.post('/register', limiter('register'), asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const name = String(req.body?.name ?? '').trim().replace(/\s+/g, ' ');
  const password = String(req.body?.password ?? '');

  const errors = {};
  if (!EMAIL_RE.test(email) || email.length > 200) errors.email = 'Enter a valid email address.';
  if (!NAME_RE.test(name)) errors.name = 'Use 2-60 letters for your name.';
  const problems = passwordProblems(password, { email, name });
  if (problems.length) errors.password = problems.join(' ');
  if (Object.keys(errors).length) return badRequest(res, 'Check the highlighted fields.', { fields: errors });

  const db = getDb();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    audit(db, 'register', email, false, 'email_taken', req);
    return res.status(409).json({ error: 'An account with that email already exists. Try logging in instead.', fields: { email: 'Already registered.' } });
  }

  const user = tx((handle) => {
    handle
      .prepare(`INSERT INTO users (email, name, avatar_url, provider, password_hash, created_at) VALUES (?, ?, NULL, 'password', ?, ?)`)
      .run(email, name, hashPassword(password), nowIso());
    return publicUser(handle.prepare('SELECT * FROM users WHERE email = ?').get(email));
  });
  audit(getDb(), 'register', email, true, null, req);

  const payload = startSession(req, res, user, 'register');
  res.status(201).json({ ...payload, strength: passwordStrength(password) });
}));

authRouter.post('/login', limiter('login'), asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  if (!email || !password) return badRequest(res, 'Email and password are both required.');

  const gate = failures.check(email);
  if (gate.blocked) {
    audit(getDb(), 'login', email, false, 'locked_out', req);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(gate.retryAfterSeconds / 60)} min.`, code: 'LOCKED' });
  }

  const row = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = row?.password_hash ? verifyPassword(password, row.password_hash) : false;
  if (!ok) {
    const after = failures.record(email);
    audit(getDb(), 'login', email, false, after.blocked ? 'locked_out' : 'invalid_credentials', req);
    return res.status(401).json({
      error: after.blocked
        ? 'Too many failed attempts for this account. Try again in a few minutes.'
        : 'Email or password is not correct.',
      attemptsLeft: Math.max(0, config.rateLimit.maxFailures - after.attempts),
    });
  }

  failures.reset(email);
  res.json(startSession(req, res, row, 'login'));
}));

authRouter.post('/logout', asyncRoute(async (req, res) => {
  if (req.session?.sessionId) {
    revokeSession(req.session.sessionId);
    audit(getDb(), 'logout', req.user?.email, true, null, req);
  }
  clearSessionCookies(res);
  res.json({ ok: true, message: 'Signed out. All good.' });
}));

authRouter.get('/me', asyncRoute(async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not signed in.', code: 'AUTH_REQUIRED' });
  res.json({
    user: req.user,
    csrfToken: req.session.csrfToken,
    expiresAt: req.session.expiresAt,
    sessions: sessionCount(req.user.id),
  });
}));

authRouter.get('/sessions', requireAuth, asyncRoute(async (req, res) => {
  const rows = getDb()
    .prepare('SELECT id, created_at, last_seen_at, expires_at, user_agent FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10')
    .all(req.user.id);
  res.json({
    current: req.session.sessionId,
    sessions: rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      expiresAt: r.expires_at,
      current: r.id === req.session.sessionId,
      device: String(r.user_agent || '').slice(0, 120),
    })),
  });
}));

authRouter.post('/sessions/revoke-others', requireAuth, asyncRoute(async (req, res) => {
  const db = getDb();
  tx((handle) => handle.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(req.user.id, req.session.sessionId));
  audit(db, 'revoke_others', req.user.email, true, null, req);
  res.json({ ok: true });
}));

/* ----------------------------- Google modes ----------------------------- */

authRouter.get('/google/nonce', (_req, res) => {
  const nonce = crypto.randomBytes(16).toString('base64url');
  res.append(
    'Set-Cookie',
    `mise_gnonce=${nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${config.cookieSecure ? '; Secure' : ''}`
  );
  res.json({ nonce, clientId: config.google.mode === 'live' ? config.google.clientId : null });
});

authRouter.post('/google/credential', limiter('google'), asyncRoute(async (req, res) => {
  if (config.google.mode !== 'live') {
    return res.status(400).json({ error: 'Live Google sign-in is not enabled on this server.' });
  }
  const { credential } = req.body ?? {};
  const expectedNonce = req.headers.cookie?.match(/mise_gnonce=([^;]+)/)?.[1];
  const profile = await verifyGoogleIdToken(credential, expectedNonce);
  const user = upsertGoogleUser(profile);
  // The nonce is single-use: burn the cookie so a captured token cannot be
  // replayed against a later sign-in attempt.
  res.append('Set-Cookie', `mise_gnonce=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.cookieSecure ? '; Secure' : ''}`);
  res.json(startSession(req, res, user, 'google_live'));
}));

authRouter.post('/google/demo', limiter('google'), asyncRoute(async (req, res) => {
  if (config.google.mode !== 'demo') {
    return res.status(400).json({ error: 'Demo Google sign-in is disabled while a real client id is configured.' });
  }
  const email = normalizeEmail(req.body?.email);
  const passcode = String(req.body?.passcode ?? '');
  const gate = failures.check(`demo:${email}`);
  if (gate.blocked) {
    audit(getDb(), 'google_demo', email, false, 'locked_out', req);
    return res.status(429).json({ error: 'Too many attempts. Wait a few minutes and try the demo passcode again.' });
  }
  try {
    const profile = verifyDemoGoogleAccount(email, passcode);
    const user = upsertGoogleUser(profile);
    failures.reset(`demo:${email}`);
    res.json(startSession(req, res, user, 'google_demo'));
  } catch (error) {
    failures.record(`demo:${email}`);
    audit(getDb(), 'google_demo', email, false, error.code || 'invalid', req);
    const status = error.statusCode || 401;
    res.status(status).json({ error: error.message, code: error.code });
  }
}));
