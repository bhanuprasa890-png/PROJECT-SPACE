import './env.mjs';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resetDbForTests } from '../src/db.mjs';
import { bootApp, makeClient } from './helpers.mjs';

let app;
let base;

before(async () => {
  resetDbForTests(':memory:');
  app = await bootApp();
  base = app.base;
});
after(async () => app.close());

const unique = (label) => `${label}.${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;

async function register(client, overrides = {}) {
  const email = overrides.email ?? unique('cook');
  const res = await client.post('/api/auth/register', {
    name: 'Test Cook',
    email,
    password: 'Saffron#Pan2026!',
    ...overrides,
    email,
  });
  return { email, res };
}

describe('GET /api/health and /api/auth/config', () => {
  test('health is public and reports demo google mode', async () => {
    const res = await app.client.get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.googleMode, 'demo');
  });

  test('config exposes the demo Google accounts in demo mode', async () => {
    const res = await app.client.get('/api/auth/config');
    assert.equal(res.status, 200);
    assert.equal(res.body.demoAccounts.length, 3);
    assert.equal(res.body.demoAccounts[0].email, 'priya.nair@gmail.com');
    assert.equal(res.body.demoAccounts[0].passcode, 'MiseDemo#2026');
    assert.equal(res.body.passwordMinLength, 10);
  });

  test('security headers are set on every response', async () => {
    const res = await fetch(`${base}/api/health`);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-src https:\/\/accounts\.google\.com/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'same-origin');
    assert.notEqual(res.headers.get('x-powered-by'), 'Express');
  });
});

describe('create new account', () => {
  test('creates the account and signs it in with httpOnly cookies', async () => {
    const client = makeClient(base);
    const { email, res } = await register(client);
    assert.equal(res.status, 201);
    assert.equal(res.body.user.email, email);
    assert.equal(res.body.user.provider, 'password');
    assert.ok(client.sessionCookie(), 'session cookie was set');

    const me = await client.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, email);
  });

  test('rejects weak passwords with per-field messages', async () => {
    const client = makeClient(base);
    const res = await client.post('/api/auth/register', { name: 'Weak', email: unique('weak'), password: 'password' });
    assert.equal(res.status, 400);
    assert.match(res.body.fields.password, /at least 10 characters/);
  });

  test('rejects invalid email and short names', async () => {
    const client = makeClient(base);
    const res = await client.post('/api/auth/register', { name: 'X', email: 'not-an-email', password: 'Saffron#Pan2026!' });
    assert.equal(res.status, 400);
    assert.ok(res.body.fields.email);
    assert.ok(res.body.fields.name);
  });

  test('duplicate email is a 409, not a 500', async () => {
    const email = unique('dup');
    const a = makeClient(base);
    const b = makeClient(base);
    await register(a, { email });
    const second = await register(b, { email });
    assert.equal(second.res.status, 409);
    assert.match(second.res.body.error, /already exists/);
  });

  test('never returns hashes, tokens or internals', async () => {
    const client = makeClient(base);
    const { res } = await register(client);
    const text = JSON.stringify(res.body);
    assert.doesNotMatch(text, /scrypt|password_hash|token_hash|demo_code|SESSION_SECRET/);
  });
});

describe('log in', () => {
  test('logs in the seeded local demo account', async () => {
    const client = makeClient(base);
    const res = await client.post('/api/auth/login', { email: 'chef@mise.dev', password: 'MiseDemo#2026' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.provider, 'password');
    assert.match(client.sessionCookie(), /^[A-Za-z0-9_-]{32,}\./);
  });

  test('unknown email and wrong password give the same generic error', async () => {
    const a = await app.client.post('/api/auth/login', { email: unique('ghost'), password: 'Whatever#123' });
    const b = await app.client.post('/api/auth/login', { email: 'chef@mise.dev', password: 'WrongPassword#1' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.error, b.body.error, 'no account enumeration');
  });

  test('locks the account after repeated failures', async () => {
    const email = unique('lockedout');
    const client = makeClient(base);
    await register(client, { email });
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await makeClient(base).post('/api/auth/login', { email, password: 'BadPassword#2026' });
      assert.equal(last.status, 401);
    }
    const sixth = await makeClient(base).post('/api/auth/login', { email, password: 'Saffron#Pan2026!' });
    assert.equal(sixth.status, 429, 'correct password is still refused while locked');
    assert.match(sixth.body.error, /Too many failed attempts/);
  });

  test('login rotates the session cookie (old cookie still works, but is a new row)', async () => {
    const client = makeClient(base);
    const { email } = await register(client);
    const first = client.sessionCookie();
    const again = await client.post('/api/auth/login', { email, password: 'Saffron#Pan2026!' });
    assert.equal(again.status, 200);
    assert.notEqual(client.sessionCookie(), first);
  });
});

describe('log out', () => {
  test('logout revokes the session and clears cookies', async () => {
    const client = makeClient(base);
    await register(client);
    assert.equal((await client.get('/api/auth/me')).status, 200);
    const out = await client.post('/api/auth/logout');
    assert.equal(out.status, 200);
    assert.equal(client.sessionCookie(), null);
    assert.equal((await client.get('/api/auth/me')).status, 401);
  });

  test('a stolen cookie is useless after logout', async () => {
    const client = makeClient(base);
    await register(client);
    const stolenCookie = client.sessionCookie();
    await client.post('/api/auth/logout');
    const res = await fetch(`${base}/api/auth/me`, { headers: { cookie: `mise_sid=${stolenCookie}` } });
    assert.equal(res.status, 401);
  });
});

describe('google sign-in (demo mode)', () => {
  test('signs in a demo Google account with the shared passcode', async () => {
    const client = makeClient(base);
    const res = await client.post('/api/auth/google/demo', { email: 'priya.nair@gmail.com', passcode: 'MiseDemo#2026' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.provider, 'google');
    const me = await client.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, 'priya.nair@gmail.com');
  });

  test('email casing/whitespace does not break the chooser', async () => {
    const res = await app.client.post('/api/auth/google/demo', { email: '  ARJUN.MEHTA@gmail.com ', passcode: 'MiseDemo#2026' });
    assert.equal(res.status, 200);
  });

  test('wrong demo passcode is refused', async () => {
    const res = await app.client.post('/api/auth/google/demo', { email: 'sana.cooks@gmail.com', passcode: 'nope' });
    assert.equal(res.status, 401);
    assert.match(res.body.error, /passcode/i);
  });

  test('non-demo emails cannot use the demo provider', async () => {
    const res = await app.client.post('/api/auth/google/demo', { email: `${unique('intruder')}`, passcode: 'MiseDemo#2026' });
    assert.equal(res.status, 401);
    assert.match(res.body.error, /demo/i);
  });

  test('live credential endpoint is closed while in demo mode', async () => {
    const res = await app.client.post('/api/auth/google/credential', { credential: 'a.b.c' });
    assert.equal(res.status, 400);
  });
});

describe('route gating + CSRF', () => {
  test('recipe cards require a session', async () => {
    const anon = makeClient(base);
    const res = await anon.get('/api/recipes');
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'AUTH_REQUIRED');
  });

  test('signed-in clients can read the cards', async () => {
    const client = makeClient(base);
    await client.post('/api/auth/google/demo', { email: 'priya.nair@gmail.com', passcode: 'MiseDemo#2026' });
    const res = await client.get('/api/recipes');
    assert.equal(res.status, 200);
    assert.equal(res.body.recipes.length, 12);
  });

  test('writes without a CSRF token are refused', async () => {
    const client = makeClient(base);
    await client.post('/api/auth/google/demo', { email: 'priya.nair@gmail.com', passcode: 'MiseDemo#2026' });
    const cookie = client.sessionCookie();
    const res = await fetch(`${base}/api/recipes/garlic-butter-paneer/favorite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `mise_sid=${cookie}` },
      body: JSON.stringify({ favorite: true }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /CSRF/);
  });

  test('writes with the CSRF token succeed', async () => {
    const client = makeClient(base);
    await client.post('/api/auth/google/demo', { email: 'priya.nair@gmail.com', passcode: 'MiseDemo#2026' });
    const res = await client.post('/api/recipes/garlic-butter-paneer/favorite', { favorite: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.favorite, false);
  });
});
