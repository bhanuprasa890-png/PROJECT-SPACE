/**
 * Dashboard recovery check.
 *
 *   npm run check:recovery            # both dashboards, 12-second API outage
 *   npm run check:recovery -- --down=30 --path=/operator
 *
 * Why this exists
 * ---------------
 * The API restarts on every `tsx watch` reload and whenever the embedded database
 * is busy. A dashboard that simply dies when that happens — and never comes back
 * without a manual reload — is the failure this check guards against:
 *
 *   1. it mounts the real app with the real query client behind a switchable
 *      proxy, with the API unreachable, and
 *   2. asserts the screen degrades *usefully*: a named loading state, then an error
 *      panel that explains the cause and offers a retry (never a raw exception or a
 *      blank page), and
 *   3. brings the API back and asserts the dashboard recovers on its own, without
 *      a reload or a click.
 *
 * It also fails on any React render error (for example a Rules-of-Hooks violation
 * that only triggers when a component re-renders out of its error state).
 */
import { JSDOM } from 'jsdom';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { createServer } from 'vite';

const arg = (name, fallback) => {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  return found ? found.split('=')[1] : fallback;
};

const API_PORT = Number(process.env.API_PORT ?? 8787);
const PROXY_PORT = Number(process.env.RECOVERY_PROXY_PORT ?? 8790);
// Long enough for the dashboards to stop re-trying and explain the failure
// (requests are retried for ~6 s, then the error panel appears after 10 s).
const DOWN_SECONDS = Number(arg('down', 14));
const ONLY_PATH = arg('path', null);
const RECOVERY_BUDGET_MS = Number(arg('budget', 25_000));

const TARGETS = [
  {
    path: '/',
    name: 'Commuter dashboard',
    healthy: ['Today at a glance'],
    broken: 'Dashboard data unavailable',
  },
  {
    path: '/operator',
    name: 'Operator command center',
    healthy: ['Network status', 'AI action'],
    broken: 'Control room feed unavailable',
  },
].filter((target) => !ONLY_PATH || target.path === ONLY_PATH);

/* -------------------------------------------------------------------------- */
/* A proxy that can be "unplugged" like a restarting API                      */
/* -------------------------------------------------------------------------- */

let apiUp = false;
const proxy = http.createServer((req, res) => {
  if (!apiUp) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'API is restarting', code: 'BAD_GATEWAY' } }));
    return;
  }
  const upstream = http.request(
    { hostname: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', () => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'upstream down', code: 'BAD_GATEWAY' } }));
  });
  req.pipe(upstream);
});
await new Promise((resolve) => proxy.listen(PROXY_PORT, '127.0.0.1', resolve));

const reachable = await new Promise((resolve) => {
  const socket = net.connect({ host: '127.0.0.1', port: API_PORT }, () => {
    socket.destroy();
    resolve(true);
  });
  socket.on('error', () => resolve(false));
  socket.setTimeout(500, () => {
    socket.destroy();
    resolve(false);
  });
});
if (!reachable) {
  console.error(
    `\n[check:recovery] Start the API first (npm run dev:api) — nothing is listening on :${API_PORT}.\n`,
  );
  proxy.close();
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* jsdom environment                                                          */
/* -------------------------------------------------------------------------- */

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
});
const { window } = dom;
const define = (key, value) =>
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });

define('window', window);
for (const key of [
  'document', 'navigator', 'location', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node',
  'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'localStorage',
]) {
  define(key, window[key]);
}
define('getComputedStyle', window.getComputedStyle.bind(window));
window.matchMedia ??= (query) => ({
  matches: false, media: query, onchange: null,
  addEventListener: () => {}, removeEventListener: () => {},
  addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
});
define('requestAnimationFrame', (cb) => setTimeout(() => cb(performance.now()), 16));
define('cancelAnimationFrame', (handle) => clearTimeout(handle));
define('IS_REACT_ACT_ENVIRONMENT', false);
define('ResizeObserver', class { observe() {} disconnect() {} });

const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  return nativeFetch(url.startsWith('/') ? `http://127.0.0.1:${PROXY_PORT}${url}` : url, init);
};

// Collect React/runtime errors: a dashboard that "recovers" by crashing is not fixed.
const runtimeErrors = [];
const originalError = console.error;
console.error = (...args) => {
  runtimeErrors.push(args.map((value) => (value instanceof Error ? value.message : String(value))).join(' '));
};

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  root: path.resolve(process.cwd()),
  define: { 'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify('recovery-check-key') },
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const textOf = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

try {
  const { mountApp, readHtml, unmountApp, cacheState } = await vite.ssrLoadModule('/src/smoke/recovery.tsx');

  for (const target of TARGETS) {
    console.log(`\n${target.name} (${target.path}) — API unreachable for ${DOWN_SECONDS}s\n`);

    const started = Date.now();
    runtimeErrors.length = 0;
    mountApp(target.path);

    await wait(DOWN_SECONDS * 1000);

    const during = readHtml();
    const duringText = textOf(during);
    const showsLoading = /Loading dashboard data|Loading network|Placing your journey/i.test(duringText);
    const showsError = duringText.includes(target.broken);
    const explains = /check the database connection|not reachable|reconnecting|Retry/i.test(duringText);
    const crashed = runtimeErrors.some((message) => /rules of hooks|change in the order of hooks|Cannot update a component/i.test(message));

    check('stayed alive while the API was down (no dead screen)', during.length > 400, `${during.length} chars rendered`);
    check('showed a loading or error state, not a blank panel', showsLoading || showsError,
      showsLoading ? 'loading state' : showsError ? 'error panel' : 'neither');
    check('explained the failure and offered a retry', explains);
    check('no React render crash (hook order, setState in render)', !crashed,
      crashed ? runtimeErrors.find((m) => /hooks|Cannot update/.test(m))?.slice(0, 90) : 'clean');

    // The API comes back.
    apiUp = true;
    const apiBackAt = Date.now();

    let recovered = false;
    for (let waited = 0; waited <= RECOVERY_BUDGET_MS && !recovered; waited += 1_000) {
      const text = textOf(readHtml());
      if (target.healthy.some((marker) => text.includes(marker)) && !text.includes(target.broken)) {
        recovered = true;
      } else {
        await wait(1_000);
      }
    }

    const seconds = ((Date.now() - apiBackAt) / 1000).toFixed(1);
    check('recovered on its own once the API returned', recovered, recovered ? `${seconds}s after the API came back` : `gave up after ${RECOVERY_BUDGET_MS / 1000}s`);
    const settled = cacheState();
    check('no query left in an error state', !/:error/.test(settled), settled);

    unmountApp();
    apiUp = false;
    console.log(`  (total check time ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }
} finally {
  console.error = originalError;
  await vite.close();
  proxy.close();
}

if (failures) {
  console.log(`\n[check:recovery] ${failures} check(s) failed\n`);
  process.exit(1);
}
console.log('\n[check:recovery] both dashboards degrade usefully and recover without a reload\n');
process.exit(0);
