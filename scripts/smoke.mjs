/**
 * Render smoke test.
 *
 *   npm run smoke
 *
 * Boots the real React application inside jsdom against a running API server and
 * asserts that every route renders meaningful, data-backed content without
 * throwing. Requires `npm run dev:api` (or `npm run dev`) to be running.
 */
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { createServer } from 'vite';

const API_ORIGIN = process.env.SMOKE_API_ORIGIN ?? 'http://127.0.0.1:8787';
const SETTLE_MS = Number(process.env.SMOKE_SETTLE_MS ?? 2200);

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
});

const { window } = dom;
const define = (key, value) =>
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });

define('window', window);
define('document', window.document);
define('navigator', window.navigator);
define('location', window.location);
define('HTMLElement', window.HTMLElement);
define('HTMLInputElement', window.HTMLInputElement);
define('Element', window.Element);
define('Node', window.Node);
define('Event', window.Event);
define('CustomEvent', window.CustomEvent);
define('MouseEvent', window.MouseEvent);
define('KeyboardEvent', window.KeyboardEvent);
define('getComputedStyle', window.getComputedStyle.bind(window));
define('localStorage', window.localStorage);
window.matchMedia ??= (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});
define('requestAnimationFrame', (callback) => setTimeout(() => callback(performance.now()), 16));
define('cancelAnimationFrame', (handle) => clearTimeout(handle));
define('IS_REACT_ACT_ENVIRONMENT', false);

// The app calls relative `/api/...` URLs; point them at the running API.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const target = url.startsWith('/') ? `${API_ORIGIN}${url}` : url;
  return nativeFetch(target, init);
};

// `expect` mixes static copy with strings that can only come from Postgres
// (stop, line and model names), so a green run proves the data path works.
const ROUTES = [
  {
    path: '/',
    name: 'Commuter dashboard',
    expect: ['Commuter Dashboard', 'Busiest right now', 'Saved journeys', 'Greenfield', 'Network pressure'],
  },
  {
    path: '/routes?origin=STN-12&destination=STN-04&avoidCrowding=true&maxTransfers=1',
    name: 'Route results',
    expect: ['crowd-aware option', 'Why this recommendation', 'Greenfield', 'Peak', 'Crowding scale'],
  },
  {
    path: '/routes/details?origin=STN-12&destination=STN-04&lineId=LN-B12&stopId=STN-12',
    name: 'Route details',
    expect: ['Boarding plan', 'Crowd forecast', 'Model breakdown', 'Greenfield'],
  },
  {
    path: '/operator',
    name: 'Operator dashboard',
    expect: ['Line load profile', 'System health', 'Red Line', 'Crosstown 12'],
  },
  {
    path: '/alerts',
    name: 'Alerts',
    expect: ['Service notices', 'Severity mix', 'Signal failure'],
  },
  {
    path: '/settings',
    name: 'Settings',
    expect: ['Routing preferences', 'Saved journeys', 'Ava Chen'],
  },
];

const errors = [];
const originalError = console.error;
console.error = (...args) => {
  errors.push(args.map((value) => (value instanceof Error ? value.message : String(value))).join(' '));
  originalError(...args);
};

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  root: path.resolve(process.cwd()),
});

let failures = 0;

try {
  const api = await nativeFetch(`${API_ORIGIN}/api/health`).then((response) => response.json());
  console.log(
    `[smoke] API ok · ${api.database.driver} · schema ${api.database.schemaVersion} · ` +
      `${api.database.rows.observation_count} observations`,
  );

  const { renderRoute } = await vite.ssrLoadModule('/src/smoke/entry.tsx');

  for (const route of ROUTES) {
    const before = errors.length;
    let html = '';
    try {
      html = await renderRoute(route.path, SETTLE_MS);
    } catch (error) {
      console.log(`✗ ${route.name} — threw during render: ${error.message}`);
      failures += 1;
      continue;
    }

    const missing = route.expect.filter((needle) => !html.includes(needle));
    const routeErrors = errors.slice(before);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (!text.length) {
      console.log(`✗ ${route.name} — rendered an empty document`);
      failures += 1;
    } else if (missing.length || routeErrors.length) {
      console.log(`✗ ${route.name} — missing ${JSON.stringify(missing)}`);
      for (const message of routeErrors) console.log(`    console.error: ${message}`);
      failures += 1;
    } else {
      console.log(`✓ ${route.name} — ${text.length} chars · "${text.slice(0, 88)}…"`);
    }
  }
} finally {
  await vite.close();
  console.error = originalError;
}

if (failures) {
  console.log(`\n[smoke] ${failures} route(s) failed`);
  process.exit(1);
}
console.log('\n[smoke] all routes rendered successfully');
