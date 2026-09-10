/**
 * Password + token crypto.
 *
 * - scrypt (memory-hard) for passwords, with an explicit cost prefix so old
 *   hashes stay verifiable after a cost bump.
 * - timingSafeEqual for every secret comparison.
 * - no reversible encryption anywhere.
 */
import crypto from 'node:crypto';
import { config } from './config.mjs';

const SCRYPT_KEYLEN = 64;
const PARAMS = { N: 16384, r: 8, p: 1 };

/** normalize: casefold + trim. Emails are identifiers, not display text. */
export const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, { ...PARAMS, maxmem: 64 * 1024 * 1024 });
  // base64url keeps the hash safe to store/log without escaping surprises.
  return ['scrypt', 'v1', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 7 || parts[0] !== 'scrypt' || parts[1] !== 'v1') return false;
  const [, , N, r, p, saltB64, hashB64] = parts;
  if (!/^[A-Za-z0-9_-]*$/.test(saltB64) || !/^[A-Za-z0-9_-]+$/.test(hashB64)) return false;
  try {
    const derived = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64url'), SCRYPT_KEYLEN, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 128 * 1024 * 1024,
    });
    const expected = Buffer.from(hashB64, 'base64url');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Session cookie -> stable DB lookup key. Never store the raw token. */
export const hashToken = (token) => sha256(token);

export function sign(payload) {
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(String(payload)).digest('base64url');
  return mac;
}

/** CSRF token bound to a session id, stateless and cheap to verify. */
export function makeCsrfToken(sessionId) {
  return `${sessionId}.${sign(`csrf:${sessionId}`)}`;
}

export function verifyCsrfToken(sessionId, token) {
  if (!sessionId || typeof token !== 'string') return false;
  const expected = makeCsrfToken(sessionId);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ *
 * Password policy
 * ------------------------------------------------------------------ */
const COMMON = new Set([
  'password', 'password1', 'password123', 'qwerty', 'qwerty123', '123456', '12345678', '123456789',
  'abc123', 'iloveyou', 'letmein', 'welcome', 'welcome1', 'monkey', 'dragon', 'football',
  'sunshine', 'princess', 'admin', 'passw0rd', 'trustno1', 'whatever', 'starwars',
  'miso', 'cooking', 'biryani', 'pancake', 'noodles', 'chicken', '111111', '000000',
]);

/** Returns a list of human-readable problems; empty list == acceptable. */
export function passwordProblems(password, { email = '', name = '' } = {}) {
  const value = String(password ?? '');
  const problems = [];
  if (value.length < config.password.minLength) problems.push(`Use at least ${config.password.minLength} characters.`);
  if (Buffer.byteLength(value, 'utf8') > config.password.maxBytes) problems.push('That password is too long.');
  const lower = value.toLowerCase();
  if (COMMON.has(lower)) problems.push('That password is too common.');
  if (/^(.)\1+$/.test(lower)) problems.push('Avoid repeating a single character.');
  if (email && lower.includes(String(email).split('@')[0].toLowerCase()) && String(email).split('@')[0].length > 2) {
    problems.push('Do not reuse your email address in the password.');
  }
  if (name && lower.includes(String(name).toLowerCase()) && String(name).length > 2) {
    problems.push('Do not reuse your name in the password.');
  }
  if (/(?:19|20)\d\d(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])/.test(lower)) problems.push('Avoid dates of birth.');
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((re) => re.test(value)).length;
  if (classes < 2) problems.push('Mix at least two of: lowercase, uppercase, numbers, symbols.');
  return problems;
}

/** 0-4, used for the strength meter on "Create new account". */
export function passwordStrength(password) {
  const value = String(password ?? '');
  if (!value) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((re) => re.test(value)).length;
  const unique = new Set(value).size;
  let score = Math.min(4, Math.floor((value.length / 6 + classes * 1.5 + unique / 6) / 2));
  if (COMMON.has(value.toLowerCase())) score = 0;
  if (passwordProblems(value).length > 1) score = Math.min(score, 2);
  return score;
}
