import { config } from '../src/config.mjs';

/** Minimal cookie-jar client so the tests exercise the real cookie flow. */
export function makeClient(base) {
  const jar = new Map();
  let csrf = null;

  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

  async function request(method, path, body, opts = {}) {
    const headers = { accept: 'application/json', ...opts.headers };
    if (cookieHeader()) headers.cookie = cookieHeader();
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET' && !opts.skipCsrf) {
      const token = opts.csrf ?? csrf;
      if (token) headers['x-csrf-token'] = token;
    }
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '' || /Max-Age=0/i.test(line)) jar.delete(name);
      else jar.set(name, value);
    }
    const json = res.status === 204 ? null : await res.json().catch(() => null);
    if (json?.csrfToken) csrf = json.csrfToken;
    return { status: res.status, body: json, headers: res.headers, cookieString: cookieHeader() };
  }

  return {
    request,
    get: (p, o) => request('GET', p, undefined, o),
    post: (p, b, o) => request('POST', p, b ?? {}, o),
    jar,
    get csrf() {
      return csrf;
    },
    set csrf(value) {
      csrf = value;
    },
    sessionCookie: () => jar.get(config.cookieName) ?? null,
  };
}

export async function bootApp() {
  const { createApp } = await import('../src/app.mjs');
  const app = createApp();
  const server = await new Promise((resolve) => {
    const handle = app.listen(0, '127.0.0.1', () => resolve(handle));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    server,
    client: makeClient(base),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function loginAs(client, email, password) {
  return client.post('/api/auth/login', { email, password });
}
