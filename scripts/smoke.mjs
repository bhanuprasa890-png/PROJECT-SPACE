/**
 * End-to-end smoke test against a running app (dev or preview URL).
 * Mirrors what the browser does: cookie jar, CSRF echo, gated cards, logout.
 *
 *   npm run smoke                       # http://127.0.0.1:5173
 *   BASE_URL=https://… npm run smoke
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';
const DEMO_PASSCODE = process.env.DEMO_PASSCODE || 'MiseDemo#2026';

let passed = 0;
let failed = 0;
const jar = new Map();
let csrf = null;
let lastSetCookie = [];

function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${label} ${detail ? `→ ${detail}` : ''}`);
  }
}

async function req(method, path, body) {
  const headers = { accept: 'application/json' };
  if (jar.size) headers.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  lastSetCookie = res.headers.getSetCookie();
  for (const line of lastSetCookie) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (value === '' || /Max-Age=0/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (json?.csrfToken) csrf = json.csrfToken;
  return { status: res.status, json };
}

console.log(`\n\x1b[1mMise smoke\x1b[0m → ${BASE}\n`);

const health = await req('GET', '/api/health');
check('api is reachable', health.status === 200, `status ${health.status}`);

const page = await fetch(`${BASE}/`);
const html = await page.text();
check('serves the SPA shell', html.includes('<div id="root">'));
check('login page is the title of the entry screen', /<title>Mise · Log in<\/title>/.test(html));

const anon = await req('GET', '/api/recipes');
check('recipe cards are gated (401 without a session)', anon.status === 401, `got ${anon.status}`);

const config = await req('GET', '/api/auth/config');
check('config lists demo Google accounts', (config.json?.demoAccounts?.length ?? 0) === 3);
const demoEmail = config.json?.demoAccounts?.[0]?.email || 'priya.nair@gmail.com';

const badCode = await req('POST', '/api/auth/google/demo', { email: demoEmail, passcode: 'wrong' });
check('wrong demo passcode is refused', badCode.status === 401, `status ${badCode.status}`);

const google = await req('POST', '/api/auth/google/demo', { email: demoEmail, passcode: DEMO_PASSCODE });
check('Google demo sign-in works', google.status === 200 && google.json?.user?.provider === 'google', JSON.stringify(google.json?.error ?? ''));

const sessionCookieLine = lastSetCookie.find((line) => line.startsWith('mise_sid=')) ?? '';
check('session cookie is HttpOnly + SameSite=Lax', /HttpOnly/i.test(sessionCookieLine) && /SameSite=Lax/i.test(sessionCookieLine), sessionCookieLine);
check('CSRF cookie is readable (double-submit) but session is not', !/HttpOnly/i.test(lastSetCookie.find((l) => l.startsWith('mise_csrf=')) ?? 'x') && jar.has('mise_sid'));

const me = await req('GET', '/api/auth/me');
check('/api/auth/me returns the user + csrf token', me.status === 200 && Boolean(me.json?.csrfToken));

const recipes = await req('GET', '/api/recipes');
check('signed-in client gets the 12 cards', recipes.json?.recipes?.length === 12, `got ${recipes.json?.recipes?.length}`);
check('cards carry favourite + step data', recipes.json?.recipes?.every((r) => typeof r.favorite === 'boolean' && r.steps?.length > 0));

const copilots = await req('GET', '/api/copilots');
check('3D copilot crew is served', copilots.json?.copilots?.length === 5 && copilots.json.copilots.every((c) => c.mesh));

const fav = await req('POST', `/api/recipes/${recipes.json.recipes[0].id}/favorite`, { favorite: true });
check('favourite write passes CSRF + persists', fav.status === 200 && fav.json.favorite === true);

const noCsrf = await fetch(`${BASE}/api/recipes/${recipes.json.recipes[1].id}/favorite`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: `mise_sid=${jar.get('mise_sid')}` },
  body: JSON.stringify({ favorite: true }),
});
check('write without the CSRF token is refused (403)', noCsrf.status === 403, `status ${noCsrf.status}`);

const stats = await req('GET', '/api/stats');
check('stats endpoint reports personal numbers', stats.status === 200 && typeof stats.json.favorites === 'number');

const sessions = await req('GET', '/api/auth/sessions');
check('session list marks exactly one current device', sessions.status === 200 && sessions.json.sessions.filter((s) => s.current).length === 1);

const leakProbe = await req('GET', '/api/recipes');
check('no hashes/tokens leak into responses', !JSON.stringify(leakProbe.json).match(/scrypt|token_hash|password_hash|demo_code/));

const out = await req('POST', '/api/auth/logout', {});
check('logout succeeds', out.status === 200);
check('cookie jar cleared', !jar.has('mise_sid'));
const afterOut = await req('GET', '/api/auth/me');
check('session is dead after logout', afterOut.status === 401);

console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
