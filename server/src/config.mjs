/**
 * Central runtime configuration.
 *
 * SECURITY RULE OF THUMB: no secret ever lives in client code.
 * Everything below is read from the environment (or a gitignored .env file).
 * `npm run dev` works with zero configuration because dev-only fallbacks are
 * generated on disk and loudly reported in the server log.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(SERVER_DIR, '..');

/** Minimal .env reader (no dependency). Existing process.env always wins. */
function loadDotEnv() {
  for (const file of [path.join(REPO_ROOT, '.env'), path.join(REPO_ROOT, '.env.local')]) {
    if (!fs.existsSync(file)) continue;
    for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}
loadDotEnv();

const env = process.env;
const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};
const int = (value, fallback) => (Number.isFinite(Number(value)) && value !== undefined && value !== '' ? Number(value) : fallback);

export const NODE_ENV = env.NODE_ENV || 'development';
export const IS_PROD = NODE_ENV === 'production';
export const IS_TEST = NODE_ENV === 'test';

/**
 * SESSION SECRET
 * - production: REQUIRED, refuse to boot without it (prevents "signed with a
 *   default secret" bugs that let anyone forge a session cookie).
 * - dev/test: generated once and stored in the gitignored .dev/ folder so that
 *   restarts don't invalidate everybody's cookies.
 */
function resolveSessionSecret() {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) return { secret: env.SESSION_SECRET, source: 'env.SESSION_SECRET' };
  if (IS_PROD) {
    throw new Error(
      'SESSION_SECRET is missing or shorter than 32 chars. Refusing to start in production.\n' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  const devDir = path.join(SERVER_DIR, '.dev');
  const devFile = path.join(devDir, 'session-secret');
  if (fs.existsSync(devFile)) return { secret: fs.readFileSync(devFile, 'utf8').trim(), source: `${path.relative(REPO_ROOT, devFile)} (dev-only)` };
  const secret = crypto.randomBytes(32).toString('hex');
  if (!IS_TEST) {
    fs.mkdirSync(devDir, { recursive: true });
    fs.writeFileSync(devFile, `${secret}\n`, { mode: 0o600 });
  }
  return { secret, source: IS_TEST ? 'ephemeral (test)' : 'generated (dev-only)' };
}
const secret = resolveSessionSecret();

/** Google Identity Services: live vs. demo mode. */
const googleClientId = (env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
const GOOGLE_MODE = (env.GOOGLE_MODE || (googleClientId ? 'live' : 'demo')).toLowerCase();
if (GOOGLE_MODE !== 'live' && GOOGLE_MODE !== 'demo') {
  throw new Error(`GOOGLE_MODE must be "live" or "demo" (got "${GOOGLE_MODE}").`);
}

export const config = {
  NODE_ENV,
  IS_PROD,
  IS_TEST,
  host: env.HOST || '0.0.0.0',
  port: int(env.PORT, 8787),
  publicOrigin: env.PUBLIC_ORIGIN || '',
  sessionSecret: secret.secret,
  sessionSecretSource: secret.source,
  cookieName: env.COOKIE_NAME || 'mise_sid',
  csrfCookieName: 'mise_csrf',
  /** Secure cookies need HTTPS; localhost over http is exempt so dev stays usable. */
  cookieSecure: bool(env.COOKIE_SECURE, IS_PROD),
  sessionTtlMs: int(env.SESSION_TTL_DAYS, 14) * 24 * 60 * 60 * 1000,
  dbPath: env.DB_PATH === ':memory:' ? ':memory:' : env.DB_PATH ? path.resolve(env.DB_PATH) : path.join(SERVER_DIR, '.dev', 'mise.db'),
  clientDist: path.join(REPO_ROOT, 'client', 'dist'),
  google: {
    mode: GOOGLE_MODE,
    clientId: googleClientId,
    tokenInfoUrl: 'https://oauth2.googleapis.com/tokeninfo',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    clockSkewSeconds: int(env.GOOGLE_CLOCK_SKEW_SECONDS, 30),
  },
  demo: {
    /** The demo passcode shared by the seeded Google accounts. */
    passcode: env.DEMO_PASSCODE || 'MiseDemo#2026',
    /** Show the demo account list on the login screen (dev/demo only). */
    showCredentials: bool(env.SHOW_DEMO_CREDENTIALS, !IS_PROD),
  },
  password: {
    minLength: int(env.PASSWORD_MIN_LENGTH, 10),
    maxLength: 200,
    maxBytes: 1024,
  },
  rateLimit: {
    windowMs: int(env.RATE_LIMIT_WINDOW_MS, 60_000),
    maxRequests: int(env.RATE_LIMIT_MAX, 12),
    /** Per-email brute-force protection. */
    maxFailures: int(env.RATE_LIMIT_MAX_FAILURES, 5),
    lockoutMs: int(env.RATE_LIMIT_LOCKOUT_MS, 15 * 60_000),
  },
  bodyLimit: env.BODY_LIMIT || '16kb',
};

export function describeConfig() {
  return {
    env: NODE_ENV,
    googleMode: config.google.mode,
    cookieSecure: config.cookieSecure,
    sessionTtlDays: config.sessionTtlMs / 86_400_000,
    dbPath: path.relative(REPO_ROOT, config.dbPath),
    secretSource: config.sessionSecretSource,
  };
}
