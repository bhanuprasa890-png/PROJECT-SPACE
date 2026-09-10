/**
 * HTTP plumbing: cookie parsing, security headers, CSRF, rate limiting,
 * auth middleware. Kept dependency-free so the attack surface is auditable.
 */
import { config } from './config.mjs';
import { parseSessionCookie, readSession } from './sessions.mjs';
import { verifyCsrfToken } from './crypto.mjs';

/* ------------------------------- cookies ------------------------------- */
export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = Object.create(null);
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[key] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

export function setSessionCookies(res, { accessToken, sessionId, csrfToken, maxAgeMs = config.sessionTtlMs }) {
  const attrs = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${config.cookieSecure ? '; Secure' : ''}`;
  res.append('Set-Cookie', `${config.cookieName}=${accessToken}.${sessionId}; ${attrs}`);
  // CSRF cookie is readable by JS on purpose (double-submit token).
  res.append(
    'Set-Cookie',
    `${config.csrfCookieName}=${csrfToken}; Path=/; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${config.cookieSecure ? '; Secure' : ''}`
  );
}

export function clearSessionCookies(res) {
  const attrs = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  res.append('Set-Cookie', `${config.cookieName}=; ${attrs}`);
  res.append('Set-Cookie', `${config.csrfCookieName}=; Path=/; SameSite=Lax; Max-Age=0`);
}

export const getClientIp = (req) =>
  (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');

/* --------------------------- security headers --------------------------- */
/**
 * The app is expected to run inside a sandbox/preview iframe, so framing is
 * allowed; tighten `frame-ancestors` to your own origin in production.
 */
export function securityHeaders(req, res, next) {
  const isDev = !config.IS_PROD;
  const csp = [
    "default-src 'self'",
    `script-src 'self' https://accounts.google.com${isDev ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src https://accounts.google.com",
    "frame-ancestors *",
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'on');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', req.path.startsWith('/api') ? 'no-store' : 'public, max-age=0, must-revalidate');
  next();
}

/* ------------------------------- rate limit ------------------------------ */
/** In-memory sliding window. Swap for Redis when running >1 process. */
export function createRateLimiter({ windowMs = config.rateLimit.windowMs, max = config.rateLimit.maxRequests } = {}) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, bucket] of hits) {
      const fresh = bucket.filter((t) => t > cutoff);
      if (fresh.length) hits.set(key, fresh);
      else hits.delete(key);
    }
  }, windowMs);
  if (sweep.unref) sweep.unref();

  return function limit(scope) {
    return (req, res, next) => {
      const key = `${scope}:${getClientIp(req)}`;
      const now = Date.now();
      const bucket = (hits.get(key) || []).filter((t) => t > now - windowMs);
      bucket.push(now);
      hits.set(key, bucket);
      if (bucket.length > max) {
        res.status(429).json({
          error: 'Too many requests — slow down.',
          retryAfterSeconds: Math.ceil(windowMs / 1000),
        });
        return;
      }
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.length)));
      next();
    };
  };
}

/**
 * Per-account lockout: after N failed attempts for one email (across IPs) the
 * account is paused for lockoutMs. Successful logins reset the counter.
 */
export function createFailureTracker({ max = config.rateLimit.maxFailures, lockoutMs = config.rateLimit.lockoutMs } = {}) {
  const failures = new Map();
  const check = (key) => {
    const entry = failures.get(key);
    if (!entry) return { blocked: false, attempts: 0, retryAfterSeconds: 0 };
    if (entry.lockedUntil && entry.lockedUntil > Date.now()) {
      return { blocked: true, attempts: entry.count, retryAfterSeconds: Math.ceil((entry.lockedUntil - Date.now()) / 1000) };
    }
    if (entry.lockedUntil && entry.lockedUntil <= Date.now()) {
      failures.delete(key);
      return { blocked: false, attempts: 0, retryAfterSeconds: 0 };
    }
    return { blocked: false, attempts: entry.count, retryAfterSeconds: 0 };
  };
  return {
    check,
    record(key) {
      const entry = failures.get(key) || { count: 0, lockedUntil: null };
      entry.count += 1;
      if (entry.count >= max) entry.lockedUntil = Date.now() + lockoutMs;
      failures.set(key, entry);
      return check(key);
    },
    reset(key) {
      failures.delete(key);
    },
  };
}

export const failures = createFailureTracker();

/* ------------------------------- CSRF ------------------------------- */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  // Requests that carry only the session cookie (no ambient-auth risk for
  // same-site JSON APIs) still need the double-submit token.
  const cookies = parseCookies(req);
  const header = req.get('x-csrf-token') || '';
  const cookieToken = cookies[config.csrfCookieName] || '';
  const parsed = parseSessionCookie(cookies[config.cookieName]);
  if (!parsed) return next(); // unauthenticated write: no session to forge
  const provided = header || cookieToken;
  if (!provided || !verifyCsrfToken(parsed.sessionId, provided)) {
    return res.status(403).json({ error: 'CSRF check failed. Reload the page and try again.' });
  }
  next();
}

/* ------------------------------- auth ------------------------------- */
export function attachSession(req, _res, next) {
  const cookies = parseCookies(req);
  req.session = readSession(cookies[config.cookieName]);
  req.user = req.session?.user ?? null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.', code: 'AUTH_REQUIRED' });
  next();
}

/** Small, uniform error surface: never leak stack traces to the client. */
export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch((error) => {
    if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message });
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large.' });
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Malformed JSON body.' });
    console.error('[unhandled]', error);
    return res.status(500).json({ error: 'Something went wrong on our side.' });
  });
}
